"use client";
// "Approve by voice" for a decision card: the agent reads the card to the desk manager, they choose an
// option out loud, the agent reads it back, and the decision is returned to the console.
import { CallDrawer, type CallResult } from "./CallDrawer";
import type { DecisionCard, HumanDecision, VoiceSource } from "./api";

// The console's slot passes { card, caseId, onDecision }; the rest has safe defaults. Without case text,
// the card itself is what any spoken promise is checked against.
const cardText = (card: DecisionCard, managerName: string) =>
  [managerName, card.whyStopped?.line ?? card.summary, ...(card.evidence ?? []).map((e) => `${e.who}: ${e.says}`)].join("\n");

export function ApproveByVoice({ card, caseId, caseText, managerName = "Desk manager", startN = 0, at = "", source = "live_human", onDecision, onEvents }: {
  card: DecisionCard;
  caseId: string;
  caseText?: string;
  managerName?: string;
  startN?: number;
  at?: string;
  source?: VoiceSource;
  onDecision: (decision: HumanDecision) => void;
  onEvents?: (events: CallResult["events"]) => void;
}) {
  // A card decided on an earlier call is not offered again: a second call could pick a different option.
  if (card.chosen) {
    const option = card.options.find((o) => o.id === card.chosen);
    return <p className="rounded bg-white/5 px-3 py-2 text-sm text-white/70">Already decided: {option?.label ?? card.chosen}</p>;
  }
  return (
    <CallDrawer
      label="Approve by voice"
      simulated={source === "simulated_persona"}
      request={{ mode: "demo", purpose: "approval", caseId, calleeRole: "desk manager", calleeName: managerName, brief: "", goal: "Get the desk manager's decision on this card.", card }}
      state={{ caseId, mode: "demo", source, caseText: caseText ?? cardText(card, managerName), calleeName: managerName, card, startN, at }}
      onDone={(result) => {
        if (result.decision) onDecision(result.decision);
        onEvents?.(result.events);
      }}
    />
  );
}
