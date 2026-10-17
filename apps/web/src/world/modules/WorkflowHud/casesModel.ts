// The city side panel's "Cases" list: real cases only (practice set, generated, scenarios, console runs,
// anything run from a case file), titled by the case's own title, newest first. City-made incidents and
// late-van groups (INC-/DLY- labels, city-inc-/city-delay- case ids) are scenery and never listed.
// Sources: the HUD feed (store workflow) and saved executions from SQLite, deduped by execution id,
// run id, or label. Pure.
import type { WorkflowEvent } from "../../store";
import { caseTitle, FLOW_NODES } from "./flow";

export type CaseState = "waiting" | "working" | "sent" | "person" | "stopped";

export const CASE_STATE_WORD: Record<CaseState, string> = {
  waiting: "Waiting",
  working: "Working",
  sent: "Sent",
  person: "Needs a person",
  stopped: "Stopped",
};

export interface CaseItem {
  key: string;
  title: string;
  /** The case file id ("delivery-007"), shown small. */
  caseId: string;
  state: CaseState;
  /** Wall clock (ms epoch) when it started, for ordering. */
  at: number;
  executionId: string | null;
  runId: string | null;
  /** The feed's caseId ("AGT-003 · delivery-007"), when the case has HUD lines. */
  label: string | null;
  /** Where it was acted out in the city, when it was. */
  pos: { x: number; z: number } | null;
}

/** A saved execution (city runs and console executions share these fields). */
export interface SavedRun {
  id: string;
  caseId: string;
  title?: string | null;
  status: "running" | "success" | "error";
  outcome?: string | null;
  startedAt: string;
  card?: unknown;
  runId?: string | null;
}

export interface MergeInput {
  workflow: readonly WorkflowEvent[];
  runs: readonly SavedRun[];
  /** Case id -> where the city acted it out (scenario:staged). */
  positions?: Readonly<Record<string, { x: number; z: number }>>;
  /** performance.now() and Date.now() taken together, to turn feed times into wall clock. */
  perfNow: number;
  epochNow: number;
}

/** "AGT-003 · delivery-007" -> "delivery-007"; a bare id stays as it is. */
export function caseIdOf(label: string): string {
  const parts = label.split(" · ");
  return (parts[1] ?? parts[0]).trim();
}

/** City-made incident and late-van cases: scenery, not listed. */
export function isCityMade(labelOrCaseId: string | null | undefined): boolean {
  const s = labelOrCaseId ?? "";
  return /^(INC|DLY)-\d+/.test(s) || /^city-(inc|delay)-/.test(s);
}

/** Where a case is, from its HUD lines in order. */
export function stateFromEvents(events: readonly Pick<WorkflowEvent, "nodeId" | "status" | "summary">[]): CaseState {
  const last = events[events.length - 1];
  if (!last) return "waiting";
  if (last.status === "ask") return "person";
  if (last.status === "error" || last.status === "block") return "stopped";
  if (last.nodeId === "log") return events.some((e) => e.status === "block") ? "stopped" : "sent";
  if (last.status === "start" && /^waiting/i.test(last.summary)) return "waiting";
  return "working";
}

export function stateFromRun(r: Pick<SavedRun, "status" | "outcome" | "card">): CaseState {
  if (r.status === "running") return "working";
  if (r.status === "error") return "stopped";
  if (r.card) return "person";
  const o = (r.outcome ?? "").toLowerCase();
  if (/escalat|hold|human/.test(o)) return "person";
  if (/block|refus/.test(o)) return "stopped";
  return "sent";
}

interface Group { label: string; events: WorkflowEvent[]; executionId: string | null; runId: string | null }

function groupFeed(workflow: readonly WorkflowEvent[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const e of workflow) {
    if (isCityMade(e.caseId)) continue;
    let g = groups.get(e.caseId);
    if (!g) groups.set(e.caseId, (g = { label: e.caseId, events: [], executionId: null, runId: null }));
    g.events.push(e);
    if (e.executionId) g.executionId = e.executionId;
    if (e.runId) g.runId = e.runId;
  }
  return groups;
}

