import { describe, expect, it } from "vitest";
import { ZONES } from "../../config";
import { allRoadSegments, buildLayout, CLEARANCE, glowForHour, pointSegDist, type Part } from "./layout";

/** Points on the outline of a part's footprint (rotated by ry; tilt ignored, it only shrinks the footprint). */
function outline(p: Part): [number, number][] {
  const hx = p.sx / 2;
  const hz = p.sz / 2;
  const c = Math.cos(p.ry);
  const s = Math.sin(p.ry);
  const pts: [number, number][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = -hx + (2 * hx * i) / steps;
    const b = -hz + (2 * hz * i) / steps;
    for (const [lx, lz] of [[a, -hz], [a, hz], [-hx, b], [hx, b]] as const) {
      pts.push([p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
    }
  }
  return pts;
}

describe("suburbs layout", () => {
  const layout = buildLayout();
  const roads = allRoadSegments();

  it("is deterministic for a seed", () => {
    const again = buildLayout();
    expect(again.parts.length).toBe(layout.parts.length);
    expect(again.parts[123]).toEqual(layout.parts[123]);
  });

  it("builds plenty of houses plus the specials", () => {
    const bodies = layout.parts.filter((p) => p.pool === "body").length;
    expect(bodies).toBeGreaterThan(40);
    expect(layout.signs.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every part inside the suburbs zone", () => {
    const z = ZONES.suburbs;
    for (const p of layout.parts)
      for (const [x, zz] of outline(p)) {
        expect(x).toBeGreaterThanOrEqual(z.minX - 0.01);
        expect(x).toBeLessThanOrEqual(z.maxX + 0.01);
        expect(zz).toBeGreaterThanOrEqual(z.minZ - 0.01);
        expect(zz).toBeLessThanOrEqual(z.maxZ + 0.01);
      }
  });

  it(`keeps ${CLEARANCE} m clear of every road centre line`, () => {
    let worst = Infinity;
    let worstPart: Part | null = null;
    for (const p of layout.parts)
      for (const [x, z] of outline(p))
        for (const s of roads) {
          const d = pointSegDist(x, z, s);
          if (d < worst) {
            worst = d;
            worstPart = p;
          }
        }
    expect(worst, JSON.stringify(worstPart)).toBeGreaterThanOrEqual(CLEARANCE - 0.01);
  });

  it("glows at night only", () => {
    expect(glowForHour(13)).toBe(0);
    expect(glowForHour(23.5)).toBe(1);
    expect(glowForHour(2)).toBe(1);
    expect(glowForHour(19.2)).toBeGreaterThan(0);
  });
});
