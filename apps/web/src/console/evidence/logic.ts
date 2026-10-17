// Pure helpers for the Evidence grid: search/filter, sort, group by dataset, totals.
import { plainDataset, plainGate, plainOutcome } from "../../ui/plain";
import type { EvidenceRow } from "../types";

export type SortKey =
  | "caseId" | "dataset" | "decision" | "nextAction" | "gate" | "pass" | "score" | "costUsd" | "durationMs";
export type SortDir = "asc" | "desc";
export type PassFilter = "all" | "pass" | "fail" | "unevaluated";

export interface EvidenceFilter {
  q: string;
  dataset: string | "all";
  pass: PassFilter;
  gate: string | "all";
}

export const EMPTY_FILTER: EvidenceFilter = { q: "", dataset: "all", pass: "all", gate: "all" };

export interface Totals {
  cases: number;
  evaluated: number;
  passed: number;
  passRate: number | null; // passed / evaluated, null when nothing evaluated
  costUsd: number;
}

export function filterRows(rows: EvidenceRow[], f: EvidenceFilter): EvidenceRow[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.dataset !== "all" && r.dataset !== f.dataset) return false;
    if (f.gate !== "all" && (r.gate ?? "") !== f.gate) return false;
    if (f.pass === "pass" && r.pass !== true) return false;
    if (f.pass === "fail" && r.pass !== false) return false;
    if (f.pass === "unevaluated" && r.pass !== null) return false;
    if (!terms.length) return true;
    const hay = [r.caseId, r.dataset, plainDataset(r.dataset), r.title, r.decision, r.decision && plainOutcome(r.decision), r.nextAction, r.gate && plainGate(r.gate)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Natural compare so delivery-2 sorts before delivery-10. */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function value(r: EvidenceRow, k: SortKey): string | number | null {
  if (k === "pass") return r.pass === null ? null : r.pass ? 1 : 0;
  return r[k];
}

/** Stable sort; nulls (not run / not evaluated) always go last regardless of direction. */
export function sortRows(rows: EvidenceRow[], key: SortKey, dir: SortDir): EvidenceRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = value(a.r, key), vb = value(b.r, key);
      if (va === null || vb === null) return va === vb ? a.i - b.i : va === null ? 1 : -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Clicking the active column flips direction; a new column starts asc (desc for numbers). */
export function nextSort(cur: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  const numeric = key === "score" || key === "costUsd" || key === "durationMs" || key === "pass";
  return { key, dir: numeric ? "desc" : "asc" };
}

export function totalsOf(rows: EvidenceRow[]): Totals {
  const evaluated = rows.filter((r) => r.pass !== null).length;
  const passed = rows.filter((r) => r.pass === true).length;
  return {
    cases: rows.length,
    evaluated,
    passed,
    passRate: evaluated ? passed / evaluated : null,
    costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
  };
}

export interface Group {
  dataset: string;
  rows: EvidenceRow[];
  totals: Totals;
}

/** Groups keep the order rows arrive in (so they respect the current sort); datasets sorted by name. */
export function groupByDataset(rows: EvidenceRow[]): Group[] {
  const m = new Map<string, EvidenceRow[]>();
  for (const r of rows) {
    const list = m.get(r.dataset);
    if (list) list.push(r);
    else m.set(r.dataset, [r]);
  }
  return [...m.keys()].sort(collator.compare).map((dataset) => ({ dataset, rows: m.get(dataset)!, totals: totalsOf(m.get(dataset)!) }));
}

export function distinct(rows: EvidenceRow[], k: "dataset" | "gate"): string[] {
  return [...new Set(rows.map((r) => r[k]).filter((v): v is string => !!v))].sort(collator.compare);
}

export function fmtPct(x: number | null): string {
  return x === null ? "–" : `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`;
}

/** A row was actually run when it has a run, a decision or a verdict (the grid also lists cases not run yet). */
export function wasRun(r: EvidenceRow): boolean {
  return r.executionId !== null || r.decision !== null || r.pass !== null;
}

/** The big numbers on top of Results: "40 cases · 34 right · 6 wrong". */
export function resultNumbers(rows: EvidenceRow[]): { known: number; run: number; right: number; wrong: number; unchecked: number } {
  const run = rows.filter(wasRun);
  const right = run.filter((r) => r.pass === true).length;
  const wrong = run.filter((r) => r.pass === false).length;
  return { known: rows.length, run: run.length, right, wrong, unchecked: run.length - right - wrong };
}
