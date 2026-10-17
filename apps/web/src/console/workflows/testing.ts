// Pure logic for the test & improve loop: flow diffs for proposals, the test-run polling state
// machine, the auto-improve loop controller, and learning-curve points.
import type { Flow, FlowEdge, FlowNode, ImproveProposal, ScenarioSetId, TestRun, WorkflowVersion } from "../types";
import { edgeKey } from "./doc";

// ---------------------------------------------------------------- flow diff

export interface ConfigChange { key: string; from: unknown; to: unknown }
export interface NodeChange { id: string; runners: { from: string[]; to: string[] } | null; config: ConfigChange[]; typeChanged: boolean }

export interface FlowDiff {
  addedNodes: Set<string>;
  removedNodes: Set<string>;
  changedNodes: Map<string, NodeChange>;
  addedEdges: Set<string>; // edgeKey
  removedEdges: Set<string>; // edgeKey
  /** New flow plus the removed nodes and edges, so the canvas can draw both. */
  merged: Flow;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Top-level config keys that differ. Numbers (thresholds) are the main case: shown old -> new. */
export function configChanges(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): ConfigChange[] {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  return keys.filter((k) => !same(a?.[k], b?.[k])).map((k) => ({ key: k, from: a?.[k], to: b?.[k] }));
}

export function diffFlows(before: Flow, after: Flow): FlowDiff {
  const oldById = new Map(before.nodes.map((n) => [n.id, n]));
  const newById = new Map(after.nodes.map((n) => [n.id, n]));
  const addedNodes = new Set(after.nodes.filter((n) => !oldById.has(n.id)).map((n) => n.id));
  const removedNodes = new Set(before.nodes.filter((n) => !newById.has(n.id)).map((n) => n.id));
  const changedNodes = new Map<string, NodeChange>();
  for (const n of after.nodes) {
    const o = oldById.get(n.id);
    if (!o) continue;
    const runners = same([...o.runs_on].sort(), [...n.runs_on].sort()) ? null : { from: o.runs_on, to: n.runs_on };
    const config = configChanges(o.config, n.config);
    const typeChanged = o.type !== n.type;
    if (runners || config.length || typeChanged) changedNodes.set(n.id, { id: n.id, runners, config, typeChanged });
  }
  const oldEdges = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const newEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  const addedEdges = new Set([...newEdges.keys()].filter((k) => !oldEdges.has(k)));
  const removedEdges = new Set([...oldEdges.keys()].filter((k) => !newEdges.has(k)));

  const keptRemovedEdges: FlowEdge[] = [...removedEdges].map((k) => oldEdges.get(k)!);
  const removedNodeList: FlowNode[] = before.nodes.filter((n) => removedNodes.has(n.id));
  const merged: Flow = {
    ...after,
    nodes: [...after.nodes, ...removedNodeList],
    edges: [...after.edges, ...keptRemovedEdges],
  };
  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, merged };
}

export type DiffMark = "added" | "removed" | "changed" | null;

export function nodeMark(diff: FlowDiff, id: string): DiffMark {
  if (diff.addedNodes.has(id)) return "added";
  if (diff.removedNodes.has(id)) return "removed";
  if (diff.changedNodes.has(id)) return "changed";
  return null;
}

export function edgeMark(diff: FlowDiff, e: FlowEdge): DiffMark {
  const k = edgeKey(e);
  if (diff.addedEdges.has(k)) return "added";
  if (diff.removedEdges.has(k)) return "removed";
  return null;
}

