import { describe, expect, it } from "vitest";
import {
  COLLAPSE_S,
  REBUILD_MAX_S,
  REBUILD_STAGGER_S,
  circleHitsRect,
  collapsePose,
  groupFootprints,
  groupsInCircle,
  rebuildFraction,
  rebuildSchedule,
} from "./damage";
import { generateCity } from "./layout";

describe("circleHitsRect", () => {
  it("hits when the centre is inside", () => expect(circleHitsRect(0, 0, 1, 0, 0, 4, 4)).toBe(true));
  it("hits when only the edge overlaps", () => expect(circleHitsRect(5, 0, 3.1, 0, 0, 4, 4)).toBe(true));
  it("misses just outside an edge", () => expect(circleHitsRect(5, 0, 2.9, 0, 0, 4, 4)).toBe(false));
  it("uses the true corner distance, not the bounding box", () => {
    // corner at (2,2); centre (4,4) is sqrt(8) ~ 2.83 away
    expect(circleHitsRect(4, 4, 2.7, 0, 0, 4, 4)).toBe(false);
    expect(circleHitsRect(4, 4, 2.9, 0, 0, 4, 4)).toBe(true);
  });
  it("handles thin rects", () => expect(circleHitsRect(0, 10, 9.5, 0, 0, 30, 1)).toBe(true));
});

describe("group footprints", () => {
  const city = generateCity(20261010);
  const fps = groupFootprints(city);

  it("tags every piece with a valid group, and every group has a footprint", () => {
    const all = [...city.bodies, ...city.trims, ...city.roofs, ...city.shopfronts, ...city.awnings, ...city.acs, ...city.tanks, ...city.antennas, ...city.lights, ...city.landmarks];
    for (const x of all) {
      expect(x.g).toBeGreaterThanOrEqual(1);
      expect(x.g).toBeLessThanOrEqual(city.groups);
    }
    for (let g = 1; g <= city.groups; g++) expect(fps[g], `group ${g}`).not.toBeNull();
  });

  it("a crash on a block hits its buildings, a crash in an empty junction hits nothing", () => {
    expect(groupsInCircle(fps, -20, 20, 5).length).toBeGreaterThan(0); // hero tower
    expect(groupsInCircle(fps, 0, 0, 3)).toEqual([]); // road junction, nearest building 7 m away
    expect(groupsInCircle(fps, 20, 20, 10)).toEqual([]); // reserved park cell
  });

  it("a bigger circle hits a superset", () => {
    const small = groupsInCircle(fps, 60, 60, 10);
    const big = groupsInCircle(fps, 60, 60, 40);
    for (const g of small) expect(big).toContain(g);
    expect(big.length).toBeGreaterThan(small.length);
  });

  it("the Shard is one group with its light", () => {
    const shard = city.landmarks.find((l) => l.kind === "shard")!;
    expect(groupsInCircle(fps, shard.x, shard.z, 2)).toEqual([shard.g]);
    expect(city.lights.some((l) => l.g === shard.g)).toBe(true);
  });
});

describe("collapse timeline", () => {
  it("starts upright, sinks monotonically and finishes at COLLAPSE_S", () => {
    expect(collapsePose(0).sink).toBe(0);
    expect(collapsePose(0).done).toBe(false);
    let prev = -1;
    for (let t = 0; t <= COLLAPSE_S; t += 0.05) {
      const p = collapsePose(t);
      expect(p.sink).toBeGreaterThanOrEqual(prev);
      prev = p.sink;
    }
    const end = collapsePose(COLLAPSE_S);
    expect(end.sink).toBe(1);
    expect(end.tilt).toBe(1);
    expect(end.shake).toBe(0);
    expect(end.done).toBe(true);
  });
  it("accelerates (drops more in the second half)", () => {
    const mid = collapsePose(COLLAPSE_S / 2).sink;
    expect(mid).toBeLessThan(0.5);
  });
});

describe("rebuild timeline", () => {
  it("goes 0 -> 1, monotonic, floor by floor", () => {
    const dur = 28;
    const floors = 10;
    expect(rebuildFraction(0, dur, floors)).toBe(0);
    expect(rebuildFraction(dur, dur, floors)).toBe(1);
    let prev = 0;
    let plateaus = 0;
    for (let t = 0.1; t < dur; t += 0.1) {
      const f = rebuildFraction(t, dur, floors);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      if (Math.abs(f - prev) < 1e-9) plateaus++;
      prev = f;
    }
    expect(plateaus).toBeGreaterThan(50); // it pauses between floors
    // a floor boundary is reached exactly at each step
    expect(rebuildFraction(dur * 0.3 + 1e-6, dur, floors)).toBeCloseTo(0.3, 3);
  });
  it("a whole zone finishes inside ~30-40 s", () => {
    for (let g = 1; g < 200; g++) {
      const { delay, dur } = rebuildSchedule(g);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay + dur).toBeLessThanOrEqual(REBUILD_STAGGER_S + REBUILD_MAX_S);
      expect(delay + dur).toBeGreaterThanOrEqual(26);
    }
    expect(REBUILD_STAGGER_S + REBUILD_MAX_S).toBeLessThanOrEqual(40);
    expect(rebuildSchedule(5)).toEqual(rebuildSchedule(5));
  });
});
