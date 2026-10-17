// Pure KPI maths over evidence rows (GET /api/console/evidence). Used by the Overview tab and
// reusable by any tab that needs headline numbers. City/simulated rows never count as real.
import type { EvidenceRow } from "../types";

/** Datasets whose rows are simulated and must never feed real KPIs. */
export const SIMULATED_DATASETS: ReadonlySet<string> = new Set(["city"]);

export interface DatasetKpi {
  dataset: string;
  /** cases known in this dataset (run or not). */
  known: number;
  /** cases with at least one real run/result. */
  cases: number;
  evaluated: number;
  passed: number;
  passRate: number | null;
}

export interface Kpis {
  /** known cases across real datasets (the evidence grid lists un-run cases too). */
  known: number;
  /** cases actually tested: they have an execution, a decision or an eval verdict. */
  cases: number;
  evaluated: number;
  passed: number;
  failed: number;
  /** passed / evaluated, null when nothing evaluated. */
  passRate: number | null;
  totalCostUsd: number;
  /** mean over rows that recorded a cost; null when none did. */
  avgCostUsd: number | null;
  /** mean over rows that recorded a duration; null when none did. */
  avgDurationMs: number | null;
  /** null = no data at all; 0 = data exists but no critical failure recorded. */
  criticalFailures: number | null;
  datasets: DatasetKpi[];
  /** rows excluded because they are simulated. */
  simulatedExcluded: number;
  /** tested cases per outcome ("acted", "escalated", ...); rows without a decision are not counted. */
  outcomes: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (x: number | null): x is number => typeof x === "number" && Number.isFinite(x);

/** A row counts as tested only when it carries a real result, not just a known case id. */
export function isTested(r: EvidenceRow): boolean {
  return r.executionId !== null || r.pass !== null || r.decision !== null;
}

export function computeKpis(rows: readonly EvidenceRow[], recordedCriticalFailures?: number | null): Kpis {
  const nonSim = rows.filter((r) => !SIMULATED_DATASETS.has(r.dataset));
  const real = nonSim.filter(isTested);
  const evaluatedRows = real.filter((r) => r.pass !== null);
  const passed = evaluatedRows.filter((r) => r.pass === true).length;
  const costs = real.map((r) => r.costUsd).filter(num);
  const durations = real.map((r) => r.durationMs).filter(num);

  const byDataset = new Map<string, DatasetKpi>();
  for (const r of nonSim) {
    const d = byDataset.get(r.dataset) ?? { dataset: r.dataset, known: 0, cases: 0, evaluated: 0, passed: 0, passRate: null };
    d.known += 1;
    byDataset.set(r.dataset, d);
    if (!isTested(r)) continue;
    d.cases += 1;
    if (r.pass !== null) d.evaluated += 1;
    if (r.pass === true) d.passed += 1;
  }
  const datasets = [...byDataset.values()]
    .map((d) => ({ ...d, passRate: d.evaluated ? d.passed / d.evaluated : null }))
    .sort((a, b) => b.cases - a.cases || b.known - a.known || a.dataset.localeCompare(b.dataset));

  const outcomes: Record<string, number> = {};
  for (const r of real) if (r.decision) outcomes[r.decision] = (outcomes[r.decision] ?? 0) + 1;

  return {
    outcomes,
    known: nonSim.length,
    cases: real.length,
    evaluated: evaluatedRows.length,
    passed,
    failed: evaluatedRows.length - passed,
    passRate: evaluatedRows.length ? passed / evaluatedRows.length : null,
    totalCostUsd: costs.reduce((a, b) => a + b, 0),
    avgCostUsd: mean(costs),
    avgDurationMs: mean(durations),
    criticalFailures: num(recordedCriticalFailures ?? null)
      ? (recordedCriticalFailures as number)
      : real.length
        ? 0
        : null,
    datasets,
    simulatedExcluded: rows.length - nonSim.length,
  };
}
