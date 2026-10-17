import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { LANDMARK_CLEARANCE, buildLayout, distToSeg, reserved } from "./layout";
import { nightLevel } from "./materials";
import { buildOldTown } from "./scene";

const L = buildLayout();

/** Sample points over a house footprint (shrunk a little: terraces share party walls). */
function footprint(h: (typeof L.houses)[number], inset = 0.5) {
  const pts: [number, number][] = [];
  const c = Math.cos(h.ry);
  const s = Math.sin(h.ry);
  for (let i = 0; i <= 2; i++)
    for (let j = 0; j <= 2; j++) {
      const lx = (i / 2 - 0.5) * (h.w - inset * 2);
      const lz = (j / 2 - 0.5) * (h.d - inset * 2);
      pts.push([h.x + lx * c + lz * s, h.z - lx * s + lz * c]);
    }
  return pts;
}

describe("old town layout", () => {
  it("fills the blocks densely with a mix of styles, shops and pubs", () => {
    expect(L.houses.length).toBeGreaterThan(900);
    const styles = new Set(L.houses.map((h) => h.style));
    for (const s of ["tudor", "stone", "brick", "georgian", "bath", "stucco"]) expect(styles.has(s as never), s).toBe(true);
    expect(L.houses.filter((h) => h.shop).length).toBeGreaterThan(25);
    expect(L.houses.filter((h) => h.pub).length).toBeGreaterThan(8);
    expect(L.lamps.length).toBeGreaterThan(120);
    expect(L.walls.length).toBeGreaterThan(60);
    expect(L.walkers.length).toBeGreaterThan(300);
  });

  it("is deterministic for a seed", () => {
    const again = buildLayout();
    expect(again.houses.length).toBe(L.houses.length);
    expect(again.houses[100]).toEqual(L.houses[100]);
  });

  it("keeps every house inside the zone, off the roads and off the landmarks", () => {
    for (const h of L.houses)
      for (const [x, z] of footprint(h, 0.1)) {
        expect(inBox(ZONES.oldTown, x, z), `house at ${h.x},${h.z}`).toBe(true);
        for (const s of L.segs) expect(distToSeg(x, z, s), `house at ${h.x},${h.z}`).toBeGreaterThan(4.6);
        for (const l of LANDMARK_CLEARANCE) expect(l.inside(x, z), `house at ${h.x},${h.z} in ${l.name}`).toBe(false);
      }
    for (const h of L.houses) for (const [x, z] of footprint(h, 0.6)) expect(reserved(x, z), `house at ${h.x},${h.z} on reserved ground`).toBe(false);
  }, 30000);

  it("never stacks two houses on the same ground", () => {
    const inside = (h: (typeof L.houses)[number], x: number, z: number) => {
      const dx = x - h.x;
      const dz = z - h.z;
      const c = Math.cos(h.ry);
      const s = Math.sin(h.ry);
      return Math.abs(dx * c - dz * s) < h.w / 2 - 0.4 && Math.abs(dx * s + dz * c) < h.d / 2 - 0.4;
    };
    const cell = (x: number, z: number) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
    const grid = new Map<string, number[]>();
    L.houses.forEach((h, i) => {
      const k = cell(h.x, h.z);
      grid.set(k, [...(grid.get(k) ?? []), i]);
    });
    L.houses.forEach((h, i) => {
      const [cx, cz] = [Math.floor(h.x / 20), Math.floor(h.z / 20)];
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const j of grid.get(`${cx + a},${cz + b}`) ?? []) {
            if (j === i) continue;
            for (const [x, z] of footprint(h, 0.8)) expect(inside(L.houses[j], x, z), `houses ${i} and ${j}`).toBe(false);
          }
    });
  });

  it("keeps gas lamps on the pavement, clear of other lanes", () => {
    for (const [x, z] of L.lamps) {
      const d = Math.min(...L.segs.map((s) => distToSeg(x, z, s)));
      expect(d).toBeGreaterThan(4.5);
      expect(d).toBeLessThan(5.5);
    }
  });
});

describe("old town scene", () => {
  it("bakes into a handful of merged geometries within a sane vertex budget", () => {
    const t0 = performance.now();
    const S = buildOldTown();
    const ms = performance.now() - t0;
    let verts = 0;
    for (const k of ["low", "tall", "stone", "windows", "glow", "pave", "lawn", "water"] as const) {
      const g = S[k];
      expect(g, k).not.toBeNull();
      verts += g!.getAttribute("position").count;
      expect(g!.boundingSphere, k).not.toBeNull();
    }
    expect(S.windows!.getAttribute("aLit")).toBeDefined();
    expect(verts).toBeLessThan(1_400_000);
    expect(ms).toBeLessThan(4000);
  }, 30000);

  it("lights up at night only", () => {
    expect(nightLevel(13)).toBe(0);
    expect(nightLevel(22)).toBe(1);
    expect(nightLevel(3)).toBe(1);
    expect(nightLevel(18.5)).toBeGreaterThan(0);
  });
});
