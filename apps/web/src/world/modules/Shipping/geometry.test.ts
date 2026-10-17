import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CLASSES, FLEET, HATCH_TOP, shipLayout } from "./fleet";
import { hullHalfWidth, pilotGeometry, shipGeometry, tugGeometry, windowGeometry } from "./geometry";

function bbox(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe("ship geometry", () => {
  it("every class builds a closed-ish hull of the right size, bow at +z", () => {
    for (const spec of FLEET) {
      const cls = CLASSES[spec.cls];
      const L = shipLayout(cls);
      const g = shipGeometry(cls, L, spec.livery);
      const b = bbox(g);
      expect(b.max.z).toBeGreaterThan(L.half - 1); // bow (bulb pokes a bit further)
      expect(b.max.z).toBeLessThan(L.half + 3);
      expect(b.min.z).toBeGreaterThan(-L.half - 1);
      expect(b.max.x).toBeLessThan(L.beam / 2 + 2); // wing bridges overhang slightly
      expect(b.max.y).toBeGreaterThan(L.bridgeY + 8); // mast above the bridge
      const pos = g.getAttribute("position");
      expect(pos.count % 3).toBe(0);
      for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      expect(windowGeometry(cls, L).getAttribute("position").count).toBeGreaterThan(0);
    }
  });
  it("hull sides face outward and the transom stays wide", () => {
    const cls = CLASSES.panamax;
    const L = shipLayout(cls);
    expect(hullHalfWidth(L, 0, 2)).toBeCloseTo(13, 5);
    expect(hullHalfWidth(L, -L.half, 4)).toBeGreaterThan(8);
    expect(hullHalfWidth(L, L.half - 0.5, 4)).toBeLessThan(3);
    expect(hullHalfWidth(L, -L.half + 2, -6)).toBe(0); // cut away under the stern
    const g = shipGeometry(cls, L, FLEET[0].livery);
    const pos = g.getAttribute("position"), nor = g.getAttribute("normal");
    let out = 0, inn = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(z) < 40 && y > -3 && y < 3.5 && Math.abs(Math.abs(x) - 13) < 0.01) {
        if (nor.getX(i) * Math.sign(x) > 0.5) out++;
        else inn++;
      }
    }
    expect(out).toBeGreaterThan(20);
    expect(inn).toBe(0);
  });
  it("containers sit on the hatch covers at the contract deck height", () => {
    expect(HATCH_TOP).toBe(5.5);
  });
  it("tug and pilot boat face +z and float", () => {
    const t = bbox(tugGeometry());
    expect(t.max.z).toBeGreaterThan(13);
    expect(t.min.z).toBeGreaterThan(-15);
    expect(t.min.y).toBeLessThan(-1);
    const p = bbox(pilotGeometry());
    expect(p.max.z).toBeGreaterThan(8);
  });
});
