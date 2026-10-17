import { describe, expect, it } from "vitest";
import { BLOCK_CENTRES, RESERVED, cellOf, generateCity } from "./layout";

const BUILDABLE = 13;

function cellKey(x: number, z: number) {
  const c = cellOf(x, z);
  return c ? `${c[0]},${c[1]}` : "none";
}

describe("generateCity", () => {
  const city = generateCity(1234);

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(generateCity(1234))).toBe(JSON.stringify(city));
    expect(JSON.stringify(generateCity(99))).not.toBe(JSON.stringify(city));
  });

  it("fills every non-reserved block with 1-4 buildings and leaves reserved cells empty", () => {
    const perCell = new Map<string, number>();
    for (const b of city.bodies) {
      if (b.y > 0.01) continue; // only count ground-standing bodies (not stepped tiers)
      const k = cellKey(b.x, b.z);
      perCell.set(k, (perCell.get(k) ?? 0) + 1);
    }
    for (const l of city.landmarks) perCell.set(cellKey(l.x, l.z), (perCell.get(cellKey(l.x, l.z)) ?? 0) + 1);
    const reserved = new Set(RESERVED.map(([x, z]) => `${x},${z}`));
    for (const cx of BLOCK_CENTRES)
      for (const cz of BLOCK_CENTRES) {
        const n = perCell.get(`${cx},${cz}`) ?? 0;
        if (reserved.has(`${cx},${cz}`)) expect(n, `reserved ${cx},${cz}`).toBe(0);
        else expect(n, `cell ${cx},${cz}`).toBeGreaterThanOrEqual(1);
      }
    expect(perCell.has("none")).toBe(false);
  });

  it("keeps every solid inside the buildable area of its block", () => {
    const solids = [...city.bodies, ...city.trims, ...city.shopfronts, ...city.acs];
    for (const s of solids) {
      const c = cellOf(s.x, s.z)!;
      expect(c, `solid at ${s.x},${s.z}`).not.toBeNull();
      expect(Math.abs(s.x - c[0]) + s.w / 2).toBeLessThanOrEqual(BUILDABLE + 1e-6);
      expect(Math.abs(s.z - c[1]) + s.d / 2).toBeLessThanOrEqual(BUILDABLE + 1e-6);
      expect(s.h).toBeGreaterThan(0);
    }
    for (const r of city.roofs) {
      const c = cellOf(r.x, r.z)!;
      const ex = Math.abs(Math.cos(r.ry)) * r.w / 2 + Math.abs(Math.sin(r.ry)) * r.d / 2;
      const ez = Math.abs(Math.sin(r.ry)) * r.w / 2 + Math.abs(Math.cos(r.ry)) * r.d / 2;
      expect(Math.abs(r.x - c[0]) + ex).toBeLessThanOrEqual(BUILDABLE + 1e-6);
      expect(Math.abs(r.z - c[1]) + ez).toBeLessThanOrEqual(BUILDABLE + 1e-6);
    }
    // awnings overhang the 3 m sidewalk but never reach the road
    for (const a of city.awnings) {
      const c = cellOf(a.x, a.z)!;
      expect(Math.max(Math.abs(a.x - c[0]), Math.abs(a.z - c[1]))).toBeLessThanOrEqual(15.5);
    }
  });

  it("has a varied skyline: tall glass near the centre, low brick at the edges, both landmarks", () => {
    const kinds = new Set(city.bodies.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(["brick", "glass", "office", "stucco"]);
    expect(city.landmarks.map((l) => l.kind).sort()).toEqual(["gherkin", "shard"]);
    const tallest = Math.max(...city.bodies.map((b) => b.y + b.h));
    expect(tallest).toBeGreaterThan(70);
    for (const b of city.bodies)
      if (b.kind === "brick" || b.kind === "stucco") expect(b.y + b.h).toBeLessThan(20);
    expect(city.awnings.length).toBeGreaterThan(10);
    expect(city.antennas.length).toBeGreaterThan(0);
    expect(city.lights.length).toBeGreaterThanOrEqual(city.antennas.length);
  });
});
