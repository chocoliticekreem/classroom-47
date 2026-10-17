import { describe, expect, it } from "vitest";
import { applyWeather, blendParams, blendToward, buildSchedule, createWeatherState, easeFactor, followCycle, sampleWeather, snapToTexel } from "./weather";
import { createSkyState, sampleSky } from "./skyState";
import { Vector3 } from "three";

describe("weather schedule", () => {
  it("is deterministic for a seed", () => {
    const a = buildSchedule(42);
    const b = buildSchedule(42);
    expect(a.segments.map((s) => s.kind)).toEqual(b.segments.map((s) => s.kind));
    expect(buildSchedule(7).segments.map((s) => s.dur)).not.toEqual(a.segments.map((s) => s.dur));
  });

  it("cycles clear -> overcast -> wet -> overcast every few minutes", () => {
    const s = buildSchedule(1);
    for (let i = 0; i < s.segments.length; i += 4) {
      expect(s.segments[i].kind).toBe("clear");
      expect(s.segments[i + 1].kind).toBe("overcast");
      expect(["drizzle", "rain", "storm"]).toContain(s.segments[i + 2].kind);
      expect(s.segments[i + 3].kind).toBe("overcast");
      const cycle = s.segments.slice(i, i + 4).reduce((n, x) => n + x.dur, 0);
      expect(cycle).toBeGreaterThan(120);
      expect(cycle).toBeLessThan(330);
    }
  });

  it("includes drizzle and a storm somewhere in the loop", () => {
    const kinds = buildSchedule(1).segments.map((s) => s.kind);
    expect(kinds).toContain("drizzle");
    expect(kinds).toContain("storm");
  });

  it("starts clear and dry", () => {
    const w = createWeatherState();
    sampleWeather(buildSchedule(1), 0, w);
    expect(w.weather).toBe("clear");
    expect(w.rain).toBe(0);
    expect(w.cover).toBeLessThan(0.3);
  });

  it("changes smoothly and loops", () => {
    const s = buildSchedule(3);
    const a = createWeatherState();
    const b = createWeatherState();
    let sawRain = false;
    for (let t = 0; t < s.period * 1.5; t += 0.5) {
      sampleWeather(s, t, a);
      sampleWeather(s, t + 0.5, b);
      expect(Math.abs(a.rain - b.rain)).toBeLessThan(0.1);
      expect(Math.abs(a.cover - b.cover)).toBeLessThan(0.1);
      if (a.rain > 0.5) sawRain = true;
    }
    expect(sawRain).toBe(true);
  });

  it("reports wet weather while it rains", () => {
    const s = buildSchedule(5);
    const w = createWeatherState();
    const wet = s.segments.find((x) => x.kind === "rain" || x.kind === "storm")!;
    sampleWeather(s, wet.start + wet.dur / 2, w);
    expect(w.weather).toBe(wet.kind);
    expect(w.rain).toBeGreaterThan(0.6);
  });
});

describe("snapToTexel", () => {
  it("keeps the point within half a texel and is stable for tiny moves", () => {
    const dir = new Vector3(0.4, 0.8, 0.3).normalize();
    const out1 = new Vector3();
    const out2 = new Vector3();
    snapToTexel(new Vector3(100.01, 0, -50), dir, 0.5, out1);
    snapToTexel(new Vector3(100.02, 0, -50), dir, 0.5, out2);
    // only the depth along the light may change (that doesn't move texels)
    const diff = out2.clone().sub(out1);
    diff.addScaledVector(dir, -diff.dot(dir));
    expect(diff.length()).toBeLessThan(1e-9);
    expect(out1.distanceTo(new Vector3(100.01, 0, -50))).toBeLessThan(0.5);
  });
});

describe("applyWeather", () => {
  it("dims the sun, greys the sky and hides stars in a storm, but stays readable", () => {
    const clear = createSkyState();
    const storm = createSkyState();
    sampleSky(12, clear);
    sampleSky(12, storm);
    applyWeather(storm, { weather: "storm", cover: 1, rain: 1, storm: 1 });
    expect(storm.keyIntensity).toBeLessThan(clear.keyIntensity * 0.4);
    const sat = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(sat(storm.zenith)).toBeLessThan(sat(clear.zenith));
    sampleSky(1, storm);
    applyWeather(storm, { weather: "storm", cover: 1, rain: 1, storm: 1 });
    expect(storm.stars).toBe(0);
    expect(storm.hemiIntensity + storm.keyIntensity).toBeGreaterThan(0.5);
  });
  it("leaves a clear sky alone", () => {
    const a = createSkyState();
    const b = createSkyState();
    sampleSky(18, a);
    sampleSky(18, b);
    applyWeather(b, { weather: "clear", cover: 0.12, rain: 0, storm: 0 });
    expect(b.zenith.equals(a.zenith)).toBe(true);
    expect(b.keyIntensity).toBeCloseTo(a.keyIntensity);
  });
});

describe("weather override blending", () => {
  it("blendToward moves a fraction of the way and labels the kind", () => {
    const s = createWeatherState();
    blendToward(s, "storm", 0.5);
    expect(s.weather).toBe("storm");
    expect(s.cover).toBeCloseTo(0.5);
    expect(s.rain).toBeCloseTo(0.5);
    expect(s.storm).toBeCloseTo(0.5);
    blendToward(s, "storm", 1);
    expect(s).toMatchObject({ cover: 1, rain: 1, storm: 1 });
  });

  it("clamps k to 0..1", () => {
    const s = createWeatherState();
    blendToward(s, "rain", 5);
    expect(s.rain).toBeCloseTo(0.8);
    blendToward(s, "clear", -1);
    expect(s.rain).toBeCloseTo(0.8);
  });

  it("eases to ~98% of the target in about 2 s at 60 fps and holds it", () => {
    const s = createWeatherState();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) blendToward(s, "rain", easeFactor(dt, 2));
    expect(s.rain).toBeGreaterThan(0.8 * 0.97);
    expect(s.rain).toBeLessThanOrEqual(0.8);
    for (let i = 0; i < 600; i++) blendToward(s, "rain", easeFactor(dt, 2));
    expect(s.rain).toBeCloseTo(0.8, 5);
    expect(s.cover).toBeCloseTo(0.95, 5);
  });

  it("blendParams eases toward a sampled cycle state without changing its label", () => {
    const s = createWeatherState();
    s.weather = "storm";
    blendParams(s, { cover: 1, rain: 0, storm: 0 }, 0.25);
    expect(s.cover).toBeCloseTo(0.25);
    expect(s.weather).toBe("storm");
  });

  it("followCycle eases onto the cycle and takes its label", () => {
    const s = createWeatherState();
    const c = { weather: "rain" as const, cover: 0.95, rain: 0.8, storm: 0 };
    followCycle(s, c, 1);
    expect(s).toEqual(c);
  });

  it("easeFactor is frame-rate independent", () => {
    const one = easeFactor(0.1, 2);
    const ten = 1 - (1 - easeFactor(0.01, 2)) ** 10;
    expect(ten).toBeCloseTo(one, 10);
    expect(easeFactor(0.1, 0)).toBe(1);
  });
});
