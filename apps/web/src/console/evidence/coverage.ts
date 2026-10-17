// Pure maths for the Results "coverage" view: headline numbers, a scorecard per case set and a
// grid per difficulty pattern. The evidence API is growing new fields (critical failures, the
// judge's reason, broken rules, the difficulty pattern); every one is feature-detected here, so
// a missing field shows as "not recorded", never as an invented zero.
import { plainDataset, scrubLeaks } from "../../ui/plain";
import type { EvidenceRow, ScenarioSetId } from "../types";
import { wasRun } from "./logic";

/**
 * An evidence row with the v2 fields normalised. The server may predate them, so they are read
 * defensively: `critical` null = not reported for this row, `criticalReported` = the API sends
 * the field at all, `pattern` = the difficulty pattern (`mutation`).
 */
export interface ResultRow extends EvidenceRow {
  criticalReported: boolean;
  pattern: string | null;
}

type Loose = Record<string, unknown>;

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const bool = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);
const fin = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function rules(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  return x
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? str((v as Loose).rule) : null))
    .filter((v): v is string => !!v);
}

function first<T>(o: Loose, keys: string[], read: (x: unknown) => T | null): T | null {
  for (const k of keys) {
    const v = read(o[k]);
    if (v !== null) return v;
  }
  return null;
}

const CRITICAL_KEYS = ["critical", "criticalFailure", "isCritical"];
const RULE_KEYS = ["brokenRules", "mustNotBroken", "violations"];

