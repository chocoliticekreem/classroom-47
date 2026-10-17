import { describe, expect, it } from "vitest";
import { buildShuttle, doorOpenAmount, legDuration, legPosition, sampleShuttle, type TrainSample } from "./motion";

describe("leg motion profile", () => {
  it("starts at 0, ends at the full distance and is monotonic (trapezoid)", () => {
    const d = 200, v = 15, a = 1.2;
    const T = legDuration(d, v, a);
    expect(legPosition(d, v, a, 0)).toBe(0);
    expect(legPosition(d, v, a, T)).toBeCloseTo(d, 5);
    let prev = 0;
    for (let t = 0; t <= T; t += 0.1) {
      const s = legPosition(d, v, a, t);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(s - prev).toBeLessThanOrEqual(v * 0.1 + 1e-6); // never faster than vmax
      prev = s;
    }
  });
  it("handles short hops with a triangular profile", () => {
    const d = 20, v = 15, a = 1.2;
    const T = legDuration(d, v, a);
    expect(T).toBeCloseTo(2 * Math.sqrt(d / a), 5);
    expect(legPosition(d, v, a, T / 2)).toBeCloseTo(d / 2, 5);
    expect(legPosition(d, v, a, T)).toBeCloseTo(d, 5);
  });
  it("accelerates smoothly: speed near the start is small", () => {
    const s1 = legPosition(300, 15, 1, 0.5);
    expect(s1).toBeCloseTo(0.5 * 1 * 0.25, 5);
  });
});

describe("shuttle schedule", () => {
  const stations = [0, 100, 250, 400];
  const p = { vmax: 14, accel: 1.1, dwell: 6 };
  const sched = buildShuttle(stations, p);
  const out: TrainSample = { s: 0, station: -1, dwellT: -1, moving: false };

  it("dwells at every station going out and back", () => {
    const dwells = sched.phases.filter((x) => !x.moving).map((x) => x.station);
    expect(dwells).toEqual([0, 1, 2, 3, 2, 1]);
  });
  it("is periodic and stays on the line", () => {
    for (let t = 0; t < sched.cycle * 2; t += 0.37) {
      sampleShuttle(sched, t, out);
      expect(out.s).toBeGreaterThanOrEqual(-1e-6);
      expect(out.s).toBeLessThanOrEqual(400 + 1e-6);
    }
    sampleShuttle(sched, 3, out);
    const a = out.s;
    sampleShuttle(sched, 3 + sched.cycle, out);
    expect(out.s).toBeCloseTo(a, 5);
  });
  it("reports the station and time into the dwell", () => {
    sampleShuttle(sched, 2, out);
    expect(out.moving).toBe(false);
    expect(out.station).toBe(0);
    expect(out.dwellT).toBeCloseTo(2, 5);
    sampleShuttle(sched, 6 + 1, out);
    expect(out.moving).toBe(true);
    expect(out.dwellT).toBe(-1);
  });
  it("position is continuous across phase boundaries", () => {
    let prev = sampleShuttle(sched, 0, out).s;
    for (let t = 0.05; t < sched.cycle; t += 0.05) {
      const s = sampleShuttle(sched, t, out).s;
      expect(Math.abs(s - prev)).toBeLessThan(p.vmax * 0.05 + 1e-3);
      prev = s;
    }
  });
});

describe("doors", () => {
  it("are shut at the start and end of a dwell and open in the middle", () => {
    expect(doorOpenAmount(-1, 6)).toBe(0);
    expect(doorOpenAmount(0, 6)).toBe(0);
    expect(doorOpenAmount(3, 6)).toBe(1);
    expect(doorOpenAmount(6, 6)).toBe(0);
    expect(doorOpenAmount(0.7, 6)).toBeGreaterThan(0);
  });
});
