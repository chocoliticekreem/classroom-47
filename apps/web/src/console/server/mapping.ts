// Pure mappings from runner outputs (traces, eval results) to console records. No I/O here.
// Rule (PRD J0): never invent a value. Anything the source does not state is null.
import type { Trace, TraceEvent } from "../../../../api/src/lib/trace";
import type { Flow } from "../../../../api/src/lib/flow";

export interface TraceSummary {
  caseId: string | null;
  title: string | null;
  workflowId: string | null;
  outcome: string | null;
  status: "success" | "error";
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  nextAction: string | null;
  gate: string | null;
  startedAt: string | null;
  simulated: boolean;
}

const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;
// The eval writes runs/eval-<iso with ":" and "." replaced by "-">.json.
const ISO_IN_FILENAME = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z/;

/** An ISO timestamp embedded in a run id ("api-2026-10-10T12:00:00.000Z", "<iso>-reality"), else null. */
export function isoFromRunId(runId: string | null | undefined): string | null {
  const m = runId?.match(ISO_IN_TEXT);
  return m ? new Date(m[0]).toISOString() : null;
}

/** The time in an eval output file name (runs/eval-2026-10-10T12-34-56-789Z.json), else null. */
export function isoFromEvalFilename(name: string): string | null {
  const m = name.match(ISO_IN_FILENAME);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${(m[5] ?? "0").padEnd(3, "0")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function nextActionLabel(a: { channel?: string | null; recipient?: string | null } | null | undefined): string | null {
  if (!a || !a.recipient) return null;
  return a.channel ? `${a.channel} → ${a.recipient}` : a.recipient;
}

/** True when the value looks like a Trace (has an events array). */
export function isTrace(v: unknown): v is Trace {
  return typeof v === "object" && v !== null && Array.isArray((v as { events?: unknown }).events);
}

/** Reads the fields the console lists and joins from one trace. */
export function summariseTrace(trace: Trace): TraceSummary {
  const events: TraceEvent[] = trace.events ?? [];
  const start = events.find((e) => e.kind === "run_start");
  const end = events.findLast((e) => e.kind === "run_end");
  const gateOut = events.findLast(
    (e) => e.kind === "node_end" && (e.output as { type?: string } | undefined)?.type === "safety_gate",
  );
  const gate = gateOut?.kind === "node_end" ? ((gateOut.output as { decision?: string }).decision ?? null) : null;
  const outcome = end?.kind === "run_end" ? end.outcome : null;
  let error: string | null = null;
  if (!end) error = "trace has no run_end event (run did not finish)";
  else if (end.kind === "run_end" && end.error) error = end.error;
  else if (outcome === "error") error = "run ended with outcome error";
  return {
    caseId: trace.caseId ?? null,
    title: start?.kind === "run_start" ? start.title ?? null : null,
    workflowId: trace.flowId ?? null,
    outcome,
    status: end && outcome !== "error" ? "success" : "error",
    error: end && outcome !== "error" ? null : error,
    durationMs: end?.kind === "run_end" && Number.isFinite(end.totalLatencyMs) ? end.totalLatencyMs : null,
    costUsd: end?.kind === "run_end" && Number.isFinite(end.totalCostUsd) ? end.totalCostUsd : null,
    nextAction: end?.kind === "run_end" ? nextActionLabel(end.nextAction) : null,
    gate,
    startedAt: isoFromRunId(trace.runId),
    simulated: trace.synthetic === true || trace.mode === "demo",
  };
}

export interface Verdict { pass: boolean; score: number; notes?: string; critical?: boolean | null; verdict?: string | null; brokenRules?: string[] }

/** One row of runs/eval-*.json (scripts/eval/run-eval.mjs evalOne). Only the fields we read. */
export interface EvalRow {
  id: string;
  set?: string;
  mutation?: string;
  score?: number;
  pass?: boolean;
  critical?: boolean;
  completed?: boolean;
  result?: {
    outcome?: string; nextAction?: { recipient?: string; channel?: string } | null; handoff?: string | null;
    costUsd?: number; durationMs?: number; latencyMs?: number;
  } | null;
  /** Not written by run-eval.mjs today; read when a later eval states them. */
  costUsd?: number;
  durationMs?: number;
  latencyMs?: number;
  judgement?: { note?: string; violations?: { rule?: string }[]; must_missed?: string[] } | null;
  judgeError?: string | null;
}

/** True for the object run-eval.mjs writes: { agent, summary, spend, rows[] }. */
export function isEvalFile(v: unknown): v is { agent?: string; rows: EvalRow[] } {
  if (typeof v !== "object" || v === null) return false;
  const rows = (v as { rows?: unknown }).rows;
  return Array.isArray(rows) && rows.every((r) => typeof r === "object" && r !== null && typeof (r as EvalRow).id === "string");
}

/** The eval's verdict for one row, as scored by scripts/eval/score.mjs. Null if the row has no score. */
export function evalRowVerdict(row: EvalRow): Verdict | null {
  if (typeof row.score !== "number" || typeof row.pass !== "boolean") return null;
  const notes: string[] = [];
  if (row.critical) {
    const rule = row.judgement?.violations?.[0]?.rule;
    notes.push(rule ? `BROKE RULE: ${rule}` : "BROKE RULE");
  }
  if (row.completed === false) {
    if (row.result?.outcome === "error") notes.push(`agent error${row.result.handoff ? `: ${row.result.handoff}` : ""}`);
    else if (row.judgeError) notes.push(`not judged: ${row.judgeError}`);
  }
  if (row.judgement?.note) notes.push(row.judgement.note);
  if (row.judgement?.must_missed?.length) notes.push(`missed: ${row.judgement.must_missed.join("; ")}`);
  const brokenRules = (row.judgement?.violations ?? []).map((v) => v?.rule).filter((r): r is string => typeof r === "string" && r.length > 0);
  // score.mjs sets critical when the judge lists any violation (the score is then forced to 0).
  const critical = row.critical === true || (row.judgement?.violations?.length ?? 0) > 0;
  const parts = {
    critical: row.completed === false && !critical ? null : critical,
    verdict: row.judgement?.note ?? null,
    brokenRules,
  };
  return notes.length ? { pass: row.pass, score: row.score, notes: notes.join(" | "), ...parts } : { pass: row.pass, score: row.score, ...parts };
}

const finite = (...vs: unknown[]): number | null => {
  for (const v of vs) if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
};

/** The execution-level fields an eval row states. Gate is never in eval output; cost and time only when the row states them. */
export function evalRowSummary(row: EvalRow) {
  const outcome = row.result?.outcome ?? null;
  return {
    caseId: row.id,
    set: row.set ?? null,
    outcome,
    status: (outcome === null || outcome === "error" ? "error" : "success") as "success" | "error",
    error: outcome === "error" ? (row.result?.handoff ?? "agent error") : outcome === null ? "eval row has no result" : null,
    nextAction: nextActionLabel(row.result?.nextAction ?? null),
    eval: evalRowVerdict(row),
    costUsd: finite(row.costUsd, row.result?.costUsd),
    durationMs: finite(row.durationMs, row.latencyMs, row.result?.durationMs, row.result?.latencyMs),
  };
}

/**
 * A sibling result.json, when present. Its shape is not fixed, so only an explicit
 * { pass: boolean, score: number } (top level or under "eval"/"verdict") is read.
 */
export function resultJsonVerdict(v: unknown): Verdict | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  for (const cand of [o, o.eval, o.verdict]) {
    if (typeof cand !== "object" || cand === null) continue;
    const c = cand as Record<string, unknown>;
    if (typeof c.pass === "boolean" && typeof c.score === "number") {
      const notes = typeof c.notes === "string" ? c.notes : typeof c.note === "string" ? c.note : undefined;
      const rules = Array.isArray(c.brokenRules) ? c.brokenRules : Array.isArray(c.mustNotBroken) ? c.mustNotBroken : [];
      const brokenRules = rules.filter((r): r is string => typeof r === "string");
      const parts = {
        critical: typeof c.critical === "boolean" ? c.critical || brokenRules.length > 0 : brokenRules.length > 0 ? true : null,
        verdict: typeof c.verdict === "string" ? c.verdict : typeof c.note === "string" ? c.note : null,
        brokenRules,
      };
      return notes ? { pass: c.pass, score: c.score, notes, ...parts } : { pass: c.pass, score: c.score, ...parts };
    }
  }
  return null;
}

/** Simple layered layout: each node goes one column right of its deepest predecessor. */
export function layeredLayout(flow: Pick<Flow, "nodes" | "edges">, dx = 280, dy = 140): Record<string, { x: number; y: number }> {
  const ids = flow.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = flow.edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  // Drop edges that close a cycle (found by a DFS in node order), so loops do not push nodes right.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) out.get(e.from)!.push(e.to);
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.has(to)) dfs(to);
    }
    state.set(id, 2);
  };
  // Roots (no incoming edge) first, then anything left.
  const hasIncoming = new Set(edges.map((e) => e.to));
  for (const id of [...ids.filter((i) => !hasIncoming.has(i)), ...ids]) if (!state.has(id)) dfs(id);
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (!back.has(`${e.from}>${e.to}`)) incoming.get(e.to)!.push(e.from);
  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    if (!layer.has(id)) layer.set(id, Math.max(-1, ...incoming.get(id)!.map(depth)) + 1);
    return layer.get(id)!;
  };
  ids.forEach(depth);
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id)!;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [l, col] of columns) {
    col.forEach((id, i) => { pos[id] = { x: l * dx, y: (i - (col.length - 1) / 2) * dy }; });
  }
  return pos;
}
