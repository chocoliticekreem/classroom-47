// Bridge from the city to the real agent. City cases go through the console (runCityCase: same-origin
// POST /api/console/city/cases, recorded in SQLite); runAgentFull still calls apps/api POST /api/cases directly. A staged scenario (or, via
// backendLink.ts, a city incident) becomes a case view, the agent runs it and returns its Trace, and the
// trace is turned into timed WorkflowEvents for the HUD, decision cards included. Every city case goes
// through here (modules/WorkflowDriver/link.ts queues them within the budget); there is no mock.
import type { DecisionCard, Trace, TraceEvent } from "../../../api/src/lib/trace";
import type { CaseScenario, Modifier } from "./scenarios";
import { MODIFIERS } from "./scenarios";
import type { WorkflowEvent } from "./store";
import { plainNode, plainOutcome, plainStep, scrubLeaks } from "../ui/plain";

export const AGENT_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const RUN_TIMEOUT_MS = 330_000; // the runner allows 300 s per case

export interface ViewEvent {
  n: number;
  timestamp: string;
  stage: string | null;
  channel: string | null;
  from: string | null;
  to: string | null;
  body: string;
  /** Voiced or simulated inputs. City-built events are always "simulated_persona" (run in mode "demo"). */
  source?: "live_human" | "simulated_persona" | "audio_attachment";
}

/**
 * What the agent gets: only the messages known at escalation plus each modifier's extra message.
 * No title, context or expected answer (they would leak the answer).
 */
export function toCaseView(s: CaseScenario, modifiers: readonly Modifier[]): { id: string; events: ViewEvent[]; mode: "demo"; context?: string | null } {
  const events: ViewEvent[] = s.view ? s.view.events.map((e) => ({ ...e })) : s.messages.map((m, i) => ({
    n: i + 1,
    timestamp: "",
    stage: i === s.messages.length - 1 ? "Escalation" : "Context",
    channel: m.channel,
    from: m.from,
    to: "Rivet Delivery Desk",
    body: m.body,
  }));
  for (const mod of modifiers) {
    // Modifier messages are invented by the city, so they are marked simulated_persona (the trace is then synthetic).
    events.push({ n: events.length + 1, timestamp: "", stage: "Escalation", channel: "Email", from: "Case update", to: "Rivet Delivery Desk", body: MODIFIERS[mod].extraMessage, source: "simulated_persona" });
  }
  return { id: `city-${s.id}`, events, mode: "demo" as const, ...(s.view?.context ? { context: s.view.context } : {}) };
}

/** One HUD event to show `atMs` after the replay starts. */
export interface TimedEvent {
  atMs: number;
  event: Omit<WorkflowEvent, "id" | "t">;
}

/** Provenance stamped on every replayed event (PRD J0: never mix real and simulated). */
export interface ReplayMeta {
  origin?: WorkflowEvent["origin"];
  /** Overrides trace.synthetic when the caller knows better (e.g. a console row flagged simulated). */
  synthetic?: boolean;
}

const MIN_NODE_MS = 600;
const MAX_NODE_MS = 2500;

function gateStatus(e: Extract<TraceEvent, { kind: "node_end" }>): WorkflowEvent["status"] {
  if (e.status === "error") return "error";
  const out = e.output as { type?: string; decision?: string } | undefined;
  if (out?.type === "safety_gate" && out.decision === "ask") return "ask";
  if (out?.type === "safety_gate" && out.decision === "block") return "block";
  if (out?.type === "human_decision") return "ask";
  return "ok";
}

/** The real agent's DecisionCard in the HUD's shape, keeping the rich fields (whyStopped, evidence, effects). */
export function cardFromTrace(card: DecisionCard, cardId: string): NonNullable<WorkflowEvent["card"]> {
  const options = (card.options ?? []).map((o) => ({ id: o.id, label: o.label, safe: o.undoable, ...(o.effect ? { effect: o.effect } : {}) }));
  const fallback = options.find((o) => o.label === card.fallback) ?? options.find((o) => o.safe) ?? options[0];
  return {
    cardId,
    summary: card.summary,
    options,
    routeTo: card.routeTo,
    deadlineMs: Math.max(1, card.deadlineMins || 60) * 60_000,
    fallbackOptionId: fallback?.id ?? "",
    ...(card.whyStopped ? { whyStopped: card.whyStopped } : {}),
    ...(card.evidence?.length ? { evidence: card.evidence } : {}),
    ...(card.alreadyDone?.length ? { alreadyDone: card.alreadyDone } : {}),
    ...(card.clash ? { clash: card.clash } : {}),
    ...(card.wouldChangeMyMind ? { wouldChangeMyMind: card.wouldChangeMyMind } : {}),
    ...(card.fallback ? { fallback: card.fallback } : {}),
  };
}