/** Reads the v2 fields under the names the backend may use; absent fields stay null / empty. */
export function normalizeRow(r: EvidenceRow): ResultRow {
  const o = r as unknown as Loose;
  const brokenRules = first(o, RULE_KEYS, rules);
  let critical = first(o, CRITICAL_KEYS, bool);
  // The scorer's definition: a checked case is a critical failure when it broke a must-not rule.
  // Only when the API has no critical field at all; when it sends critical: null it means "not recorded".
  const hasCriticalKey = CRITICAL_KEYS.some((k) => k in o);
  if (!hasCriticalKey && brokenRules !== null && r.pass !== null) critical = brokenRules.length > 0;
  return {
    ...r,
    critical,
    criticalReported: hasCriticalKey || (brokenRules !== null && RULE_KEYS.some((k) => k in o)),
    brokenRules: brokenRules ?? [],
    verdict: first(o, ["verdict", "judgeNote", "note", "reason", "why"], str),
    mutation: first(o, ["mutation"], str),
    pattern: first(o, ["mutation", "pattern"], str),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface Headline {
  known: number;
  run: number;
  checked: number;
  right: number;
  wrong: number;
  /** right / checked; null when nothing was checked. */
  rightRate: number | null;
  /** The API reports critical failures at all (otherwise the tile is hidden). */
  criticalReported: boolean;
  /** Checked cases that broke a rule; null when no checked case records it. */
  critical: number | null;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
}

/** `totalsCritical` is the server's own count when it sends one; it wins over the row count. */
export function headline(rows: ResultRow[], totalsCritical?: unknown): Headline {
  const run = rows.filter(wasRun);
  const checked = run.filter((r) => r.pass !== null);
  const right = checked.filter((r) => r.pass === true).length;
  const reported = rows.some((r) => r.criticalReported);
  const judged = checked.filter((r) => r.critical !== null);
  const server = fin(totalsCritical);
  return {
    known: rows.length,
    run: run.length,
    checked: checked.length,
    right,
    wrong: checked.length - right,
    rightRate: checked.length ? right / checked.length : null,
    criticalReported: reported || server !== null,
    // A number only when some checked case actually carries a verdict on it (older verdicts
    // don't say), so "0" never stands in for "not recorded".
    critical: !judged.length ? null : server !== null ? server : judged.filter((r) => r.critical === true).length,
    avgCostUsd: mean(run.map((r) => r.costUsd).filter((x): x is number => fin(x) !== null)),
    avgDurationMs: mean(run.map((r) => r.durationMs).filter((x): x is number => fin(x) !== null)),
  };
}

/** The sets the rules ask about, in this order; anything else the API sends follows. */
export const SET_ORDER = ["public", "generated", "grounded", "adversarial", "city", "fixtures"] as const;

export const SET_LABEL: Record<string, string> = {
  public: "Sample cases",
  generated: "Generated cases",
  grounded: "Real-world cases",
  adversarial: "Trick cases",
  city: "City cases",
  bulk: "Bulk (rule-made)",
  fixtures: "Hard cases",
  reality: "Test day cases",
  adhoc: "One-off cases",
};

export const setLabel = (d: string) => SET_LABEL[d] ?? (plainDataset(d) || words(d));

/** Which Practice set runs more cases of a dataset (null = Practice can't pick it). */
export const PRACTICE_SET: Record<string, ScenarioSetId> = {
  public: "quick",
  generated: "generated",
  grounded: "generated",
  adversarial: "adversarial",
  city: "city",
  bulk: "bulk",
  fixtures: "fixtures",
};

export interface Tally {
  key: string;
  known: number;
  run: number;
  right: number;
  wrong: number;
  /** run but no verdict yet */
  unchecked: number;
  notRun: number;
  rightRate: number | null;
}

function tally(key: string, rows: ResultRow[]): Tally {
  const run = rows.filter(wasRun);
  const right = run.filter((r) => r.pass === true).length;
  const wrong = run.filter((r) => r.pass === false).length;
  return {
    key,
    known: rows.length,
    run: run.length,
    right,
    wrong,
    unchecked: run.length - right - wrong,
    notRun: rows.length - run.length,
    rightRate: right + wrong ? right / (right + wrong) : null,
  };
}

function groupBy(rows: ResultRow[], key: (r: ResultRow) => string | null): Map<string, ResultRow[]> {
  const m = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** One tally per case set, in SET_ORDER then by name. */
export function scorecard(rows: ResultRow[]): Tally[] {
  const m = groupBy(rows, (r) => r.dataset);
  const rank = (d: string) => {
    const i = (SET_ORDER as readonly string[]).indexOf(d);
    return i === -1 ? SET_ORDER.length : i;
  };
  return [...m.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((d) => tally(d, m.get(d)!));
}

/** Bar segments as fractions of the set (they sum to 1 when the set has cases). */
export function segments(t: Tally): { right: number; wrong: number; unchecked: number; notRun: number } {
  const d = t.known || 1;
  return { right: t.right / d, wrong: t.wrong / d, unchecked: t.unchecked / d, notRun: t.notRun / d };
}

/**
 * One tally per difficulty pattern, over rows that carry one. Weakest first among checked
 * patterns, then patterns with no verdict yet (by name). Empty when the API sends no pattern.
 */
export function byPattern(rows: ResultRow[]): Tally[] {
  const m = groupBy(rows, (r) => r.pattern);
  return [...m.entries()]
    .map(([k, rs]) => tally(k, rs))
    .sort((a, b) => {
      if (a.rightRate === null || b.rightRate === null) return a.rightRate === b.rightRate ? a.key.localeCompare(b.key) : a.rightRate === null ? 1 : -1;
      return a.rightRate - b.rightRate || b.right + b.wrong - (a.right + a.wrong) || a.key.localeCompare(b.key);
    });
}

export type Strength = "strong" | "mixed" | "weak" | "unknown";
export function strength(t: Tally): Strength {
  if (t.rightRate === null) return "unknown";
  return t.rightRate >= 0.8 ? "strong" : t.rightRate >= 0.5 ? "mixed" : "weak";
}

/** "hidden_injection" -> "Hidden injection". */
export function words(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The judge's one-line reason, safe to show: a broken rule first (that is what made it wrong),
 * then the verdict. Scrubbed of leak words and cut to one line. "" when nothing was recorded.
 */
export function why(r: ResultRow, max = 140): string {
  const firstLine = (s: string | null | undefined) => scrubLeaks((s ?? "").split(/\r?\n/)[0]);
  const broke = r.brokenRules.length ? firstLine(r.brokenRules[0]) : "";
  const line = broke ? `Broke a rule: ${broke}` : firstLine(r.verdict);
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export type Show = "run" | "wrong" | "all";

/** Rows for the case table: one set (or all), then run / wrong / all. Wrong first, then right, then the rest. */
export function tableRows(rows: ResultRow[], set: string | null, show: Show): ResultRow[] {
  const inSet = set ? rows.filter((r) => r.dataset === set) : rows;
  const picked = inSet.filter((r) => (show === "all" ? true : show === "wrong" ? r.pass === false : wasRun(r)));
  const rank = (r: ResultRow) => (r.pass === false ? (r.critical ? 0 : 1) : r.pass === true ? 2 : wasRun(r) ? 3 : 4);
  return picked.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}
