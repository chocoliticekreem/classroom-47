import { describe, expect, it } from "vitest";
import { RIVER, WATER_X, ZONES } from "../../config";
import { fbm, MOUTH_N, mulberry32, QUAY_N, QUAY_S, ribbonEdges, riverZAt, shoreX, valueNoise } from "./noise";

describe("Ground noise", () => {
  it("rng is deterministic and in [0,1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("value noise and fbm stay in [0,1]", () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 80;
      const y = i * 0.91 + 3;
      expect(valueNoise(x, y)).toBeGreaterThanOrEqual(0);
      expect(valueNoise(x, y)).toBeLessThanOrEqual(1);
      expect(fbm(x, y)).toBeGreaterThanOrEqual(0);
      expect(fbm(x, y)).toBeLessThanOrEqual(1);
    }
  });

  it("value noise is continuous", () => {
    expect(Math.abs(valueNoise(3.4999, 1.2) - valueNoise(3.5001, 1.2))).toBeLessThan(0.01);
    expect(Math.abs(valueNoise(4 - 1e-6, 1.2) - valueNoise(4 + 1e-6, 1.2))).toBeLessThan(0.001);
  });
});

describe("coastline", () => {
  it("finds the river mouth on the coast", () => {
    expect(riverZAt(WATER_X)).toBe(-620);
    expect(MOUTH_N).toBeLessThan(-620 - RIVER.width / 2);
    expect(QUAY_N).toBeGreaterThan(-620 + RIVER.width / 2);
  });

  it("has a straight sea wall along every coastal zone", () => {
    for (const zone of [ZONES.docks, ZONES.containerTerminal, ZONES.industrial, ZONES.shoreditch]) {
      expect(zone.minZ).toBeGreaterThanOrEqual(QUAY_N);
      expect(zone.maxZ).toBeLessThanOrEqual(QUAY_S);
      for (let z = zone.minZ; z <= zone.maxZ; z += 10) expect(shoreX(z)).toBe(WATER_X);
    }
  });

  it("leaves the river mouth open (shore tucked under the land)", () => {
    expect(shoreX(-620)).toBeLessThan(WATER_X - 20);
  });

  it("keeps the beach waterline inside WATER_X across the whole coast", () => {
    for (let z = -4000; z <= 4000; z += 3) {
      if (z >= MOUTH_N && z <= QUAY_S) continue;
      const x = shoreX(z);
      expect(x).toBeLessThanOrEqual(WATER_X);
      expect(x).toBeGreaterThan(WATER_X - 12);
    }
  });

  it("starts the beach straight next to the sea wall", () => {
    expect(Math.abs(shoreX(QUAY_S + 0.01) - (WATER_X - 6))).toBeLessThan(0.01);
    expect(Math.abs(shoreX(MOUTH_N - 0.01) - (WATER_X - 6))).toBeLessThan(0.01);
  });
});

describe("ribbonEdges", () => {
  it("offsets a straight line by half on each side", () => {
    const [l, r] = ribbonEdges([[0, 0], [100, 0]], 10);
    expect(l[0][1]).toBeCloseTo(10);
    expect(r[0][1]).toBeCloseTo(-10);
    expect(l[1][0]).toBeCloseTo(100);
  });

  it("keeps the perpendicular width through a bend", () => {
    const [l, r] = ribbonEdges([[0, 0], [100, 0], [200, 50]], 10);
    // Distance from the corner edge points to the incoming segment line stays 10.
    expect(Math.abs(l[1][1])).toBeCloseTo(10, 5);
    expect(Math.abs(r[1][1])).toBeCloseTo(10, 5);
  });

  it("covers the whole river polyline", () => {
    const [l, r] = ribbonEdges(RIVER.points, RIVER.width / 2);
    expect(l.length).toBe(RIVER.points.length);
    expect(r.length).toBe(RIVER.points.length);
  });
});
