import { describe, expect, it } from "vitest";
import { ZONES } from "../../config";
import { PAD_Y, buildIndustrial } from "./scene";

describe("industrial scene build", () => {
  const S = buildIndustrial();

  it("produces every merged geometry, with finite positions", () => {
    for (const [name, g] of Object.entries(S)) {
      const p = g.getAttribute("position");
      expect(p.count, name).toBeGreaterThan(0);
      for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i]), name).toBe(true);
    }
  });

  it("keeps the static estate inside its zone and above y = -0.6", () => {
    const Z = ZONES.industrial;
    for (const name of ["solid", "shells", "windows", "glow", "ground", "fence", "pools", "aviation"] as const) {
      const b = S[name].boundingBox!;
      expect(b.min.x, name).toBeGreaterThanOrEqual(Z.minX - 12.5); // light pools may spill a little past the edge
      expect(b.max.x, name).toBeLessThanOrEqual(Z.maxX + 1);
      expect(b.min.z, name).toBeGreaterThanOrEqual(Z.minZ - 1);
      expect(b.max.z, name).toBeLessThanOrEqual(Z.maxZ + 1);
      expect(b.min.y, name).toBeGreaterThanOrEqual(-0.6);
    }
  });

  it("lifts yard pads clear of Ground's zone paint", () => {
    const b = S.ground.boundingBox!;
    expect(b.min.y).toBeCloseTo(PAD_Y, 5);
    expect(b.max.y).toBeCloseTo(PAD_Y, 5);
    expect(PAD_Y).toBeGreaterThanOrEqual(0.08);
  });

  it("stays a reasonable size", () => {
    const verts = Object.values(S).reduce((n, g) => n + g.getAttribute("position").count, 0);
    expect(verts).toBeLessThan(400_000);
  });
});
