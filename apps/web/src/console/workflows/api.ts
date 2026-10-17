// Client calls for the workflow editor. Every call resolves (never throws) so the UI can show
// a clear state when the console API is missing (404) or down.
import type { ConsoleApi, ConsoleTestApi, ExecutionRecord, Flow, ScenarioSetId, WorkflowRecord, WorkflowVersion } from "../types";
import type { ArchitectResult } from "./architect";
import { buildIntakeRequest } from "../intake/request";
import { splitThread } from "../intake/split";
import fileFlow from "../../../../api/flows/default-incident.json";

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const msg = (body as { error?: string } | null)?.error ?? (res.status === 404 ? "endpoint not found" : res.statusText);
      return { ok: false, status: res.status, error: msg || `HTTP ${res.status}` };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }
}

/** The flow file shipped in the repo, used when the API has no workflows. */
export function fileWorkflow(): WorkflowRecord {
  return {
    id: (fileFlow as Flow).id,
    name: (fileFlow as Flow).name,
    flow: structuredClone(fileFlow as Flow),
    positions: {},
    active: true,
    updatedAt: new Date(0).toISOString(),
    source: "file",
  };
}

export async function loadWorkflows(): Promise<{ workflows: WorkflowRecord[]; fallback: string | null }> {
  const r = await call<ConsoleApi["GET /api/console/workflows"]>("/api/console/workflows");
  if (r.ok && r.data?.workflows?.length) return { workflows: r.data.workflows, fallback: null };
  const why = r.ok ? "no saved workflows" : `API ${r.status || "offline"}: ${r.error}`;
  return { workflows: [fileWorkflow()], fallback: why };
}

export const saveWorkflow = (w: WorkflowRecord) =>
  call<ConsoleApi["PUT /api/console/workflows/:id"]>(`/api/console/workflows/${encodeURIComponent(w.id)}`, {
    method: "PUT",
    body: JSON.stringify(w),
  });

export type ExecutionSummary = ConsoleApi["GET /api/console/executions?limit&dataset"]["executions"][number];

export const listExecutions = (limit = 20) =>
  call<ConsoleApi["GET /api/console/executions?limit&dataset"]>(`/api/console/executions?limit=${limit}`);

export const getExecution = (id: string) =>
  call<ConsoleApi["GET /api/console/executions/:id"]>(`/api/console/executions/${encodeURIComponent(id)}`);

export const listCases = (q: string) =>
  call<ConsoleApi["GET /api/console/cases?dataset&q"]>(`/api/console/cases${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const executeCase = (body: { caseId: string; dataset?: string; workflowId?: string }) =>
  call<ConsoleApi["POST /api/console/execute"]>("/api/console/execute", { method: "POST", body: JSON.stringify(body) });

export async function executeSample(workflowId: string, scenario: string): Promise<Result<{ execution: ExecutionRecord }>> {
  const request = buildIntakeRequest({ messages: splitThread(scenario), attachments: [], now: new Date(), workflowId });
  const started = await call<{ executionId: string }>("/api/console/intake", {
    method: "POST", body: JSON.stringify({ ...request, practice: true }),
  });
  if (!started.ok) return started;
  return getExecution(started.data.executionId);
}

export async function executeReply(workflowId: string, parentExecutionId: string, scenario: string): Promise<Result<{ execution: ExecutionRecord }>> {
  const messages = splitThread(scenario);
  const request = buildIntakeRequest({ messages, attachments: [], now: new Date(), workflowId });
  return call("/api/console/execute", {
    method: "POST", body: JSON.stringify({ workflowId, parentExecutionId, mode: "demo",
      extraEvents: request.events.map((e, i) => ({ ...e, timestamp: messages[i].date ?? "", source: "simulated_persona" })),
    }),
  });
}

export type { ExecutionRecord };

// ---------- Architect (proxied by app/api/console/architect/route.ts) ----------

export const architectBuild = (body: { description: string }) =>
  call<ArchitectResult>("/api/console/architect", { method: "POST", body: JSON.stringify(body) });

export const architectValidate = (body: { flow: Flow }) =>
  call<{ problems?: string[]; error?: string }>("/api/console/architect", { method: "POST", body: JSON.stringify(body) });

export const deleteWorkflow = (id: string) =>
  call<{ deleted: string }>(`/api/console/architect?id=${encodeURIComponent(id)}`, { method: "DELETE" });

// ---------- Test & improve loop (ConsoleTestApi) ----------
export type ScenarioSetInfo = ConsoleTestApi["GET /api/console/scenario-sets"]["sets"][number];
export type TestRunBody = {
  workflowId: string; version?: number; set: ScenarioSetId; filter?: string; caseIds?: string[]; limit?: number;
  /** Run every case again instead of reusing results this exact playbook already has. */
  fresh?: boolean;
};

export const listScenarioSets = () => call<ConsoleTestApi["GET /api/console/scenario-sets"]>("/api/console/scenario-sets");

export const startTestRun = (body: TestRunBody) =>
  call<ConsoleTestApi["POST /api/console/testruns"]>("/api/console/testruns", { method: "POST", body: JSON.stringify(body) });

export const getTestRun = (id: string) =>
  call<ConsoleTestApi["GET /api/console/testruns/:id"]>(`/api/console/testruns/${encodeURIComponent(id)}`);

export const listTestRuns = (workflowId: string) =>
  call<ConsoleTestApi["GET /api/console/testruns?workflowId"]>(`/api/console/testruns?workflowId=${encodeURIComponent(workflowId)}`);

export const cancelTestRun = (id: string) =>
  call<ConsoleTestApi["POST /api/console/testruns/:id/cancel"]>(`/api/console/testruns/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });

export const listVersions = (workflowId: string) =>
  call<ConsoleTestApi["GET /api/console/workflows/:id/versions"]>(`/api/console/workflows/${encodeURIComponent(workflowId)}/versions`);

export const createVersion = (workflowId: string, body: { flow: Flow; createdBy: WorkflowVersion["createdBy"]; note: string | null; parentVersion: number | null }) =>
  call<ConsoleTestApi["POST /api/console/workflows/:id/versions"]>(`/api/console/workflows/${encodeURIComponent(workflowId)}/versions`, { method: "POST", body: JSON.stringify(body) });

export const improveFlow = (body: { workflowId: string; testRunId?: string; executionId?: string; correction?: string; author?: string }) =>
  call<ConsoleTestApi["POST /api/console/improve"]>("/api/console/improve", { method: "POST", body: JSON.stringify(body) });
