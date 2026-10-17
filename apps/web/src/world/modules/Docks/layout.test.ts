import { describe, expect, it } from "vitest";
import { ZONES, WATER_X } from "../../config";
import {
  CRANES,
  CRANE_HOME_X,
  CRANE_LEG_X,
  CRANE_LEG_HALF_Z,
  CRANE_PERIOD,
  CONTAINER,
  LIGHT_TOWERS,
  SHEDS,
  STRADDLE_HALF,
  STRADDLE_PERIOD,
  craneAt,
  nightFactor,
  rectClearOfRoads,
  roadClearance,
  straddleAt,
  yardSlots,
} from "./layout";

const z = ZONES.docks;

describe("roadClearance", () => {
  it("is negative on a dock road and positive well away from it", () => {
    expect(roadClearance(260, 0)).toBeLessThan(0); // dock_gate
    expect(roadClearance(320, 0)).toBeLessThan(0); // dock_quay
    expect(roadClearance(335, -75)).toBeGreaterThan(5);
  });
});

describe("static layout keeps roads clear and stays in the zone", () => {
  it("yard container stacks", () => {
    const slots = yardSlots();
    expect(slots.length).toBeGreaterThan(60);
    for (const s of slots) {
      const hw = CONTAINER.w / 2, hd = (s.short ? CONTAINER.l / 2 : CONTAINER.l) / 2;
      expect(rectClearOfRoads(s.x, s.z, hw, hd, 1.5)).toBe(true);
      expect(s.x - hw).toBeGreaterThanOrEqual(z.minX);
      expect(s.x + hw).toBeLessThanOrEqual(WATER_X);
      expect(s.z - hd).toBeGreaterThanOrEqual(z.minZ);
      expect(s.z + hd).toBeLessThanOrEqual(z.maxZ);
    }
  });

  it("crane legs and sheds and light towers", () => {
    for (const c of CRANES)
      for (const lx of CRANE_LEG_X)
        for (const sz of [-1, 1]) expect(rectClearOfRoads(lx, c.z + sz * CRANE_LEG_HALF_Z, 1, 1, 1.5)).toBe(true);
    for (const s of SHEDS) expect(rectClearOfRoads(s.x, s.z, s.w / 2, s.d / 2, 2)).toBe(true);
    for (const t of LIGHT_TOWERS) expect(rectClearOfRoads(t.x, t.z, 1, 1, 1.5)).toBe(true);
  });

  it("straddle carrier loop never touches a road", () => {
    for (let t = 0; t < STRADDLE_PERIOD; t += 0.25) {
      const p = straddleAt(t);
      expect(roadClearance(p.x, p.z)).toBeGreaterThan(STRADDLE_HALF.r + 1);
    }
  });
});

describe("craneAt", () => {
  it("loops seamlessly and never teleports the container", () => {
    const c = CRANES[0];
    const dt = 0.05;
    let prev = craneAt(0, c);
    expect(prev.trolleyX).toBeCloseTo(CRANE_HOME_X);
    for (let t = dt; t <= CRANE_PERIOD * 2 + 1e-9; t += dt) {
      const cur = craneAt(t, c);
      expect(Math.abs(cur.trolleyX - prev.trolleyX)).toBeLessThan(1.5);
      expect(Math.abs(cur.spreaderY - prev.spreaderY)).toBeLessThan(1.5);
      expect(Math.abs(cur.boxX - prev.boxX)).toBeLessThan(1.5);
      expect(Math.abs(cur.boxY - prev.boxY)).toBeLessThan(1.5);
      if (cur.carrying) {
        expect(cur.boxX).toBeCloseTo(cur.trolleyX);
        expect(cur.boxY + CONTAINER.h).toBeCloseTo(cur.spreaderY);
      }
      prev = cur;
    }
  });

  it("moves the container between ship and apron", () => {
    const c = CRANES[0];
    const xs = new Set<string>();
    for (let t = 0; t < CRANE_PERIOD; t += 0.5) {
      const s = craneAt(t, c);
      if (!s.carrying) xs.add(s.boxX > WATER_X ? "ship" : "apron");
    }
    expect(xs).toEqual(new Set(["ship", "apron"]));
  });
});

describe("straddleAt", () => {
  it("is periodic and continuous", () => {
    const a = straddleAt(0), b = straddleAt(STRADDLE_PERIOD);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.z).toBeCloseTo(b.z);
    let prev = a;
    for (let t = 0.05; t < STRADDLE_PERIOD; t += 0.05) {
      const cur = straddleAt(t);
      expect(Math.hypot(cur.x - prev.x, cur.z - prev.z)).toBeLessThan(1);
      expect(Math.hypot(cur.boxX - prev.boxX, cur.boxZ - prev.boxZ)).toBeLessThan(1);
      prev = cur;
    }
  });
});

describe("nightFactor", () => {
  it("is 0 at noon and 1 at midnight", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(23)).toBe(1);
  });
});
