// results.csv: every case with its latest real run, its verdict, cost and time. Pure, unit tested.
import type { EvidenceRow } from "../types";

export type CsvValue = string | number | boolean | null | undefined;

/**
 * One RFC 4180 cell. Quoted when it holds a comma, quote, CR or LF, or leading/trailing space;
 * quotes are doubled. A text cell starting with = + - @ (or a tab/CR) gets a leading apostrophe
 * so a spreadsheet never runs it as a formula; numbers are written as-is.
 */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with CRLF line ends (what spreadsheets expect). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const RESULTS_HEADER = [
  "case_id", "case_set", "pattern", "title", "outcome", "result", "score", "broke_a_rule", "rules_broken", "judge_note",
  "cost_usd", "time_s", "next_action", "safety_check", "run_id",
];

/** "right" / "wrong" when the case was checked against its answer key, "not checked" when run but not scored, "" when never run. */
export function resultWord(r: Pick<EvidenceRow, "pass" | "executionId">): string {
  if (r.pass === true) return "right";
  if (r.pass === false) return "wrong";
  return r.executionId ? "not checked" : "";
}

export function resultsCsv(rows: EvidenceRow[]): string {
  return toCsv(RESULTS_HEADER, rows.map((r) => [
    r.caseId,
    r.dataset,
    r.mutation ?? null,
    r.title,
    r.decision ?? (r.executionId ? "not finished" : "not run"),
    resultWord(r),
    r.score,
    r.critical === null || r.critical === undefined ? null : r.critical ? "yes" : "no",
    (r.brokenRules ?? []).join("; "),
    r.verdict ?? null,
    r.costUsd === null ? null : Math.round(r.costUsd * 1e6) / 1e6,
    r.durationMs === null ? null : Math.round(r.durationMs / 100) / 10,
    r.nextAction,
    r.gate,
    r.executionId,
  ]));
}
