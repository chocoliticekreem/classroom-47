import { describe, expect, it } from "vitest";
import type { CaseWithMutation } from "./catalogue";
import { clampLimit, listSets, QUICK_CASES, resolveSet, spread } from "./scenarios";

const c = (id: string, dataset: string, mutation: string | null = null): CaseWithMutation => ({ id, dataset, title: null, mutation });
const all: CaseWithMutation[] = [
  ...QUICK_CASES.map((id) => c(id, "public")),
  c("delivery-002", "public"),
  ...Array.from({ length: 12 }, (_, i) => c(`fixture-${101 + i}`, "fixtures")),
  c("gen-1", "generated", "noise"), c("gen-2", "generated", "noise"), c("gen-3", "grounded", "noise"),
  c("gen-4", "generated", "needs_human"), c("gen-5", "grounded", "failed_action"),
  c("city-001", "city", "disruption"), c("city-002", "city", "disruption"), c("city-003", "city", "fraud_signal"),
  c("adv-1", "adversarial", "false_alarm"), c("adv-2", "adversarial", "false_alarm"), c("adv-3", "adversarial", "safeguarding"),
];

describe("resolveSet", () => {
  it("quick is the five public scene cases", () => {
    expect(resolveSet({ set: "quick" }, all).map((x) => x.id)).toEqual(QUICK_CASES);
    expect(resolveSet({ set: "quick", limit: 2 }, all).map((x) => x.id)).toEqual(QUICK_CASES.slice(0, 2));
  });

  it("fixtures default to 5, cap at 20", () => {
    expect(resolveSet({ set: "fixtures" }, all)).toHaveLength(5);
    expect(resolveSet({ set: "fixtures", limit: 50 }, all)).toHaveLength(12);
  });

  it("generated includes grounded, spreads across mutations, and filters by a mutation list", () => {
    expect(resolveSet({ set: "generated", limit: 3 }, all).map((x) => x.id)).toEqual(["gen-1", "gen-4", "gen-5"]);
    expect(resolveSet({ set: "generated", filter: "noise", limit: 20 }, all).map((x) => x.id)).toEqual(["gen-1", "gen-2", "gen-3"]);
    expect(resolveSet({ set: "generated", filter: "noise, failed_action", limit: 2 }, all).map((x) => x.id)).toEqual(["gen-1", "gen-5"]);
    expect(() => resolveSet({ set: "generated", filter: "nope" }, all)).toThrow(/nope/);
  });

  it("city reads data/city, spreads across mutations and filters", () => {
    expect(resolveSet({ set: "city", limit: 2 }, all).map((x) => x.id)).toEqual(["city-001", "city-003"]);
    expect(resolveSet({ set: "city", filter: "disruption" }, all).map((x) => x.id)).toEqual(["city-001", "city-002"]);
  });

  it("adversarial reads its own dataset", () => {
    expect(resolveSet({ set: "adversarial", filter: "safeguarding" }, all).map((x) => x.id)).toEqual(["adv-3"]);
  });

  it("custom keeps the given order, dedupes, and rejects unknown ids", () => {
    expect(resolveSet({ set: "custom", caseIds: ["adv-2", "delivery-002", "adv-2"] }, all).map((x) => x.id)).toEqual(["adv-2", "delivery-002"]);
    expect(() => resolveSet({ set: "custom", caseIds: ["zzz"] }, all)).toThrow(/zzz/);
    expect(() => resolveSet({ set: "custom", caseIds: [] }, all)).toThrow(/caseIds/);
  });

  it("rejects an unknown set", () => {
    expect(() => resolveSet({ set: "bogus" as never }, all)).toThrow(/bogus/);
  });
});

describe("helpers", () => {
  it("clampLimit defaults to 5 and caps at 20", () => {
    expect([clampLimit(undefined), clampLimit(0), clampLimit("7"), clampLimit(99)]).toEqual([5, 5, 7, 20]);
  });

  it("spread round-robins across mutations", () => {
    expect(spread([c("a", "g", "x"), c("b", "g", "x"), c("c", "g", "y")], 3).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("listSets counts members and lists filters", () => {
    const sets = Object.fromEntries(listSets(all).map((s) => [s.id, s]));
    expect(sets.quick.count).toBe(5);
    expect(sets.fixtures.count).toBe(12);
    expect(sets.generated).toMatchObject({ count: 5, filters: ["failed_action", "needs_human", "noise"] });
    expect(sets.adversarial).toMatchObject({ count: 3, filters: ["false_alarm", "safeguarding"] });
    expect(sets.city).toMatchObject({ count: 3, filters: ["disruption", "fraud_signal"] });
  });
});
