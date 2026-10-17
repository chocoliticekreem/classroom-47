import { describe, expect, it } from "vitest";
import { getNode } from "../../roads";
import { mulberry32 } from "./sim";
import { RIDER_GUTTER, spawnRiders, stepRider, streetGraph, type Rider, type RiderEnv } from "./riders";

const free: RiderEnv = { isGreen: () => true, isBlocked: () => false, ahead: () => Infinity, aheadStopped: () => false };

/** Signed lateral distance of the rider from the from->to centre line (> 0 = left of travel). */
function lateral(r: Rider) {
  const a = getNode(r.from);
  const b = getNode(r.to);
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / L;
  const uz = (b.z - a.z) / L;
  return (r.x - a.x) * uz - (r.z - a.z) * ux;
}

describe("citywide riders", () => {
  it("spawn 36 riders across downtown and the districts, all on street edges", () => {
    const rs = spawnRiders(36, mulberry32(7));
    expect(rs.length).toBe(36);
    const g = streetGraph();
    expect(g.downtown.length).toBeGreaterThan(50);
    const downtown = rs.filter((r) => r.from.startsWith("g_") && r.to.startsWith("g_")).length;
    expect(downtown).toBeGreaterThanOrEqual(10);
    if (g.districts.length) expect(36 - downtown).toBeGreaterThanOrEqual(10);
    expect(new Set(rs.map((r) => r.id)).size).toBe(36);
  });

  it("ride in the left gutter on streets and stay on the street graph", () => {
    const rand = mulberry32(3);
    const rs = spawnRiders(36, rand);
    const adj = streetGraph().adj;
    for (let f = 0; f < 3000; f++)
      for (const r of rs) {
        stepRider(r, 0.05, rand, free);
        expect(adj.get(r.from)).toContain(r.to);
        if (r.seg === 0) expect(lateral(r)).toBeCloseTo(RIDER_GUTTER, 3);
        expect(Number.isFinite(r.x) && Number.isFinite(r.z)).toBe(true);
      }
  });

  it("stop at red lights", () => {
    const rand = mulberry32(5);
    const [r] = spawnRiders(1, rand);
    let stopped = 0;
    for (let f = 0; f < 2000; f++) {
      stepRider(r, 0.05, rand, { ...free, isGreen: () => false });
      if (r.speed === 0) stopped++;
    }
    expect(stopped).toBeGreaterThan(1500);
  });

  it("brake for something stopped ahead, then squeeze past after a while", () => {
    const rand = mulberry32(9);
    const [r] = spawnRiders(1, rand);
    r.speed = r.cruise;
    const env: RiderEnv = { ...free, ahead: () => 1.0, aheadStopped: () => true };
    for (let f = 0; f < 40; f++) stepRider(r, 0.05, rand, env);
    expect(r.speed).toBe(0);
    for (let f = 0; f < 200; f++) stepRider(r, 0.05, rand, env);
    expect(r.squeeze > 0 || r.speed > 0).toBe(true);
  });

  it("knocked-off riders don't move until they respawn", () => {
    const rand = mulberry32(1);
    const [r] = spawnRiders(1, rand);
    r.down = 1;
    const x = r.x;
    stepRider(r, 0.5, rand, free);
    expect(r.x).toBe(x);
    expect(r.down).toBeCloseTo(0.5);
  });
});
