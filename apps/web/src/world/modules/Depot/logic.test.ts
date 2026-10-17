import { describe, expect, it } from "vitest";
import { anyWithin, barrierStep, buildLegs, cycleDuration, nightFactor, sampleForklift, type ForkliftSample } from "./logic";

const pick = { x: -52.5, z: 283 };
const drop = { x: -44, z: 311 };
const legs = buildLegs({
  pick,
  pickFace: { x: -1, z: 0 },
  drop,
  dropFace: { x: 0, z: 1 },
  mids: [{ x: -50, z: 300 }],
});
const s: ForkliftSample = { x: 0, z: 0, heading: 0, loaded: false, lift: 0 };

describe("forklift cycle", () => {
  it("starts at the pick point facing the rack, carrying a load", () => {
    sampleForklift(legs, 4, 0, s);
    expect(s.x).toBeCloseTo(pick.x);
    expect(s.z).toBeCloseTo(pick.z);
    // facing -x => heading atan2(-1, 0) = -PI/2
    expect(Math.cos(s.heading - -Math.PI / 2)).toBeCloseTo(1);
    expect(s.loaded).toBe(true);
  });

  it("reaches the drop point facing into the bay", () => {
    // find a time where we're at the drop point
    const total = cycleDuration(legs, 4);
    let found = false;
    for (let t = 0; t < total; t += 0.05) {
      sampleForklift(legs, 4, t, s);
      if (Math.hypot(s.x - drop.x, s.z - drop.z) < 0.01) {
        expect(Math.cos(s.heading - 0)).toBeCloseTo(1); // facing +z
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("is empty on the way back and loops", () => {
    const total = cycleDuration(legs, 4);
    sampleForklift(legs, 4, total * 0.8, s);
    expect(s.loaded).toBe(false);
    sampleForklift(legs, 4, total + 0.001, s);
    expect(s.x).toBeCloseTo(pick.x, 1);
  });

  it("moves continuously (no teleport)", () => {
    const total = cycleDuration(legs, 4);
    sampleForklift(legs, 4, 0, s);
    let px = s.x;
    let pz = s.z;
    for (let t = 0.02; t < total * 2; t += 0.02) {
      sampleForklift(legs, 4, t, s);
      expect(Math.hypot(s.x - px, s.z - pz)).toBeLessThan(0.2);
      px = s.x;
      pz = s.z;
    }
  });
});

describe("barrier", () => {
  it("detects a vehicle within range", () => {
    const pts = [{ x: 100, z: 100 }, { x: 3, z: 260 }];
    expect(anyWithin(pts, 0, 255, 12)).toBe(true);
    expect(anyWithin([{ x: 30, z: 255 }], 0, 255, 12)).toBe(false);
  });

  it("eases toward open and closed", () => {
    let a = 0;
    for (let i = 0; i < 100; i++) a = barrierStep(a, true, 0.05);
    expect(a).toBeCloseTo(1);
    for (let i = 0; i < 100; i++) a = barrierStep(a, false, 0.05);
    expect(a).toBeCloseTo(0);
  });
});

describe("nightFactor", () => {
  it("is 0 by day, 1 at night, ramps between", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(2)).toBe(1);
    expect(nightFactor(18.5)).toBeCloseTo(0.5);
    expect(nightFactor(6.5)).toBeCloseTo(0.5);
  });
});
