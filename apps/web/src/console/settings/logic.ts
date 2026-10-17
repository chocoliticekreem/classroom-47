// Pure helpers for the Settings tab: the "How careful?" dial applied to a whole playbook,
// thresholds in plain words, spending from real case runs, and case-set counts.
import { cents, plainDataset, riskWord } from "../../ui/plain";
import type { ExecutionRecord, Flow, FlowNode, WorkflowRecord } from "../types";
import { carefulToThresholds, thresholdsToCareful } from "../workflows/careful";

export const DEFAULT_THRESHOLDS = { allow_below: 0.3, block_above: 0.8 };

export interface Thresholds {
  allow_below: number;
  block_above: number;
}

/** The playbook the agent runs: the active one, else the first. */
export function activeWorkflow(workflows: WorkflowRecord[] | undefined): WorkflowRecord | null {
  if (!workflows?.length) return null;
  return workflows.find((w) => w.active) ?? workflows[0];
}

export function safetyChecks(flow: Flow | undefined): FlowNode[] {
  return flow?.nodes?.filter((n) => n.type === "safety_gate") ?? [];
}

/** Current thresholds of the playbook's first safety check (defaults when unset). */
export function currentThresholds(flow: Flow | undefined): Thresholds | null {
  const gate = safetyChecks(flow)[0];
  if (!gate) return null;
  const c = gate.config ?? {};
  return {
    allow_below: typeof c.allow_below === "number" ? c.allow_below : DEFAULT_THRESHOLDS.allow_below,
    block_above: typeof c.block_above === "number" ? c.block_above : DEFAULT_THRESHOLDS.block_above,
  };
}

/** Dial position (0 relaxed .. 1 strict) of the playbook, or null when it has no safety check. */
export function flowCareful(flow: Flow | undefined): number | null {
  const gate = safetyChecks(flow)[0];
  return gate ? thresholdsToCareful(gate.config) : null;
}

/** A copy of the flow with every safety check set to the dial position. Other config is kept. */
export function applyCareful(flow: Flow, careful: number): Flow {
  const t = carefulToThresholds(careful);
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.type === "safety_gate" ? { ...n, config: { ...(n.config ?? {}), ...t } } : n)),
  };
}

/** The record to PUT: same playbook, new flow. */
export function withCareful(w: WorkflowRecord, careful: number): WorkflowRecord {
  return { ...w, flow: { ...applyCareful(w.flow, careful), id: w.id }, updatedAt: new Date().toISOString() };
}

/** Risk at or above `n`, in words: "medium or higher", or "high" when nothing is above. */
function fromRisk(n: number): string {
  const w = riskWord(n) || "medium";
  return w === "high" ? "high" : `${w} or higher`;
}

/** The three rules of a safety check, in plain words. */
export function describeThresholds(t: Thresholds): { send: string; ask: string; stop: string } {
  const pct = (n: number) => Math.round(n * 100);
  return {
    send: `Sends on its own when risk is under ${pct(t.allow_below)} in 100`,
    ask: `Asks a person when risk is ${pct(t.allow_below)} to ${pct(t.block_above) - 1} in 100`,
    stop: `Stops when risk is ${fromRisk(t.block_above)} (${pct(t.block_above)}+ in 100)`,
  };
}

type CostRow = Pick<ExecutionRecord, "startedAt" | "costUsd">;

export interface Spend {
  todayUsd: number;
  todayRuns: number;
  /** Mean cost per case run with a recorded cost (null when none has one). */
  avgUsd: number | null;
  costedRuns: number;
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Real money from case runs: today's total (local day) and the average per case run. */
export function spendSummary(rows: CostRow[], now: Date = new Date()): Spend {
  let todayUsd = 0;
  let todayRuns = 0;
  let total = 0;
  let costedRuns = 0;
  for (const r of rows) {
    const cost = typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd > 0 ? r.costUsd : null;
    if (cost !== null) {
      total += cost;
      costedRuns += 1;
    }
    const at = new Date(r.startedAt);
    if (!Number.isNaN(at.getTime()) && sameLocalDay(at, now)) {
      todayRuns += 1;
      todayUsd += cost ?? 0;
    }
  }
  return { todayUsd, todayRuns, avgUsd: costedRuns ? total / costedRuns : null, costedRuns };
}

/** Money as a caption, "0¢" for nothing. */
export const money = (usd: number | null) => (usd === null ? "—" : cents(usd) || "0¢");

export interface CaseSetCount {
  dataset: string;
  label: string;
  cases: number;
  runs: number;
}

/** Cases per set (from status counts `cases_<set>`) joined with case runs per set. Biggest first. */
export function caseSetCounts(counts: Record<string, number> | undefined, rows: Pick<ExecutionRecord, "dataset">[] = []): CaseSetCount[] {
  const by = new Map<string, CaseSetCount>();
  const get = (dataset: string) => {
    let c = by.get(dataset);
    if (!c) by.set(dataset, (c = { dataset, label: plainDataset(dataset) || dataset, cases: 0, runs: 0 }));
    return c;
  };
  for (const [k, v] of Object.entries(counts ?? {})) if (k.startsWith("cases_")) get(k.slice(6)).cases = v;
  for (const r of rows) if (r.dataset) get(r.dataset).runs += 1;
  return [...by.values()].sort((a, b) => b.cases - a.cases || b.runs - a.runs || a.label.localeCompare(b.label));
}
