import { describe, expect, it } from "vitest";
import { ZONES } from "../../config";
import { ROAD_NODES } from "../../roads";
import { FORKLIFT_ROUTES, buildLayout } from "./layout";
import { buildLegs } from "./logic";

const n = (id: string) => ROAD_NODES.get(id)!;
const SEGS = [
  [{ x: 0, z: 220 }, n("depot_gate")],
  [n("depot_gate"), n("depot_yard_w")],
  [n("depot_gate"), n("depot_yard_e")],
  [n("depot_yard_w"), n("depot_yard_e")],
];

function distToSeg(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

describe("depot layout", () => {
  const L = buildLayout();
  it("keeps the depot roads clear (ignoring flat paint and speed bumps)", () => {
    for (const it of [...L.solid, ...L.cyl]) {
      if (it.s[1] <= 0.12) continue;
      if (Math.max(it.s[0], it.s[2]) > 60) continue; // long perimeter rails/bands are checked by zone below
      for (const [a, b] of SEGS) expect(distToSeg(it.p[0], it.p[2], a, b), JSON.stringify(it)).toBeGreaterThan(4.2);
    }
  });
  it("stays inside the depot zone", () => {
    const z = ZONES.depot;
    for (const it of L.solid) {
      expect(it.p[0]).toBeGreaterThanOrEqual(z.minX);
      expect(it.p[0]).toBeLessThanOrEqual(z.maxX);
      expect(it.p[2]).toBeGreaterThanOrEqual(z.minZ);
      expect(it.p[2]).toBeLessThanOrEqual(z.maxZ);
    }
  });
  it("forklift paths stay off public roads", () => {
    for (const r of FORKLIFT_ROUTES)
      for (const leg of buildLegs(r))
        for (let i = 1; i < leg.pts.length; i++)
          for (let u = 0; u <= 1; u += 0.1) {
            const x = leg.pts[i - 1].x + (leg.pts[i].x - leg.pts[i - 1].x) * u;
            const z = leg.pts[i - 1].z + (leg.pts[i].z - leg.pts[i - 1].z) * u;
            for (const [a, b] of SEGS) expect(distToSeg(x, z, a, b)).toBeGreaterThan(5.5);
          }
  });
});
