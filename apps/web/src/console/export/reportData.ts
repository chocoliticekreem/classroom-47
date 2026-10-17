// Reads the evidence pack's input from the console database (runs/console.db): the cases scored by
// practice runs (test_runs) and the eval verdicts imported onto executions. Only type imports, so
// scripts/export-evidence.mjs can load it with Node's type stripping and pass its own node:sqlite handle.
import type { PackCase, PackInput, PackTestRun } from "./report.ts";

type Row = Record<string, unknown>;
export interface PackDb {
  prepare(sql: string): { all(...params: unknown[]): Row[] };
}

export interface ExecRow {
  id: string;
  caseId: string;
  dataset: string;
  status: string;
  outcome: string | null;
  startedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  simulated: boolean;
  evalPass: boolean | null;
  evalScore: number | null;
  evalNotes: string | null;
}

export interface StoredCase {
  caseId: string;
  dataset: string;
  executionId: string | null;
  status: string; // queued | running | passed | failed | error
  score: number | null;
  breakdown: { disposition?: number; recipient?: number } | null;
  mustNotBroken: string[];
  verdict: string | null;
  expected: string | null;
  got: string | null;
  costUsd: number | null;
  durationMs: number | null;
}

export interface StoredTestRun extends PackTestRun {
  cases: StoredCase[];
}

const OUTCOMES = new Set(["acted", "asked_for_info", "escalated", "blocked", "no_action", "error"]);
const DISPOSITIONS = new Set(["contact", "escalate", "no_action"]);

/** "contact: Email → Dispatch (+1 more)" or "escalate / no_action" -> ["contact"] / ["escalate","no_action"]. */
export function dispositionsOf(expected: string | null): string[] | null {
  if (!expected) return null;
  const list = expected.split(":")[0].split("/").map((s) => s.trim()).filter(Boolean);
  return list.length && list.every((d) => DISPOSITIONS.has(d)) ? list : null;
}

/** "acted: Email → ..." -> "acted". */
export function outcomeOfGot(got: string | null): string | null {
  const head = got?.split(":")[0].trim() ?? "";
  return OUTCOMES.has(head) ? head : null;
}

/**
 * The latest scored run per case. Practice-run cases that finished (passed, failed or error) carry the
 * judge's full breakdown; eval verdicts on executions that no practice run covers fill in the rest.
 * Simulated executions are never evidence.
 */
export function selectCases(testRuns: StoredTestRun[], executions: ExecRow[]): PackCase[] {
  const execById = new Map(executions.map((e) => [e.id, e]));
  const usedExec = new Set<string>();
  const candidates: PackCase[] = [];

  for (const run of testRuns) {
    for (const c of run.cases) {
      if (c.status !== "passed" && c.status !== "failed" && c.status !== "error") continue;
      const ex = c.executionId ? execById.get(c.executionId) : undefined;
      if (c.executionId) usedExec.add(c.executionId);
      if (ex?.simulated) continue;
      const finished = c.status !== "error";
      candidates.push({
        caseId: c.caseId,
        set: c.dataset,
        at: ex?.startedAt ?? run.startedAt,
        outcome: ex?.outcome ?? outcomeOfGot(c.got) ?? (finished ? null : "error"),
        completed: finished,
        pass: c.status === "passed",
        score: c.score,
        expectedDispositions: dispositionsOf(c.expected),
        disposition: finished && typeof c.breakdown?.disposition === "number" ? c.breakdown.disposition : null,
        recipient: finished && typeof c.breakdown?.recipient === "number" ? c.breakdown.recipient : null,
        rulesBroken: finished ? c.mustNotBroken ?? [] : [],
        note: c.verdict,
        costUsd: c.costUsd ?? ex?.costUsd ?? null,
        durationMs: c.durationMs ?? ex?.durationMs ?? null,
        executionId: c.executionId,
        source: `practice run ${run.id.slice(0, 8)}`,
      });
    }
  }

  for (const e of executions) {
    if (e.simulated || e.evalPass === null || usedExec.has(e.id)) continue;
    candidates.push({
      caseId: e.caseId,
      set: e.dataset,
      at: e.startedAt,
      outcome: e.outcome ?? (e.status === "error" ? "error" : null),
      completed: e.status === "success" && e.outcome !== "error",
      pass: e.evalPass,
      score: e.evalScore,
      expectedDispositions: null,
      disposition: null,
      recipient: null,
      rulesBroken: null,
      note: e.evalNotes,
      costUsd: e.costUsd,
      durationMs: e.durationMs,
      executionId: e.id,
      source: "eval import",
    });
  }

  // A judged run beats any run that failed before it could be judged (an agent outage must not erase
  // a real verdict); among equals, the latest wins. A case with only failed runs keeps its latest failure.
  const latest = new Map<string, PackCase>();
  for (const c of candidates) {
    const prev = latest.get(c.caseId);
    if (!prev || (c.completed && !prev.completed) || (c.completed === prev.completed && c.at > prev.at)) latest.set(c.caseId, c);
  }
  return [...latest.values()];
}

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function parse<T>(v: unknown, fallback: T): T {
  try {
    return v === null || v === undefined ? fallback : (JSON.parse(String(v)) as T);
  } catch {
    return fallback;
  }
}

export function readExecutions(db: PackDb): ExecRow[] {
  return db.prepare(`SELECT id, case_id, dataset, status, outcome, started_at, duration_ms, cost_usd, simulated, eval_pass, eval_score, eval_notes
    FROM executions`).all().map((r) => ({
    id: String(r.id),
    caseId: String(r.case_id),
    dataset: String(r.dataset),
    status: String(r.status),
    outcome: s(r.outcome),
    startedAt: String(r.started_at),
    durationMs: n(r.duration_ms),
    costUsd: n(r.cost_usd),
    simulated: Number(r.simulated) === 1,
    evalPass: r.eval_pass === null || r.eval_pass === undefined ? null : Number(r.eval_pass) === 1,
    evalScore: n(r.eval_score),
    evalNotes: s(r.eval_notes),
  }));
}

export function readTestRuns(db: PackDb): StoredTestRun[] {
  return db.prepare("SELECT id, workflow_id, version, scenario_set, status, started_at, cases, summary FROM test_runs ORDER BY started_at").all().map((r) => ({
    id: String(r.id),
    workflowId: String(r.workflow_id),
    version: Number(r.version),
    set: String(r.scenario_set),
    status: String(r.status),
    startedAt: String(r.started_at),
    cases: parse<StoredCase[]>(r.cases, []),
    summary: parse<PackTestRun["summary"]>(r.summary, { total: 0, passed: 0, failed: 0, errors: 0, meanScore: null, costUsd: 0 }),
  }));
}

export function loadPackInput(db: PackDb, dbLabel: string, now = new Date()): PackInput {
  const executions = readExecutions(db);
  const testRuns = readTestRuns(db);
  return {
    generatedAt: now.toISOString(),
    dbLabel,
    cases: selectCases(testRuns, executions),
    ranCases: new Set(executions.filter((e) => !e.simulated).map((e) => e.caseId)).size,
    testRuns: testRuns.map((t) => ({ id: t.id, workflowId: t.workflowId, version: t.version, set: t.set, status: t.status, startedAt: t.startedAt, summary: t.summary })),
  };
}
