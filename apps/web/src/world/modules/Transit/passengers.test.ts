import { describe, expect, it } from "vitest";
import { END, PassengerPool, ST } from "./passengers";

describe("PassengerPool", () => {
  it("spawns until full, then refuses", () => {
    const p = new PassengerPool(3, 1);
    expect(p.spawn(0, 0, 0)).toBe(0);
    expect(p.spawn(0, 0, 0)).toBe(1);
    expect(p.spawn(0, 0, 0)).toBe(2);
    expect(p.spawn(0, 0, 0)).toBe(-1);
    expect(p.active).toBe(3);
  });
  it("walks through waypoints (including up stairs) and idles at the end", () => {
    const p = new PassengerPool(4, 1);
    const i = p.spawn(0, 0, 0);
    p.addWaypoint(i, 0, 5, 10);
    p.addWaypoint(i, 4, 5, 10);
    p.finish(i, END.IDLE, 0);
    for (let k = 0; k < 200; k++) p.step(0.05);
    expect(p.state[i]).toBe(ST.IDLE);
    expect(p.x[i]).toBeCloseTo(4, 3);
    expect(p.y[i]).toBeCloseTo(5, 3);
    expect(p.z[i]).toBeCloseTo(10, 3);
  });
  it("boarding passengers disappear (are freed) on arrival", () => {
    const p = new PassengerPool(4, 1);
    const i = p.spawn(0, 0, 0);
    p.addWaypoint(i, 1, 0, 0);
    p.finish(i, END.BOARD, 0);
    for (let k = 0; k < 100; k++) p.step(0.05);
    expect(p.state[i]).toBe(ST.FREE);
    expect(p.active).toBe(0);
    expect(p.spawn(0, 0, 0)).toBe(i); // slot reused
  });
  it("vanishing passengers shrink then free", () => {
    const p = new PassengerPool(2, 1);
    const i = p.spawn(0, 0, 0);
    p.addWaypoint(i, 2, 0, 0);
    p.finish(i, END.VANISH, 0);
    let sawShrink = false;
    for (let k = 0; k < 200; k++) {
      p.step(0.05);
      if (p.state[i] === ST.LEAVING && p.scale[i] < 1) sawShrink = true;
    }
    expect(sawShrink).toBe(true);
    expect(p.state[i]).toBe(ST.FREE);
  });
});
