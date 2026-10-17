import { describe, expect, it } from "vitest";
import type { ReviewTask } from "./types";
import { taskCard } from "./voice";

const task = {
  id: "t1", caseId: "delivery-050", runId: "r1", cardId: "c1", title: "Surcharge refund", summary: "Customer asks for the surcharge back.",
  routeTo: "Merchant refunds team", mustDecide: "Refund the GBP 7.50 surcharge or not.",
  evidence: [{ who: "Customer", says: "It came a day late.", basis: "unverified_claim" }, { who: "Tracker", says: "Delivered 20 Feb.", basis: "weird" }],
  clash: null, tried: ["Asked the carrier for the delivery record."], wouldChangeMyMind: "The carrier's scan log.",
  options: [{ id: "option-1", label: "Refund it", undoable: false, effect: "Email to the customer" }, { id: "option-2", label: "Hold", undoable: true }],
  fallback: "Hold and ask again tomorrow.", receivedAt: "2026-10-10T12:00:00Z", deadlineAt: "2026-10-10T12:30:00Z",
  urgency: "medium", risk: 0.5, status: "pending", decision: null, simulated: false, mode: "demo", origin: "agent",
  messages: [], timeline: [], costUsd: null, durationMs: null,
} as ReviewTask;

describe("taskCard", () => {
  it("gives the voice call what the person must decide, the options with their effects, and the time left", () => {
    const card = taskCard(task, Date.parse("2026-10-10T12:10:00Z"));
    expect(card.summary).toBe("Refund the GBP 7.50 surcharge or not. Customer asks for the surcharge back.");
    expect(card.routeTo).toBe("Merchant refunds team");
    expect(card.options).toEqual(task.options);
    expect(card.alreadyDone).toEqual(["Asked the carrier for the delivery record."]);
    expect(card.deadlineMins).toBe(20);
    expect(card.chosen).toBeUndefined();
  });
  it("keeps evidence with a known basis and reads anything else as an unverified claim", () => {
    expect(taskCard(task, 0).evidence?.map((e) => e.basis)).toEqual(["unverified_claim", "unverified_claim"]);
  });
  it("never gives a negative or unreadable deadline", () => {
    expect(taskCard(task, Date.parse("2026-10-10T13:00:00Z")).deadlineMins).toBe(0);
    expect(taskCard({ ...task, deadlineAt: "soon" }, 0).deadlineMins).toBe(0);
  });
});
