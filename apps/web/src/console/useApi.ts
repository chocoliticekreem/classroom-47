"use client";
// Tiny fetch hooks for the console API (contract: ./types.ts ConsoleApi). Same-origin, JSON only.
//
//   const { data, error, loading, reload, updatedAt } = useEvidence({ pollMs: 5000 });
//   const res = await consoleApi.execute({ caseId: "delivery-024" });
//
// Reliability (./reliability):
// - Every call has a timeout (15 s; 6 min for execute) and fails with plain words.
// - Components reading the same path share ONE poller: one request in flight, one timer, one
//   cached answer (interval = the fastest subscriber's pollMs). The last unmount aborts it.
// - Polling slows down 4x while the tab is hidden and backs off exponentially on errors (to 60 s);
//   fetch-once hooks retry by themselves after connection errors, so blips heal without a click.
// - `loading` is true only until the first response for the current path; polling refreshes
//   in the background (stale-while-revalidate), so tables don't flash.
// - Errors keep the last good `data` so a blip doesn't blank the screen. While the agent-offline
//   banner is showing, connection errors are not repeated in every panel.
import { useCallback, useState, useSyncExternalStore } from "react";
import type { ConsoleApi, EvidenceRow, ExecutionRecord, WorkflowRecord } from "./types";
import {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  EXECUTE_TIMEOUT_MS,
  isConnectionError,
  request,
  type RequestOptions,
} from "./reliability/http";
import { EMPTY_SNAPSHOT, type PollSnapshot } from "./reliability/poller";
import { sharedPoller } from "./reliability/shared";
import { AGENT_OFFLINE_MESSAGE, isAgentKnownOffline, useOfflineBannerShowing } from "./reliability/agentStatus";

export { ApiError, DEFAULT_TIMEOUT_MS, EXECUTE_TIMEOUT_MS };
export type { RequestOptions };

export type ApiResponse<K extends keyof ConsoleApi> = ConsoleApi[K];
export type ExecutionSummary = ApiResponse<"GET /api/console/executions?limit&dataset">["executions"][number];
export type EvidenceResponse = ApiResponse<"GET /api/console/evidence">;
export type StatusResponse = ApiResponse<"GET /api/console/status">;
export type CaseOption = ApiResponse<"GET /api/console/cases?dataset&q">["cases"][number];

/** `signal` may also be passed as a RequestOptions object ({ signal, timeoutMs }). */
export const getJson = <T>(path: string, signal?: AbortSignal | RequestOptions) =>
  request<T>("GET", path, undefined, signal instanceof AbortSignal || signal === undefined ? { signal } : signal);
export const postJson = <T>(path: string, body?: unknown, opts?: RequestOptions) =>
  request<T>("POST", path, body ?? {}, opts);
export const putJson = <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>("PUT", path, body, opts);

/** Build "/path?a=1&b=2", skipping null/undefined/"" values. */
export function withQuery(path: string, q: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

export interface ApiState<T> {
  data: T | undefined;
  error: string | undefined;
  /** First load for the current path is in flight. */
  loading: boolean;
  /** ms epoch of the last successful response. */
  updatedAt: number | undefined;
  /** Refetch now (keeps current data while loading; joins a request already in flight). */
  reload: () => void;
}

export interface UseApiOptions {
  /** Poll interval in ms. 0/undefined = fetch once. */
  pollMs?: number;
}

const noopUnsubscribe = () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;

/** GET `path` (null = skip). Generic hook; prefer the typed wrappers below. */
export function useApi<T>(path: string | null, { pollMs }: UseApiOptions = {}): ApiState<T> {
  const subscribe = useCallback(
    (onChange: () => void) => (path ? sharedPoller.subscribe(path, pollMs ?? 0, onChange) : noopUnsubscribe),
    [path, pollMs],
  );
  const getSnapshot = useCallback(() => (path ? sharedPoller.getSnapshot(path) : EMPTY_SNAPSHOT), [path]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot) as PollSnapshot<T>;
  const bannerShowing = useOfflineBannerShowing();
  const reload = useCallback(() => {
    if (path) void sharedPoller.refresh(path);
  }, [path]);

  const hideError = bannerShowing && isConnectionError(snap.error);
  return {
    data: path ? snap.data : undefined,
    error: path && snap.error && !hideError ? snap.error.message : undefined,
    loading: path !== null && !snap.settled,
    updatedAt: path ? snap.updatedAt : undefined,
    reload,
  };
}

// ---- Typed wrappers, one per endpoint in ConsoleApi ----

export const useStatus = (opts: UseApiOptions = { pollMs: 5000 }) =>
  useApi<StatusResponse>("/api/console/status", opts);

export const useEvidence = (opts?: UseApiOptions) => useApi<EvidenceResponse>("/api/console/evidence", opts);

export const useExecutions = (q: { limit?: number; dataset?: string | null } = {}, opts?: UseApiOptions) =>
  useApi<ApiResponse<"GET /api/console/executions?limit&dataset">>(
    withQuery("/api/console/executions", { limit: q.limit, dataset: q.dataset }),
    opts,
  );

/** id null = skip. */
export const useExecution = (id: string | null, opts?: UseApiOptions) =>
  useApi<ApiResponse<"GET /api/console/executions/:id">>(
    id ? `/api/console/executions/${encodeURIComponent(id)}` : null,
    opts,
  );

export const useWorkflows = (opts?: UseApiOptions) =>
  useApi<ApiResponse<"GET /api/console/workflows">>("/api/console/workflows", opts);

/** enabled=false skips the request (e.g. until a picker opens). */
export const useCases = (q: { dataset?: string | null; q?: string | null } = {}, enabled = true, opts?: UseApiOptions) =>
  useApi<ApiResponse<"GET /api/console/cases?dataset&q">>(
    enabled ? withQuery("/api/console/cases", { dataset: q.dataset, q: q.q }) : null,
    opts,
  );

// ---- Mutations ----

/** When the agent is known to be offline, say so instead of a generic server/connection error. */
function explainOffline(e: unknown): never {
  if ((isConnectionError(e) || (e instanceof ApiError && e.status >= 500)) && isAgentKnownOffline()) {
    const err = e as ApiError;
    throw new ApiError(AGENT_OFFLINE_MESSAGE, err.status, err.detail, err.kind);
  }
  throw e;
}

export const consoleApi = {
  execute: (body: { caseId: string; dataset?: string; workflowId?: string }) =>
    postJson<ApiResponse<"POST /api/console/execute">>("/api/console/execute", body, {
      timeoutMs: EXECUTE_TIMEOUT_MS,
    }).catch(explainOffline),
  importRuns: () => postJson<ApiResponse<"POST /api/console/import">>("/api/console/import"),
  saveWorkflow: (wf: WorkflowRecord) =>
    putJson<ApiResponse<"PUT /api/console/workflows/:id">>(
      `/api/console/workflows/${encodeURIComponent(wf.id)}`,
      wf,
    ),
};

/** Wrap an async action with pending/error state: const imp = useAction(consoleApi.importRuns). */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, clearError: useCallback(() => setError(undefined), []) };
}

export type { EvidenceRow, ExecutionRecord, WorkflowRecord };
