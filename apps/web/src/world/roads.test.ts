import { describe, expect, it } from "vitest";
import { DELIVERY_STOPS, PLACES, ROAD_EDGES, ROAD_NODES, edgeKey, findPath, lanePosition } from "./roads";

describe("road network", () => {
  it("is fully connected", () => {
    for (const id of ROAD_NODES.keys()) expect(findPath(PLACES.depot, id), id).not.toBeNull();
  });

  it("routes around a blocked road", () => {
    const direct = findPath("g_0_0", "g_1_0")!;
    expect(direct).toEqual(["g_0_0", "g_1_0"]);
    const detour = findPath("g_0_0", "g_1_0", new Set([edgeKey("g_0_0", "g_1_0")]))!;
    expect(detour.length).toBeGreaterThan(2);
    for (let i = 1; i < detour.length; i++) expect(edgeKey(detour[i - 1], detour[i])).not.toBe(edgeKey("g_0_0", "g_1_0"));
  });

  it("has valid places and stops", () => {
    for (const id of [...Object.values(PLACES).flat(), ...DELIVERY_STOPS]) expect(ROAD_NODES.has(id), id).toBe(true);
    expect(ROAD_EDGES.size).toBeGreaterThan(150);
  });

  it("keeps traffic on the left", () => {
    // heading east (+x): left-hand side is -z... in three.js with y up, travelling +x, left is -z
    const [, z] = lanePosition("g_0_0", "g_1_0", 0.5);
    expect(z).toBeLessThan(0);
  });
});
