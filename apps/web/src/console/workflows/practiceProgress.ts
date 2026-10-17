// Live progress for a practice run: per-case elapsed time and an overall bar. The bar counts
// finished cases exactly; a running case adds a share estimated from how long it has been running
// (never from agent steps, which the run does not report), capped so it only reaches 100% when
// every case is done.
import type { TestRunCase } from "../types";

/** What a real case usually takes, end to end (agent + scoring). Shown in the header. */
export const TYPICAL_RANGE_S: readonly [number, number] = [30, 90];
/** Midpoint used for the time estimate. */
export const TYPICAL_MS = 60_000;
/** A running case never counts for more than this share of one case. */
export const RUNNING_CAP = 0.9;

export const isFinished = (c: Pick<TestRunCase, "status">) => c.status === "passed" || c.status === "failed" || c.status === "error";

/** "0:42", "1:05", "12:00". Negative or missing time reads "0:00". */
export function fmtElapsed(ms: number | null | undefined): string {
  const s = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How long a case has run: to `now` while running, to its end once finished, null if not started. */
export function caseElapsedMs(c: Pick<TestRunCase, "status" | "startedAt" | "finishedAt" | "durationMs">, now: number): number | null {
  const start = c.startedAt ? Date.parse(c.startedAt) : NaN;
  if (c.status === "running") return Number.isFinite(start) ? Math.max(0, now - start) : null;
  if (isFinished(c)) {
    const end = c.finishedAt ? Date.parse(c.finishedAt) : NaN;
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, end - start);
    return c.durationMs ?? null;
  }
  return null;
}

/** Share of one case a running case counts for: rises quickly, then slows, never past RUNNING_CAP. */
export function runningShare(elapsedMs: number, typicalMs = TYPICAL_MS): number {
  if (!(elapsedMs > 0)) return 0;
  return RUNNING_CAP * (1 - Math.exp(-elapsedMs / typicalMs));
}

/** Overall progress, 0..1: finished cases count 1, running cases their time-estimated share. */
export function overallProgress(cases: Pick<TestRunCase, "status" | "startedAt" | "finishedAt" | "durationMs">[], now: number, typicalMs = TYPICAL_MS): number {
  if (!cases.length) return 0;
  let sum = 0;
  for (const c of cases) {
    if (isFinished(c)) sum += 1;
    else if (c.status === "running") sum += runningShare(caseElapsedMs(c, now) ?? 0, typicalMs);
  }
  return Math.min(1, sum / cases.length);
}

/** Header line while running, e.g. "5 running at once · usually 30–90 s each". */
export function runningLine(cases: Pick<TestRunCase, "status">[]): string {
  const running = cases.filter((c) => c.status === "running").length;
  const waiting = cases.filter((c) => c.status === "queued").length;
  const head = running === 0 ? (waiting ? "Starting" : "Finishing") : running === 1 ? "1 running" : `${running} running at once`;
  return `${head}${waiting ? ` · ${waiting} waiting` : ""} · usually ${TYPICAL_RANGE_S[0]}–${TYPICAL_RANGE_S[1]} s each`;
}

/** The case in plain words: its title, else its id made readable. */
export function caseTitle(c: Pick<TestRunCase, "caseId" | "title">): string {
  const t = c.title?.trim();
  if (t) return t;
  return c.caseId.replace(/[-_]+/g, " ").replace(/\b(\d+)\b/, "case $1").trim();
}
