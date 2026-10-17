// Test runs: one workflow version over a scenario set, each case run through the agent API (the same
// path as Execute, with the version's flow) and scored by the team's judge (scripts/eval/score.mjs).
// POST returns at once; cases run in the background, all 5 at once (CONCURRENCY), and progress is saved after each.
// A case this exact playbook (same flow JSON) already ran and had judged is reused from practiceCache.ts
// unless the body says `fresh: true`: no agent call, no judge call, $0.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ScenarioSetId, TestRun, TestRunCase } from "../types";
import { buildView, listCasesWithMutation, type CaseWithMutation } from "./catalogue";
import { getDb, repoRoot, type SqlValue } from "./db";
import { evalModules, ensureJudgeKey, type AgentResult, type EvalCase, type Expected, type Judgement, type Verdict } from "./evalModules";
import { agentHealthy, agentUrl, execute } from "./execute";
import { resolveSet, SET_LABELS, type SetId } from "./scenarios";
import { fixtureExpected, scoreFixture, summarise, toTestCase, withMessages, type FixtureRubric } from "./scoring";
import { recordVerdict } from "./store";
import { getVersion } from "./versions";
import { countedBefore, flowHash, lookupCached, reusedCase, storeCached } from "./practiceCache";

export const CONCURRENCY = 5;

export class TestRunError extends Error {
  constructor(message: string, readonly status: number, readonly problems?: string[]) {
    super(message);
  }
}

// ---------- bookkeeping (pure apart from the callbacks; tested) ----------

export function queuedCase(c: Pick<CaseWithMutation, "id" | "dataset"> & { title?: string | null }): TestRunCase {
  return { caseId: c.id, dataset: c.dataset, title: c.title ?? null, executionId: null, status: "queued", score: null, breakdown: null, mustNotBroken: [], verdict: null, expected: null, got: null, costUsd: null, durationMs: null, startedAt: null, finishedAt: null };
}

/**
 * Runs every queued case (cases already finished, e.g. reused, are left as they are) with at most `concurrency` in flight. A case that throws becomes an "error"
 * case and the rest carry on. Once `isCancelled()` is true no new case starts; cases already running
 * finish and are recorded. `onUpdate` is called after every state change with the full list.
 */
export async function runCases(opts: {
  cases: TestRunCase[];
  concurrency: number;
  runOne: (c: TestRunCase) => Promise<TestRunCase>;
  onUpdate: (cases: TestRunCase[]) => void;
  isCancelled: () => boolean;
  now?: () => Date;
}): Promise<"done" | "cancelled"> {
  const cases = opts.cases;
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const todo = cases.flatMap((c, i) => (c.status === "queued" ? [i] : []));
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !opts.isCancelled()) {
      const i = todo[next++];
      const started = { ...cases[i], status: "running" as const, startedAt: now() };
      cases[i] = started;
      opts.onUpdate(cases);
      try {
        const done = await opts.runOne(started);
        // runOne builds a fresh case; keep the title and timing it does not know about.
        cases[i] = { ...done, title: done.title ?? started.title ?? null, startedAt: started.startedAt, finishedAt: now() };
      } catch (err) {
        cases[i] = { ...started, status: "error", verdict: `error: ${err instanceof Error ? err.message : String(err)}`, finishedAt: now() };
      }
      opts.onUpdate(cases);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, todo.length)) }, worker));
  return opts.isCancelled() ? "cancelled" : "done";
}

// ---------- storage ----------

function toRun(r: Record<string, SqlValue>): TestRun {
  return {
    id: String(r.id),
    workflowId: String(r.workflow_id),
    version: Number(r.version),
    set: String(r.scenario_set) as ScenarioSetId,
    filter: r.filter === null ? null : String(r.filter),
    status: String(r.status) as TestRun["status"],
    startedAt: String(r.started_at),
    finishedAt: r.finished_at === null ? null : String(r.finished_at),
    cases: JSON.parse(String(r.cases)) as TestRunCase[],
    summary: JSON.parse(String(r.summary)) as TestRun["summary"],
  };
}

function saveRun(run: TestRun) {
  getDb().prepare(`INSERT INTO test_runs (id, workflow_id, version, scenario_set, filter, status, started_at, finished_at, cases, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, cases = excluded.cases, summary = excluded.summary`)
    .run(run.id, run.workflowId, run.version, run.set, run.filter, run.status, run.startedAt, run.finishedAt, JSON.stringify(run.cases), JSON.stringify(run.summary));
}

const g = globalThis as unknown as { __consoleTestRuns?: Map<string, { cancelled: boolean }> };
const active = (g.__consoleTestRuns ??= new Map());

