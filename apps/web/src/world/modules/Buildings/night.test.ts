import { describe, expect, it } from "vitest";
import { hourBucket, nightLevel } from "./night";

describe("nightLevel", () => {
  it("is dark-off by day and fully on at night", () => {
    expect(nightLevel(12)).toBe(0);
    expect(nightLevel(17.5)).toBe(0);
    expect(nightLevel(22)).toBe(1);
    expect(nightLevel(2)).toBe(1);
    expect(nightLevel(8)).toBe(0);
  });
  it("fades on after 18:00 and off after 07:00", () => {
    expect(nightLevel(18.5)).toBeGreaterThan(0.3);
    expect(nightLevel(18.5)).toBeLessThan(1);
    expect(nightLevel(6.5)).toBeGreaterThan(0.3);
    expect(nightLevel(7.25)).toBe(0);
    expect(nightLevel(18)).toBeLessThan(nightLevel(18.5));
  });
  it("wraps hours outside 0..24", () => {
    expect(nightLevel(26)).toBe(nightLevel(2));
    expect(nightLevel(-2)).toBe(nightLevel(22));
  });
  it("buckets to quarter hours", () => {
    expect(hourBucket(18.1)).toBe(18);
    expect(hourBucket(18.3)).toBe(18.25);
  });
});
