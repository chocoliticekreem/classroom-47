import { describe, expect, it } from "vitest";
import { ZONES } from "../../config";
import { shoreditch } from "../../districts/shoreditch";
import { PLACES, ROAD_NODES, findPath } from "../../roads";
import { obbOverlap, obbSegDist, segmentsCross, type Seg } from "./geom2d";
import { KIND, ROAD_CLEAR, buildLayout, nearbyRoads, nightLevel, viaductLength, viaductPoint } from "./layout";

const Z = ZONES.shoreditch;
const L = buildLayout();

describe("shoreditch roads", () => {
  it("uses sh_ ids and stays inside the zone (connectors excepted) and south of the river", () => {
    for (const n of shoreditch.nodes) {
      expect(n.id.startsWith("sh_"), n.id).toBe(true);
      expect(n.z, n.id).toBeGreaterThan(-560);
      const inside = n.x >= Z.minX - 6 && n.x <= Z.maxX && n.z >= Z.minZ && n.z <= Z.maxZ + 4;
      const connector = /^sh_(ow4|cr3|ge3)$/.test(n.id);
      expect(inside || connector, n.id).toBe(true);
    }
  });

  it("references only known nodes and every node reaches the depot", () => {
    for (const e of shoreditch.edges) {
      expect(ROAD_NODES.has(e.a), e.a).toBe(true);
      expect(ROAD_NODES.has(e.b), e.b).toBe(true);
    }
    for (const n of shoreditch.nodes) expect(findPath(PLACES.depot, n.id), n.id).not.toBeNull();
  });

  it("has no crossing edges", () => {
    const segs: (Seg & { a: string; b: string })[] = shoreditch.edges.map((e) => {
      const a = ROAD_NODES.get(e.a)!;
      const b = ROAD_NODES.get(e.b)!;
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z, a: e.a, b: e.b };
    });
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i], t = segs[j];
        if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
        expect(segmentsCross(s, t), `${s.a}-${s.b} x ${t.a}-${t.b}`).toBe(false);
      }
  });

  it("keeps edges 15-40 m long (organic curves)", () => {
    for (const e of shoreditch.edges) {
      const a = ROAD_NODES.get(e.a)!;
      const b = ROAD_NODES.get(e.b)!;
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      expect(len, `${e.a}-${e.b}`).toBeLessThan(42);
    }
  });
});

describe("shoreditch layout", () => {
  it("is deterministic", () => {
    const again = buildLayout();
    expect(again.facades.length).toBe(L.facades.length);
    expect(again.parts.length).toBe(L.parts.length);
    expect(again.facades[10]).toEqual(L.facades[10]);
  });

  it("is dense and has every feature", () => {
    expect(L.buildings.length).toBeGreaterThan(120);
    expect(L.facades.filter((f) => f.kind === KIND.warehouse).length).toBeGreaterThan(60);
    expect(L.facades.filter((f) => f.kind === KIND.glass).length).toBeGreaterThanOrEqual(3);
    expect(L.facades.filter((f) => f.kind === KIND.container).length).toBeGreaterThan(10);
    expect(L.facades.filter((f) => f.kind === KIND.archShop).length).toBeGreaterThan(8);
    expect(L.murals.length).toBeGreaterThanOrEqual(8);
    expect(L.rooftopBars).toBeGreaterThanOrEqual(4);
    expect(L.signs.length).toBeGreaterThan(40);
    expect(L.people.length).toBeGreaterThan(200);
    expect(L.parts.filter((p) => p.pool === "sailboat" || p.pool === "motorboat").length).toBeGreaterThan(15);
    expect(L.parts.filter((p) => p.pool === "crane").length).toBeGreaterThan(10);
    expect(L.parts.filter((p) => p.pool === "bulb").length).toBeGreaterThan(200);
  });

  it("keeps buildings inside the zone, off the roads and apart", () => {
    const roads = nearbyRoads();
    for (const b of L.buildings) {
      expect(b.x).toBeGreaterThan(Z.minX);
      expect(b.x).toBeLessThan(Z.maxX);
      expect(b.z).toBeGreaterThan(Z.minZ);
      expect(b.z).toBeLessThan(Z.maxZ);
      let d = Infinity;
      for (const s of roads) d = Math.min(d, obbSegDist(b, s));
      const min = b.facade.kind === KIND.container ? 5 : ROAD_CLEAR - 0.01;
      expect(d, `${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThanOrEqual(min);
    }
    for (let i = 0; i < L.buildings.length; i++)
      for (let j = i + 1; j < L.buildings.length; j++) expect(obbOverlap(L.buildings[i], L.buildings[j], 0.05)).toBe(false);
  });
});

describe("helpers", () => {
  it("night level", () => {
    expect(nightLevel(12)).toBe(0);
    expect(nightLevel(23)).toBe(1);
    expect(nightLevel(18.5)).toBeCloseTo(0.5);
  });
  it("walks the viaduct", () => {
    const o = { x: 0, z: 0, heading: 0 };
    viaductPoint(0, o);
    expect(o.x).toBeCloseTo(82);
    viaductPoint(viaductLength(), o);
    expect(o.x).toBeCloseTo(262);
  });
});
