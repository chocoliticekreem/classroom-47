import { describe, expect, it } from "vitest";
import { buildBanks } from "./banks";
import { buildBridges } from "./bridgeGeo";
import { clipper, policeLaunch, rowingEight, tallShip, tourBoat } from "./boats";
import { GAPS } from "./gaps";
import { riverRibbon } from "./water";
import { BRIDGES } from "../../districts/bridges";

describe("river geometry builds", () => {
  it("builds banks with trees, lamps and posts", () => {
    const b = buildBanks();
    expect(b.geometry.getAttribute("position").count).toBeGreaterThan(1000);
    expect(b.trees.length).toBeGreaterThan(100);
    expect(b.lamps.length).toBeGreaterThan(50);
    for (const t of b.trees) expect(Number.isFinite(t.x + t.z)).toBe(true);
  });

  it("builds every bridge and footprints for each crossing", () => {
    const br = buildBridges();
    expect(br.geometry.getAttribute("position").count).toBeGreaterThan(1000);
    expect(br.lights.length).toBeGreaterThan(100);
    expect(br.footprints.length).toBeGreaterThanOrEqual(BRIDGES.length);
    expect(br.footprints.length).toBeLessThanOrEqual(12);
    expect(br.tower.hingeS - br.tower.hingeN).toBeCloseTo(30);
  });

  it("leaves a wall gap at the motorway's own west crossing", () => {
    expect(GAPS.some(([a, b]) => a < -870 && b > -860)).toBe(true);
  });

  it("builds the water ribbon and boats", () => {
    expect(riverRibbon().getIndex()!.count).toBeGreaterThan(1000);
    for (const f of [tourBoat, clipper, policeLaunch, rowingEight, tallShip]) expect(f().getAttribute("color")).toBeTruthy();
  });
});
