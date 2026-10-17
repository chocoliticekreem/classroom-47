// Practice result cache: a case already run and judged on the exact same playbook (same flow JSON)
// is reused instead of calling the agent and the judge again (both paid). Key = dataset + case id +
// a hash of the canonical flow JSON, so any edit to the playbook misses the cache.
// The cached value is the scored TestRunCase (the judge's verdict included) plus the execution it came
// from; an entry is only used while that execution is still a finished run with a trace.
import { createHash } from "node:crypto";
import type { Flow, TestRunCase } from "../types";
import { dbPath, getDb, type SqlValue } from "./db";

// ---------- pure (tested) ----------

/** JSON with object keys sorted at every level; undefined values dropped as JSON.stringify does. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === "function" ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const parts = Object.keys(o).sort()
    .filter((k) => o[k] !== undefined && typeof o[k] !== "function")
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  return `{${parts.join(",")}}`;
}

/** Stable hash of the exact flow under test (key order does not matter, any value change does). */
export function flowHash(flow: Flow | unknown): string {
  return createHash("sha256").update(canonicalJson(flow)).digest("hex").slice(0, 32);
}

export function cacheKey(caseId: string, dataset: string, hash: string): string {
  return `${dataset}/${caseId}#${hash}`;
}

/** A judged case worth keeping: right or wrong with a score, from a recorded run. Errors are never cached. */
export function isCacheable(c: Pick<TestRunCase, "status" | "score" | "executionId">): boolean {
  return (c.status === "passed" || c.status === "failed") && typeof c.score === "number" && !!c.executionId;
}

/** The execution behind an entry is still usable: finished OK, has a trace, no error. */
export function executionUsable(e: { status: string; hasTrace: boolean; error: string | null } | null): boolean {
  return !!e && e.status === "success" && e.hasTrace && !e.error;
}

/** The case row for a reused result: done at once, original timing, nothing new spent. */
export function reusedCase(cached: TestRunCase, queued: Pick<TestRunCase, "title">, countedBefore: boolean): TestRunCase {
  return {
    ...cached,
    title: queued.title ?? cached.title ?? null,
    costUsd: 0,
    reused: { originalCostUsd: cached.reused ? cached.reused.originalCostUsd : cached.costUsd, countedBefore },
  };
}

// ---------- storage ----------

const g = globalThis as unknown as { __practiceCacheBackfilled?: string };

/** The table is created by the db.ts migrations. */
const db = () => getDb();

export interface CacheHit { testCase: TestRunCase; executionId: string }

function executionState(id: string) {
  const r = db().prepare("SELECT status, error, trace IS NOT NULL AS has_trace FROM executions WHERE id = ?").get(id);
  return r ? { status: String(r.status), error: r.error === null ? null : String(r.error), hasTrace: Number(r.has_trace) === 1 } : null;
}

/** A reusable result for this case on this exact flow, or null. Stale entries (run gone or failed) are dropped. */
export function lookupCached(caseId: string, dataset: string, hash: string): CacheHit | null {
  backfillOnce();
  const key = cacheKey(caseId, dataset, hash);
  const row = db().prepare("SELECT execution_id, test_case FROM practice_cache WHERE key = ?").get(key);
  if (!row) return null;
  const executionId = String(row.execution_id);
  let testCase: TestRunCase | null = null;
  try {
    testCase = JSON.parse(String(row.test_case)) as TestRunCase;
  } catch {
    testCase = null;
  }
  if (!testCase || !isCacheable(testCase) || !executionUsable(executionState(executionId))) {
    db().prepare("DELETE FROM practice_cache WHERE key = ?").run(key);
    return null;
  }
  return { testCase: { ...testCase, executionId }, executionId };
}

export function storeCached(c: TestRunCase, hash: string, workflowId: string | null, version: number | null) {
  if (!isCacheable(c)) return;
  const { reused: _r, ...plain } = c;
  void _r;
  db().prepare(`INSERT INTO practice_cache (key, case_id, dataset, flow_hash, execution_id, workflow_id, version, test_case, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET execution_id = excluded.execution_id, workflow_id = excluded.workflow_id,
      version = excluded.version, test_case = excluded.test_case, created_at = excluded.created_at`)
    .run(cacheKey(c.caseId, c.dataset, hash), c.caseId, c.dataset, hash, c.executionId!, workflowId, version, JSON.stringify(plain), new Date().toISOString());
}

/** True when an earlier practice run of this version already holds this execution's result. */
export function countedBefore(workflowId: string, version: number, executionId: string): boolean {
  const needle = `%"executionId":${JSON.stringify(executionId)}%`;
  return !!db().prepare("SELECT 1 AS x FROM test_runs WHERE workflow_id = ? AND version = ? AND cases LIKE ? LIMIT 1").get(workflowId, version, needle);
}

/**
 * Fills the cache from practice runs made before it existed, once per process and database file:
 * each judged case of each run, keyed by the hash of that run's version flow. Newest run wins.
 */
export function backfillOnce() {
  const d = db();
  if (g.__practiceCacheBackfilled === dbPath()) return;
  g.__practiceCacheBackfilled = dbPath();
  try {
    const flows = new Map<string, string | null>();
    const hashOf = (workflowId: string, version: number) => {
      const k = `${workflowId}@${version}`;
      if (!flows.has(k)) {
        const r = d.prepare("SELECT flow FROM workflow_versions WHERE workflow_id = ? AND version = ?").get(workflowId, version);
        let h: string | null = null;
        try {
          h = r ? flowHash(JSON.parse(String(r.flow))) : null;
        } catch {
          h = null;
        }
        flows.set(k, h);
      }
      return flows.get(k) ?? null;
    };
    const insert = d.prepare(`INSERT OR IGNORE INTO practice_cache (key, case_id, dataset, flow_hash, execution_id, workflow_id, version, test_case, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = d.prepare("SELECT workflow_id, version, cases, started_at FROM test_runs ORDER BY started_at DESC").all();
    for (const r of rows as Record<string, SqlValue>[]) {
      const hash = hashOf(String(r.workflow_id), Number(r.version));
      if (!hash) continue;
      let cases: TestRunCase[] = [];
      try {
        cases = JSON.parse(String(r.cases)) as TestRunCase[];
      } catch {
        continue;
      }
      for (const c of cases) {
        if (c.reused || !isCacheable(c)) continue;
        insert.run(cacheKey(c.caseId, c.dataset, hash), c.caseId, c.dataset, hash, c.executionId!, String(r.workflow_id), Number(r.version), JSON.stringify(c), String(r.started_at));
      }
    }
  } catch {
    // A cache that cannot be filled just means fewer hits.
  }
}
