import { describe, expect, it } from "vitest";
import {
  billboardGeometry, binGeometry, bollardGeometry, carGeometry, lampGeometry, neonPylonGeometry, shrubGeometry, signPostGeometry, treeGeometry,
} from "./geo";
import { buildStreetscape } from "./placement";
import { LED_CORNER, neonFaces, screenPlacement } from "./scene";
import { nightness } from "./night";

describe("streetscape scene helpers", () => {
  it("every prop geometry merges into one vertex-coloured geometry", () => {
    for (const g of [treeGeometry(), lampGeometry(), binGeometry(), bollardGeometry(), carGeometry(), signPostGeometry(), neonPylonGeometry(), shrubGeometry(), billboardGeometry()]) {
      expect(g.getAttribute("position").count).toBeGreaterThan(0);
      expect(g.getAttribute("color")).toBeDefined();
    }
  });

  it("LED screens hang just outside the corner block, facing the junction g_1_-1 at (40, -40)", () => {
    for (const face of ["west", "south"] as const) {
      const p = screenPlacement({ face, along: 8 });
      // in front of the buildable edge (x <= 47 on the west face, z >= -47 on the south face), still on the pavement
      if (face === "west") expect(p.x).toBeLessThan(LED_CORNER.x);
      else expect(p.z).toBeGreaterThan(LED_CORNER.z);
      expect(Math.min(Math.abs(p.x - 40), Math.abs(p.z + 40))).toBeGreaterThan(4); // off the carriageway (half width 4)
      // face normal points towards the junction side
      const nx = Math.sin(p.yaw);
      const nz = Math.cos(p.yaw);
      expect(nx * (40 - p.x) + nz * (-40 - p.z)).toBeGreaterThan(0);
    }
  });

  it("shop neon sits on the facade line above the awnings, facing the street", () => {
    const faces = neonFaces(buildStreetscape().props);
    expect(faces.length).toBeGreaterThan(10);
    for (const f of faces) {
      expect(f.y).toBeGreaterThan(4);
      expect(f.w / f.h).toBeCloseTo(4, 1);
    }
  });

  it("night ramps from day to night", () => {
    expect(nightness(12)).toBe(0);
    expect(nightness(23)).toBe(1);
    expect(nightness(2)).toBe(1);
    expect(nightness(18.5)).toBeGreaterThan(0);
  });

  it("builds the placement quickly enough for page load", () => {
    const t0 = performance.now();
    buildStreetscape();
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