/** The last decision card in a trace (human_decision node output), if the agent stopped for a person. */
export function lastCard(trace: Trace): DecisionCard | null {
  let card: DecisionCard | null = null;
  for (const e of trace.events) {
    if (e.kind !== "node_end") continue;
    const out = e.output as { type?: string; card?: DecisionCard } | undefined;
    if (out?.type === "human_decision" && out.card) card = out.card;
  }
  return card;
}

/**
 * Turns a trace into HUD events with readable timing: each node shows for 0.6-2.5 s whatever its
 * real latency was. The final action line names channel and recipient so the HUD can check it
 * against the scenario's expected next action. Every event carries source "agent", the trace's
 * synthetic flag, origin and runId; the real cost (run_end.totalCostUsd) rides on the final log line only.
 */
export function traceToTimedEvents(trace: Trace, caseId: string, meta: ReplayMeta = {}): TimedEvent[] {
  const out: TimedEvent[] = [];
  const synthetic = meta.synthetic ?? trace.synthetic === true;
  const tag = { source: "agent" as const, runId: trace.runId, ...(synthetic ? { synthetic: true } : {}), ...(meta.origin ? { origin: meta.origin } : {}) };
  let at = 0;
  for (const e of trace.events) {
    if (e.kind === "node_start") {
      out.push({ atMs: at, event: { caseId, nodeId: e.nodeId, status: "start", summary: `${plainNode(e.nodeType ?? e.nodeId)}…`, ...tag } });
    } else if (e.kind === "node_end") {
      at += Math.min(MAX_NODE_MS, Math.max(MIN_NODE_MS, e.latencyMs));
      const out0 = e.output as { type?: string; card?: DecisionCard } | undefined;
      if (out0?.type === "human_decision" && out0.card) {
        const card = cardFromTrace(out0.card, `${trace.runId}:${e.nodeId}:${e.t}`);
        const line = scrubLeaks(out0.card.whyStopped?.line ?? out0.card.summary);
        out.push({ atMs: at, event: { caseId, nodeId: "human", status: "ask", summary: `A person needs to decide: ${line}`.slice(0, 120), card, decision: "hold_for_human", ...tag } });
        continue;
      }
      // Never the raw step summary: one plain sentence, or the plain step name when it should be hidden.
      const plain = plainStep(e.nodeId, e.summary, e.output) ?? plainNode(e.nodeId);
      out.push({ atMs: at, event: { caseId, nodeId: e.nodeId, status: gateStatus(e), summary: plain, ...tag } });
    } else if (e.kind === "run_end") {
      at += 400;
      const a = e.nextAction;
      const summary = a
        ? `${a.channel} → ${a.recipient}: ${a.message}`.slice(0, 140)
        : plainOutcome(e.outcome);
      out.push({ atMs: at, event: { caseId, nodeId: a ? "action" : "log", status: e.outcome === "error" ? "error" : "ok", summary, ...tag } });
      out.push({ atMs: at + 300, event: { caseId, nodeId: "log", status: e.outcome === "error" ? "error" : "ok", summary: `Done: ${plainOutcome(e.outcome)}`, costUsd: e.totalCostUsd, ...tag } });
    }
  }
  return out;
}

/** run_end.totalCostUsd, or null when the trace never finished. */
export function traceCost(trace: Trace): number | null {
  const end = trace.events.find((e): e is Extract<TraceEvent, { kind: "run_end" }> => e.kind === "run_end");
  return end && Number.isFinite(end.totalCostUsd) ? end.totalCostUsd : null;
}

export function outcomeOf(trace: Trace): "acted" | "asked_for_info" | "escalated" | "blocked" | "no_action" {
  const end = trace.events.find((e): e is Extract<TraceEvent, { kind: "run_end" }> => e.kind === "run_end");
  const o = end?.outcome;
  return o === "acted" || o === "asked_for_info" || o === "escalated" || o === "blocked" || o === "no_action" ? o : "escalated";
}

/** Agent API health as the console sees it (same-origin /api/console/status), so the city and the console agree. */
export async function checkAgent(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch("/api/console/status", { signal, cache: "no-store" });
    if (!r.ok) return false;
    const body = (await r.json()) as { agentApi?: unknown };
    return body.agentApi === true;
  } catch {
    return false;
  }
}