/** A "running" run that this server process is not running was cut off by a restart. */
function settleOrphan(run: TestRun): TestRun {
  if (run.status !== "running" || active.has(run.id)) return run;
  const cases = run.cases.map((c) => (c.status === "running" || c.status === "queued"
    ? { ...c, status: "error" as const, verdict: "interrupted: the console server restarted during the run" }
    : c));
  const settled: TestRun = { ...run, status: "error", finishedAt: run.finishedAt ?? new Date().toISOString(), cases, summary: summarise(cases) };
  saveRun(settled);
  return settled;
}

export function getTestRun(id: string): TestRun | null {
  const row = getDb().prepare("SELECT * FROM test_runs WHERE id = ?").get(id);
  return row ? settleOrphan(toRun(row)) : null;
}

export function listTestRuns(workflowId?: string | null): Omit<TestRun, "cases">[] {
  const db = getDb();
  const rows = workflowId
    ? db.prepare("SELECT * FROM test_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 200").all(workflowId)
    : db.prepare("SELECT * FROM test_runs ORDER BY started_at DESC LIMIT 200").all();
  return rows.map((r) => {
    const { cases: _cases, ...rest } = settleOrphan(toRun(r));
    void _cases;
    return rest;
  });
}

export function cancelTestRun(id: string): boolean {
  const run = getTestRun(id);
  if (!run) return false;
  const handle = active.get(id);
  if (handle) handle.cancelled = true;
  if (run.status === "running") saveRun({ ...run, status: "cancelled" });
  return true;
}

// ---------- scoring one case ----------

interface CaseContext {
  view: unknown;
  expected: Expected;
  fixture: boolean;
}

async function contextFor(c: TestRunCase, evalCases: Map<string, EvalCase>): Promise<CaseContext> {
  if (c.dataset === "fixtures") {
    const n = c.caseId.replace(/^fixture-/, "");
    const rubric = JSON.parse(await readFile(path.join(repoRoot(), "docs", "stress-test", "fixtures", n, "rubric.json"), "utf8")) as FixtureRubric;
    const built = await buildView(c.caseId, "fixtures");
    return { view: built?.view ?? null, expected: fixtureExpected(rubric), fixture: true };
  }
  const ec = evalCases.get(c.caseId);
  if (!ec) throw new Error(`no answer key for ${c.caseId} in scripts/eval/cases.mjs`);
  return { view: ec.view, expected: ec.expected, fixture: false };
}

function recordVerdictOnExecution(executionId: string, v: Verdict, note: string | null, judgement: Judgement | null) {
  const brokenRules = judgement?.violations.map((x) => x.rule) ?? [];
  recordVerdict(executionId, {
    pass: v.pass, score: v.score, notes: note,
    critical: v.critical || brokenRules.length > 0,
    verdict: judgement?.note ?? null,
    brokenRules,
  });
}

// ---------- start ----------

export interface StartBody {
  workflowId?: unknown;
  version?: unknown;
  set?: unknown;
  filter?: unknown;
  caseIds?: unknown;
  limit?: unknown;
  /** true: run every case again, ignoring cached results. */
  fresh?: unknown;
}

/**
 * Fills in cached results for cases this flow already ran (pure apart from the two lookups, tested).
 * Returns how many were reused.
 */
export function applyCache(cases: TestRunCase[], opts: {
  lookup: (c: TestRunCase) => TestRunCase | null;
  countedBefore: (executionId: string) => boolean;
}): number {
  let n = 0;
  for (let i = 0; i < cases.length; i++) {
    const hit = cases[i].status === "queued" ? opts.lookup(cases[i]) : null;
    if (!hit?.executionId) continue;
    cases[i] = reusedCase(hit, cases[i], opts.countedBefore(hit.executionId));
    n++;
  }
  return n;
}

