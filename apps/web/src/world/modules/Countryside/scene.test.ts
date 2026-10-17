import { describe, expect, it } from "vitest";
import { buildCountryside, treeMatrices } from "./scene";

describe("buildCountryside", () => {
  it("builds the merged static mesh and tree instances without NaNs", () => {
    const b = buildCountryside();
    const pos = b.staticGeo.getAttribute("position");
    expect(pos.count).toBeGreaterThan(10000);
    expect(pos.count).toBeLessThan(500000);
    expect(b.flatGeo.getAttribute("position").count).toBeLessThan(400000);
    expect(b.trees.length).toBeLessThanOrEqual(8000);
    expect(b.pastures.length).toBeGreaterThanOrEqual(5);
    expect(b.staticGeo.getAttribute("color").count).toBe(pos.count);
    expect(Number.isFinite(b.staticGeo.boundingSphere!.radius)).toBe(true);
    const m = treeMatrices(b.trees);
    expect(m.trunk.length).toBe(b.trees.length * 16);
    expect(m.crown.reduce((n, a) => n + a.length, 0)).toBe(b.trees.length * 16);
    expect(m.crown.every((a, s) => a.length / 16 === m.crownColor[s].length)).toBe(true);
    expect(m.trunk.every(Number.isFinite)).toBe(true);
    expect(b.turbines.length).toBeGreaterThan(3);
  });
});
