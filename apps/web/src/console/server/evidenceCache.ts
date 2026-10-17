// The /evidence response, memoised: rebuilt only when the database or the case catalogue changed.
// With 455+ cases and every execution joined, this keeps repeat polls (every few seconds per tab) to
// two tiny SQL reads.
import type { EvidenceRow, EvidenceTotals } from "../types";
import { catalogueStamp, listCasesWithMutation } from "./catalogue";
import { dbVersion } from "./db";
import { buildEvidence } from "./evidence";
import { evidenceExecutions } from "./store";

type Evidence = { rows: EvidenceRow[]; totals: EvidenceTotals };
// New on each module load, so a hot-reloaded evidence.ts never serves a grid built by the old code.
const LOADED = `${Date.now()}-${Math.random()}`;
const g = globalThis as unknown as { __consoleEvidence?: { key: string; value: Evidence } };

export async function cachedEvidence(): Promise<Evidence> {
  const cases = await listCasesWithMutation();
  const key = `${LOADED}|${dbVersion()}|${catalogueStamp()}`;
  if (g.__consoleEvidence?.key === key) return g.__consoleEvidence.value;
  const value = buildEvidence(cases, evidenceExecutions());
  g.__consoleEvidence = { key, value };
  return value;
}
