import { describe, expect, it } from "vitest";
import { Path, roundCorners, v3 } from "./path";

describe("Path", () => {
  it("measures arc length and samples by distance", () => {
    const p = new Path([v3(0, 0, 0), v3(10, 0, 0), v3(10, 0, 10)]);
    expect(p.length).toBeCloseTo(20);
    const o = v3(0, 0, 0);
    p.sample(5, o);
    expect(o).toEqual({ x: 5, y: 0, z: 0 });
    p.sample(15, o);
    expect(o.x).toBeCloseTo(10);
    expect(o.z).toBeCloseTo(5);
  });

  it("clamps outside the range", () => {
    const p = new Path([v3(0, 0, 0), v3(0, 4, 0)]);
    const o = v3(0, 0, 0);
    p.sample(-3, o);
    expect(o.y).toBe(0);
    p.sample(99, o);
    expect(o.y).toBe(4);
  });

  it("gives unit tangents", () => {
    const p = new Path([v3(0, 0, 0), v3(3, 4, 0)]);
    const t = v3(0, 0, 0);
    p.tangent(1, t);
    expect(t.x).toBeCloseTo(0.6);
    expect(t.y).toBeCloseTo(0.8);
  });

  it("drops duplicate points", () => {
    const p = new Path([v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0)]);
    expect(p.length).toBeCloseTo(1);
  });
});

describe("roundCorners", () => {
  it("keeps the end points and cuts the corner", () => {
    const pts = roundCorners([v3(0, 0, 0), v3(20, 0, 0), v3(20, 0, 20)], 5);
    expect(pts[0]).toEqual(v3(0, 0, 0));
    expect(pts[pts.length - 1]).toEqual(v3(20, 0, 20));
    // the sharp corner itself is not on the path any more
    expect(pts.some((p) => p.x === 20 && p.z === 0)).toBe(false);
    const path = new Path(pts);
    expect(path.length).toBeLessThan(40);
    expect(path.length).toBeGreaterThan(37);
  });

  it("clamps the radius to half the shorter segment", () => {
    const pts = roundCorners([v3(0, 0, 0), v3(4, 0, 0), v3(4, 0, 40)], 30);
    for (const p of pts) expect(p.z).toBeLessThanOrEqual(40);
    expect(new Path(pts).length).toBeGreaterThan(40);
  });
});
