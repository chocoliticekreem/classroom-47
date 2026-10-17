import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { registerVehicle } from "../../registry";
import { findPath, getEdge, lanePosition } from "../../roads";
import { DEFAULT_BUFFER, Lookahead, obstacleAt, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { BASE } from "./dispatch";
import { BLUES_BUFFER, UNIT_BRAKE, UNIT_SIZE, advance, approachSpeed, lookTarget, type Cursor } from "./motion";

const edgeLen = (a: string, b: string) => getEdge(a, b)?.length ?? 1;
const look = (fn: ObstacleFn, buffer = BLUES_BUFFER) => new Lookahead({ ...UNIT_SIZE.police, decel: UNIT_BRAKE, buffer }, fn);

describe("responder look-ahead braking", () => {
  it("a unit with an obstacle reported ahead decelerates to a stop short of it (blues on)", () => {
    const nodes = findPath(BASE.police, "g_0_0", new Set())!;
    expect(nodes.length).toBeGreaterThan(2);
    const route = { nodes, stopT: 1 };
    const probe: Cursor = { seg: 0, t: 0 };
    advance(route, probe, 40, edgeLen, () => true);
    const [ox, oz] = lanePosition(nodes[probe.seg], nodes[probe.seg + 1], probe.t);
    const l = look(obstacleAt("POLICE-t", ox, oz));
    const cur: Cursor = { seg: 0, t: 0 };
    const dt = 0.05;
    let speed = 14;
    let minDist = Infinity;
    let stoppedAt = -1;
    for (let i = 0; i < 400 && stoppedAt < 0; i++) {
      const [x, z, h] = lanePosition(nodes[cur.seg], nodes[cur.seg + 1], cur.t);
      minDist = Math.min(minDist, Math.hypot(ox - x, oz - z));
      l.scan("POLICE-t", x, z, h, speed, dt);
      speed = approachSpeed(speed, lookTarget(15.4, l, { scene: null, junction: null }), dt);
      advance(route, cur, speed * dt, edgeLen, () => true);
      if (speed < 0.05 && i > 5) stoppedAt = Math.hypot(ox - x, oz - z);
    }
    const h = UNIT_SIZE.police.halfLength;
    expect(stoppedAt).toBeGreaterThan(h + 2.2 + 0.5);
    expect(stoppedAt).toBeLessThan(h + 2.2 + 2 + 2);
    expect(minDist).toBeGreaterThan(h + 2.2 + 0.5);
  });

  it("blues on: casts a shorter buffer than a unit heading home", () => {
    const ranges: number[] = [];
    const fn: ObstacleFn = (_i, _x, _z, _h, range) => {
      ranges.push(range);
      return null;
    };
    look(fn, BLUES_BUFFER).scan("u", 0, 0, 0, 10, 0.05);
    look(fn, DEFAULT_BUFFER).scan("u", 0, 0, 0, 10, 0.05);
    expect(ranges[1] - ranges[0]).toBeCloseTo(DEFAULT_BUFFER - BLUES_BUFFER);
  });

  it("doesn't brake for its own scene (the wreck it's driving up to)", () => {
    const wreck = new Object3D();
    wreck.position.set(100, 0, 100);
    const off = registerVehicle({ id: "wreck-1", kind: "car", object: wreck, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: true });
    try {
      const l = look(() => ({ id: "wreck-1", dist: 3, kind: "car", stopped: true }));
      l.scan("POLICE-t", 95, 95, 0, 8, 0.05);
      expect(lookTarget(10, l, { scene: { x: 100, z: 100 }, junction: null })).toBe(10);
      expect(lookTarget(10, l, { scene: { x: 500, z: 500 }, junction: null })).toBeLessThan(2);
    } finally {
      off();
    }
  });
});
