import { describe, expect, it } from "vitest";
import { PLACES, getEdge, lanePosition } from "../../roads";
import { Lookahead, obstacleAt } from "../DeliveryFleet/lookahead";
import { RW_BRAKE, RW_HALF_LEN, RW_HALF_W, approachSpeed, lookWant, queueWant } from "./drive";
import { advanceRoute, chooseTarget, planOutbound, type Cursor } from "./logic";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("roadworks truck speed control", () => {
  it("keeps the old lane-queue rule", () => {
    expect(queueWant(12, 5, 10)).toBe(0);
    expect(queueWant(12, 12, 1)).toBeCloseTo(3);
    expect(queueWant(12, 30, 0)).toBe(12);
  });

  it("no hit: look-ahead leaves the target alone", () => {
    const look = new Lookahead({ halfLength: RW_HALF_LEN, halfWidth: RW_HALF_W, decel: RW_BRAKE }, () => null);
    look.scan("RW-x", 0, 0, 0, 10, 0.05);
    expect(lookWant(12, look, 20, null)).toBe(12);
  });

  it("a truck with an obstacle reported ahead decelerates to a stop short of it", () => {
    const target = chooseTarget({ from: PLACES.maintenanceYard, blocked: new Set(), exclude: new Set(), rand: seeded(3) })!;
    const route = planOutbound(target, PLACES.maintenanceYard, new Set())!;
    const cur: Cursor = { seg: 0, t: 0 };
    // put the obstacle ~40 m down the route
    const probe: Cursor = { seg: 0, t: 0 };
    advanceRoute(route, probe, 40);
    const [ox, oz] = lanePosition(route.nodes[probe.seg], route.nodes[probe.seg + 1], probe.t);
    const look = new Lookahead({ halfLength: RW_HALF_LEN, halfWidth: RW_HALF_W, decel: RW_BRAKE }, obstacleAt("RW-test", ox, oz));
    const dt = 0.05;
    let speed = 10;
    let minDist = Infinity;
    let stoppedAt = -1;
    for (let i = 0; i < 400 && stoppedAt < 0; i++) {
      const a = route.nodes[cur.seg];
      const b = route.nodes[cur.seg + 1];
      const len = getEdge(a, b)?.length ?? 1;
      const [x, z, h] = lanePosition(a, b, cur.t);
      minDist = Math.min(minDist, Math.hypot(ox - x, oz - z));
      look.scan("RW-test", x, z, h, speed, dt);
      const want = lookWant(12, look, (1 - cur.t) * len - 6 - RW_HALF_LEN, null);
      const prev = speed;
      speed = approachSpeed(speed, want, dt);
      expect(prev - speed).toBeLessThanOrEqual(14 * dt + 1e-9);
      advanceRoute(route, cur, speed * dt);
      if (speed < 0.05 && i > 5) stoppedAt = Math.hypot(ox - x, oz - z);
    }
    expect(stoppedAt).toBeGreaterThan(RW_HALF_LEN + 2.2 + 0.5);
    expect(stoppedAt).toBeLessThan(RW_HALF_LEN + 2.2 + 2 + 2);
    expect(minDist).toBeGreaterThan(RW_HALF_LEN + 2.2 + 0.5);
  });
});
