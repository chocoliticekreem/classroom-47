import { describe, expect, it } from "vitest";
import { RIVER, ZONES } from "../../config";
import { hampstead } from "../../districts/hampstead";
import { CLEARANCE, SOUTH_LIMIT, buildLayout, glowForHour, type Part } from "./layout";
import { HEATH, PONDS, VIEWPOINT, hampsteadSegments, heightAt, pointSegDist, pondMetric, roadDistance } from "./terrain";

const Z = ZONES.hampstead;

describe("hampstead roads (districts/hampstead.ts)", () => {
  const ids = new Set(hampstead.nodes.map((n) => n.id));

  it("prefixes every node with hp_ and keeps it inside the zone, clear of the motorway", () => {
    expect(hampstead.nodes.length).toBeGreaterThan(80);
    for (const n of hampstead.nodes) {
      expect(n.id.startsWith("hp_"), n.id).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(Z.minX);
      expect(n.x).toBeLessThanOrEqual(Z.maxX);
      expect(n.z).toBeGreaterThanOrEqual(Z.minZ);
      expect(n.z).toBeLessThanOrEqual(-706);
    }
  });

  it("stays well north of the river", () => {
    const river = RIVER.points.slice(1).map((q, i) => ({ ax: RIVER.points[i][0], az: RIVER.points[i][1], bx: q[0], bz: q[1] }));
    for (const n of hampstead.nodes) {
      const d = Math.min(...river.map((s) => pointSegDist(n.x, n.z, s)));
      expect(d, n.id).toBeGreaterThan(RIVER.width / 2 + 6);
    }
  });

  it("uses short straight edges (organic curves) between known nodes", () => {
    const at = new Map(hampstead.nodes.map((n) => [n.id, n]));
    for (const e of hampstead.edges) {
      const internal = ids.has(e.a) && ids.has(e.b);
      if (!internal) continue; // links to motorway / bridge nodes are checked by roads.test.ts
      const a = at.get(e.a)!;
      const b = at.get(e.b)!;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${e.a}-${e.b}`).toBeLessThanOrEqual(23);
    }
  });

  it("is internally connected and has its city connector", () => {
    const adj = new Map<string, string[]>([...ids].map((id) => [id, []]));
    for (const e of hampstead.edges) {
      if (ids.has(e.a) && ids.has(e.b)) {
        adj.get(e.a)!.push(e.b);
        adj.get(e.b)!.push(e.a);
      }
    }
    const seen = new Set(["hp_link_south"]);
    const stack = ["hp_link_south"];
    while (stack.length)
      for (const nb of adj.get(stack.pop()!)!)
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
    expect(seen.size).toBe(ids.size);
  });
});

describe("hampstead terrain", () => {
  it("keeps roads flat at y = 0", () => {
    for (const s of hampsteadSegments())
      for (let t = 0; t <= 1; t += 0.25) {
        const x = s.ax + (s.bx - s.ax) * t;
        const z = s.az + (s.bz - s.az) * t;
        for (const [ox, oz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) expect(heightAt(x + ox, z + oz)).toBe(0);
      }
  });

  it("has real hills on the heath, and flat ponds", () => {
    expect(heightAt(VIEWPOINT.x, VIEWPOINT.z)).toBeGreaterThan(10);
    for (const p of PONDS) {
      expect(heightAt(p.x, p.z)).toBe(0);
      expect(heightAt(p.x + p.rx * 1.1, p.z)).toBe(0);
    }
    expect(heightAt(HEATH.minX - 1, -800)).toBe(0);
    expect(heightAt(0, -800)).toBe(0);
  });
});

/** Points on the outline of a part's footprint (rotated by ry). */
function outline(p: Part): [number, number][] {
  const hx = p.sx / 2;
  const hz = p.sz / 2;
  const c = Math.cos(p.ry);
  const s = Math.sin(p.ry);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 4; i++) {
    const a = -hx + (2 * hx * i) / 4;
    const b = -hz + (2 * hz * i) / 4;
    for (const [lx, lz] of [[a, -hz], [a, hz], [-hx, b], [hx, b]] as const) pts.push([p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
  }
  return pts;
}

describe("hampstead layout", () => {
  const layout = buildLayout();

  it("is deterministic for a seed", () => {
    const again = buildLayout();
    expect(again.parts.length).toBe(layout.parts.length);
    expect(again.anims.length).toBe(layout.anims.length);
    expect(again.parts[500]).toEqual(layout.parts[500]);
  });

  it("fills the district", () => {
    const c = layout.counts;
    expect(c.villas).toBeGreaterThanOrEqual(18);
    expect(c.pools).toBeGreaterThanOrEqual(10);
    expect(c.shops).toBeGreaterThanOrEqual(18);
    expect(c.graves).toBeGreaterThanOrEqual(400);
    expect(c.mausoleums).toBeGreaterThanOrEqual(12);
    expect(c.trees).toBeGreaterThanOrEqual(300);
    expect(c.swimmers).toBeGreaterThanOrEqual(20);
    expect(c.kites).toBeGreaterThanOrEqual(8);
    expect(c.dogs).toBeGreaterThanOrEqual(15);
    expect(c.people).toBeGreaterThanOrEqual(150);
    expect(c.tennisCourts).toBe(3);
    expect(c.lamps).toBeGreaterThanOrEqual(40);
    expect(c.observatory).toBe(1);
    expect(c.cricket).toBe(1);
    expect(layout.signs.length).toBeGreaterThanOrEqual(20);
  });

  it("keeps every part inside the zone and off the motorway", () => {
    const bad = layout.parts.filter((p) =>
      outline(p).some(([x, z]) => x < Z.minX - 0.01 || x > Z.maxX + 0.01 || z < Z.minZ - 0.01 || z > SOUTH_LIMIT + 0.01),
    );
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it(`keeps every part ${CLEARANCE} m clear of every road centre line`, () => {
    const segs = hampsteadSegments();
    let worst = Infinity;
    let worstPart: Part | null = null;
    for (const p of layout.parts)
      for (const [x, z] of outline(p)) {
        const d = roadDistance(x, z, segs);
        if (d < worst) {
          worst = d;
          worstPart = p;
        }
      }
    expect(worst, JSON.stringify(worstPart)).toBeGreaterThanOrEqual(CLEARANCE - 0.01);
  });

  it("puts swimmers in the bathing ponds and people inside the zone", () => {
    for (const a of layout.anims) {
      expect(a.x).toBeGreaterThan(Z.minX);
      expect(a.x).toBeLessThan(Z.maxX);
      expect(a.z).toBeGreaterThan(Z.minZ);
      expect(a.z).toBeLessThan(SOUTH_LIMIT);
      if (a.mode === 2 && a.y < 0.5) {
        const pond = PONDS.find((p) => pondMetric(p, a.x, a.z) < 1);
        expect(pond, JSON.stringify(a)).toBeDefined();
        // the whole swim circle stays in the water
        for (let k = 0; k < 8; k++) {
          const t = (k / 8) * Math.PI * 2;
          expect(pondMetric(pond!, a.x + Math.cos(t) * a.dx, a.z + Math.sin(t) * a.dx)).toBeLessThan(1);
        }
      }
    }
  });

  it("flies kites high, downwind of their flyers", () => {
    const strings = layout.anims.filter((a) => a.pool === "aString");
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      const [kx, ky, kz] = s.to!;
      expect(ky - s.y).toBeGreaterThan(10);
      // WIND blows towards -x, -z
      expect(kx).toBeLessThan(s.x);
      expect(kz).toBeLessThan(s.z);
    }
  });

  it("glows at night only", () => {
    expect(glowForHour(13)).toBe(0);
    expect(glowForHour(23.5)).toBe(1);
    expect(glowForHour(2)).toBe(1);
    expect(glowForHour(19.2)).toBeGreaterThan(0);
  });
});