/** Merge HUD cases and saved runs into one list of real cases, newest first. */
export function mergeCases(input: MergeInput): CaseItem[] {
  const { workflow, runs, positions = {}, perfNow, epochNow } = input;
  const toEpoch = (t: number) => epochNow - (perfNow - t);
  const items: CaseItem[] = [];
  const byExec = new Map<string, CaseItem>();
  const byRun = new Map<string, CaseItem>();
  const index = (it: CaseItem) => {
    if (it.executionId) byExec.set(it.executionId, it);
    if (it.runId) byRun.set(it.runId, it);
  };

  // 1. HUD cases (they carry the freshest status).
  for (const g of groupFeed(workflow).values()) {
    const caseId = caseIdOf(g.label);
    const it: CaseItem = {
      key: g.executionId ? `ex:${g.executionId}` : `case:${g.label}`,
      title: caseTitle(g.label),
      caseId,
      state: stateFromEvents(g.events),
      at: toEpoch(g.events[0].t),
      executionId: g.executionId,
      runId: g.runId,
      label: g.label,
      pos: positions[caseId] ?? null,
    };
    items.push(it);
    index(it);
  }

  // 2. Saved runs: link to a HUD case (execution, run, or label) or add as their own row.
  for (const r of runs) {
    if (isCityMade(r.caseId) || isCityMade(r.title)) continue;
    let it = byExec.get(r.id) ?? (r.runId ? byRun.get(r.runId) : undefined);
    if (!it && r.title) it = items.find((x) => x.label === r.title && !x.executionId);
    const started = Date.parse(r.startedAt);
    if (it) {
      it.executionId ??= r.id;
      it.runId ??= r.runId ?? null;
      if (it.key.startsWith("case:")) it.key = `ex:${r.id}`;
      if (Number.isFinite(started)) it.at = Math.min(it.at, started);
      index(it);
      continue;
    }
    const label = r.title && r.title !== r.caseId ? r.title : r.caseId;
    const caseId = caseIdOf(label);
    const added: CaseItem = {
      key: `ex:${r.id}`,
      title: caseTitle(label),
      caseId,
      state: stateFromRun(r),
      at: Number.isFinite(started) ? started : 0,
      executionId: r.id,
      runId: r.runId ?? null,
      label: null,
      pos: positions[caseId] ?? null,
    };
    items.push(added);
    index(added);
  }

  // Dedupe by key (two feed labels can share an execution after a refresh), newest first.
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.at - a.at)
    .filter((it) => (seen.has(it.key) ? false : (seen.add(it.key), true)));
}

/** Keep the selection on the same case when its key changes (a feed case gets its execution id). */
export function resolveSelection(items: readonly CaseItem[], selected: { key: string; label: string | null } | null): CaseItem | null {
  if (!selected) return null;
  return items.find((it) => it.key === selected.key) ?? (selected.label ? items.find((it) => it.label === selected.label) ?? null : null);
}

/** The row for a case acted out at a clicked spot in the city. */
export function caseForCaseId(items: readonly CaseItem[], caseId: string): CaseItem | null {
  return items.find((it) => it.caseId === caseId) ?? null;
}

/** HUD lines for one case, in order. */
export function caseEvents(workflow: readonly WorkflowEvent[], item: CaseItem | null): WorkflowEvent[] {
  if (!item?.label) return [];
  return workflow.filter((e) => e.caseId === item.label);
}

// ---------------------------------------------------------------- the run on the playbook

export interface RunRow { atMs: number; nodeId: string; status: WorkflowEvent["status"]; summary: string }
export interface PathStep {
  nodeId: string;
  /** Latest status, or null when the run never reached this step (only with `showAll`). */
  status: WorkflowEvent["status"] | null;
  /** When the step first showed, ms from the run's start. */
  atMs: number | null;
  /** The step's lines in order (latest last). */
  lines: RunRow[];
}

/**
 * The steps the run took, in the order it reached them (a gate "block" also lights the Stop step).
 * With `showAll`, every playbook step in playbook order, untouched ones with status null.
 */
export function runPath(rows: readonly RunRow[], showAll = false): PathStep[] {
  const byNode = new Map<string, PathStep>();
  const add = (nodeId: string, r: RunRow) => {
    let s = byNode.get(nodeId);
    if (!s) byNode.set(nodeId, (s = { nodeId, status: null, atMs: r.atMs, lines: [] }));
    s.lines.push(r);
    s.status = r.status;
  };
  for (const r of rows) {
    add(r.nodeId, r);
    if (r.nodeId === "gate" && r.status === "block") add("block", r);
  }
  if (!showAll) return [...byNode.values()];
  const known = new Set(FLOW_NODES.map((n) => n.id));
  return [
    ...FLOW_NODES.map((n) => byNode.get(n.id) ?? { nodeId: n.id, status: null, atMs: null, lines: [] }),
    ...[...byNode.values()].filter((s) => !known.has(s.nodeId)),
  ];
}

/** The step to bring into view: the last one the run reached. */
export function currentStep(path: readonly PathStep[]): string | null {
  let best: PathStep | null = null;
  for (const s of path) if (s.status && (!best || (s.atMs ?? 0) >= (best.atMs ?? 0))) best = s;
  return best?.nodeId ?? null;
}
