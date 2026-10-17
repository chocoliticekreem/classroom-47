// Pure helpers for the WorkflowHud: flow layout, per-case node status, case grouping, plain-words case lines.
import { plainNode, plainOutcome, scrubLeaks } from "../../../ui/plain";
import { getScenario } from "../../scenarios";
import type { WorkflowEvent } from "../../store";

export type Runner = "jev" | "claude" | "code";
export type NodeStatus = WorkflowEvent["status"];

export interface FlowNode {
  id: string;
  label: string;
  runner: Runner;
  col: number;
  row: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Gate branch label, if any. */
  when?: "allow" | "ask" | "block";
}

// Snake layout: row 0 left→right, row 1 right→left, gate fans out on rows 2–3.
export const FLOW_NODES: readonly FlowNode[] = [
  { id: "ingest", label: "Read the messages", runner: "code", col: 0, row: 0 },
  { id: "history", label: "Check past orders", runner: "code", col: 1, row: 0 },
  { id: "triage", label: "What kind of problem?", runner: "jev", col: 2, row: 0 },
  { id: "clash", label: "Do the stories match?", runner: "jev", col: 3, row: 0 },
  { id: "missing_info", label: "Anything missing?", runner: "claude", col: 3, row: 1 },
  { id: "group", label: "Same cause as others?", runner: "code", col: 2, row: 1 },
  { id: "planner", label: "Plan the reply", runner: "claude", col: 1, row: 1 },
  { id: "gate", label: "Safety check", runner: "jev", col: 0, row: 1 },
  { id: "action", label: "Send it", runner: "code", col: 0, row: 2 },
  { id: "human", label: "Ask a person", runner: "claude", col: 1, row: 2 },
  { id: "block", label: "Stop", runner: "code", col: 3, row: 2 },
  { id: "verify", label: "Did it work?", runner: "jev", col: 0, row: 3 },
  { id: "log", label: "Done", runner: "code", col: 3, row: 3 },
];

export const FLOW_EDGES: readonly FlowEdge[] = [
  { from: "ingest", to: "history" },
  { from: "history", to: "triage" },
  { from: "triage", to: "clash" },
  { from: "clash", to: "missing_info" },
  { from: "missing_info", to: "group" },
  { from: "group", to: "planner" },
  { from: "planner", to: "gate" },
  { from: "gate", to: "action", when: "allow" },
  { from: "gate", to: "human", when: "ask" },
  { from: "gate", to: "block", when: "block" },
  { from: "human", to: "action" },
  { from: "action", to: "verify" },
  { from: "verify", to: "log" },
  { from: "block", to: "log" },
];

export const RUNNER_OF: Record<string, Runner> = Object.fromEntries(FLOW_NODES.map((n) => [n.id, n.runner]));

/** Latest status per node for one case. Gate "block" also lights the virtual block node. */
export function nodeStatuses(events: readonly WorkflowEvent[], caseId: string): Record<string, NodeStatus> {
  const out: Record<string, NodeStatus> = {};
  for (const e of events) {
    if (e.caseId !== caseId) continue;
    out[e.nodeId] = e.status;
    if (e.nodeId === "gate" && e.status === "block") out.block = "block";
  }
  return out;
}

/** Which gate branch this case took, if decided yet. */
export function gateBranch(st: Record<string, NodeStatus>): FlowEdge["when"] | null {
  if (st.block || st.gate === "block") return "block";
  if (st.human || st.gate === "ask") return "ask";
  if (st.action || st.gate === "ok") return "allow";
  return null;
}

// Mock cost per model call (USD), an ESTIMATE for simulated cases only. Code is free.
const COST: Record<Runner, number> = { jev: 0.0004, claude: 0.011, code: 0 };

/** True for events replayed from a real agent trace (anything not produced by the mock engine). */
export function isReal(e: Pick<WorkflowEvent, "source">): boolean {
  return !!e.source && e.source !== "mock" && e.source !== "simulated_persona";
}

/**
 * Real events: the trace's own cost (run_end.totalCostUsd rides on the final log line), never an estimate.
 * Mock events: the per-call estimate above, which the HUD labels "est".
 */
export function eventCost(e: WorkflowEvent): number {
  if (isReal(e)) return e.costUsd ?? 0;
  // Only count completed calls, not "start" pings.
  if (e.status === "start") return 0;
  return COST[RUNNER_OF[e.nodeId] ?? "code"];
}

export type CaseState = "running" | "awaiting" | "blocked" | "error" | "closed";

export interface CaseSummary {
  caseId: string;
  last: WorkflowEvent;
  state: CaseState;
  cost: number;
  steps: number;
  firstT: number;
  /** The first real-trace event of the case (provenance: synthetic, origin), or null for a mock case. */
  prov: WorkflowEvent | null;
}

function stateOf(last: WorkflowEvent, closed: boolean, errored: boolean): CaseState {
  if (closed) return "closed";
  if (errored || last.status === "error") return "error";
  if (last.status === "block") return "blocked";
  if (last.status === "ask") return "awaiting";
  return "running";
}

