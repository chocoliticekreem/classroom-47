import { describe, expect, it } from "vitest";
import type { EvidenceRow } from "../types";
import type { ReviewTask } from "../../review/types";
import { activityLine, caseBucket, homeNumbers, newIds, openDecisions, percent, recipientOf } from "./logic";

const row = (p: Partial<EvidenceRow>): EvidenceRow => ({
  caseId: "delivery-001",
  dataset: "public",
  title: null,
  decision: null,
  nextAction: null,
  gate: null,
  pass: null,
  score: null,
  costUsd: null,
  durationMs: null,
  executionId: "e1",
  critical: null,
  verdict: null,
  brokenRules: [],
  mutation: null,
  ...p,
});

describe("homeNumbers", () => {
  it("is all zero with no rate when there is no data", () => {
    expect(homeNumbers([])).toEqual({
      handled: 0, sent: 0, asked: 0, needPerson: 0, stopped: 0, evaluated: 0, passed: 0, rightRate: null,
    });
  });

  it("counts each real case once, in one bucket", () => {
    const n = homeNumbers([
      row({ caseId: "a", decision: "acted", gate: "allow" }),
      row({ caseId: "b", decision: "acted" }),
      row({ caseId: "c", decision: "asked_for_info" }),
      row({ caseId: "d", decision: "escalated" }),
      row({ caseId: "e", decision: "blocked" }),
      row({ caseId: "f", decision: "escalated", gate: "block" }), // a safety stop wins
      row({ caseId: "g", decision: "no_action" }),
      row({ caseId: "h", executionId: "e9" }), // run, no decision yet
    ]);
    expect(n).toMatchObject({ handled: 8, sent: 2, asked: 1, needPerson: 1, stopped: 2 });
    expect(n.sent + n.asked + n.needPerson + n.stopped).toBeLessThanOrEqual(n.handled);
  });

  it("never counts city (practice) rows or cases that were never run", () => {
    const n = homeNumbers([
      row({ dataset: "city", decision: "acted" }),
      row({ dataset: "city", decision: "blocked", pass: true }),
      row({ caseId: "x", executionId: null }), // known case, no result
      row({ caseId: "y", decision: "acted" }),
    ]);
    expect(n).toMatchObject({ handled: 1, sent: 1, stopped: 0, evaluated: 0, rightRate: null });
  });

  it("works out % right only over checked test cases", () => {
    const n = homeNumbers([
      row({ caseId: "a", pass: true }),
      row({ caseId: "b", pass: true }),
      row({ caseId: "c", pass: false }),
      row({ caseId: "d", decision: "acted" }), // not checked: not in the rate
    ]);
    expect(n.evaluated).toBe(3);
    expect(n.passed).toBe(2);
    expect(n.rightRate).toBeCloseTo(2 / 3);
    expect(percent(n.rightRate!)).toBe("67%");
  });
});

describe("caseBucket", () => {
  it("maps outcomes to plain buckets", () => {
    expect(caseBucket({ decision: "acted", gate: null })).toBe("sent");
    expect(caseBucket({ decision: "acted", gate: "block" })).toBe("stopped");
    expect(caseBucket({ decision: "no_action", gate: null })).toBeNull();
    expect(caseBucket({ decision: null, gate: null })).toBeNull();
  });
});

describe("openDecisions", () => {
  const task = (p: Partial<ReviewTask>) => ({ id: "t", status: "pending", simulated: false, ...p }) as ReviewTask;
  it("keeps live pending cards only, in queue order", () => {
    const out = openDecisions([
      task({ id: "1" }),
      task({ id: "2", simulated: true }),
      task({ id: "3", status: "decision_recorded" }),
      task({ id: "4" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["1", "4"]);
  });
});

describe("activityLine", () => {
  const base = { id: "r1", caseId: "gen-1", status: "success" as const, outcome: "acted", startedAt: "2026-10-10T12:00:00Z", simulated: false };
  it("says what Hamyway did in plain words", () => {
    expect(activityLine({ ...base, nextAction: "Customer portal → Calla Mossop" }).sentence).toBe("Sent a message to Calla Mossop");
    expect(activityLine({ ...base, outcome: "escalated" }).sentence).toBe("Asked a person to decide");
    expect(activityLine({ ...base, outcome: "asked_for_info", nextAction: "Email → Ann" }).sentence).toBe("Asked Ann a question");
    expect(activityLine({ ...base, outcome: "blocked" }).tone).toBe("red");
    expect(activityLine({ ...base, status: "running", outcome: null }).sentence).toBe("Working on a case");
    expect(activityLine({ ...base, status: "error", outcome: null }).sentence).toBe("Couldn't finish a case");
  });
  it("uses the case title without its number, else the case id", () => {
    expect(activityLine({ ...base, title: "Case 045: Invoice is missing" }).about).toBe("Invoice is missing");
    expect(activityLine(base).about).toBe("gen-1");
  });
  it("marks re-runs after a person decided", () => {
    expect(activityLine({ ...base, parentExecutionId: "p" }).afterDecision).toBe(true);
  });
});

describe("recipientOf / newIds", () => {
  it("takes the last part of the next action", () => {
    expect(recipientOf("Phone → Depot → Sam")).toBe("Sam");
    expect(recipientOf(null)).toBe("");
  });
  it("finds new runs, but none on the first load", () => {
    expect(newIds(null, [{ id: "a" }])).toEqual([]);
    expect(newIds(new Set(["a"]), [{ id: "b" }, { id: "a" }])).toEqual(["b"]);
  });
});
