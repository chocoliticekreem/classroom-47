import { describe, expect, it } from "vitest";
import { MODIFIERS, SCENARIOS, sceneCoverage, type Modifier, type Scene } from "../../scenarios";
import { MODIFIER_CHIP, SCENES } from "./scenes";

describe("scene table", () => {
  it("has a spec for every scene used by the 50 cases", () => {
    for (const s of SCENARIOS) expect(SCENES[s.scene], s.scene).toBeDefined();
    expect(Object.keys(sceneCoverage()).every((k) => k in SCENES)).toBe(true);
  });

  it("covers all 48 scene types with distinct signs", () => {
    const scenes = Object.keys(SCENES) as Scene[];
    expect(scenes).toHaveLength(48);
    expect(new Set(scenes.map((s) => SCENES[s].sign)).size).toBe(48);
  });

  it("puts each scene's kit where its cases happen", () => {
    for (const s of SCENARIOS) {
      const kit = SCENES[s.scene].kit;
      if (s.where === "office") expect(kit).toBe("office");
      if (s.where === "depot") expect(kit).toBe("depot");
      if (s.where === "docks") expect(kit).toBe("docks");
      if (s.where === "road") expect(kit).toBe("road");
    }
  });

  it("has a chip for every modifier", () => {
    for (const m of Object.keys(MODIFIERS) as Modifier[]) expect(MODIFIER_CHIP[m]).toBeTruthy();
  });
});
