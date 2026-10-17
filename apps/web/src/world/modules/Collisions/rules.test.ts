import { describe, expect, it } from "vitest";
import { CrashGate, closingSpeed, crashNote, impulse, isCrash, pairKey } from "./rules";

const body = (x: number, z: number, h: number, speed: number, stopped = false) => ({ x, z, h, speed, stopped });

describe("closing speed / crash classification", () => {
  it("rear-end at speed is a crash, a creeping queue is not", () => {
    expect(closingSpeed(body(0, 0, 0, 14), body(0, 4, 0, 2))).toBeCloseTo(12);
    expect(isCrash(body(0, 0, 0, 14), body(0, 4, 0, 2))).toBe(true);
    expect(isCrash(body(0, 0, 0, 3), body(0, 4, 0, 2))).toBe(false);
  });
  it("cars moving apart never crash", () => {
    expect(isCrash(body(0, 0, Math.PI, 10), body(0, 4, 0, 10))).toBe(false);
  });
  it("a fast sideswipe past a stopped car is a crash even with low closing speed", () => {
    expect(isCrash(body(0, 0, 0, 12), body(1.5, 0, 0, 0, true))).toBe(true);
    expect(isCrash(body(0, 0, 0, 0, true), body(1.5, 0, 0, 0, true))).toBe(false);
  });
  it("impulse pushes the lighter vehicle much further", () => {
    const i = impulse(body(0, 0, 0, 15), 12, body(0, 6, 0, 0, true), 1.4, 0, 1);
    expect(i.bz).toBeGreaterThan(10);
    expect(Math.abs(i.az)).toBeLessThan(i.bz / 5);
  });
  it("writes a readable note", () => {
    expect(crashNote("truck", "hgv-4", "car", "car-12", 14, true)).toBe("Lorry hgv-4 slammed into a stopped car car-12 at 31 mph");
    expect(crashNote("car", "car-1", "ambulance", "amb-1", 5, false)).toMatch(/ran into an ambulance/);
  });
});

describe("CrashGate", () => {
  it("allows at most one crash per interval", () => {
    const g = new CrashGate(20_000, 3);
    expect(g.allows(pairKey("a", "b"), 0, 0)).toBe(true);
    g.commit(pairKey("a", "b"), 0);
    expect(g.allows(pairKey("c", "d"), 5_000, 1)).toBe(false);
    expect(g.allows(pairKey("c", "d"), 19_999, 1)).toBe(false);
    expect(g.allows(pairKey("c", "d"), 20_000, 1)).toBe(true);
    expect(g.suppressed).toBe(2);
  });
  it("caps active crashes", () => {
    const g = new CrashGate(0, 3);
    expect(g.allows("x", 100, 3)).toBe(false);
    expect(g.allows("x", 100, 2)).toBe(true);
  });
  it("dedupes pairs regardless of order, and forgets them later", () => {
    const g = new CrashGate(0, 3, 60_000);
    g.commit(pairKey("b", "a"), 0);
    expect(g.allows(pairKey("a", "b"), 30_000, 0)).toBe(false);
    expect(g.suppressed).toBe(0); // a duplicate isn't a suppressed crash
    expect(g.allows(pairKey("a", "b"), 60_001, 0)).toBe(true);
  });
});
