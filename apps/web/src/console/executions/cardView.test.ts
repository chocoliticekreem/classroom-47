import { describe, expect, it } from "vitest";
import type { DecisionCard } from "../../../../api/src/lib/trace";
import { cardOf, cardView } from "./logic";

const base: DecisionCard = {
  routeTo: "Supervisor", summary: "Customer and courier disagree", tried: ["Called courier"],
  options: [{ id: "a", label: "Refund", undoable: false }, { id: "b", label: "Redeliver", undoable: true }],
  wouldChangeMyMind: "proof of delivery", deadlineMins: 30, fallback: "hold",
};

describe("cardView", () => {
  it("leads with whyStopped and keeps the summary underneath", () => {
    const v = cardView({ ...base, whyStopped: { reason: "message_too_risky", line: "The refund message was held." } });
    expect(v.headline).toEqual({ chip: { label: "Message too risky", tone: "err" }, line: "The refund message was held." });
    expect(v.summary).toBe("Customer and courier disagree");
  });

  it("maps evidence basis to badge styles", () => {
    const v = cardView({ ...base, evidence: [
      { who: "WMS", says: "Scanned out 09:12", basis: "system_record" },
      { who: "Depot team", says: "Van left late", basis: "owning_team_statement" },
      { who: "Customer", says: "Nobody came", basis: "unverified_claim" },
    ] });
    expect(v.evidence.map((e) => [e.style, e.label])).toEqual([
      ["solid", "system record"], ["blue", "owning team"], ["dashed", "unverified claim"],
    ]);
  });

  it("uses alreadyDone for the ✓ list and shows option effects with reversibility", () => {
    const v = cardView({
      ...base, chosen: "b", alreadyDone: ["Told the customer we are on it"],
      options: [{ id: "a", label: "Refund", undoable: false, effect: "Email customer: refund issued" }, { id: "b", label: "Redeliver", undoable: true }],
    });
    expect(v.done).toEqual({ title: "Already done", items: ["Told the customer we are on it"] });
    expect(v.options).toEqual([
      { id: "a", label: "Refund", effect: "Email customer: refund issued", undoable: false, chosen: false },
      { id: "b", label: "Redeliver", effect: null, undoable: true, chosen: true },
    ]);
  });

  it("falls back to the older fields when the new ones are missing", () => {
    const v = cardView({ ...base, clash: "times differ" });
    expect(v.headline).toEqual({ chip: null, line: "Customer and courier disagree" });
    expect(v.summary).toBeNull();
    expect(v.clash).toBe("times differ");
    expect(v.evidence).toEqual([]);
    expect(v.done).toEqual({ title: "Already tried", items: ["Called courier"] });
  });

  it("tolerates an unknown stop reason and basis", () => {
    const v = cardView({
      ...base,
      whyStopped: { reason: "new_reason" as never, line: "" },
      evidence: [{ who: "X", says: "y", basis: "rumour" as never }],
    });
    expect(v.headline.chip).toEqual({ label: "new reason", tone: "muted" });
    expect(v.headline.line).toBe("Customer and courier disagree");
    expect(v.evidence[0].style).toBe("dashed");
  });

  it("cardOf keeps the new fields from a trace output", () => {
    const c = cardOf({ type: "human_decision", card: { ...base, whyStopped: { reason: "rule_requires_person", line: "Legal" }, alreadyDone: ["x"], evidence: [] } });
    expect(c?.whyStopped?.reason).toBe("rule_requires_person");
    expect(c?.alreadyDone).toEqual(["x"]);
  });
});
