import { describe, expect, it } from "vitest";
import {
  COAST_PASS_TIMES, PASS_TIMES, S_COAST, S_MOOR, S_SEA, S_TOWER, DEPART, SHIP_PERIOD, basculeAt, loopLength, loopPose, shipAt, travel, travelTime,
  type BasculeState, type LoopPose, type ShipState,
} from "./engine";
import { HALF_W, PATH, centreZ, poseAt, sAtX } from "./path";
import { RIVER } from "../../config";

const ship: ShipState = { s: 0, dir: 1, speed: 0 };
const bs: BasculeState = { lift: 0, closed: false };

describe("river path", () => {
  it("follows the config polyline closely", () => {
    for (const [x, z] of RIVER.points) expect(Math.abs(centreZ(x) - z)).toBeLessThan(1);
  });
  it("is monotonic in x and sAtX inverts poseAt", () => {
    for (let i = 1; i < PATH.count; i++) expect(PATH.x[i]).toBeGreaterThan(PATH.x[i - 1]);
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    for (const x of [-900, -300, 0, 240]) expect(poseAt(sAtX(x), p).x).toBeCloseTo(x, 0);
    expect(HALF_W).toBe(35);
  });
});

describe("tall ship + Tower Bridge", () => {
  it("travel and travelTime are inverses", () => {
    const D = 600;
    for (const d of [5, 100, 300, 590]) expect(travel(travelTime(d, D), D)).toBeCloseTo(d, 3);
  });

  it("sails in from the sea, moors, then sails out", () => {
    expect(shipAt(0, ship).s).toBeCloseTo(S_SEA, 3);
    expect(shipAt(DEPART - 1, ship).s).toBeCloseTo(S_MOOR, 3);
    expect(shipAt(SHIP_PERIOD - 1, ship).s).toBeCloseTo(S_SEA, 3);
    expect(shipAt(10, ship).dir).toBe(-1);
    expect(shipAt(DEPART + 10, ship).dir).toBe(1);
  });

  it("passes under the bridge once per 90 s, at the pass times", () => {
    expect(PASS_TIMES).toHaveLength(2);
    expect(Math.abs(PASS_TIMES[1] - PASS_TIMES[0] - 90)).toBeLessThan(8);
    expect(travel(1e9, 1) + DEPART + 1).toBeLessThanOrEqual(SHIP_PERIOD + 1);
    for (const p of PASS_TIMES) expect(shipAt(p, ship).s).toBeCloseTo(S_TOWER, 1);
  });

  it("both opening bridges are fully up whenever the ship's hull is near their span", () => {
    for (const [sB, passes] of [[S_TOWER, PASS_TIMES], [S_COAST, COAST_PASS_TIMES]] as const) {
      for (let t = 0; t < SHIP_PERIOD * 2; t += 0.25) {
        shipAt(t, ship);
        basculeAt(t, bs, passes);
        if (Math.abs(ship.s - sB) < 60) expect(bs.lift, `t=${t}`).toBeGreaterThan(0.999);
        if (bs.lift > 0) expect(bs.closed, `t=${t}`).toBe(true);
      }
    }
  });

  it("closes and reopens the road twice per cycle, and is open most of the time", () => {
    let transitions = 0;
    let prev = basculeAt(0, bs).closed;
    let openTime = 0;
    for (let t = 0.1; t <= SHIP_PERIOD; t += 0.1) {
      const c = basculeAt(t, bs).closed;
      if (c !== prev) transitions++;
      if (!c) openTime += 0.1;
      prev = c;
    }
    expect(transitions).toBe(4);
    expect(openTime).toBeGreaterThan(SHIP_PERIOD * 0.45);
  });
});

describe("boat loops", () => {
  it("is continuous around the loop", () => {
    const p: LoopPose = { s: 0, lat: 0, ds: 0, dl: 0 };
    const q: LoopPose = { s: 0, lat: 0, ds: 0, dl: 0 };
    const L = loopLength(100, 500, 12);
    for (let u = 0; u < L; u += 0.5) {
      loopPose(u, 100, 500, 12, p);
      loopPose(u + 0.5, 100, 500, 12, q);
      expect(Math.hypot(q.s - p.s, q.lat - p.lat)).toBeLessThan(0.6);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(12 + 1e-6);
    }
    loopPose(10, 100, 500, 12, p);
    expect(p.lat).toBe(12); // downstream on the right of the flow
    expect(p.ds).toBe(1);
  });
});
