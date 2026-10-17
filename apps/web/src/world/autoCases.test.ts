import { describe, expect, it } from "vitest";
import { planPick, shouldFire } from "./autoCases";

const sets = [
  { id: "public", count: 3 },
  { id: "city", count: 10 },
  { id: "haiku", count: 0 },
  { id: "bulk", count: 2500 },
];

describe("planPick", () => {
  it("plays the sample cases in order first", () => {
    expect([0, 1, 2].map((i) => planPick(i, sets, () => 0))).toEqual([0, 1, 2].map((offset) => ({ set: "public", offset })));
  });
  it("then takes a random case from each other non-empty set in turn", () => {
    expect(planPick(3, sets, () => 0.5)).toEqual({ set: "city", offset: 5 });
    expect(planPick(4, sets, () => 0.999999)).toEqual({ set: "bulk", offset: 2499 });
    expect(planPick(5, sets, () => 0)).toEqual({ set: "city", offset: 0 });
  });
  it("copes with missing sets", () => {
    expect(planPick(7, [{ id: "public", count: 3 }], () => 0)).toEqual({ set: "public", offset: 1 });
    expect(planPick(0, [], () => 0)).toBeNull();
    expect(planPick(0, [{ id: "bulk", count: 4 }], () => 0.3)).toEqual({ set: "bulk", offset: 1 });
  });
});

describe("shouldFire", () => {
  const base = { on: true, now: 100, nextAt: 50, idle: true, budgetLeft: 1, busy: false };
  it("fires when on, due, idle and within budget", () => {
    expect(shouldFire(base)).toBe(true);
  });
  it("waits otherwise", () => {
    expect(shouldFire({ ...base, on: false })).toBe(false);
    expect(shouldFire({ ...base, nextAt: 200 })).toBe(false);
    expect(shouldFire({ ...base, idle: false })).toBe(false);
    expect(shouldFire({ ...base, budgetLeft: 0 })).toBe(false);
    expect(shouldFire({ ...base, busy: true })).toBe(false);
  });
});
