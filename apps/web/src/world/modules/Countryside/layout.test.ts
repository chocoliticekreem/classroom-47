import { describe, expect, it } from "vitest";
import { WATER_X, ZONES, inBox } from "../../config";
import {
  FARM,
  FARMLAND_SW,
  FORESTS,
  RIVER_CLEAR,
  WORLD_HALF,
  distToSegment,
  hillHeight,
  inAirport,
  makeAllotments,
  makeFarmsteads,
  makeFields,
  makeHills,
  makeSouthWestFields,
  makeTrees,
  makeTurbines,
  mulberry32,
  riverDistance,
  roadDistance,
  roadDistanceExact,
  tallPropAllowed,
} from "./layout";

describe("distToSegment", () => {
  it("measures to the interior and to the endpoints", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distToSegment(13, 4, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });
});

describe("roadDistance spatial hash", () => {
  it("matches the exact distance within 30 m and never under-reports", () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 4000; i++) {
      const x = -1100 + rand() * 2200;
      const z = -1100 + rand() * 2200;
      const exact = roadDistanceExact(x, z);
      const fast = roadDistance(x, z);
      if (exact <= 30) expect(fast).toBeCloseTo(exact, 6);
      else expect(fast).toBeGreaterThan(30);
    }
  });
});

const ALL_ZONES = Object.entries(ZONES).filter(([n]) => n !== "airport");

describe("countryside layout", () => {
  const hills = makeHills();
  const turbines = makeTurbines(hills);
  const fields = makeFields();
  const farmsteads = makeFarmsteads();
  const sw = makeSouthWestFields(farmsteads);
  const allot = makeAllotments();
  const trees = makeTrees(hills, turbines, 23, { extraBoxes: allot.sites });

  it("keeps farm buildings off the lanes", () => {
    const footprints: [number, number, number][] = [
      [FARM.farmhouse.x, FARM.farmhouse.z, 7],
      [FARM.barn.x, FARM.barn.z, 11],
      [FARM.silo.x, FARM.silo.z, 3.5],
      [FARM.pond.x, FARM.pond.z, FARM.pond.r],
      [FARM.windmill.x, FARM.windmill.z, 5],
      [FARM.tractor.x, FARM.tractor.z, 3],
      ...farmsteads.map((f): [number, number, number] => [f.x, f.z, 20]),
    ];
    for (const [x, z, r] of footprints) expect(roadDistanceExact(x, z)).toBeGreaterThan(r + 4.5);
    expect(turbines.length).toBeGreaterThanOrEqual(4);
    for (const t of turbines) {
      expect(roadDistanceExact(t.x, t.z)).toBeGreaterThan(8);
      expect(tallPropAllowed(t.x, t.z)).toBe(true);
      expect(inAirport(t.x, t.z, 20)).toBe(false);
    }
  });

  it("keeps hills clear of the westmost lane, the airport and other zones", () => {
    expect(hillHeight(hills, -345, 0)).toBe(0);
    for (let x = -480; x <= -230; x += 5) for (let z = -460; z <= -230; z += 5) expect(hillHeight(hills, x, z)).toBe(0);
    for (const h of hills) {
      expect(roadDistanceExact(h.x, h.z)).toBeGreaterThan(h.r);
      for (const [n, b] of ALL_ZONES) if (n !== "countryside") expect(inBox(b, h.x, h.z, h.r)).toBe(false);
    }
  });

  it("scatters thousands of trees, never on roads, zones, sea or river", () => {
    expect(trees.length).toBeGreaterThan(3000);
    expect(trees.length).toBeLessThanOrEqual(8000);
    const bad = trees.filter(
      (t) =>
        roadDistanceExact(t.x, t.z) < 9 ||
        t.x > WATER_X - 10 ||
        Math.abs(t.x) > WORLD_HALF ||
        Math.abs(t.z) > WORLD_HALF ||
        inAirport(t.x, t.z) ||
        riverDistance(t.x, t.z) < RIVER_CLEAR ||
        ALL_ZONES.some(([, b]) => inBox(b, t.x, t.z)) ||
        allot.sites.some((b) => inBox(b, t.x, t.z)) ||
        inBox(FARMLAND_SW, t.x, t.z),
    );
    expect(bad).toEqual([]);
  });

  it("grows dense forests on the outer edges", () => {
    for (const f of FORESTS) {
      const n = trees.filter((t) => ((t.x - f.x) / f.rx) ** 2 + ((t.z - f.z) / f.rz) ** 2 < 1).length;
      expect(n, f.name).toBeGreaterThan(500);
    }
  });

  it("is deterministic", () => {
    expect(makeTrees(hills, turbines, 23, { extraBoxes: allot.sites }).slice(-5)).toEqual(trees.slice(-5));
  });

  it("lays field stripes inside the zone and off the lanes", () => {
    expect(fields.stripes.length).toBeGreaterThan(100);
    for (const s of fields.stripes) {
      expect(inBox(ZONES.countryside, s.x, s.z)).toBe(true);
      expect(roadDistanceExact(s.x, s.z)).toBeGreaterThanOrEqual(5);
    }
    expect(fields.pastures.length).toBe(3);
    for (const p of fields.pastures) expect(p.spots.length).toBeGreaterThan(20);
    expect(fields.pieces.length).toBeGreaterThan(100);
  });

  it("adds farms with fields in the far south-west", () => {
    expect(farmsteads.length).toBeGreaterThanOrEqual(2);
    expect(sw.stripes.length).toBeGreaterThan(400);
    expect(sw.pastures.length).toBeGreaterThanOrEqual(2);
    for (const s of sw.stripes) {
      expect(inBox(FARMLAND_SW, s.x, s.z)).toBe(true);
      expect(roadDistanceExact(s.x, s.z)).toBeGreaterThanOrEqual(5);
      expect(riverDistance(s.x, s.z)).toBeGreaterThanOrEqual(RIVER_CLEAR);
    }
  });

  it("puts allotments on the city fringe, off roads and out of zones", () => {
    expect(allot.sites.length).toBeGreaterThanOrEqual(3);
    expect(allot.plots.length).toBeGreaterThan(40);
    for (const p of allot.plots) {
      expect(roadDistanceExact(p.x, p.z)).toBeGreaterThanOrEqual(7.5);
      for (const [, b] of Object.entries(ZONES)) expect(inBox(b, p.x, p.z)).toBe(false);
    }
  });
});
