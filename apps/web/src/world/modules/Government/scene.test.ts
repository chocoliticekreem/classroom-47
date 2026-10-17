import { describe, expect, it } from "vitest";
import { buildGovernment, heliBodyGeometry, policeGeometry } from "./scene";
import { POLICE } from "./layout";

describe("government scene", () => {
  it("builds its merged geometry (a few draw calls) within a sane vertex budget", () => {
    const s = buildGovernment();
    let total = 0;
    for (const [k, g] of Object.entries(s)) {
      expect(g, k).not.toBeNull();
      const n = g!.getAttribute("position").count;
      for (const v of g!.getAttribute("position").array as Float32Array) expect(Number.isFinite(v)).toBe(true);
      total += n;
    }
    expect(total).toBeLessThan(400_000);
    expect(s.flags.getAttribute("aWave").count).toBe(s.flags.getAttribute("position").count);
    expect(s.jets.getAttribute("aJet").count).toBe(s.jets.getAttribute("position").count);
    expect(s.windows!.getAttribute("aLit").count).toBe(s.windows!.getAttribute("position").count);
  });

  it("gives every officer patrol attributes", () => {
    const g = policeGeometry();
    expect(g.getAttribute("aSeg").count).toBe(POLICE.length);
    expect(heliBodyGeometry().getAttribute("position").count).toBeGreaterThan(0);
  });
});
