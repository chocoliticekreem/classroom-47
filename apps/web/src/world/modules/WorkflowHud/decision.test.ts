import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../../store";
import type { ReviewTask } from "../../../review/types";
import { toastFromEvent, toastFromTask } from "./decision";

const card: NonNullable<WorkflowEvent["card"]> = {
  cardId: "c", summary: "s", routeTo: "depot_manager", deadlineMs: 60_000, fallbackOptionId: "a",
  options: [{ id: "a", label: "Hold", safe: true, effect: "Nothing is sent" }],
  whyStopped: { reason: "agent_judged_unsafe", line: "why" },
};
const base: WorkflowEvent = { id: "1", t: 0, caseId: "INC-001 · car crash", nodeId: "human", status: "ask", summary: "x" };

describe("decision toast sources", () => {
  it("only takes real replayed cards", () => {
    expect(toastFromEvent({ ...base, card, source: "mock", runId: "r" }, undefined, 0)).toBeNull();
    expect(toastFromEvent({ ...base, source: "agent", runId: "r" }, undefined, 0)).toBeNull(); // no card
    const it = toastFromEvent({ ...base, card, source: "agent", runId: "r", synthetic: true, origin: "city_incident" }, "city-inc-1", 0)!;
    expect(it.key).toBe("r|city-inc-1");
    expect(it.prov).toBe("Practice case");
    expect(it.card.options[0].effect).toBe("Nothing is sent");
  });

  it("maps a review-queue task with its rich fields and skips the city's simulated tasks", () => {
    const task = {
      id: "t", caseId: "delivery-001", runId: "api-9", cardId: "k", title: "", summary: "sum", routeTo: "claims",
      mustDecide: "A manager must decide.", evidence: [{ who: "Driver", says: "x", basis: "unverified_claim" }], clash: null,
      tried: ["Asked the depot"], wouldChangeMyMind: "", options: [{ id: "o1", label: "Refund", undoable: false, effect: "£40 back" }],
      fallback: "Refund", receivedAt: "2026-10-10T12:00:00Z", deadlineAt: "2026-10-10T12:30:00Z", urgency: "high", risk: 0.5,
      status: "pending", decision: null, simulated: false, mode: "demo", origin: "agent", messages: [], timeline: [], costUsd: 0.05, durationMs: 1,
    } satisfies ReviewTask;
    const it = toastFromTask(task, 0)!;
    expect(it.prov).toBe("Live");
    expect(it.card.whyStopped?.line).toBe("A manager must decide.");
    expect(it.card.alreadyDone).toEqual(["Asked the depot"]);
    expect(it.card.deadlineMs).toBe(30 * 60_000);
    expect(toastFromTask({ ...task, origin: "city", simulated: true }, 0)).toBeNull();
    expect(toastFromTask({ ...task, status: "decision_recorded" }, 0)).toBeNull();
  });
});

describe("compact card text", () => {
  it("clips long lines and keeps option labels to four words", async () => {
    const { clip, shortLabel } = await import("./decision");
    expect(clip("a".repeat(100), 90)).toHaveLength(90);
    expect(clip("short", 90)).toBe("short");
    expect(shortLabel("Phone driver and open welfare check")).toBe("Phone driver and open…");
    expect(shortLabel("Hold")).toBe("Hold");
    expect(shortLabel("Supercalifragilistic expialidocious extraordinarily")).toHaveLength(28);
  });
});
