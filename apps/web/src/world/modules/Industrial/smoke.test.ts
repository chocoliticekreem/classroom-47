import { describe, expect, it } from "vitest";
import { WIND, ZONES, inBox } from "../../config";
import { CRANE_DROP_YAW, CRANE_PERIOD, CRANE_PICK_YAW, STEEL, aviationOn, craneAt, furnaceFlicker, nightFactor } from "./layout";
import {
  EMITTERS,
  SMOKE_FRAGMENT,
  SMOKE_VERTEX,
  buildParticles,
  buildSparks,
  particleAt,
  sparkAt,
  type ParticleState,
} from "./smoke";

const st = (): ParticleState => ({ x: 0, y: 0, z: 0, size: 0, alpha: 0, age: 0 });

describe("smoke spawn math", () => {
  const ps = buildParticles();

  it("is deterministic and within budget", () => {
    expect(buildParticles()).toEqual(ps);
    expect(ps.length).toBeGreaterThan(600);
    expect(ps.length).toBeLessThan(1400);
  });

  it("emits from stack tops inside the estate", () => {
    for (const e of EMITTERS) {
      expect(inBox(ZONES.industrial, e.pos[0], e.pos[2]), e.name).toBe(true);
      expect(e.pos[1]).toBeGreaterThan(25);
      expect(e.top).toBeGreaterThanOrEqual(60);
      expect(e.top).toBeLessThanOrEqual(120);
    }
  });

  it("starts at the spawn point with zero opacity", () => {
    for (const p of ps.slice(0, 50)) {
      // time chosen so age = 0
      const s = particleAt(p, -p.phase * p.life, st());
      expect(s.age).toBeCloseTo(0, 6);
      expect(Math.hypot(s.x - p.spawn[0], s.z - p.spawn[2])).toBeLessThan(1.5);
      expect(s.y).toBeCloseTo(p.spawn[1], 3);
      expect(s.alpha).toBe(0);
    }
  });

  it("rises to the plume height (60-120 m) and drifts downwind", () => {
    const w = Math.hypot(WIND[0], WIND[1]);
    for (const p of ps) {
      const s = particleAt(p, p.life * 0.6 - p.phase * p.life, st());
      expect(s.y).toBeGreaterThan(p.spawn[1]);
      expect(s.y).toBeLessThan(135);
      const dx = s.x - p.spawn[0];
      const dz = s.z - p.spawn[2];
      // displacement points along the wind (blowing from the SE towards the NW, over downtown)
      expect((dx * WIND[0] + dz * WIND[1]) / w).toBeGreaterThan(0);
    }
  });

  it("long trails reach over downtown and fade out at 600-900 m", () => {
    const trails = ps.filter((p) => p.life > 60 && p.spread >= 1);
    expect(trails.length).toBeGreaterThan(200);
    for (const p of trails) {
      const end = particleAt(p, p.life * 0.999 - p.phase * p.life, st());
      expect(end.alpha).toBeLessThan(0.01);
      const d = Math.hypot(end.x - p.spawn[0], end.z - p.spawn[2]);
      expect(d, `trail end ${d}`).toBeGreaterThan(500);
      expect(d).toBeLessThan(950);
      // where it starts fading it is past 300 m and still visible
      const mid = particleAt(p, p.life * p.fadeOut - p.phase * p.life, st());
      expect(mid.alpha).toBeGreaterThan(0.1);
    }
    // the power station plume passes over the city centre (within ~120 m of the origin)
    const power = trails.filter((p) => p.spawn[0] < 200 && p.spawn[2] < 480);
    let closest = Infinity;
    for (const p of power)
      for (let u = 0; u < 1; u += 0.02) {
        const s = particleAt(p, u * p.life - p.phase * p.life, st());
        closest = Math.min(closest, Math.hypot(s.x, s.z));
      }
    expect(closest).toBeLessThan(120);
  });

  it("grows as it disperses", () => {
    const p = ps[0];
    const a = particleAt(p, 1 - p.phase * p.life, st()).size;
    const b = particleAt(p, p.life * 0.9 - p.phase * p.life, st()).size;
    expect(b).toBeGreaterThan(a * 2);
  });

  it("shader declares every attribute it reads", () => {
    for (const a of ["aSpawn", "aLife", "aShape", "aFade", "aSeed", "aColor", "aHaze"]) expect(SMOKE_VERTEX).toContain(a);
    expect(SMOKE_FRAGMENT).toContain("fog_fragment");
  });

  it("sparks arc up from the pour and land", () => {
    expect(inBox(ZONES.industrial, STEEL.pour[0], STEEL.pour[2])).toBe(true);
    const o: [number, number, number] = [0, 1, 0];
    for (const s of buildSparks()) {
      const peak = sparkAt(s, o, s.vel[1] / 9.8 - s.phase * s.life);
      if (peak.age < s.life) expect(peak.y).toBeGreaterThan(1);
      const late = sparkAt(s, o, s.life * 0.999 - s.phase * s.life);
      expect(late.y).toBeGreaterThanOrEqual(0.05);
    }
  });
});

describe("estate timing helpers", () => {
  it("night factor", () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(23)).toBe(1);
    expect(nightFactor(18)).toBeCloseTo(0.5);
  });
  it("aviation lights blink", () => {
    expect(aviationOn(0.1)).toBe(true);
    expect(aviationOn(0.8)).toBe(false);
  });
  it("furnace flicker stays in range", () => {
    for (let t = 0; t < 30; t += 0.07) {
      expect(furnaceFlicker(t)).toBeGreaterThan(0.55);
      expect(furnaceFlicker(t)).toBeLessThan(1.15);
    }
  });
  it("scrap crane picks at the pile and drops at the crusher, carrying in between", () => {
    const s = { yaw: 0, cable: 0, carrying: false };
    craneAt(6, s);
    expect(s.yaw).toBeCloseTo(CRANE_PICK_YAW);
    expect(s.carrying).toBe(true);
    craneAt(11.8, s);
    expect(s.yaw).toBeCloseTo(CRANE_DROP_YAW);
    expect(s.carrying).toBe(true);
    craneAt(14, s);
    expect(s.carrying).toBe(false);
    craneAt(CRANE_PERIOD + 6, s);
    expect(s.carrying).toBe(true);
  });
});
