// Pure logic for the Reality Test page. The data comes from GET /api/console/reality, which reads
// the runner's output folder (ANSWERS/<case>/ANSWER.md, REASONING.md, trace.json, RUNLOG.md).
// Nothing here writes anything: the files are what the judges read and are shown read-only.
import { scrubLeaks } from "../../ui/plain";

export interface RealityCase {
  /** Position in the run (1-based) or the folder number. */
  n: number | string;
  /** Case folder name, exactly as the organisers named it. */
  caseId: string;
  title: string | null;
  /** acted | asked_for_info | escalated | blocked | no_action | error | null (not finished yet). */
  outcome: string | null;
  /** One-line headline of the decision, if the case finished. */
  decision: string | null;
  escalated: boolean;
  failed: boolean;
  costUsd: number | null;
  durationMs: number | null;
  executionId: string | null;
  /** Optional: the files' text, if the API sends it inline. */
  answerMd?: string | null;
  reasoningMd?: string | null;
}

/** Loose on purpose: the backend owns this shape. Only the fields below are read. */
export interface RealitySummary {
  total?: number | null;
  done?: number | null;
  finished?: boolean | null;
  [k: string]: unknown;
}

export interface RealityResponse {
  cases: RealityCase[];
  summary: RealitySummary | null;
  /** RUNLOG.md parsed by the server ({ runId, rows }); older servers sent the raw text. */
  runlog: string | { runId?: string | null; rows?: unknown[] } | null;
}

export type CaseStatus = "working" | "sent" | "asked" | "person" | "stopped" | "failed" | "nothing";
export type StatusTone = "green" | "blue" | "amber" | "violet" | "red" | "neutral";

export const STATUS_LABEL: Record<CaseStatus, string> = {
  working: "Working on it",
  sent: "Sent",
  asked: "Asked",
  person: "Needs a person",
  stopped: "Stopped",
  failed: "Failed",
  nothing: "Nothing to do",
};

export const STATUS_TONE: Record<CaseStatus, StatusTone> = {
  working: "neutral",
  sent: "green",
  asked: "blue",
  person: "amber",
  stopped: "violet",
  failed: "red",
  nothing: "neutral",
};

/** Legend order on screen. */
export const LEGEND: CaseStatus[] = ["sent", "asked", "person", "stopped", "failed"];

export function caseStatus(c: Pick<RealityCase, "outcome" | "failed" | "escalated">): CaseStatus {
  if (c.failed || c.outcome === "error") return "failed";
  switch (c.outcome) {
    case "acted":
      return "sent";
    case "asked_for_info":
      return "asked";
    case "escalated":
      return "person";
    case "blocked":
      return "stopped";
    case "no_action":
      return "nothing";
  }
  if (c.outcome) return c.escalated ? "person" : "nothing";
  return "working";
}

const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

export function sortCases(cases: RealityCase[]): RealityCase[] {
  return [...cases].sort((a, b) =>
    String(a.n).localeCompare(String(b.n), "en", { numeric: true }) ||
    a.caseId.localeCompare(b.caseId, "en", { numeric: true }),
  );
}

export interface Tally {
  /** Cases expected in the run (summary.total, or the cases seen so far if larger). */
  total: number;
  /** Cases with a finished outcome. */
  done: number;
  working: number;
  /** Sent + nothing to do: the agent dealt with it alone. */
  handled: number;
  /** Needs a person + stopped by the safety check: handed to a person. */
  person: number;
  asked: number;
  failed: number;
  byStatus: Record<CaseStatus, number>;
  /** Sum of known costs; null if none are known. */
  costUsd: number | null;
}

export function tally(data: Pick<RealityResponse, "cases" | "summary"> | null | undefined): Tally {
  const byStatus: Record<CaseStatus, number> = { working: 0, sent: 0, asked: 0, person: 0, stopped: 0, failed: 0, nothing: 0 };
  let cost: number | null = null;
  for (const c of data?.cases ?? []) {
    byStatus[caseStatus(c)]++;
    const k = num(c.costUsd);
    if (k !== null) cost = (cost ?? 0) + k;
  }
  const seen = data?.cases.length ?? 0;
  const done = seen - byStatus.working;
  const total = Math.max(num(data?.summary?.total) ?? 0, seen);
  return {
    total,
    done,
    working: byStatus.working,
    handled: byStatus.sent + byStatus.nothing,
    person: byStatus.person + byStatus.stopped,
    asked: byStatus.asked,
    failed: byStatus.failed,
    byStatus,
    costUsd: cost,
  };
}

export type Phase = "waiting" | "running" | "done";

/**
 * waiting: nothing on disk yet. done: the run log is written (or the API says finished) and no
 * case is still in progress. Anything else is running.
 */
function hasRunlog(r: RealityResponse["runlog"]): boolean {
  if (!r) return false;
  if (typeof r === "string") return r.trim().length > 0;
  return Array.isArray(r.rows) && r.rows.length > 0;
}

export function runPhase(data: RealityResponse | null | undefined): Phase {
  if (!data || data.cases.length === 0) return "waiting";
  const t = tally(data);
  if (t.working > 0 || t.done < t.total) return "running";
  if (data.summary?.finished === false) return "running";
  if (data.summary?.finished === true || hasRunlog(data.runlog)) return "done";
  return "running";
}

export interface Tile {
  key: string;
  label: string;
  caseId: string | null;
  status: CaseStatus | "pending";
}

/** One tile per case, in run order, padded with "pending" tiles up to the expected total. */
export function gridTiles(cases: RealityCase[], total: number): Tile[] {
  const tiles: Tile[] = sortCases(cases).map((c) => ({
    key: `c:${c.caseId}`,
    label: String(c.n),
    caseId: c.caseId,
    status: caseStatus(c),
  }));
  for (let i = tiles.length; i < total; i++) tiles.push({ key: `p:${i}`, label: String(i + 1), caseId: null, status: "pending" });
  return tiles;
}

const RAW_LABELS = /^(?:[Dd]ecision:?\s*)?(?:ACT|ASK FOR INFORMATION|HOLD FOR A HUMAN|BLOCKED BY THE SAFETY CHECK|NO ACTION NEEDED NOW|SYSTEM FAILURE: HANDED TO A HUMAN)\b\.?\s*/;

/** A short plain headline for the table: the decision sentence, else the outcome in words. */
export function headline(c: RealityCase, max = 110): string {
  const raw = (c.decision ?? "").replace(/\*\*/g, "").replace(RAW_LABELS, "").trim();
  const text = scrubLeaks(raw) || STATUS_LABEL[caseStatus(c)];
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Case title for display; the folder name when there is no title. */
export function caseTitle(c: RealityCase): string {
  const t = (c.title ?? "").trim();
  return t || c.caseId;
}

/** Where the judges find this case's files. */
export function filePath(caseId: string, file: "ANSWER.md" | "REASONING.md" | "trace.json", root = "ANSWERS"): string {
  return `${root}/${caseId}/${file}`;
}

/** What a try run of `n` cases costs, roughly, in words: "3 cases · about 15¢ · real agent". */
export function tryCostLine(n: number, centsPerCase = 5): string {
  const cents = n * centsPerCase;
  const money = cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents}¢`;
  return `${n} case${n === 1 ? "" : "s"} · about ${money} · real agent`;
}
