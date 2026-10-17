import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { getNode, ROAD_EDGES } from "../../roads";
import type { Where } from "../../scenarios";
import { rng } from "./director";
import { edgesFor, frameOnEdge, KERB_OFFSET, OFFICE, pickLocation } from "./location";

describe("edgesFor", () => {
  it("returns candidate roads for every physical place", () => {
    for (const w of ["suburbs", "downtown", "depot", "docks", "road"] as Where[]) expect(edgesFor(w).length).toBeGreaterThan(0);
    expect(edgesFor("office")).toEqual([]);
  });

  it("keeps suburb/depot edges on their own nodes", () => {
    for (const e of edgesFor("suburbs")) expect(e.a.startsWith("sub_") && e.b.startsWith("sub_")).toBe(true);
    for (const e of edgesFor("depot")) expect(e.a.startsWith("depot_") && e.b.startsWith("depot_")).toBe(true);
  });
});

describe("frameOnEdge", () => {
  it("puts the origin KERB_OFFSET off the centre line, +z pointing away from the road", () => {
    const e = ROAD_EDGES.get("g_0_0|g_1_0")!;
    for (const side of [1, -1] as const) {
      const f = frameOnEdge(e, 0.5, side);
      expect(Math.hypot(f.x - f.roadX, f.z - f.roadZ)).toBeCloseTo(KERB_OFFSET);
      // local +z (sin rot, cos rot) points from road centre to the origin
      const dx = (f.x - f.roadX) / KERB_OFFSET;
      const dz = (f.z - f.roadZ) / KERB_OFFSET;
      expect(Math.sin(f.rot)).toBeCloseTo(dx);
      expect(Math.cos(f.rot)).toBeCloseTo(dz);
    }
  });
});

describe("pickLocation", () => {
  it("lands in the right zone", () => {
    const r = rng(9);
    for (let i = 0; i < 20; i++) {
      expect(inBox(ZONES.suburbs, pickLocation("suburbs", { rand: r }).x, pickLocation("suburbs", { rand: r }).z, 10)).toBe(true);
      const d = pickLocation("downtown", { rand: r });
      expect(inBox(ZONES.downtown, d.x, d.z)).toBe(true);
      const dp = pickLocation("depot", { rand: r });
      expect(inBox(ZONES.depot, dp.x, dp.z, 10)).toBe(true);
      const dk = pickLocation("docks", { rand: r });
      expect(dk.x).toBeGreaterThan(215);
    }
  });

  it("avoids scenes already on screen", () => {
    const r = rng(4);
    const a = pickLocation("downtown", { rand: r });
    for (let i = 0; i < 20; i++) {
      const b = pickLocation("downtown", { rand: r, taken: [a] });
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(26);
    }
  });

  it("skips blocked roads", () => {
    const r = rng(5);
    const blocked = new Set(edgesFor("road").slice(0, -1).map((e) => e.key));
    const last = edgesFor("road").at(-1)!;
    for (let i = 0; i < 5; i++) expect(pickLocation("road", { rand: r, blocked, onRoad: true }).edgeKey).toBe(last.key);
  });

  it("office slots sit at the back-office tower", () => {
    const a = pickLocation("office", { rand: rng(1) });
    expect(a).toMatchObject({ x: OFFICE.x, z: OFFICE.z });
    const b = pickLocation("office", { rand: rng(1), taken: [a] });
    expect(b.x).not.toBe(a.x);
  });

  it("on-road picks sit on the centre line", () => {
    const f = pickLocation("road", { rand: rng(2), onRoad: true });
    const e = ROAD_EDGES.get(f.edgeKey!)!;
    const a = getNode(e.a);
    const b = getNode(e.b);
    expect(f.x).toBeCloseTo((a.x + b.x) / 2);
    expect(f.z).toBeCloseTo((a.z + b.z) / 2);
  });
});

describe("road scenes", () => {
  it("only use city streets and the highway ring (never zone access roads)", () => {
    for (const e of edgesFor("road")) for (const id of [e.a, e.b]) expect(/^(g_|h_)/.test(id)).toBe(true);
  });
});