export function fmtValue(v: unknown): string {
  if (v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return v;
  const s = JSON.stringify(v);
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

export function diffCount(d: FlowDiff): number {
  return d.addedNodes.size + d.removedNodes.size + d.changedNodes.size + d.addedEdges.size + d.removedEdges.size;
}

// ---------------------------------------------------------------- polling state machine

export interface PollState {
  phase: "idle" | "starting" | "polling" | "done" | "error" | "cancelled";
  run: TestRun | null;
  error: string | null;
  /** Consecutive failed polls. */
  misses: number;
}

export type PollEvent =
  | { type: "start" }
  | { type: "started"; run: TestRun }
  | { type: "start_failed"; error: string }
  | { type: "poll_ok"; run: TestRun }
  | { type: "poll_failed"; error: string; status: number }
  | { type: "cancel" }
  | { type: "reset" };

export const POLL_MS = 1500;
export const MAX_MISSES = 5;
export const initialPoll: PollState = { phase: "idle", run: null, error: null, misses: 0 };

const terminal = (run: TestRun): PollState["phase"] =>
  run.status === "running" ? "polling" : run.status === "done" ? "done" : run.status === "cancelled" ? "cancelled" : "error";

export function pollReducer(s: PollState, ev: PollEvent): PollState {
  switch (ev.type) {
    case "reset":
      return initialPoll;
    case "start":
      return { phase: "starting", run: null, error: null, misses: 0 };
    case "start_failed":
      return { ...s, phase: "error", error: ev.error };
    case "started":
      return { phase: terminal(ev.run), run: ev.run, error: null, misses: 0 };
    case "poll_ok":
      if (s.phase !== "polling") return s; // late answer after cancel / reset
      return { phase: terminal(ev.run), run: ev.run, error: ev.run.status === "error" ? "it didn't finish" : null, misses: 0 };
    case "poll_failed": {
      if (s.phase !== "polling") return s;
      const misses = s.misses + 1;
      // 404 = the run is gone (or the route is missing); otherwise retry a few times.
      if (ev.status === 404 || misses >= MAX_MISSES) return { ...s, phase: "error", error: ev.error, misses };
      return { ...s, misses };
    }
    case "cancel":
      return s.phase === "polling" || s.phase === "starting" ? { ...s, phase: "cancelled" } : s;
  }
}

export const isPolling = (s: PollState) => s.phase === "polling";

// ---------------------------------------------------------------- auto-improve loop

export const AUTO_MAX_ITERATIONS = 3;

export interface AutoState {
  step: "test" | "improve" | "accept" | "stopped";
  /** Improvements accepted so far. */
  iteration: number;
  max: number;
  /** Pass rate of each completed test run, in order (baseline first). */
  rates: number[];
  reason: string | null;
  log: string[];
}

export type AutoEvent =
  | { type: "tested"; summary: TestRun["summary"]; status: TestRun["status"] }
  | { type: "improved"; proposal: Pick<ImproveProposal, "problems" | "changes"> }
  | { type: "accepted"; version: number }
  | { type: "failed"; error: string }
  | { type: "stop" };

export const passRate = (s: TestRun["summary"]) => (s.total ? s.passed / s.total : 0);
const pct = (r: number) => `${Math.round(r * 100)}%`;

export function autoStart(max = AUTO_MAX_ITERATIONS): AutoState {
  return { step: "test", iteration: 0, max, rates: [], reason: null, log: ["First practice"] };
}

export function autoNext(s: AutoState, ev: AutoEvent): AutoState {
  if (s.step === "stopped") return s;
  const stop = (reason: string): AutoState => ({ ...s, step: "stopped", reason, log: [...s.log, `Stopped: ${reason}`] });
  switch (ev.type) {
    case "stop":
      return stop("you stopped it");
    case "failed":
      return stop(ev.error);
    case "tested": {
      if (s.step !== "test") return s;
      if (ev.status !== "done") return stop(ev.status === "cancelled" ? "practice was stopped" : "practice didn't finish");
      const rate = passRate(ev.summary);
      const prev = s.rates.length ? s.rates[s.rates.length - 1] : null;
      const next: AutoState = { ...s, rates: [...s.rates, rate], log: [...s.log, `${ev.summary.passed} of ${ev.summary.total} right`] };
      const halt = (reason: string): AutoState => ({ ...next, step: "stopped", reason, log: [...next.log, `Stopped: ${reason}`] });
      if (prev !== null && rate <= prev) return halt(`it stopped getting better (${pct(prev)} → ${pct(rate)} right)`);
      if (ev.summary.failed + ev.summary.errors === 0) return halt("every case is right");
      if (s.iteration >= s.max) return halt(`improved ${s.max} times`);
      return { ...next, step: "improve", log: [...next.log, `Improving (${s.iteration + 1} of ${s.max})`] };
    }
    case "improved":
      if (s.step !== "improve") return s;
      if (ev.proposal.problems.length) return stop("the suggested change wasn't safe");
      if (!ev.proposal.changes.length) return stop("no changes to suggest");
      return { ...s, step: "accept", log: [...s.log, `${ev.proposal.changes.length} change${ev.proposal.changes.length === 1 ? "" : "s"} suggested`] };
    case "accepted":
      if (s.step !== "accept") return s;
      return { ...s, step: "test", iteration: s.iteration + 1, log: [...s.log, `Saved version ${ev.version}, practising again`] };
  }
}

// ---------------------------------------------------------------- learning curve

export interface CurvePoint { version: number; meanScore: number | null; passRate: number; runs: number; costUsd: number }

/**
 * A run's summary with reused cases this version had already counted taken out, so the same result
 * is never counted twice for a version. Null when nothing new is left (a run made only of repeats).
 */
export function freshSummary(s: TestRun["summary"]): TestRun["summary"] | null {
  const rp = s.repeats ?? { passed: 0, failed: 0, scoreSum: 0 };
  const total = s.total - rp.passed - rp.failed;
  if (total <= 0) return null;
  const scored = s.passed + s.failed;
  const freshScored = scored - rp.passed - rp.failed;
  const meanScore = s.meanScore === null || freshScored <= 0 ? null : (s.meanScore * scored - rp.scoreSum) / freshScored;
  return { ...s, total, passed: s.passed - rp.passed, failed: s.failed - rp.failed, meanScore, repeats: undefined };
}

/** One point per version from finished runs: the mean of their mean scores and pass rates (repeats left out). */
export function learningCurve(runs: Pick<TestRun, "version" | "status" | "summary">[]): CurvePoint[] {
  const by = new Map<number, { scores: number[]; rates: number[]; cost: number; n: number }>();
  for (const r of runs) {
    if (r.status !== "done" || !r.summary.total) continue;
    const s = freshSummary(r.summary);
    if (!s) continue;
    const b = by.get(r.version) ?? { scores: [], rates: [], cost: 0, n: 0 };
    if (s.meanScore !== null) b.scores.push(s.meanScore);
    b.rates.push(passRate(s));
    b.cost += s.costUsd;
    b.n += 1;
    by.set(r.version, b);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([version, b]) => ({
    version, meanScore: b.scores.length ? avg(b.scores) : null, passRate: avg(b.rates), runs: b.n, costUsd: b.cost,
  }));
}

/** Cost estimate per case from earlier finished runs (null when there is no history). Reused cases cost nothing and are left out. */
export function costPerCase(runs: Pick<TestRun, "status" | "summary">[]): number | null {
  let cost = 0;
  let n = 0;
  for (const r of runs) {
    if (r.status !== "done" || !r.summary.total) continue;
    cost += r.summary.costUsd;
    n += r.summary.total - (r.summary.reused ?? 0);
  }
  return n ? cost / n : null;
}

/** "3 reused · 2 running" style line for a practice run; null when nothing was reused. */
export function reuseLine(cases: Pick<TestRun["cases"][number], "status" | "reused">[]): string | null {
  const reused = cases.filter((c) => c.reused).length;
  if (!reused) return null;
  const running = cases.filter((c) => !c.reused && (c.status === "running" || c.status === "queued")).length;
  const ran = cases.filter((c) => !c.reused && (c.status === "passed" || c.status === "failed" || c.status === "error")).length;
  const parts = [`${reused} reused`];
  if (running) parts.push(`${running} running`);
  if (ran) parts.push(`${ran} new`);
  return parts.join(" · ");
}

export function latestVersion(versions: WorkflowVersion[]): WorkflowVersion | null {
  return versions.reduce<WorkflowVersion | null>((a, v) => (!a || v.version > a.version ? v : a), null);
}

/** Request body for a re-test on exactly the cases of an earlier run. */
export function retestBody(run: Pick<TestRun, "workflowId" | "cases">, version: number) {
  return {
    workflowId: run.workflowId,
    version,
    set: "custom" as const,
    caseIds: run.cases.map((c) => c.caseId),
    limit: Math.min(20, Math.max(1, run.cases.length)),
  };
}

const SET_IDS: ScenarioSetId[] = ["quick", "fixtures", "adversarial", "generated", "city", "bulk", "custom"];

/** Deep link into Practice (`?panel=practice&set=<id>[&filter=<pattern>]`), e.g. from Results'
 *  "Run more cases". Null when the link does not ask for the Practice panel. */
export function practiceLink(params: URLSearchParams | null | undefined): { set: ScenarioSetId | null; filter: string | null } | null {
  if (params?.get("panel") !== "practice") return null;
  const raw = params.get("set");
  const set = raw && (SET_IDS as string[]).includes(raw) ? (raw as ScenarioSetId) : null;
  const filter = params.get("filter")?.trim() || null;
  return { set, filter };
}
