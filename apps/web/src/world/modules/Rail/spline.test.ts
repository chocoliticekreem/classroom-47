import { describe, expect, it } from "vitest";
import { buildSpline, crossings, easedProfile, offsetPoint, poseAt, projectS, type Pose } from "./spline";

const p: Pose = { x: 0, z: 0, h: 0 };

describe("track spline", () => {
  it("is the straight line for two points", () => {
    const sp = buildSpline([[0, 0], [0, 100]], 20);
    expect(sp.length).toBeCloseTo(100, 5);
    poseAt(sp, 50, p);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.z).toBeCloseTo(50, 5);
    expect(p.h).toBeCloseTo(0, 5); // facing +z
  });

  it("rounds a right-angle corner with the requested radius", () => {
    const R = 30;
    const sp = buildSpline([[0, 0], [0, 100], [100, 100]], R);
    // straight + quarter circle + straight: 2 * (100 - R) + pi R / 2
    expect(sp.length).toBeCloseTo(2 * (100 - R) + (Math.PI * R) / 2, 0);
    // the arc's mid point sits R (sqrt2 - 1) inside the corner
    poseAt(sp, 100 - R + (Math.PI * R) / 4, p);
    expect(Math.hypot(p.x - 0, p.z - 100)).toBeCloseTo(R * (Math.SQRT2 - 1), 0);
    // heading turns from +z to +x
    poseAt(sp, sp.length, p);
    expect(p.h).toBeCloseTo(Math.PI / 2, 2);
  });

  it("is continuous: samples are evenly spaced and the heading never jumps", () => {
    const sp = buildSpline([[-184, -333], [-184, -505], [-610, -505], [-610, -250]], [35, 60]);
    for (let i = 1; i < sp.xs.length - 1; i++) {
      const d = Math.hypot(sp.xs[i] - sp.xs[i - 1], sp.zs[i] - sp.zs[i - 1]);
      expect(d).toBeLessThan(sp.step + 1e-3);
      let dh = Math.abs(sp.hs[i] - sp.hs[i - 1]);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      expect(dh).toBeLessThan(sp.step / 30); // radius >= 30 m everywhere
    }
  });

  it("offsets to the left of the direction of travel", () => {
    const sp = buildSpline([[0, 0], [0, 100]], 20);
    // travelling +z, left (seen from above with -z up the screen... in three.js x/z) is +x
    offsetPoint(sp, 10, 2, p);
    expect(p.x).toBeCloseTo(2, 5);
    expect(p.z).toBeCloseTo(10, 5);
  });

  it("projects points back to their arc length", () => {
    const sp = buildSpline([[0, 0], [0, 100], [100, 100]], 30);
    for (const s of [5, 40, 90, 150]) {
      poseAt(sp, s, p);
      expect(projectS(sp, p.x, p.z)).toBeCloseTo(s, 0);
    }
  });

  it("finds where a road segment crosses the track", () => {
    const sp = buildSpline([[0, 0], [0, 100]], 20);
    const c = crossings(sp, -10, 40, 10, 40);
    expect(c).toHaveLength(1);
    expect(c[0].s).toBeCloseTo(40, 1);
    expect(c[0].u).toBeCloseTo(0.5, 2);
    expect(c[0].angle).toBeCloseTo(Math.PI / 2, 2);
    expect(crossings(sp, 5, 40, 10, 40)).toHaveLength(0);
  });

  it("eases a height profile through its keys", () => {
    const keys: [number, number][] = [[0, 8], [100, 8], [200, 0]];
    expect(easedProfile(keys, -5)).toBe(8);
    expect(easedProfile(keys, 100)).toBe(8);
    expect(easedProfile(keys, 150)).toBeCloseTo(4, 5);
    expect(easedProfile(keys, 250)).toBe(0);
    // flat at the keys (no kinks for the train to bump over)
    expect(easedProfile(keys, 101) - easedProfile(keys, 100)).toBeLessThan(0.01);
  });
});