/** What POST /api/cases returns besides the trace. */
export interface AgentRunResult {
  trace: Trace;
  card: DecisionCard | null;
  outbox: unknown[] | null;
  reviewWarning?: string;
}

export async function runAgent(view: { id: string; events: ViewEvent[]; mode?: "demo" | "practice"; context?: string | null }): Promise<Trace> {
  return (await runAgentFull(view)).trace;
}

export async function runAgentFull(view: { id: string; events: ViewEvent[]; mode?: "demo" | "practice"; context?: string | null }): Promise<AgentRunResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RUN_TIMEOUT_MS);
  try {
    const r = await fetch(`${AGENT_API}/api/cases`, {
      method: "POST",
      headers: { "content-type": "text/plain" }, // a "simple" request: no CORS preflight needed
      body: JSON.stringify(view),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`agent API ${r.status}`);
    const body = (await r.json()) as { trace?: Trace; card?: DecisionCard | null; outbox?: unknown[]; reviewWarning?: string } | Trace;
    const trace = "trace" in body && body.trace ? body.trace : (body as Trace);
    if (!trace?.events) throw new Error("agent API returned no trace");
    const extra = "trace" in body ? body : {};
    return {
      trace,
      card: ("card" in extra && extra.card) || lastCard(trace),
      outbox: "outbox" in extra && Array.isArray(extra.outbox) ? extra.outbox : null,
      ...("reviewWarning" in extra && typeof extra.reviewWarning === "string" ? { reviewWarning: extra.reviewWarning } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- city cases through the console (SQLite)

export const CITY_CASES_URL = "/api/console/city/cases";
const FOLLOW_EVERY_MS = 2000;

/** The shared city budget is full (429): the case keeps waiting in the queue. */
export class OverBudgetError extends Error {
  readonly overBudget = true;
  constructor(readonly budget: { starts: number[]; spentUsd: number; maxPerWindow: number } | null) {
    super("over budget");
  }
}

export interface CityRunResult extends AgentRunResult {
  executionId: string;
}

type CityDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; onBudget?: (b: { starts: number[]; spentUsd: number; maxPerWindow: number }) => void };

function runFailed(message: string): Error {
  const e = new Error(message);
  e.name = "RunFailed";
  return e;
}

/** Poll GET /api/console/executions/:id until it finishes; the run's trace, card and outbox. */
export async function followExecution(id: string, deps: CityDeps = {}): Promise<CityRunResult> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + (deps.timeoutMs ?? RUN_TIMEOUT_MS);
  let misses = 0;
  while (Date.now() < until) {
    try {
      const r = await f(`/api/console/executions/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.status === 404) throw runFailed("execution not found");
      const body = (await r.json()) as { execution?: { status: string; trace: Trace | null; card?: DecisionCard | null; outbox?: unknown[] | null; error?: string | null } };
      const ex = body.execution;
      misses = 0;
      if (ex && ex.status !== "running") {
        if (ex.status === "error" || !ex.trace?.events) throw runFailed(ex.error ?? "the agent run failed");
        return { trace: ex.trace, card: ex.card ?? lastCard(ex.trace), outbox: ex.outbox ?? null, executionId: id };
      }
    } catch (e) {
      if (e instanceof Error && e.name === "RunFailed") throw e;
      if (++misses > 5) throw e; // the console API is unreachable: give up after ~10 s
    }
    await sleep(FOLLOW_EVERY_MS);
  }
  throw new Error("the agent run did not finish in time");
}

/**
 * Run a city case through the console (same-origin, recorded in SQLite as origin "city", dataset
 * "city-live"): POST it, then follow the execution until it finishes. Throws OverBudgetError on 429.
 */
export async function runCityCase(view: { id: string; events: ViewEvent[]; mode?: "demo" | "practice"; context?: string | null }, label: string, deps: CityDeps = {}): Promise<CityRunResult> {
  const f = deps.fetch ?? fetch;
  const r = await f(CITY_CASES_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ view, label }) });
  const body = (await r.json().catch(() => null)) as { id?: string; error?: string; budget?: { starts: number[]; spentUsd: number; maxPerWindow: number } } | null;
  if (body?.budget) deps.onBudget?.(body.budget);
  if (r.status === 429) throw new OverBudgetError(body?.budget ?? null);
  if (!r.ok || !body?.id) throw new Error(body?.error ?? `city cases ${r.status}`);
  return followExecution(body.id, deps);
}
