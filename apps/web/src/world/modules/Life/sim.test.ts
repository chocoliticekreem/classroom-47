import { describe, expect, it } from "vitest";
import { LANE_OFFSET, ROAD_WIDTH } from "../../config";
import {
  BLOCKS,
  GUTTER_OFFSET,
  blockCentre,
  createCyclist,
  createPedestrian,
  mulberry32,
  nightness,
  perimeterPoint,
  placeFurniture,
  stadiumPoint,
  stepCyclist,
  stepPedestrian,
} from "./sim";

const ROAD_CENTRES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
/** Distance from (x,z) to the nearest downtown road centre line (either axis). */
function distToRoad(x: number, z: number) {
  let best = Infinity;
  for (const c of ROAD_CENTRES) best = Math.min(best, Math.abs(x - c), Math.abs(z - c));
  return best;
}

describe("perimeterPoint", () => {
  it("walks the square loop corner to corner", () => {
    const h = 14;
    const p = { x: 0, z: 0, heading: 0 };
    perimeterPoint(h, 0, 1, p);
    expect([p.x, p.z]).toEqual([-h, -h]);
    perimeterPoint(h, 2 * h, 1, p);
    expect(p.x).toBeCloseTo(h);
    expect(p.z).toBeCloseTo(-h);
    perimeterPoint(h, 5 * h, 1, p); // middle of side 2: (0, h), heading -x
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(h);
    expect(p.heading).toBeCloseTo(-Math.PI / 2);
  });

  it("wraps around", () => {
    const a = { x: 0, z: 0, heading: 0 };
    const b = { x: 0, z: 0, heading: 0 };
    perimeterPoint(10, 3, 1, a);
    perimeterPoint(10, 83, 1, b);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });
});

describe("pedestrians", () => {
  it("stay on sidewalks or zebra crossings for a long walk", () => {
    const rand = mulberry32(7);
    const peds = Array.from({ length: 60 }, () => createPedestrian(rand));
    let crossings = 0;
    for (let f = 0; f < 3000; f++) {
      for (const p of peds) {
        stepPedestrian(p, 0.05, rand, () => true);
        if (p.mode === 2) {
          crossings++;
          continue;
        }
        const d = distToRoad(p.x, p.z);
        expect(d).toBeGreaterThanOrEqual(ROAD_WIDTH / 2);
        expect(d).toBeLessThanOrEqual(ROAD_WIDTH / 2 + 3);
      }
    }
    expect(crossings).toBeGreaterThan(0);
    for (const p of peds) {
      expect(p.bi).toBeGreaterThanOrEqual(0);
      expect(p.bi).toBeLessThan(BLOCKS);
      expect(p.bj).toBeGreaterThanOrEqual(0);
      expect(p.bj).toBeLessThan(BLOCKS);
    }
  });

  it("wait at a red light instead of crossing", () => {
    const rand = mulberry32(3);
    const peds = Array.from({ length: 40 }, () => createPedestrian(rand));
    for (let f = 0; f < 2000; f++) for (const p of peds) stepPedestrian(p, 0.05, rand, () => false);
    for (const p of peds) expect(p.mode).not.toBe(2);
    expect(peds.some((p) => p.mode === 1)).toBe(true);
  });
});

describe("cyclists", () => {
  it("ride in the gutter band on the left of downtown roads", () => {
    expect(GUTTER_OFFSET).toBeCloseTo(LANE_OFFSET + 1.2);
    const rand = mulberry32(11);
    const bikes = Array.from({ length: 15 }, () => createCyclist(rand));
    for (let f = 0; f < 4000; f++)
      for (const b of bikes) {
        stepCyclist(b, 0.05, rand, () => true, () => false);
        expect(Math.abs(b.x)).toBeLessThanOrEqual(160 + GUTTER_OFFSET + 0.01);
        expect(Math.abs(b.z)).toBeLessThanOrEqual(160 + GUTTER_OFFSET + 0.01);
        if (b.seg === 0) {
          // on a street: exactly GUTTER_OFFSET from the centre line, to the left of travel
          expect(distToRoad(b.x, b.z)).toBeCloseTo(GUTTER_OFFSET, 3);
          const lx = Math.cos(b.heading); // left of heading (sin h, cos h) is (cos h, -sin h)
          const lz = -Math.sin(b.heading);
          const cx = Math.round((b.x - lx * GUTTER_OFFSET) / 40) * 40;
          const cz = Math.round((b.z - lz * GUTTER_OFFSET) / 40) * 40;
          const onCentre = Math.abs(b.x - lx * GUTTER_OFFSET - cx) < 0.01 || Math.abs(b.z - lz * GUTTER_OFFSET - cz) < 0.01;
          expect(onCentre).toBe(true);
        }
      }
  });

  it("stop at red lights", () => {
    const rand = mulberry32(5);
    const b = createCyclist(rand);
    let stoppedFrames = 0;
    for (let f = 0; f < 2000; f++) {
      stepCyclist(b, 0.05, rand, () => false, () => false);
      if (b.speed === 0) stoppedFrames++;
    }
    expect(stoppedFrames).toBeGreaterThan(1500);
  });
});

describe("furniture", () => {
  it("sits on the outer sidewalk band, away from corners, without overlaps", () => {
    const items = placeFurniture(42);
    expect(items.length).toBeGreaterThan(100);
    for (const it of items) {
      const d = distToRoad(it.x, it.z);
      expect(d).toBeGreaterThanOrEqual(ROAD_WIDTH / 2 + 0.3);
      expect(d).toBeLessThanOrEqual(ROAD_WIDTH / 2 + 1.8);
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        expect(Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z)).toBeGreaterThan(2.5);
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.size).toBe(5);
  });

  it("is deterministic", () => {
    expect(placeFurniture(1)).toEqual(placeFurniture(1));
  });
});

describe("helpers", () => {
  it("blockCentre maps 0..7 to -140..140", () => {
    expect(blockCentre(0)).toBe(-140);
    expect(blockCentre(7)).toBe(140);
  });

  it("stadiumPoint is continuous and loops", () => {
    const a = { x: 0, z: 0, heading: 0 };
    const b = { x: 0, z: 0, heading: 0 };
    const total = 2 * 600 + 2 * Math.PI * 8;
    for (let s = 0; s < total; s += 1) {
      stadiumPoint(s, 380, 0, 8, 300, a);
      stadiumPoint(s + 1, 380, 0, 8, 300, b);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1.01);
    }
    stadiumPoint(0, 380, 0, 8, 300, a);
    stadiumPoint(total, 380, 0, 8, 300, b);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });

  it("nightness is 1 at midnight and 0 at noon", () => {
    expect(nightness(0)).toBe(1);
    expect(nightness(12)).toBe(0);
    expect(nightness(19)).toBeGreaterThan(0);
  });
});
