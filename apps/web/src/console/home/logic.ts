// Pure maths and words for the Home tab. Real data only: city-made (simulated) rows never count.
import { computeKpis, isTested, SIMULATED_DATASETS } from "../ui/kpis";
import { scrubLeaks } from "../../ui/plain";
import type { EvidenceRow } from "../types";
import type { ExecutionSummary } from "../useApi";
import type { ReviewTask } from "../../review/types";

export interface HomeNumbers {
  /** Real cases with a result (run, decision or test verdict). */
  handled: number;
  sent: number;
  asked: number;
  needPerson: number;
  stopped: number;
  /** Test cases with a verdict, and how many were right. */
  evaluated: number;
  passed: number;
  /** passed / evaluated; null when nothing was checked (then the number is hidden). */
  rightRate: number | null;
}

/**
 * Which bucket a case ends up in. Each case lands in at most one, so the numbers never
 * double-count: a safety stop wins over everything, then "needs a person".
 */
export function caseBucket(r: Pick<EvidenceRow, "decision" | "gate">): "stopped" | "needPerson" | "asked" | "sent" | null {
  if (r.decision === "blocked" || r.gate === "block") return "stopped";
  if (r.decision === "escalated") return "needPerson";
  if (r.decision === "asked_for_info") return "asked";
  if (r.decision === "acted") return "sent";
  return null;
}

export function homeNumbers(rows: readonly EvidenceRow[]): HomeNumbers {
  const k = computeKpis(rows);
  const out: HomeNumbers = {
    handled: k.cases,
    sent: 0,
    asked: 0,
    needPerson: 0,
    stopped: 0,
    evaluated: k.evaluated,
    passed: k.passed,
    rightRate: k.evaluated > 0 ? k.passed / k.evaluated : null,
  };
  // Same row set as computeKpis counts as "handled" (tested, not simulated).
  const tested = rows.filter((r) => !SIMULATED_DATASETS.has(r.dataset) && isTested(r));
  for (const r of tested) {
    const b = caseBucket(r);
    if (b) out[b] += 1;
  }
  return out;
}

/** "100% right" style figure: whole percent, no decimals. */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Live decisions waiting for a person, most urgent first (the queue is already sorted). */
export function openDecisions(tasks: readonly ReviewTask[]): ReviewTask[] {
  return tasks.filter((t) => !t.simulated && t.status === "pending");
}

/** "Customer portal → Calla Mossop" -> "Calla Mossop". */
export function recipientOf(nextAction: string | null | undefined): string {
  if (!nextAction) return "";
  const parts = nextAction.split("→");
  return scrubLeaks(parts[parts.length - 1]?.trim() ?? "");
}

export type ActivityTone = "green" | "amber" | "red" | "blue" | "neutral";

export interface ActivityLine {
  id: string;
  /** What Hamyway did, as a short sentence. */
  sentence: string;
  /** The case it was about. */
  about: string;
  tone: ActivityTone;
  simulated: boolean;
  startedAt: string;
  /** Re-run after a person made a choice. */
  afterDecision: boolean;
}

type Summary = Pick<ExecutionSummary, "id" | "caseId" | "status" | "outcome" | "startedAt" | "simulated"> & {
  title?: string | null;
  nextAction?: string | null;
  gate?: string | null;
  parentExecutionId?: string | null;
};

/** "Case 045: Import shipment…" -> "Import shipment…" (same rule as the case picker). */
const stripCaseNo = (title: string) => title.replace(/^case\s*[\w-]+\s*:\s*/i, "");

/** One case run in plain words: "Sent a message to Calla Mossop". */
export function activityLine(r: Summary): ActivityLine {
  const to = recipientOf(r.nextAction);
  const about = r.title ? scrubLeaks(stripCaseNo(r.title)) || r.caseId : r.caseId;
  let sentence: string;
  let tone: ActivityTone;
  if (r.status === "running") [sentence, tone] = ["Working on a case", "blue"];
  else if (r.status === "error") [sentence, tone] = ["Couldn't finish a case", "red"];
  else if (r.outcome === "blocked" || r.gate === "block") [sentence, tone] = ["Stopped a message for safety", "red"];
  else if (r.outcome === "escalated") [sentence, tone] = ["Asked a person to decide", "amber"];
  else if (r.outcome === "asked_for_info") [sentence, tone] = [to ? `Asked ${to} a question` : "Asked a question", "neutral"];
  else if (r.outcome === "acted") [sentence, tone] = [to ? `Sent a message to ${to}` : "Sent a message", "green"];
  else if (r.outcome === "no_action") [sentence, tone] = ["Checked a case: nothing to do", "neutral"];
  else [sentence, tone] = ["Finished a case", "neutral"];
  return {
    id: r.id,
    sentence,
    about,
    tone,
    simulated: r.simulated,
    startedAt: r.startedAt,
    afterDecision: !!r.parentExecutionId,
  };
}

/** Ids in `next` that were not in `seen` (used to slide new runs in). Empty on the first load. */
export function newIds(seen: ReadonlySet<string> | null, next: readonly { id: string }[]): string[] {
  if (!seen) return [];
  return next.filter((r) => !seen.has(r.id)).map((r) => r.id);
}
