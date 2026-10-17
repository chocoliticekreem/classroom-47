import { describe, expect, it } from "vitest";
import { newKits, type Kits } from "./kit";
import { build as police } from "./PoliceStation";
import { build as hospital } from "./Hospital";
import { build as yard } from "./MaintenanceYard";
import { build as park, buildDucks } from "./CentralPark";
import { buildStatic, buildWheel } from "./FerrisWheel";

const builds: Record<string, (k: Kits) => void> = { police, hospital, yard, park, buildDucks, buildStatic, buildWheel };

describe("landmark bakes", () => {
  for (const [name, b] of Object.entries(builds))
    it(`${name} bakes to valid vertex-coloured geometry inside its cell`, () => {
      const k = newKits();
      b(k);
      const solid = k.solid.build();
      expect(solid).not.toBeNull();
      const pos = solid!.getAttribute("position");
      expect(solid!.getAttribute("color").count).toBe(pos.count);
      expect(Number.isFinite(solid!.boundingSphere!.radius)).toBe(true);
      if (name !== "buildWheel") {
        solid!.computeBoundingBox();
        const bb = solid!.boundingBox!;
        expect(bb.min.x).toBeGreaterThanOrEqual(-14);
        expect(bb.max.x).toBeLessThanOrEqual(14);
        expect(bb.min.z).toBeGreaterThanOrEqual(-14);
        expect(bb.max.z).toBeLessThanOrEqual(14);
      }
      k.glow.build();
      k.glass.build();
    });
});
