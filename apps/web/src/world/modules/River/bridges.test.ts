import { describe, expect, it } from "vitest";
import { RIVER } from "../../config";
import { BRIDGES, BRIDGE_ENDS, bridges, motorwayDistance, riverCrossings, riverDistance, riverZAt, spanEdge } from "../../districts/bridges";
import { ROAD_EDGES, ROAD_NODES, edgeKey, findPath, getNode, PLACES } from "../../roads";

const crosses = (a: string, b: string) => {
  const na = getNode(a);
  const nb = getNode(b);
  return riverCrossings(na.x, na.z, nb.x, nb.z);
};

const neighboursOutside = (id: string) =>
  [...ROAD_EDGES.values()].some((e) => (e.a === id || e.b === id) && !(e.a.startsWith("br_") && e.b.startsWith("br_")));

describe("bridges", () => {
  const road = BRIDGES.filter((b) => b.kind);

  it("has 4-5 city road bridges plus the two motorway crossings, and a Tower Bridge", () => {
    const city = road.filter((b) => b.kind === "street");
    expect(city.length).toBeGreaterThanOrEqual(4);
    expect(city.length).toBeLessThanOrEqual(5);
    expect(road.filter((b) => b.kind === "highway").map((b) => b.id)).toEqual(["mw", "coast"]);
    const tower = BRIDGES.find((b) => b.style === "tower")!;
    expect(tower.x).toBeGreaterThanOrEqual(200);
    expect(tower.x).toBeLessThanOrEqual(280);
  });

  it("each road bridge crosses the river polyline exactly once, on its span edge", () => {
    for (const b of road) {
      const ids = [BRIDGE_ENDS[b.id].north, `br_${b.id}_nd`, `br_${b.id}_sd`, BRIDGE_ENDS[b.id].south];
      let total = 0;
      for (let i = 1; i < ids.length; i++) total += crosses(ids[i - 1], ids[i]);
      expect(total, b.id).toBe(1);
      const [nd, sd] = spanEdge(b.id);
      expect(crosses(nd, sd), b.id).toBe(1);
      expect(ROAD_EDGES.get(edgeKey(nd, sd))?.kind).toBe(b.kind);
      // abutments sit on dry land, clear of the water
      for (const id of [nd, sd]) expect(Math.abs(getNode(id).z - riverZAt(b.x))).toBeGreaterThan(RIVER.width / 2 + 5);
    }
  });

  it("no other bridges-district edge crosses or touches the river", () => {
    const spans = new Set(road.map((b) => edgeKey(...spanEdge(b.id))));
    for (const e of bridges.edges) {
      if (spans.has(edgeKey(e.a, e.b))) continue;
      if (!ROAD_NODES.has(e.a) || !ROAD_NODES.has(e.b)) continue;
      const a = getNode(e.a);
      const b = getNode(e.b);
      expect(riverDistance(a.x, a.z, b.x, b.z), `${e.a}->${e.b}`).toBeGreaterThan(RIVER.width / 2 + 5);
    }
  });

  it("every edge references a known node (so none get skipped by roads.ts)", () => {
    for (const e of bridges.edges) {
      expect(ROAD_NODES.has(e.a), e.a).toBe(true);
      expect(ROAD_NODES.has(e.b), e.b).toBe(true);
    }
  });

  it("both ends of every bridge connect to the existing network", () => {
    for (const b of road) {
      const { north, south } = BRIDGE_ENDS[b.id];
      for (const end of [north, south]) expect(findPath(PLACES.depot, end), end).not.toBeNull();
      // the north end connects to some non-bridge node, and stays reachable with the span closed (another bridge)
      expect(getNode(north).id.startsWith("mw_") || neighboursOutside(north), b.id).toBe(true);
      const blocked = new Set([edgeKey(...spanEdge(b.id))]);
      expect(findPath(PLACES.depot, north, blocked), `${b.id} detour`).not.toBeNull();
    }
    // south ends hook into the suburbs
    expect(findPath("sub_-1_1", "br_tower_s")).not.toBeNull();
    expect(findPath("br_mw_bot", "mw_j_hp")).toEqual(["br_mw_bot", "mw_j_hp"]);
  });

  it("north ends and the north embankment road keep clear of the motorway", () => {
    for (const n of bridges.nodes) {
      if (n.z > riverZAt(n.x)) continue; // south bank
      if (n.id.endsWith("_nd")) continue; // abutments may sit 20 m from it
      expect(motorwayDistance(n.x, n.z), n.id).toBeGreaterThan(20);
    }
  });

  it("the coast lift bridge closes the motorway coast-road gap", () => {
    expect(findPath("mw_bridge_e_n", "mw_bridge_e_s")).toEqual(["mw_bridge_e_n", "br_coast_nd", "br_coast_sd", "mw_bridge_e_s"]);
  });

  it("node ids are prefixed br_", () => {
    for (const n of bridges.nodes) expect(n.id.startsWith("br_"), n.id).toBe(true);
  });
});
