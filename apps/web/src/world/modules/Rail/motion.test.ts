import { describe, expect, it } from "vitest";
import { buildSchedule, legDuration, legPosition, legSpeed, newTrainState, sampleSchedule } from "./motion";

describe("train motion profile", () => {
  it("covers the whole leg, starting and ending at rest", () => {
    for (const [d, v, a] of [[600, 26, 0.75], [80, 26, 0.75], [300, 13, 0.45]]) {
      const T = legDuration(d, v, a);
      expect(legPosition(d, v, a, 0)).toBe(0);
      expect(legPosition(d, v, a, T)).toBeCloseTo(d, 6);
      expect(legSpeed(d, v, a, 0)).toBe(0);
      expect(legSpeed(d, v, a, T - 1e-6)).toBeCloseTo(0, 3);
    }
  });

  it("is smooth: position is monotonic and speed matches its derivative, never above vmax", () => {
    const d = 700, v = 26, a = 0.75;
    const T = legDuration(d, v, a);
    let prev = 0;
    const dt = 0.01;
    for (let t = dt; t < T; t += dt) {
      const s = legPosition(d, v, a, t);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      const numeric = (s - prev) / dt;
      expect(Math.abs(numeric - legSpeed(d, v, a, t - dt / 2))).toBeLessThan(0.05);
      expect(legSpeed(d, v, a, t)).toBeLessThanOrEqual(v + 1e-9);
      prev = s;
    }
  });

  it("limits acceleration to 1.5x the average (S-curve, no jerk spikes)", () => {
    const d = 700, v = 26, a = 0.75;
    const T = legDuration(d, v, a);
    let maxA = 0;
    let prevV = 0;
    const dt = 0.01;
    for (let t = dt; t < T; t += dt) {
      const sp = legSpeed(d, v, a, t);
      maxA = Math.max(maxA, Math.abs(sp - prevV) / dt);
      prevV = sp;
    }
    expect(maxA).toBeLessThan(1.5 * a + 0.02);
    expect(maxA).toBeGreaterThan(1.4 * a);
  });

  it("short legs never reach top speed", () => {
    const d = 50, v = 26, a = 0.75;
    const T = legDuration(d, v, a);
    expect(legSpeed(d, v, a, T / 2)).toBeCloseTo(Math.sqrt(a * d), 3);
  });

  it("shuttles out and back, dwelling at every stop and reversing at the ends", () => {
    const sc = buildSchedule([{ s: 50, dwell: 20 }, { s: 400, dwell: 10 }, { s: 900, dwell: 20 }], 26, 0.75);
    const st = newTrainState();
    // starts dwelling at the first stop, facing out once half the dwell is done
    sampleSchedule(sc, 1, st);
    expect(st.moving).toBe(false);
    expect(st.s).toBe(50);
    sampleSchedule(sc, 15, st);
    expect(st.dir).toBe(1);
    // visits every stop in both directions; s stays within the ends
    const seen: number[] = [];
    let lastStop = -1;
    for (let t = 0; t < sc.cycle; t += 0.25) {
      sampleSchedule(sc, t, st);
      expect(st.s).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(st.s).toBeLessThanOrEqual(900 + 1e-6);
      if (!st.moving && st.stop !== lastStop) seen.push(st.stop);
      lastStop = st.moving ? -1 : st.stop;
    }
    expect(seen).toEqual([0, 1, 2, 1]);
    // the far end turns the train round
    const half = sc.phases.find((p) => !p.moving && p.stop === 2)!;
    sampleSchedule(sc, half.t0 + 1, st);
    expect(st.dir).toBe(1);
    sampleSchedule(sc, half.t0 + half.dur - 1, st);
    expect(st.dir).toBe(-1);
  });

  it("is periodic", () => {
    const sc = buildSchedule([{ s: 0, dwell: 5 }, { s: 300, dwell: 5 }], 20, 1);
    const a = newTrainState();
    const b = newTrainState();
    for (const t of [3, 17.5, 40]) {
      sampleSchedule(sc, t, a);
      sampleSchedule(sc, t + 3 * sc.cycle, b);
      expect(b.s).toBeCloseTo(a.s, 6);
    }
  });
});
