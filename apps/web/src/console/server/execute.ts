// "Execute" in the console: builds the case view the eval would send, POSTs it to the agent API
// (apps/api POST /api/cases), and records the run. A "running" row is written first.
// Voice re-runs (PRD I1, I5): `parentExecutionId` brings back the parent's sent messages as desk events,
// `extraEvents` (voice notes, call transcripts) are appended on the case's own timeline, and
// `humanDecision` is passed through as a trusted input. Any voice input runs in "demo" mode (PRD I2).
import { randomUUID } from "node:crypto";
import type { CaseViewEvent, DecisionCard, ExecutionVoice, Flow, HumanDecision, OutboxEntry, Trace } from "../types";
import { buildView } from "./catalogue";
import type { CaseView } from "./caseViews";
import { summariseTrace, isTrace } from "./mapping";
import { buildRerun } from "./rerun";
import { getExecution, getExecutionInput, recordExecutionInput, recordExecutionFlow, seedWorkflows, getWorkflow, upsertExecution, type ExecutionWrite, type StoredExecution } from "./store";

export const RUN_TIMEOUT_MS = 5 * 60_000;

export function agentUrl(): string {
  return (process.env.AGENT_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}

export class ExecuteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ExecuteInput {
  caseId?: string | null;
  dataset?: string | null;
  workflowId?: string | null;
  parentExecutionId?: string | null;
  extraEvents?: CaseViewEvent[] | null;
  humanDecision?: HumanDecision | null;
  voice?: ExecutionVoice | null;
  mode?: "practice" | "demo" | null;
  elapsedMs?: number | null;
  /** Run on this exact flow (a workflow version under test) instead of the saved workflow. */
  flow?: Flow | null;
}

/** The JSON body for apps/api POST /api/cases: the case view plus `mode` and `humanDecision` when set. */
export function agentRequestBody<V extends { events: CaseViewEvent[] }>(input: {
  view: V;
  parentOutbox?: OutboxEntry[] | null;
  extraEvents?: CaseViewEvent[] | null;
  humanDecision?: HumanDecision | null;
  mode?: "practice" | "demo" | null;
  elapsedMs: number;
  rerun: boolean;
}): { body: V & { mode?: string; humanDecision?: HumanDecision }; synthetic: boolean; voiceInput: boolean } {
  const voiceInput = Boolean(input.extraEvents?.length || input.humanDecision);
  const { view, synthetic } = input.rerun || voiceInput
    ? buildRerun({ view: input.view, previousOutbox: input.parentOutbox, newEvents: input.extraEvents, elapsedMs: input.elapsedMs })
    : { view: input.view, synthetic: false };
  const mode = input.mode ?? (voiceInput ? "demo" : null);
  return {
    body: { ...view, ...(mode ? { mode } : {}), ...(input.humanDecision ? { humanDecision: input.humanDecision } : {}) },
    synthetic,
    voiceInput,
  };
}

export async function execute(input: ExecuteInput): Promise<StoredExecution> {
  const parent = input.parentExecutionId ? getExecution(input.parentExecutionId) : null;
  if (input.parentExecutionId && !parent) throw new ExecuteError(`Unknown parent execution "${input.parentExecutionId}"`, 404);
  const caseId = input.caseId || parent?.caseId;
  if (!caseId) throw new ExecuteError("caseId or parentExecutionId is required", 400);
  const dataset = input.dataset ?? (parent && parent.caseId === caseId ? parent.dataset : null);
  if (parent && (parent.caseId !== caseId || parent.dataset !== dataset)) {
    throw new ExecuteError("A follow-up must use the parent's case and dataset", 400);
  }
  const built = await buildView(caseId, dataset);
  if (!built) {
    throw new ExecuteError(`Unknown case "${caseId}"${dataset ? ` in dataset "${dataset}"` : ""}`, 404);
  }
  const elapsedMs = input.elapsedMs ?? (parent ? Math.max(0, Date.now() - Date.parse(parent.startedAt)) || 0 : 0);
  const request = agentRequestBody({
    // The parent's exact input already contains every earlier reply and desk request.
    // Older imported executions have no saved input and fall back to the source case.
    view: (parent ? getExecutionInput(parent.id) : null) ?? built.view,
    parentOutbox: parent?.outbox,
    extraEvents: input.extraEvents,
    humanDecision: input.humanDecision,
    mode: input.mode ?? (built.view.events.some((e) => "source" in e && e.source === "simulated_persona") ? "demo" : null),
    elapsedMs,
    rerun: Boolean(parent),
  });
  const startedAt = new Date();
  const base: ExecutionWrite = {
    id: randomUUID(),
    sourceKey: null,
    caseId: built.entry.id,
    dataset: built.entry.dataset,
    workflowId: input.workflowId || parent?.workflowId || "default-incident",
    status: "running",
    outcome: null,
    startedAt: startedAt.toISOString(),
    durationMs: null,
    costUsd: null,
    origin: input.voice ? "voice" : "console",
    simulated: request.synthetic,
    title: built.entry.title,
    nextAction: null,
    gate: null,
    error: null,
    trace: null,
    answerMd: null,
    reasoningMd: null,
    eval: null,
    parentExecutionId: parent?.id ?? null,
    outbox: null,
    card: null,
    voice: input.voice ?? null,
  };
  upsertExecution(base);

  await seedWorkflows();
  const saved = input.flow ? null : getWorkflow(base.workflowId);
  const flow = input.flow ?? (saved?.source === "db" ? saved.flow : null);
  const snapshot = input.flow ?? saved?.flow;
  if (snapshot) recordExecutionFlow(base.id, snapshot);

  const voiceRun = request.voiceInput && !input.mode;
  await recordAgentRun(base, flow ? { ...request.body, flow } : { ...request.body, flowId: base.workflowId }, (trace, s) =>
    // Voice runs go in "demo" mode only because the agent admits voice there (PRD I2). They are simulated
    // only when a simulated persona spoke (trace.synthetic), not because of the mode itself.
    voiceRun ? trace.synthetic === true || request.synthetic : s.simulated || request.synthetic,
    { ...built.view, events: request.body.events },
  );
  return getExecution(base.id)!;
}

/**
 * POSTs `body` to the agent API (apps/api POST /api/cases) and records the result on the "running" row `base`
 * (already written). Shared by execute() and city cases (city.ts). Never throws: failures become an error row.
 */
export async function recordAgentRun(
  base: ExecutionWrite,
  body: unknown,
  simulatedOf: (trace: Trace, s: ReturnType<typeof summariseTrace>) => boolean = (_t, s) => s.simulated,
  inputView?: CaseView,
): Promise<void> {
  const startedAt = Date.parse(base.startedAt);
  try {
    // Persist evidence, never the control fields: a previous human approval must not
    // authorise a different action in a later follow-up.
    if (inputView) recordExecutionInput(base.id, inputView);
    const res = await fetch(`${agentUrl()}/api/cases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // A workflow edited in the console runs as edited: the agent API validates the flow and
      // refuses an unsound one. An untouched workflow is left to the API's own flow file.
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`agent API answered ${res.status}: ${text.slice(0, 500)}`);
    const parsed = JSON.parse(text) as { trace?: unknown; outcome?: string; outbox?: OutboxEntry[]; card?: DecisionCard | null };
    const trace = parsed.trace ?? parsed;
    if (!isTrace(trace)) throw new Error("agent API response has no trace");
    const s = summariseTrace(trace);
    upsertExecution({
      ...base,
      status: s.status,
      outcome: s.outcome ?? parsed.outcome ?? null,
      durationMs: s.durationMs ?? Date.now() - startedAt,
      costUsd: s.costUsd,
      simulated: simulatedOf(trace, s),
      title: s.title ?? base.title,
      nextAction: s.nextAction,
      gate: s.gate,
      error: s.error,
      trace,
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : null,
      card: parsed.card ?? null,
    });
  } catch (err) {
    const c = err instanceof Error ? (err.cause as { message?: string; code?: string } | undefined) : undefined;
    const cause = c?.message || c?.code ? ` (${c.message || c.code})` : "";
    const message = err instanceof Error
      ? (err.name === "TimeoutError" ? `agent API did not answer within ${RUN_TIMEOUT_MS / 1000} s` : `${err.message}${cause}`)
      : String(err);
    upsertExecution({ ...base, status: "error", durationMs: Date.now() - startedAt, error: message });
  }
}

export async function agentHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${agentUrl()}/api/health`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
