// Decide by voice on the Decisions desk: a waiting task becomes the decision card the voice call reads
// out (apps/web/src/voice/ApproveByVoice). The choice made on the call is saved like a tapped one.
import type { DecisionCard } from "../voice/api";
import type { ReviewTask } from "./types";

type Basis = NonNullable<DecisionCard["evidence"]>[number]["basis"];
const BASES = new Set<string>(["system_record", "owning_team_statement", "unverified_claim"]);

export function taskCard(task: ReviewTask, nowMs: number): DecisionCard {
  const left = Math.round((Date.parse(task.deadlineAt) - nowMs) / 60_000);
  return {
    routeTo: task.routeTo,
    summary: [task.mustDecide, task.summary].filter(Boolean).join(" "),
    evidence: task.evidence.map((e) => ({ who: e.who, says: e.says, basis: (BASES.has(e.basis) ? e.basis : "unverified_claim") as Basis })),
    alreadyDone: task.tried,
    tried: task.tried,
    options: task.options,
    wouldChangeMyMind: task.wouldChangeMyMind,
    deadlineMins: Number.isFinite(left) ? Math.max(0, left) : 0,
    fallback: task.fallback,
  };
}