/** Group events by case, newest case activity first. */
export function summariseCases(events: readonly WorkflowEvent[], limit = 12): CaseSummary[] {
  const map = new Map<string, { last: WorkflowEvent; cost: number; steps: number; firstT: number; closed: boolean; errored: boolean; prov: WorkflowEvent | null }>();
  for (const e of events) {
    let c = map.get(e.caseId);
    if (!c) {
      c = { last: e, cost: 0, steps: 0, firstT: e.t, closed: false, errored: false, prov: null };
      map.set(e.caseId, c);
    }
    c.last = e;
    if (!c.prov && isReal(e)) c.prov = e;
    c.cost += eventCost(e);
    if (e.status !== "start") c.steps++;
    if (e.nodeId === "log" && e.status === "ok") c.closed = true;
    if (e.status === "error") c.errored = true;
  }
  return [...map.entries()]
    .map(([caseId, c]) => ({
      caseId,
      last: c.last,
      state: stateOf(c.last, c.closed, c.errored),
      cost: c.cost,
      steps: c.steps,
      firstT: c.firstT,
      prov: c.prov,
    }))
    .sort((a, b) => b.last.t - a.last.t)
    .slice(0, limit);
}

/** Spend split by provenance: real trace costs vs the mock's estimate. Never summed together. */
export function spendSplit(events: readonly WorkflowEvent[]): { real: number; estimated: number } {
  let real = 0;
  let estimated = 0;
  for (const e of events) {
    if (isReal(e)) real += e.costUsd ?? 0;
    else estimated += eventCost(e);
  }
  return { real, estimated };
}

/** New "ask" events since lastId (events are newest-last). Returns them oldest-first. */
export function newAsks(events: readonly WorkflowEvent[], lastId: string | null): WorkflowEvent[] {
  const fresh: WorkflowEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.id === lastId) break;
    if (e.status === "ask") fresh.push(e);
  }
  return fresh.reverse();
}

export function formatClock(h: number): string {
  const total = Math.floor((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

// ---------------------------------------------------------------- plain words (docs/plans/ui-simplify-brief.md)

/** The city's short step ids, mapped onto the shared glossary's step types. */
const CITY_STEP: Record<string, string> = {
  history: "history_lookup", clash: "clash_check", group: "group_check", gate: "safety_gate",
  human: "human_decision", log: "case_log",
};

/** Plain name of a step, from a city step id or a playbook step type ("gate" -> "Safety check"). */
export function stepName(nodeId: string): string {
  if (nodeId === "block") return "Stop";
  return plainNode(CITY_STEP[nodeId] ?? nodeId);
}

/** One word for where a case is. */
export const STATUS_WORD: Record<CaseState, string> = {
  running: "Working",
  awaiting: "Needs a person",
  blocked: "Stopped",
  error: "Problem",
  closed: "Done",
};

const INCIDENT_WORDS: Record<string, string> = {
  "car crash": "Car crash", "truck crash": "Truck crash", pileup: "Pile-up", roadworks: "Roadworks",
  breakdown: "Van breakdown", "plane crash": "Plane crash", "emergency landing": "Emergency landing",
};

/** Plain title for a feed case id: "INC-001 · car crash" -> "Car crash", "RUN-002 · delivery-013" -> the case title. */
export function caseTitle(caseId: string): string {
  const [, rest = caseId] = caseId.split(" · ");
  if (INCIDENT_WORDS[rest]) return INCIDENT_WORDS[rest];
  const late = /^(\d+) late$/.exec(rest);
  if (late) return `${late[1]} late deliver${late[1] === "1" ? "y" : "ies"}`;
  const sc = getScenario(rest);
  if (sc) return sc.title;
  return rest.replace(/[_-]+/g, " ");
}

/** "Email → Tracking support, Plover Arc: message" -> "Tracking support, Plover Arc". */
function recipientOf(summary: string): string | null {
  const m = /→\s*([^:]+):/.exec(summary);
  return m ? scrubLeaks(m[1]) || null : null;
}

/** The case's last plain outcome, from the final "Done: <outcome>" line. */
function outcomeWord(events: readonly WorkflowEvent[], caseId: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.caseId === caseId && e.nodeId === "log" && /^Done: /.test(e.summary)) return e.summary.slice(6);
  }
  return null;
}

/**
 * One plain sentence per case, with a status word. No step ids, runner names or costs.
 * e.g. { title: "Car crash", sentence: "Messaged Driver, vehicle V-14.", status: "Done" }
 */
export function caseLine(events: readonly WorkflowEvent[], c: CaseSummary): { title: string; sentence: string; status: string } {
  const title = caseTitle(c.caseId);
  const status = STATUS_WORD[c.state];
  let sentence: string;
  if (c.state === "awaiting") sentence = "A person needs to decide.";
  else if (c.state === "error") sentence = "Something went wrong. Nothing was sent.";
  else if (c.state === "closed") {
    let sent: string | null = null;
    for (const e of events) if (e.caseId === c.caseId && e.nodeId === "action" && e.status === "ok") sent = recipientOf(e.summary) ?? sent;
    const out = outcomeWord(events, c.caseId);
    sentence = sent ? `Messaged ${sent}.` : out ? `${out}.` : "Finished.";
    if (out === plainOutcome("escalated")) sentence = sent ? `Messaged ${sent}. A person was asked.` : "A person was asked.";
  } else if (c.state === "blocked") sentence = "Stopped by the safety check.";
  else sentence = c.last.nodeId === "ingest" && c.steps === 0 ? "Waiting for the answer…" : `${stepName(c.last.nodeId)}…`;
  return { title, sentence, status };
}
