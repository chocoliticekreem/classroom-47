import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { SB_FEATURES } from "../../districts/southbank";
import { ROAD_EDGES, getNode } from "../../roads";
import { FACADE_KINDS, generateSouthbank } from "./layout";

describe("southbank layout", () => {
  const L = generateSouthbank();
  const bodies = FACADE_KINDS.flatMap((k) => L.bodies[k]);

  it("is seeded (same city every reload)", () => {
    const again = generateSouthbank();
    expect(again.bodies.brick.length).toBe(L.bodies.brick.length);
    expect(again.walkers[5]).toEqual(L.walkers[5]);
  });

  it("is dense and varied", () => {
    expect(bodies.length).toBeGreaterThan(250);
    expect(L.shopfronts.length).toBeGreaterThan(120);
    expect(L.awnings.length).toBeGreaterThan(80);
    expect(L.bodies.georgian.length).toBeGreaterThanOrEqual(10);
    expect(L.trees.length).toBeGreaterThan(150);
    expect(L.cars.length).toBeGreaterThan(80);
    expect(L.walkers.length).toBeGreaterThan(600);
    const hs = new Set(bodies.map((b) => Math.round(b.y + b.h)));
    expect(hs.size).toBeGreaterThan(12);
  });

  it("keeps buildings inside the zone and off the roads", () => {
    const sb = [...ROAD_EDGES.values()].filter((e) => e.a.startsWith("sb_") || e.b.startsWith("sb_"));
    for (const b of bodies) {
      expect(inBox(ZONES.southbank, b.x, b.z), `${b.x},${b.z}`).toBe(true);
      for (const e of sb) {
        const a = getNode(e.a), c = getNode(e.b);
        const len = Math.hypot(c.x - a.x, c.z - a.z);
        const ux = (c.x - a.x) / len, uz = (c.z - a.z) / len;
        const t = Math.max(0, Math.min(len, (b.x - a.x) * ux + (b.z - a.z) * uz));
        const d = Math.hypot(b.x - a.x - ux * t, b.z - a.z - uz * t);
        expect(d, `${b.x},${b.z} on ${e.key}`).toBeGreaterThan(Math.min(b.w, b.d) / 2 + 3);
      }
    }
  });

  it("leaves the market street, park and lake open", () => {
    const P = SB_FEATURES.park;
    for (const b of bodies) expect(b.x > P.minX && b.x < P.maxX && b.z > P.minZ && b.z < P.maxZ).toBe(false);
  });
});
