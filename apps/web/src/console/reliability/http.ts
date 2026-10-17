// JSON over fetch for the console API, with a timeout on every call and plain-word errors.
// Pure (no React); useApi.ts re-exports ApiError / request helpers from here.
import { scrubLeaks } from "../../ui/plain";

/** Default timeout for any console API call. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Running a case waits for the agent's whole trace (the server allows 5 minutes). */
export const EXECUTE_TIMEOUT_MS = 6 * 60_000;

export const MSG_UNREACHABLE = "Can't reach Hamyway City right now.";
export const MSG_TIMEOUT = "This is taking too long. Try again in a moment.";
export const MSG_SERVER = "Something went wrong. Try again in a moment.";

/**
 * `message` is plain words safe to show anyone (ui-simplify-brief: no paths, codes or server
 * jargon on main screens). `detail` keeps the technical reason for Advanced views and logs.
 * `status` is the HTTP status, or 0 when no response arrived (network error or timeout).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string = message,
    readonly kind: "http" | "network" | "timeout" = status === 0 ? "network" : "http",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** No answer at all (network down, timed out) or the gateway says the far side is down. */
export function isConnectionError(e: unknown): boolean {
  return e instanceof ApiError && (e.kind !== "http" || e.status === 502 || e.status === 503 || e.status === 504);
}

/** Worth retrying automatically: connection trouble, 5xx, 408, 429. A 4xx won't fix itself. */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.kind !== "http" || e.status >= 500 || e.status === 408 || e.status === 429;
}

export function isAbortError(e: unknown): boolean {
  return (e as Error | null)?.name === "AbortError";
}

function describe(status: number, body: unknown, path: string): ApiError {
  const server =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  const detail = `${path}: HTTP ${status}${server ? `: ${server}` : ""}`;
  if (status === 404) return new ApiError("This isn't ready yet.", status, detail);
  if (status === 408 || status === 504) return new ApiError(MSG_TIMEOUT, status, detail);
  if (status === 429) return new ApiError("Hamyway City is busy. Try again in a moment.", status, detail);
  if (status >= 500) return new ApiError(MSG_SERVER, status, detail);
  return new ApiError(server ? scrubLeaks(server) || "That didn't work." : "That didn't work.", status, detail);
}

/**
 * A signal that aborts when `outer` aborts or after `ms`. `timedOut()` tells the two apart.
 * Always call `dispose()` so the timer and listener don't leak.
 */
export function timeoutSignal(ms: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  let fired = false;
  const timer = ms > 0 && Number.isFinite(ms) ? setTimeout(() => {
    fired = true;
    ctrl.abort();
  }, ms) : undefined;
  const onOuter = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctrl.signal,
    timedOut: () => fired,
    dispose: () => {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

export interface RequestOptions {
  /** Cancel from outside (e.g. on unmount). Rejects with an AbortError, never an ApiError. */
  signal?: AbortSignal;
  /** ms before giving up; default DEFAULT_TIMEOUT_MS. 0 = no timeout. */
  timeoutMs?: number;
}

function abortError(): Error {
  const e = new Error("The request was cancelled.");
  e.name = "AbortError";
  return e;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t = timeoutSignal(timeoutMs, opts.signal);
  const bare = path.split("?")[0];
  const fail = (e: unknown, what: string): never => {
    if (t.timedOut()) throw new ApiError(MSG_TIMEOUT, 0, `${bare}: no answer after ${Math.round(timeoutMs / 1000)} s`, "timeout");
    if (opts.signal?.aborted || isAbortError(e)) throw abortError();
    throw new ApiError(MSG_UNREACHABLE, 0, `${bare}: ${what}`, "network");
  };
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        signal: t.signal,
        cache: "no-store",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      return fail(e, "network error");
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      return fail(e, "connection dropped while reading the answer");
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) throw new ApiError(MSG_SERVER, res.status, `${bare}: non-JSON response`);
    }
    if (!res.ok) throw describe(res.status, json, bare);
    return json as T;
  } finally {
    t.dispose();
  }
}
