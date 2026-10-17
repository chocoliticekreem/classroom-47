import { describe, expect, it } from "vitest";
import {
  ACCIDENT,
  ACTIVE_ZONES,
  BRIDGE,
  CAMERAS,
  PATCH,
  ROADS,
  STREAMER,
  bankOf,
  distanceToPolyline,
  insidePatch,
  planRoutes,
} from "./layout";
import {
  acceptFork,
  countOnCrossing,
  createLiveCity,
  previewCrossingSurge,
  previewLocationLeak,
  stepSim,
} from "./sim";

function roadPoints(road: { points: readonly (readonly [number, number])[] } | readonly (readonly [number, number])[]) {
  return "points" in road ? road.points : road;
}

describe("tower layout", () => {
  it("puts the bridge ends on opposite banks inside the patch", () => {
    const [nx, nz] = BRIDGE.northEnd;
    const [sx, sz] = BRIDGE.southEnd;
    expect(bankOf(nx, nz)).toBe("north");
    expect(bankOf(sx, sz)).toBe("south");
    expect(nz).toBeLessThan(sz);
    expect(insidePatch(nx, nz)).toBe(true);
    expect(insidePatch(sx, sz)).toBe(true);
    expect(PATCH.minX).toBeLessThan(PATCH.maxX);
    expect(insidePatch((PATCH.minX + PATCH.maxX) / 2, (PATCH.minZ + PATCH.maxZ) / 2)).toBe(true);
  });

  it("keeps the A100 approaches and Tooley Street inside the patch", () => {
    for (const key of ["towerBridgeApproach", "towerBridgeRoad", "tooleyStreet"] as const) {
      const points = roadPoints(ROADS[key]);
      expect(points.some(([x, z]) => insidePatch(x, z))).toBe(true);
    }
  });

  it("marks cameras inside the patch, mostly on the south approach", () => {
    expect(CAMERAS.length).toBeGreaterThan(0);
    for (const camera of CAMERAS) expect(insidePatch(camera.x, camera.z)).toBe(true);
    const south = CAMERAS.filter((camera) => camera.approach === "south").length;
    expect(south).toBeGreaterThan(CAMERAS.length / 2);
  });

  it("does not include airport, depot, container terminal, or delivery zones", () => {
    const zones: readonly string[] = ACTIVE_ZONES;
    for (const name of ["airport", "depot", "containerTerminal", "container-terminal", "delivery"]) {
      expect(zones).not.toContain(name);
    }
  });

  it("plans a blocked primary that hits the accident and a different detour", () => {
    const routes = planRoutes();
    expect(routes.blocked).toBe(true);
    expect(distanceToPolyline(ACCIDENT.x, ACCIDENT.z, routes.primary)).toBeLessThan(8);
    expect(distanceToPolyline(ACCIDENT.x, ACCIDENT.z, routes.detour)).toBeGreaterThan(40);
    expect(routes.primary).not.toEqual(routes.detour);
  });
});

describe("tower sim", () => {
  it("seeds flow, a sniper, and an incident without a fork", () => {
    const city = createLiveCity(47);
    const snipers = city.live.filter((agent) => agent.kind === "sniper" || agent.archetype === "stream_sniper");
    const flow = city.live.filter((agent) => agent.kind === "flow");
    expect(snipers.length).toBeGreaterThanOrEqual(1);
    expect(flow.length).toBeGreaterThan(5);
    expect(city.incident.label.length).toBeGreaterThan(0);
    expect(city.fork).toBeNull();
  });

  it("previews a crossing surge without touching live until accept", () => {
    const live = createLiveCity(47);
    const preview = previewCrossingSurge(live, 50);
    expect(preview.live).toBe(live.live);
    expect(preview.fork).not.toBeNull();
    expect(countOnCrossing(preview.fork!)).toBeGreaterThanOrEqual(50);
    expect(countOnCrossing(live.live)).toBeLessThan(5);

    const accepted = acceptFork(preview);
    expect(countOnCrossing(accepted.live)).toBeGreaterThanOrEqual(50);
    expect(accepted.fork).toBeNull();
  });

  it("leaks fifty personas toward the streamer only on the fork", () => {
    const leak = previewLocationLeak(createLiveCity(47), 50);
    expect(leak.live.some((agent) => agent.kind === "leak")).toBe(false);
    expect(leak.fork).toHaveLength(50);

    const before = new Map(leak.fork!.map((agent) => [agent.id, Math.hypot(agent.x - STREAMER.x, agent.z - STREAMER.z)]));
    const stepped = stepSim(leak, 2);
    expect(stepped.fork).toHaveLength(50);
    for (const agent of stepped.fork!) {
      const prior = before.get(agent.id);
      expect(prior).toBeDefined();
      expect(prior! - Math.hypot(agent.x - STREAMER.x, agent.z - STREAMER.z)).toBeGreaterThanOrEqual(1);
    }
    expect(stepped.live.filter((agent) => agent.kind === "leak")).toHaveLength(0);

    for (const agent of leak.fork!) {
      expect(agent.archetype.length).toBeGreaterThan(0);
      expect(agent.subreddit).toMatch(/^r\//);
      expect(agent.thread.length).toBeGreaterThan(3);
      expect(agent.intent.length).toBeGreaterThan(3);
    }
  });
});
