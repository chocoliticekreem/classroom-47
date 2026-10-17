import { describe, expect, it } from "vitest";
import { clockHandAngles, nightFactor } from "./time";

const TAU = Math.PI * 2;

describe("clockHandAngles", () => {
  it("points both hands at 12 at noon and midnight", () => {
    for (const h of [0, 12, 24]) {
      const a = clockHandAngles(h);
      expect(a.hour).toBeCloseTo(0);
      expect(a.minute).toBeCloseTo(0);
    }
  });
  it("puts the hour hand at 3 o'clock and minute at 6 for 15:30", () => {
    const a = clockHandAngles(15.5);
    expect(a.hour).toBeCloseTo((3.5 / 12) * TAU);
    expect(a.minute).toBeCloseTo(Math.PI);
  });
  it("wraps negative / out-of-range hours", () => {
    expect(clockHandAngles(-1).hour).toBeCloseTo((11 / 12) * TAU);
    expect(clockHandAngles(27.25).minute).toBeCloseTo(TAU / 4);
  });
});

describe("nightFactor", () => {
  it("is 0 in the day and 1 at night", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(2)).toBe(1);
  });
  it("ramps smoothly through dusk and dawn", () => {
    const dusk = nightFactor(19);
    const dawn = nightFactor(6);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
    expect(nightFactor(18.5)).toBeLessThan(nightFactor(19.5));
  });
});
