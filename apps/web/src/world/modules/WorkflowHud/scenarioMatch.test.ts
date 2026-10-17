import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "../../store";
import { chosenAction, formatExpected, hasRealTrace, matchExpected, scenarioIdOf, groupScenarios, filterScenarios } from "./scenarioMatch";
import type { CaseScenario } from "../../scenarios";

const ev = (caseId: string, nodeId: string, summary: string, status: WorkflowEvent["status"] = "ok"): WorkflowEvent => ({
  id: `${caseId}-${nodeId}-${summary}`, t: 0, caseId, nodeId, status, summary,
});

describe("scenarioIdOf", () => {
  it("extracts a delivery scenario id from a case id", () => {
    expect(scenarioIdOf("CASE-delivery-024-r3")).toBe("delivery-024");
    expect(scenarioIdOf("delivery-001")).toBe("delivery-001");
    expect(scenarioIdOf("CASE-0042")).toBeNull();
  });
});

describe("chosenAction", () => {
  it("prefers the latest action, then human, then planner event", () => {
    const evs = [ev("A", "planner", "plan"), ev("A", "human", "ask human"), ev("B", "action", "other"), ev("A", "action", "send")];
    expect(chosenAction(evs, "A")?.summary).toBe("send");
    expect(chosenAction(evs.slice(0, 2), "A")?.summary).toBe("ask human");
    expect(chosenAction([ev("A", "planner", "plan")], "A")?.summary).toBe("plan");
    expect(chosenAction([ev("A", "triage", "x")], "A")).toBeNull();
  });
});

describe("matchExpected", () => {
  const exp = { summary: "s", recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email" };
  it("matches when channel and recipient's lead name appear", () => {
    expect(matchExpected("Email → Delivery investigations: please trace DL-024", exp)).toBe(true);
  });
  it("fails on wrong channel or recipient", () => {
    expect(matchExpected("Customer portal → Delivery investigations", exp)).toBe(false);
    expect(matchExpected("Email → Dispatch", exp)).toBe(false);
  });
  it("skips null fields", () => {
    expect(matchExpected("anything", { summary: "s", recipient: null, channel: "Email" })).toBe(false);
    expect(matchExpected("via email", { summary: "s", recipient: null, channel: "Email" })).toBe(true);
  });
});

describe("formatExpected", () => {
  it("shortens the recipient's organisation", () => {
    expect(formatExpected({ summary: "s", recipient: "Delivery investigations, Plover Arc Logistics", channel: "Email" })).toBe(
      "Email → Delivery investigations, Plover Arc",
    );
    expect(formatExpected({ summary: "Do x", recipient: null, channel: null })).toBe("Do x");
  });
});

describe("groupScenarios / filterScenarios", () => {
  const s = (id: string, where: CaseScenario["where"], title: string) => ({ id, where, title }) as CaseScenario;
  const list = [s("delivery-001", "suburbs", "Slot change"), s("delivery-002", "downtown", "Apartment missing"), s("delivery-003", "suburbs", "Gate code")];
  it("groups by where in first-seen order", () => {
    const g = groupScenarios(list);
    expect(g.map(([w]) => w)).toEqual(["suburbs", "downtown"]);
    expect(g[0][1].map((x) => x.id)).toEqual(["delivery-001", "delivery-003"]);
  });
  it("filters by id or title, case-insensitive", () => {
    expect(filterScenarios(list, "GATE").map((x) => x.id)).toEqual(["delivery-003"]);
    expect(filterScenarios(list, "002").map((x) => x.id)).toEqual(["delivery-002"]);
    expect(filterScenarios(list, "  ")).toHaveLength(3);
  });
});

describe("hasRealTrace", () => {
  it("is true only when the case has an event replayed from the real agent", () => {
    const mock = ev("CASE-delivery-024-r1", "action", "Email Plover Arc");
    const untagged = { ...ev("CASE-delivery-024-r1", "planner", "plan"), source: "mock" as const };
    const real = { ...ev("AGT-delivery-024-1", "action", "Email Plover Arc"), source: "agent" as const };
    expect(hasRealTrace([mock, untagged], "CASE-delivery-024-r1")).toBe(false);
    expect(hasRealTrace([mock, untagged, real], "CASE-delivery-024-r1")).toBe(false);
    expect(hasRealTrace([mock, real], "AGT-delivery-024-1")).toBe(true);
    expect(hasRealTrace([], "AGT-delivery-024-1")).toBe(false);
  });
});
