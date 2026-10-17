import { describe, expect, it } from "vitest";
import { MODIFIERS, SCENARIOS, sceneCoverage } from "./scenarios";

describe("scenario catalogue", () => {
  it("covers all 50 public delivery cases, each with inputs and an expected action", () => {
    expect(SCENARIOS).toHaveLength(50);
    for (const s of SCENARIOS) {
      expect(s.messages.length, s.id).toBeGreaterThan(0);
      expect(s.expected?.summary, s.id).toBeTruthy();
    }
  });
  it("maps every case to a scene", () => {
    expect(Object.values(sceneCoverage()).reduce((a, b) => a + b, 0)).toBe(50);
  });
  it("has all Reality Test edge cases", () => {
    expect(Object.keys(MODIFIERS)).toHaveLength(12);
  });
});
