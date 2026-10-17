import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { DELIVERY_STOPS, PLACES, ROAD_EDGES, ROAD_NODES, findPath } from "../../roads";
import { GOV_DELIVERY_NODES, GOV_PLACES, government } from "../../districts/government";
import { BOLLARDS, FLAGS, FOOTPRINTS, FOUNTAIN, HELIPAD, LAMPS, POLICE, TREES, rectClearance, roadClearance } from "./layout";
import { heliState, HELI_CYCLE } from "./helicopter";

const Z = ZONES.government;

describe("government roads", () => {
  it("keeps its nodes inside the zone", () => {
    for (const n of government.nodes) expect(inBox(Z, n.x, n.z), n.id).toBe(true);
    for (const n of government.nodes) expect(n.id.startsWith("gov_"), n.id).toBe(true);
  });

  it("merges into the graph and reaches the depot", () => {
    for (const e of government.edges) expect(ROAD_EDGES.size > 0 && ROAD_NODES.has(e.a) && ROAD_NODES.has(e.b), `${e.a}-${e.b}`).toBe(true);
    for (const id of [...Object.values(GOV_PLACES), ...GOV_DELIVERY_NODES]) {
      expect(ROAD_NODES.has(id), id).toBe(true);
      expect(findPath(PLACES.depot, id), id).not.toBeNull();
    }
  });

  it("exports two mailroom delivery stops that are not already shared stops", () => {
    expect(GOV_DELIVERY_NODES).toHaveLength(2);
    for (const id of GOV_DELIVERY_NODES) expect(DELIVERY_STOPS.includes(id)).toBe(false);
  });
});

describe("government layout", () => {
  it("keeps every building inside the zone (and off the sea-wall embankment)", () => {
    for (const f of FOOTPRINTS) {
      expect(f.minX >= Z.minX && f.maxX <= 326 && f.minZ >= Z.minZ && f.maxZ <= Z.maxZ, f.id).toBe(true);
    }
  });

  it("keeps buildings at least a metre clear of every road", () => {
    for (const f of FOOTPRINTS) expect(rectClearance(f), f.id).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps buildings from overlapping each other", () => {
    for (let i = 0; i < FOOTPRINTS.length; i++)
      for (let j = i + 1; j < FOOTPRINTS.length; j++) {
        const a = FOOTPRINTS[i];
        const b = FOOTPRINTS[j];
        const overlap = a.minX < b.maxX - 0.01 && b.minX < a.maxX - 0.01 && a.minZ < b.maxZ - 0.01 && b.minZ < a.maxZ - 0.01;
        const pair = new Set([a.id, b.id]);
        const attached = pair.has("residence") && [...pair].some((id) => id.startsWith("res_"));
        if (!attached) expect(overlap, `${a.id} x ${b.id}`).toBe(false);
      }
  });

  it("keeps props, the helipad and the fountain off the carriageway", () => {
    for (const p of [...FLAGS, ...TREES, ...LAMPS, ...BOLLARDS]) expect(roadClearance(p.x, p.z), `${p.x},${p.z}`).toBeGreaterThanOrEqual(0.3);
    expect(roadClearance(HELIPAD.x, HELIPAD.z)).toBeGreaterThan(HELIPAD.r + 2);
    expect(roadClearance(FOUNTAIN.x, FOUNTAIN.z)).toBeGreaterThan(FOUNTAIN.r + 2);
    expect(FLAGS.length).toBeGreaterThan(10);
    expect(TREES.length).toBeGreaterThan(12);
  });

  it("posts police on the pavement, never in the road", () => {
    for (const o of POLICE) {
      for (const p of [o.a, o.b]) {
        expect(roadClearance(p.x, p.z), `${p.x},${p.z}`).toBeGreaterThanOrEqual(0.3);
        expect(inBox(Z, p.x, p.z), `${p.x},${p.z}`).toBe(true);
      }
    }
  });
});

describe("helicopter", () => {
  it("rests on the pad with the rotor stopped, and flies a loop", () => {
    const s = { x: 0, y: 0, z: 0, yaw: 0, rotor: 0 };
    heliState(1, s);
    expect(Math.hypot(s.x - HELIPAD.x, s.z - HELIPAD.z)).toBeLessThan(0.5);
    expect(s.y).toBeLessThan(0.5);
    expect(s.rotor).toBeLessThan(0.05);
    let maxY = 0;
    for (let t = 0; t < HELI_CYCLE; t += 0.5) {
      heliState(t, s);
      expect(Number.isFinite(s.x + s.y + s.z + s.yaw)).toBe(true);
      maxY = Math.max(maxY, s.y);
    }
    expect(maxY).toBeGreaterThan(40);
    heliState(HELI_CYCLE - 0.01, s);
    expect(Math.hypot(s.x - HELIPAD.x, s.z - HELIPAD.z)).toBeLessThan(0.5);
    expect(s.y).toBeLessThan(0.6);
  });

  it("is continuous (no teleports)", () => {
    const s = { x: 0, y: 0, z: 0, yaw: 0, rotor: 0 };
    heliState(0, s);
    let px = s.x, py = s.y, pz = s.z;
    for (let t = 0.1; t < HELI_CYCLE * 2; t += 0.1) {
      heliState(t, s);
      expect(Math.hypot(s.x - px, s.y - py, s.z - pz), `t=${t}`).toBeLessThan(3.5);
      px = s.x; py = s.y; pz = s.z;
    }
  });
});
