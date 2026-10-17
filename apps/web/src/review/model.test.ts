import { describe, expect, it } from "vitest";
import { plainOwner } from "../ui/plain";
import { deadlineLabel, keyEvidence, shortLine, taskFromTrace } from "./model";

import { fixtureTrace } from "./test-fixtures";

describe("human review trace adapter", () => {
  it("uses the actual handover, urgency, options and deadline", () => {
    const task = taskFromTrace(fixtureTrace(), "2026-10-10T12:00:00Z", "test-id")!;
    expect(task.deadlineAt).toBe("2026-10-10T12:15:00.000Z");
    expect(task.options[0].id).toBe("investigate");
    expect(task).toMatchObject({ urgency: "high", routeTo: "Claims team", status: "pending", simulated: false });
    expect(deadlineLabel(task, Date.parse("2026-10-10T12:10:00Z"))).toBe("5m left");
  });
  it("does not revive an old card when a resumed case no longer needs a human", () => {
    const trace = fixtureTrace();
    trace.events.push({ kind: "run_start", t: 20, title: "Resolved with new evidence" });
    expect(taskFromTrace(trace, "2026-10-10T12:00:00Z", "test-id")).toBeNull();
  });
  it("accepts the future PRD card event and its explicit fallback option", () => {
    const trace = fixtureTrace();
    const card = trace.events[2].output!.card!;
    const future = { ...trace, events: [trace.events[0], { kind: "card", card: { ...card, fallback: undefined, fallbackOptionId: "hold" } }] };
    expect(taskFromTrace(future, "2026-10-10T12:00:00Z", "test-id")?.fallback).toBe("Hold the refund request");
  });
  it("preserves the richer agent card explanation, evidence and option effects", () => {
    const trace = fixtureTrace();
    const card = trace.events[2].output!.card!;
    const enriched = { ...trace, events: [trace.events[0], { kind: "card", card: {
      ...card,
      whyStopped: { line: "The carrier and customer give conflicting accounts" },
      evidence: [{ who: "Customer", says: "The parcel arrived damaged", basis: "customer_statement" }],
      alreadyDone: ["Checked the tracking history"],
      options: [{ ...card.options[0], effect: "Ask the owning team to inspect the damage" }],
    } }] };
    const task = taskFromTrace(enriched, "2026-10-10T12:00:00Z", "test-id")!;
    expect(task.mustDecide).toBe("The carrier and customer give conflicting accounts");
    expect(task.evidence[0]).toMatchObject({ who: "Customer", basis: "customer_statement" });
    expect(task.tried).toEqual(["Checked the tracking history"]);
    expect(task.options[0].effect).toBe("Ask the owning team to inspect the damage");
  });
  it("keeps simulated traces labelled and rejects incomplete cards", () => {
    expect(taskFromTrace({ ...fixtureTrace("demo"), synthetic: true }, "2026-10-10T12:00:00Z", "test-id")?.simulated).toBe(true);
    expect(taskFromTrace({ events: [] }, "2026-10-10T12:00:00Z", "test-id")).toBeNull();
  });
  it("shows plain words, never ids or leaks", () => {
    expect(plainOwner("desk_duty_supervisor")).toBe("Desk supervisor");
    expect(plainOwner("Claims team")).toBe("Claims team");
    expect(shortLine("Check the trace for missed_or_failed_delivery. Then ask.")).not.toMatch(/trace|_/);
    expect(shortLine("one two three four five six", 3)).toBe("one two three…");
    const task = taskFromTrace(fixtureTrace(), "2026-10-10T12:00:00Z", "test-id")!;
    const lines = keyEvidence({ ...task, evidence: [{ who: "Customer", says: "It broke.", basis: "x" }, { who: "Driver", says: "Fine.", basis: "y" }] });
    expect(lines).toHaveLength(2);
    expect(keyEvidence(task)[0]).toMatch(/^The stories don't match: Carrier scan says intact/);
  });
});
