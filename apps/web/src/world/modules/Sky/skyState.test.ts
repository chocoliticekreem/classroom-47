import { describe, expect, it } from "vitest";
import { advanceHour, createGrade, createSkyState, gradeFor, sampleSky, sunDirection, GAME_SECONDS_PER_HOUR } from "./skyState";

describe("advanceHour", () => {
  it("runs nights faster and honours the HUD time scale", () => {
    expect(advanceHour(23, 20)).toBeCloseTo(2); // night: 3x
    expect(advanceHour(10, 20, 10)).toBeCloseTo(20); // day at 10x
  });
  it("advances 1 game hour per 20 real seconds", () => {
    expect(GAME_SECONDS_PER_HOUR).toBe(20);
    expect(advanceHour(10, 20)).toBeCloseTo(11);
    expect(advanceHour(10, 5)).toBeCloseTo(10.25);
  });
  it("wraps around midnight", () => {
    expect(advanceHour(23.9, 4)).toBeCloseTo(0.5); // 4 s at night (3x) = 0.6 h
  });
});

describe("sunDirection", () => {
  it("is high at noon and below the horizon at midnight", () => {
    const s = createSkyState();
    sunDirection(12, s.sunDir);
    expect(s.sunDir.y).toBeGreaterThan(0.8);
    sunDirection(0, s.sunDir);
    expect(s.sunDir.y).toBeLessThan(0);
  });
  it("rises in the east (+x) and sets in the west (-x)", () => {
    const s = createSkyState();
    sunDirection(7, s.sunDir);
    expect(s.sunDir.x).toBeGreaterThan(0);
    sunDirection(19, s.sunDir);
    expect(s.sunDir.x).toBeLessThan(0);
  });
  it("moves continuously through the day and night", () => {
    const a = createSkyState();
    const b = createSkyState();
    for (let h = 0; h < 24; h += 0.05) {
      sunDirection(h, a.sunDir);
      sunDirection(h + 0.05, b.sunDir);
      expect(a.sunDir.distanceTo(b.sunDir)).toBeLessThan(0.05);
    }
    sunDirection(1, a.sunDir);
    expect(a.sunDir.y).toBeLessThan(-0.5); // deep below the horizon in the small hours
  });
  it("is unit length", () => {
    const s = createSkyState();
    for (let h = 0; h < 24; h += 0.7) {
      sunDirection(h, s.sunDir);
      expect(s.sunDir.length()).toBeCloseTo(1);
    }
  });
});

describe("sampleSky", () => {
  it("is blue by day, warm at golden hour, dark navy at night", () => {
    const s = createSkyState();
    sampleSky(12, s);
    expect(s.zenith.b).toBeGreaterThan(s.zenith.r);
    expect(s.stars).toBeLessThan(0.01);

    sampleSky(19.2, s);
    expect(s.horizon.r).toBeGreaterThan(s.horizon.b);

    sampleSky(1, s);
    expect(s.zenith.r + s.zenith.g + s.zenith.b).toBeLessThan(0.3);
    expect(s.stars).toBeGreaterThan(0.9);
  });
  it("never goes pitch black: ambient + key light stay readable at night", () => {
    const s = createSkyState();
    for (let h = 0; h < 24; h += 0.25) {
      sampleSky(h, s);
      expect(s.hemiIntensity + s.keyIntensity).toBeGreaterThan(0.5);
      expect(s.keyDir.y).toBeGreaterThan(0.1); // the shadow light is always above the horizon
    }
  });
  it("is continuous across midnight", () => {
    const a = createSkyState();
    const b = createSkyState();
    sampleSky(23.999, a);
    sampleSky(0, b);
    expect(Math.abs(a.zenith.r - b.zenith.r)).toBeLessThan(0.01);
    expect(Math.abs(a.hemiIntensity - b.hemiIntensity)).toBeLessThan(0.01);
  });
  it("does not allocate new objects between samples", () => {
    const s = createSkyState();
    const z = s.zenith;
    sampleSky(8, s);
    expect(s.zenith).toBe(z);
  });
});

describe("gradeFor", () => {
  it("is most saturated at golden hour, less at noon, least at night and under cloud", () => {
    const g = createGrade();
    const golden = gradeFor(18.6, 0, 0.1, g).saturation;
    const noon = gradeFor(12, 0, 0.1, g).saturation;
    const night = gradeFor(1, 1, 0.1, g).saturation;
    const grey = gradeFor(12, 0, 1, g).saturation;
    expect(golden).toBeGreaterThan(noon);
    expect(noon).toBeGreaterThan(night);
    expect(noon).toBeGreaterThan(grey);
  });
  it("adds contrast and vignette at night", () => {
    const g = createGrade();
    const noon = { ...gradeFor(12, 0, 0, g) };
    const night = gradeFor(1, 1, 0, g);
    expect(night.contrast).toBeGreaterThan(noon.contrast);
    expect(night.vignette).toBeGreaterThan(noon.vignette);
  });
  it("is continuous through the day", () => {
    const a = createGrade();
    for (let h = 0; h < 24; h += 0.1) {
      const s1 = gradeFor(h, 0, 0, a).saturation;
      const s2 = gradeFor(h + 0.1, 0, 0, createGrade()).saturation;
      expect(Math.abs(s1 - s2)).toBeLessThan(0.03);
    }
  });
});