async function validateWithAgent(flow: unknown): Promise<string[]> {
  const res = await fetch(`${agentUrl()}/api/architect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flow }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new TestRunError(`agent API refused the flow check (${res.status})`, 502);
  const body = (await res.json()) as { problems?: string[] };
  return Array.isArray(body.problems) ? body.problems : [];
}

export async function startTestRun(body: StartBody): Promise<TestRun> {
  const workflowId = typeof body.workflowId === "string" && body.workflowId ? body.workflowId : null;
  if (!workflowId) throw new TestRunError("workflowId is required", 400);
  const set = body.set as SetId;
  if (typeof set !== "string" || !(set in SET_LABELS)) throw new TestRunError(`set must be one of ${Object.keys(SET_LABELS).join(", ")}`, 400);
  const version = await getVersion(workflowId, body.version === undefined || body.version === null ? null : Number(body.version));
  if (!version) throw new TestRunError(`no version ${String(body.version ?? "")} of ${workflowId}`, 404);
  const filter = typeof body.filter === "string" && body.filter.trim() ? body.filter.trim() : null;
  const caseIds = Array.isArray(body.caseIds) ? body.caseIds.filter((x): x is string => typeof x === "string")
    : typeof body.caseIds === "string" ? body.caseIds.split(",") : null;
  let picked: CaseWithMutation[];
  try {
    picked = resolveSet({ set, filter, caseIds, limit: body.limit }, await listCasesWithMutation());
  } catch (err) {
    throw new TestRunError(err instanceof Error ? err.message : String(err), 400);
  }
  const hash = flowHash(version.flow);
  const cases = picked.map(queuedCase);
  if (body.fresh !== true) {
    applyCache(cases, {
      lookup: (c) => lookupCached(c.caseId, c.dataset, hash)?.testCase ?? null,
      countedBefore: (executionId) => countedBefore(workflowId, version.version, executionId),
    });
  }
  const toRun = cases.filter((c) => c.status === "queued").length;
  // Nothing to run: no agent, judge or flow check needed (a flow that already ran was valid).
  if (toRun > 0) {
    if (!ensureJudgeKey()) throw new TestRunError("no ANTHROPIC_API_KEY for the judge (set it in apps/api/.env.local)", 503);
    if (!(await agentHealthy())) throw new TestRunError(`the agent API at ${agentUrl()} is not answering`, 503);
    const problems = await validateWithAgent(version.flow);
    if (problems.length) throw new TestRunError(`version ${version.version} of ${workflowId} is not a valid flow`, 422, problems);
  }
  const ev = toRun > 0 ? await evalModules() : null;
  const evalCases = new Map(ev ? (await ev.loadCases("all")).map((c) => [c.id, c]) : []);

  const run: TestRun = {
    id: randomUUID(),
    workflowId,
    version: version.version,
    set: set as ScenarioSetId, // may be "city" until the contract lists it
    filter: set === "custom" ? picked.map((c) => c.id).join(",") : filter,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cases,
    summary: summarise([]),
  };
  run.summary = summarise(run.cases);
  if (toRun === 0) {
    run.status = "done";
    run.finishedAt = new Date().toISOString();
    saveRun(run);
    return run;
  }
  saveRun(run);
  const handle = { cancelled: false };
  active.set(run.id, handle);

  const runOne = async (c: TestRunCase): Promise<TestRunCase> => {
    if (!ev) throw new Error("eval modules not loaded");
    const ctx = await contextFor(c, evalCases);
    const exec = await execute({ caseId: c.caseId, dataset: c.dataset, workflowId, flow: version.flow });
    const base = { caseId: c.caseId, dataset: c.dataset, executionId: exec.id };
    let result: AgentResult | null = null;
    let agentError: string | null = null;
    if (exec.trace) {
      try {
        // Every recorded message is judged, as in the eval (agents.mjs): a second message can break a rule too.
        result = withMessages(ev.traceToResult(exec.trace), exec.outbox);
      } catch (err) {
        agentError = err instanceof Error ? err.message : String(err);
      }
    } else {
      agentError = exec.error ?? "the agent API returned no trace";
    }
    let judgement: Judgement | null = null;
    let judgeError: string | null = null;
    if (result && result.outcome !== "error") {
      try {
        judgement = await ev.judge(ctx.view, ctx.expected, result);
      } catch (err) {
        judgeError = err instanceof Error ? err.message : String(err);
      }
    }
    const verdict = result ? (ctx.fixture ? scoreFixture(result, judgement, ev.PASS_AT) : ev.scoreCase(ctx.expected, result, judgement)) : null;
    const scored = toTestCase(base, { result, agentError, judgement, judgeError, verdict, expected: ctx.expected, costUsd: exec.costUsd, durationMs: exec.durationMs });
    if (verdict?.completed && (scored.status === "passed" || scored.status === "failed")) {
      recordVerdictOnExecution(exec.id, verdict, scored.verdict, judgement);
      // Only a finished run with a trace and a completed verdict is worth reusing.
      if (exec.status === "success" && exec.trace && !exec.error) {
        try {
          storeCached({ ...scored, title: c.title ?? null, startedAt: c.startedAt ?? null, finishedAt: new Date().toISOString() }, hash, workflowId, version.version);
        } catch {
          // Not caching never fails the case.
        }
      }
    }
    return scored;
  };

  void runCases({
    cases: run.cases,
    concurrency: CONCURRENCY,
    runOne,
    isCancelled: () => handle.cancelled,
    onUpdate: (cases) => {
      run.cases = cases;
      run.summary = summarise(cases);
      if (handle.cancelled) run.status = "cancelled";
      saveRun(run);
    },
  }).then((end) => {
    run.status = end === "cancelled" ? "cancelled" : "done";
    run.finishedAt = new Date().toISOString();
    run.summary = summarise(run.cases);
    saveRun(run);
  }).catch(() => {
    run.status = "error";
    run.finishedAt = new Date().toISOString();
    saveRun(run);
  }).finally(() => active.delete(run.id));

  return run;
}
