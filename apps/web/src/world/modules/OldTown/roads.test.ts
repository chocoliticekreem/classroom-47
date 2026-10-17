import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { oldTown } from "../../districts/oldTown";
import { PLACES, ROAD_NODES, findPath, getNode } from "../../roads";
import { LANDMARK_CLEARANCE, distToSeg, type Seg } from "./layout";

const own = oldTown.nodes;
const seg = (a: string, b: string): Seg => {
  const na = getNode(a);
  const nb = getNode(b);
  return { ax: na.x, az: na.z, bx: nb.x, bz: nb.z, key: "", boulevard: false, main: false };
};

describe("old town roads", () => {
  it("prefixes every node id and merges into the shared graph", () => {
    expect(own.length).toBeGreaterThan(150);
    for (const n of own) {
      expect(n.id.startsWith("old_"), n.id).toBe(true);
      expect(ROAD_NODES.has(n.id), n.id).toBe(true);
    }
    for (const e of oldTown.edges) expect(ROAD_NODES.has(e.a) && ROAD_NODES.has(e.b), `${e.a}-${e.b}`).toBe(true);
  });

  it("keeps old town nodes inside the zone (connectors are tagged countryside)", () => {
    for (const n of own.filter((n) => n.zone === "oldTown")) expect(inBox(ZONES.oldTown, n.x, n.z), n.id).toBe(true);
    for (const n of own.filter((n) => n.zone !== "oldTown")) {
      expect(n.zone, n.id).toBe("countryside");
      expect(n.x, n.id).toBeLessThan(-300);
      expect(n.z, n.id).toBeGreaterThan(-240);
    }
  });

  it("is connected to the depot, the ring's west side and the motorway", () => {
    for (const n of own) expect(findPath(PLACES.depot, n.id), n.id).not.toBeNull();
    const toRing = findPath("old_mk_0", "h_14")!;
    expect(toRing).not.toBeNull();
    expect(toRing).toContain("farm_s");
    expect(findPath("old_sq_e", "h_13")).not.toBeNull();
    expect(findPath("old_mk_4", "mw_j_west")).not.toBeNull();
  });

  it("is organic: short edges, many headings, roundabout-like junctions", () => {
    const headings = new Set<number>();
    for (const e of oldTown.edges) {
      const a = getNode(e.a);
      const b = getNode(e.b);
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      expect(len, `${e.a}-${e.b}`).toBeLessThanOrEqual(30);
      expect(len, `${e.a}-${e.b}`).toBeGreaterThan(3);
      headings.add(Math.round(((Math.atan2(b.z - a.z, b.x - a.x) + Math.PI) % Math.PI) / (Math.PI / 36)));
    }
    expect(headings.size).toBeGreaterThan(28); // nearly every 5 degree bucket is used: no grid
    const degree = new Map<string, number>();
    for (const e of oldTown.edges) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    expect([...degree.values()].filter((d) => d >= 3).length).toBeGreaterThan(20);
  });

  it("never crosses itself without a junction", () => {
    const es = oldTown.edges.map((e) => [getNode(e.a), getNode(e.b)] as const);
    const cross = (p: { x: number; z: number }, q: { x: number; z: number }, r: { x: number; z: number }, s: { x: number; z: number }) => {
      const d = (a: typeof p, b: typeof p, c: typeof p) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
    };
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        const [a, b] = es[i];
        const [c, d] = es[j];
        if (a === c || a === d || b === c || b === d) continue;
        expect(cross(a, b, c, d), `${a.id}(${a.x},${a.z})-${b.id}(${b.x},${b.z}) x ${c.id}(${c.x},${c.z})-${d.id}(${d.x},${d.z})`).toBe(false);
      }
  });

  it("keeps lanes clear of the landmarks", () => {
    for (const e of oldTown.edges) {
      const s = seg(e.a, e.b);
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      for (let t = 0; t <= len; t += 1)
        for (const off of [-5, 0, 5]) {
          const ux = (s.bx - s.ax) / len;
          const uz = (s.bz - s.az) / len;
          const x = s.ax + ux * t - uz * off;
          const z = s.az + uz * t + ux * off;
          for (const l of LANDMARK_CLEARANCE) expect(l.inside(x, z), `${e.a}-${e.b} hits ${l.name}`).toBe(false);
        }
    }
  });

  it("stays south of the river and leaves the distance helper sane", () => {
    for (const n of own) expect(n.z).toBeGreaterThan(-480);
    expect(distToSeg(0, 5, { ax: -1, az: 0, bx: 1, bz: 0 } as Seg)).toBeCloseTo(5);
  });
});
