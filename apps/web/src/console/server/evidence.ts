// The evidence grid: one row per case across every dataset, joined with its latest execution and
// its latest eval verdict. Pure: the route passes the catalogue and the executions in.
import type { EvalVerdict, EvidenceRow, EvidenceTotals } from "../types";
import type { CaseEntry } from "./catalogue";

export interface EvidenceExecution {
  id: string;
  caseId: string;
  dataset: string;
  status: "running" | "success" | "error";
  outcome: string | null;
  startedAt: string;
  durationMs: number | null;
  costUsd: number | null;
  simulated: boolean;
  title: string | null;
  nextAction: string | null;
  gate: string | null;
  eval: EvalVerdict | null;
}

export type { EvidenceTotals };

/** A catalogue entry, optionally with its difficulty pattern. */
export type EvidenceCase = CaseEntry & { mutation?: string | null };

const DATASET_ORDER = ["public", "generated", "grounded", "adversarial", "city", "fixtures", "reality"];

const later = (a: EvidenceExecution, b: EvidenceExecution) => (a.startedAt > b.startedAt ? a : b);
const keepLatest = (m: Map<string, EvidenceExecution>, e: EvidenceExecution) => {
  const prev = m.get(e.caseId);
  m.set(e.caseId, prev ? later(prev, e) : e);
};

/** critical: the stored flag, else any broken rule; null when the run was never judged on rules. */
function criticalOf(v: EvalVerdict | null): boolean | null {
  if (!v) return null;
  if (v.critical === true || (v.brokenRules?.length ?? 0) > 0) return true;
  // A pass, or any score above 0, rules a broken rule out (score.mjs forces a critical case to 0 and fail).
  if (v.critical === false || v.pass || v.score > 0) return false;
  // Rows scored before the flag existed: the notes start with "BROKE RULE" (mapping.ts evalRowVerdict).
  return /BROKE RULE/.test(v.notes ?? "") ? true : null;
}

export function buildEvidence(cases: EvidenceCase[], executions: EvidenceExecution[]): { rows: EvidenceRow[]; totals: EvidenceTotals } {
  const latest = new Map<string, EvidenceExecution>(); // latest finished run per case
  const latestAny = new Map<string, EvidenceExecution>(); // falls back to a running one
  const latestEval = new Map<string, EvidenceExecution>();
  for (const e of executions) {
    if (e.simulated) continue; // Simulated runs (city/mock) are never evidence.
    keepLatest(latestAny, e);
    if (e.status !== "running") keepLatest(latest, e);
    if (e.eval) keepLatest(latestEval, e);
  }

  const row = (caseId: string, dataset: string, title: string | null, mutation: string | null): EvidenceRow => {
    // Every field comes from one run: the latest judged run when there is one, else the latest run.
    const ex = latestEval.get(caseId) ?? latest.get(caseId) ?? latestAny.get(caseId) ?? null;
    const ev = ex?.eval ?? null;
    return {
      caseId,
      dataset,
      title: title ?? ex?.title ?? null,
      decision: ex?.outcome ?? null,
      nextAction: ex?.nextAction ?? null,
      gate: ex?.gate ?? null,
      pass: ev ? ev.pass : null,
      score: ev ? ev.score : null,
      costUsd: ex?.costUsd ?? null,
      durationMs: ex?.durationMs ?? null,
      executionId: ex?.id ?? null,
      critical: criticalOf(ev),
      verdict: ev?.verdict ?? null,
      brokenRules: ev?.brokenRules ?? [],
      mutation,
    };
  };

  const rows = cases.map((c) => row(c.id, c.dataset, c.title, c.mutation ?? null));
  // Cases that were run but are not in the repo's datasets (Reality Test folders, ad hoc runs).
  const listed = new Set(cases.map((c) => c.id));
  const extra = [...latestAny.values()].filter((e) => !listed.has(e.caseId)).sort((a, b) => a.caseId.localeCompare(b.caseId, "en", { numeric: true }));
  for (const e of extra) rows.push(row(e.caseId, e.dataset, null, null));

  const per = new Map<string, { dataset: string; run: number; right: number; wrong: number }>();
  for (const r of rows) {
    const d = per.get(r.dataset) ?? { dataset: r.dataset, run: 0, right: 0, wrong: 0 };
    if (r.executionId !== null) d.run++;
    if (r.pass === true) d.right++;
    if (r.pass === false) d.wrong++;
    per.set(r.dataset, d);
  }
  const rank = (d: string) => (DATASET_ORDER.includes(d) ? DATASET_ORDER.indexOf(d) : DATASET_ORDER.length);
  const byDataset = [...per.values()].sort((a, b) => rank(a.dataset) - rank(b.dataset) || a.dataset.localeCompare(b.dataset));

  const totals: EvidenceTotals = {
    cases: rows.length,
    evaluated: rows.filter((r) => r.pass !== null).length,
    passed: rows.filter((r) => r.pass === true).length,
    costUsd: Math.round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 1e6) / 1e6,
    criticalFailures: rows.filter((r) => r.critical === true).length,
    byDataset,
  };
  return { rows, totals };
}
