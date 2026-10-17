import { describe, expect, it } from "vitest";
import { CapsuleGeometry, SphereGeometry, TorusGeometry } from "three";
import { buildGeometries } from "./Furniture";
import { beamGeometry, ferryGeometry, lighthouseGeometry, sailboatGeometry, speedboatGeometry } from "./Sea";

describe("prop geometries", () => {
  it("all build into single merged geometries", () => {
    const all = [...Object.values(buildGeometries()), ferryGeometry(), speedboatGeometry(), sailboatGeometry(), lighthouseGeometry(), beamGeometry()];
    for (const g of all) expect(g.getAttribute("position").count).toBeGreaterThan(0);
  });
  it("primitives used in cyclists are indexed (mergeable with boxes)", () => {
    for (const g of [new CapsuleGeometry(0.2, 0.5, 3, 6), new SphereGeometry(1, 8, 6), new TorusGeometry(1, 0.1, 5, 12)]) expect(g.index).not.toBeNull();
  });
});
