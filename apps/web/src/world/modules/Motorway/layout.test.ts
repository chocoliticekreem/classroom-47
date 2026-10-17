import { describe, expect, it } from "vitest";
import { getNode } from "../../roads";
import { JUNCTION_GANTRIES, SOS, TREES, VIADUCT, VMS_GANTRIES, crossesRiver, nightFactor } from "./layout";

describe("motorway furniture layout", () => {
  it("junction gantry panels face traffic approaching the junction, over its (left-hand) carriageway", () => {
    expect(JUNCTION_GANTRIES.length).toBeGreaterThanOrEqual(10);
    for (const g of JUNCTION_GANTRIES) {
      const j = getNode(g.junction!.id);
      const tx = j.x - g.x, tz = j.z - g.z; // roughly the direction of travel
      for (const p of g.panels) {
        const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
        expect(nx * tx + nz * tz, g.junction!.id).toBeLessThan(0);
        // left of travel (tx, tz) in three.js is -(right) = (tz, -tx)
        expect((p.x - g.x) * tz + (p.z - g.z) * -tx, g.junction!.id).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(5.4);
      }
    }
  });

  it("has smart-motorway signs, SOS phones, trees and a viaduct over the river", () => {
    expect(VMS_GANTRIES.length).toBeGreaterThanOrEqual(3);
    for (const g of VMS_GANTRIES) expect(g.panels).toHaveLength(2);
    expect(SOS.length).toBeGreaterThan(10);
    expect(TREES.length).toBeGreaterThan(200);
    expect(VIADUCT.some((s) => crossesRiver({ x: s.ax, z: s.az }, { x: s.bx, z: s.bz }))).toBe(true);
  });

  it("night factor runs 0 by day to 1 at night", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(18)).toBeCloseTo(0.5);
  });
});
