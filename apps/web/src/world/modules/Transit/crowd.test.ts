import { describe, expect, it } from "vitest";
import { growWaiting, planVisit } from "./crowd";
import { mulberry32 } from "./rng";

describe("growWaiting", () => {
  it("grows over time and never exceeds the cap", () => {
    const r = mulberry32(1);
    let w = 0;
    for (let i = 0; i < 2000; i++) w = growWaiting(w, 0.1, 0.5, 8, r);
    expect(w).toBe(8);
  });
  it("grows roughly at the given rate", () => {
    const r = mulberry32(2);
    let w = 0;
    for (let i = 0; i < 100; i++) w = growWaiting(w, 0.1, 1, 1000, r); // 10 s at 1/s
    expect(w).toBeGreaterThan(4);
    expect(w).toBeLessThan(18);
  });
  it("is deterministic for a seed", () => {
    const run = () => {
      const r = mulberry32(7);
      let w = 0;
      for (let i = 0; i < 300; i++) w = growWaiting(w, 0.05, 0.4, 20, r);
      return w;
    };
    expect(run()).toBe(run());
  });
});

describe("planVisit", () => {
  it("never alights more than are on board or boards more than wait or fit", () => {
    const r = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const waiting = Math.floor(r() * 12);
      const onboard = Math.floor(r() * 30);
      const v = planVisit(waiting, onboard, 30, r);
      expect(v.alight).toBeGreaterThanOrEqual(0);
      expect(v.alight).toBeLessThanOrEqual(onboard);
      expect(v.board).toBeLessThanOrEqual(waiting);
      expect(onboard - v.alight + v.board).toBeLessThanOrEqual(30);
    }
  });
  it("drains the stop when there is room", () => {
    const v = planVisit(6, 0, 30, mulberry32(4));
    expect(v.board).toBe(6);
    expect(v.alight).toBe(0);
  });
  it("lets someone off when people are on board", () => {
    const v = planVisit(0, 10, 30, () => 0);
    expect(v.alight).toBeGreaterThanOrEqual(1);
  });
});
