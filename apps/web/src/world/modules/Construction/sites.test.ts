import { describe, expect, it } from "vitest";
import { ZONES } from "../../config";
import { ROAD_EDGES, findPath, getNode } from "../../roads";
import { derive, craneAt, newCraneState, slewAngle } from "./crane";
import { boxAround, boxesOverlap, pointSegDist, segBoxDist, wrapPi } from "./geom2d";
import {
  CANDIDATES, MAX_SITES, MIN_SITES, ROAD_CLEARANCE, ROAD_HALF, getSites, layoutSite, pickSites, siteProblem,
} from "./sites";

const sites = getSites();

describe("geometry helpers", () => {
  it("segment to box distance", () => {
    const b = boxAround(0, 0, 5, 5);
    expect(segBoxDist(-20, 0, 20, 0, b)).toBe(0); // crosses
    expect(segBoxDist(10, -20, 10, 20, b)).toBeCloseTo(5);
    expect(segBoxDist(8, 8, 20, 20, b)).toBeCloseTo(Math.hypot(3, 3));
    expect(segBoxDist(1, 1, 2, 2, b)).toBe(0); // inside
  });
});

describe("site placement", () => {
  it(`places ${MIN_SITES}-${MAX_SITES} sites`, () => {
    expect(sites.length).toBeGreaterThanOrEqual(MIN_SITES);
    expect(sites.length).toBeLessThanOrEqual(MAX_SITES);
  });

  it("keeps every hoarding at least 10 m off every road's kerb", () => {
    for (const s of sites)
      for (const e of ROAD_EDGES.values()) {
        const a = getNode(e.a);
        const b = getNode(e.b);
        const d = segBoxDist(a.x, a.z, b.x, b.z, s.box) - ROAD_HALF[e.kind];
        expect(d, `${s.id} vs ${e.key}`).toBeGreaterThanOrEqual(ROAD_CLEARANCE);
      }
  });

  it("stays out of every zone box", () => {
    for (const s of sites)
      for (const [name, z] of Object.entries(ZONES)) expect(boxesOverlap(s.box, z), `${s.id} in ${name}`).toBe(false);
  });

  it("passes all placement checks and sites don't overlap", () => {
    for (const s of sites) expect(siteProblem(s.box)).toBeNull();
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) expect(boxesOverlap(sites[i].box, sites[j].box, 20)).toBe(false);
  });

  it("rejects a spot on top of a road and nudges or skips it", () => {
    const onRoad = { ...CANDIDATES[0], id: "bad", x: 0, z: 0 }; // downtown centre
    expect(pickSites([onRoad])).toHaveLength(0);
  });

  it("includes a half-built tower just outside downtown", () => {
    expect(sites.some((s) => Math.abs(s.spec.x) < 220 && Math.abs(s.spec.z) < 220)).toBe(true);
  });
});

describe("site layout", () => {
  it("fits every prop inside the hoarding without overlaps", () => {
    for (const c of CANDIDATES) {
      const s = layoutSite(c, 3);
      const { hx, hz } = s.local;
      for (const f of s.footprints) {
        expect(f.minX, `${c.id} ${f.name}`).toBeGreaterThanOrEqual(-hx);
        expect(f.maxX, `${c.id} ${f.name}`).toBeLessThanOrEqual(hx);
        expect(f.minZ, `${c.id} ${f.name}`).toBeGreaterThanOrEqual(-hz);
        expect(f.maxZ, `${c.id} ${f.name}`).toBeLessThanOrEqual(hz);
      }
      for (let i = 0; i < s.footprints.length; i++)
        for (let j = i + 1; j < s.footprints.length; j++) {
          const a = s.footprints[i];
          const b = s.footprints[j];
          expect(boxesOverlap(a, b), `${c.id}: ${a.name} overlaps ${b.name}`).toBe(false);
        }
    }
  });

  it("gives every crane reachable pick and drop points and a hook path below the jib", () => {
    for (const c of CANDIDATES) {
      const s = layoutSite(c, 5);
      for (const cr of s.cranes) {
        const p = cr.plan;
        for (const pt of [p.pick, p.drop]) {
          const r = Math.hypot(pt.x - cr.x, pt.z - cr.z);
          expect(r, c.id).toBeGreaterThan(3);
          expect(r, c.id).toBeLessThan(cr.jib - 1.5);
        }
        expect(p.clearY).toBeGreaterThan(s.tower.topY + 2);
        expect(p.clearY).toBeLessThan(cr.mastH - 2);
        expect(p.drop.y).toBeGreaterThan(s.tower.topY);
        // drop lands on the tower's top slab
        const t = s.tower;
        const [hw, hd] = c.q % 2 === 0 ? [t.w / 2, t.d / 2] : [t.d / 2, t.w / 2];
        expect(Math.abs(p.drop.x - t.x)).toBeLessThan(hw);
        expect(Math.abs(p.drop.z - t.z)).toBeLessThan(hd);
        // pick is inside the site
        expect(p.pick.x).toBeGreaterThan(s.box.minX);
        expect(p.pick.x).toBeLessThan(s.box.maxX);
        expect(p.pick.z).toBeGreaterThan(s.box.minZ);
        expect(p.pick.z).toBeLessThan(s.box.maxZ);
      }
    }
  });

  it("keeps two cranes on one site from hitting each other", () => {
    for (const c of CANDIDATES.filter((k) => k.cranes === 2)) {
      const s = layoutSite(c, 7);
      const [hi, lo] = s.cranes; // external crane is the taller one
      expect(hi.mastH).toBeGreaterThan(lo.mastH + 10); // jib passes over the lower crane's tower head
      const dist = Math.hypot(hi.x - lo.x, hi.z - lo.z);
      if (lo.jib + 1 < dist) continue;
      // the lower crane never slews its jib through the taller crane's mast
      const toHi = slewAngle(hi.x - lo.x, hi.z - lo.z);
      const margin = Math.asin(Math.min(1, 2.5 / dist));
      const d = derive(lo.plan);
      const st = newCraneState();
      for (let t = 0; t < d.cycle; t += 0.1) {
        craneAt(lo.plan, d, t, st);
        expect(Math.abs(wrapPi(st.slew - toHi)), c.id).toBeGreaterThan(margin);
      }
      // and its counter-jib neither
      for (let t = 0; t < d.cycle; t += 0.1) {
        craneAt(lo.plan, d, t, st);
        if (lo.counterJib + 1 < dist) break;
        expect(Math.abs(wrapPi(st.slew + Math.PI - toHi)), c.id).toBeGreaterThan(margin);
      }
    }
  });

  it("puts the mixer pads outside the hoarding and off the road", () => {
    for (const s of sites)
      for (const p of s.pads) {
        expect(
          p.x < s.box.minX || p.x > s.box.maxX || p.z < s.box.minZ || p.z > s.box.maxZ,
          `${s.id} pad inside`,
        ).toBe(true);
        for (const e of ROAD_EDGES.values()) {
          const a = getNode(e.a);
          const b = getNode(e.b);
          expect(pointSegDist(p.x, p.z, a.x, a.z, b.x, b.z) - ROAD_HALF[e.kind]).toBeGreaterThan(4.6);
        }
      }
  });

  it("connects every site's gate node to every other by road", () => {
    for (const a of sites)
      for (const b of sites) if (a !== b) expect(findPath(a.gateNode, b.gateNode), `${a.id} -> ${b.id}`).not.toBeNull();
  });
});
