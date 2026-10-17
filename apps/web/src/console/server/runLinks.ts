// Links a decision card (a human review task: trace runId + caseId) to the console case run that
// produced it, so a person's choice can re-run that exact case with POST /api/console/execute
// { parentExecutionId, humanDecision }. Several rows can share a runId (a console run and the copy the
// importer reads back from runs/api); the console's own run wins, then the newest.
import { getDb } from "./db";

export interface RunLinkRow {
  id: string;
  caseId: string;
  runId: string | null;
  origin: string;
  status: string;
  startedAt: string;
}

const ORIGIN_RANK: Record<string, number> = { console: 0, voice: 0, city: 1, runs: 2, answers: 3, examples: 4 };

export const linkKey = (runId: string, caseId: string) => `${runId}\n${caseId}`;

/** Best finished execution per runId + caseId. Pure, for tests. */
export function pickLinks(rows: RunLinkRow[]): Map<string, string> {
  const best = new Map<string, RunLinkRow>();
  for (const r of rows) {
    if (!r.runId || r.status !== "success") continue;
    const key = linkKey(r.runId, r.caseId);
    const cur = best.get(key);
    const rank = (x: RunLinkRow) => ORIGIN_RANK[x.origin] ?? 5;
    if (!cur || rank(r) < rank(cur) || (rank(r) === rank(cur) && r.startedAt > cur.startedAt)) best.set(key, r);
  }
  return new Map([...best].map(([k, r]) => [k, r.id]));
}

/** Execution ids for these (runId, caseId) pairs, from the console's SQLite. Empty on any error. */
export function executionLinks(pairs: { runId: string; caseId: string }[]): Map<string, string> {
  const caseIds = [...new Set(pairs.map((p) => p.caseId).filter(Boolean))];
  if (!caseIds.length) return new Map();
  try {
    const rows = getDb()
      .prepare(`SELECT id, case_id, origin, status, started_at, json_extract(trace, '$.runId') AS run_id
        FROM executions WHERE trace IS NOT NULL AND case_id IN (${caseIds.map(() => "?").join(", ")})`)
      .all(...caseIds)
      .map((r): RunLinkRow => ({
        id: String(r.id), caseId: String(r.case_id), runId: r.run_id === null ? null : String(r.run_id),
        origin: String(r.origin), status: String(r.status), startedAt: String(r.started_at),
      }));
    return pickLinks(rows);
  } catch {
    return new Map();
  }
}

/** Adds `executionId` to each task that came from a console case run (null when none). */
export function withExecutionLinks<T extends { runId: string; caseId: string }>(tasks: T[]): (T & { executionId: string | null })[] {
  const links = executionLinks(tasks);
  return tasks.map((t) => ({ ...t, executionId: links.get(linkKey(t.runId, t.caseId)) ?? null }));
}
