import { describe, expect, it } from "vitest";
import { MOTORWAY, RIVER } from "../../config";
import { MW_CORNER_RADIUS, MW_JUNCTIONS, MW_LINKS, MW_MAIN, motorway, roundCorners, resample } from "../../districts/motorway";
import { PLACES, ROAD_EDGES, ROAD_NODES, findPath, getEdge, getNode } from "../../roads";
import { crossesRiver, distToRiver } from "./layout";

const P = (id: string) => getNode(id);
const heading = (a: string, b: string) => Math.atan2(P(b).z - P(a).z, P(b).x - P(a).x);
const turn = (h1: number, h2: number) => Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));

describe("motorway geometry helpers", () => {
  it("rounds a right angle into an arc of the given radius", () => {
    const d = roundCorners([[0, 0], [100, 0], [100, 100]], 40);
    expect(d.corners).toHaveLength(1);
    const [s0, s1] = d.corners[0];
    expect(s0).toBeCloseTo(60, 1);
    expect(s1 - s0).toBeCloseTo((Math.PI / 2) * 40, 0);
  });

  it("resamples with anchors kept exactly and steps <= max", () => {
    const d = roundCorners([[0, 0], [200, 0]], 10);
    const r = resample(d, [70], 50);
    expect(r.map((x) => x.s)).toContain(70);
    for (let i = 1; i < r.length; i++) expect(r[i].s - r[i - 1].s).toBeLessThanOrEqual(50 + 1e-6);
  });
});

describe("motorway main carriageway", () => {
  it("has nodes every 40-60 m", () => {
    for (let i = 1; i < MW_MAIN.length; i++) {
      const a = P(MW_MAIN[i - 1]), b = P(MW_MAIN[i]);
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      expect(d, `${a.id}->${b.id}`).toBeGreaterThanOrEqual(38);
      expect(d, `${a.id}->${b.id}`).toBeLessThanOrEqual(61);
    }
  });

  it("is one continuous highway from terminus to terminus", () => {
    expect(MW_MAIN[0]).toBe("mw_j_ne");
    expect(MW_MAIN[MW_MAIN.length - 1]).toBe("mw_j_se");
    for (let i = 1; i < MW_MAIN.length; i++) expect(getEdge(MW_MAIN[i - 1], MW_MAIN[i])?.kind).toBe("highway");
  });

  it("follows the configured C shape", () => {
    for (const id of MW_MAIN) {
      const n = P(id);
      const onSide =
        Math.abs(n.z - MOTORWAY.points[0][1]) < 0.5 || Math.abs(n.x - MOTORWAY.points[1][0]) < 0.5 ||
        Math.abs(n.z - MOTORWAY.points[2][1]) < 0.5;
      const nearCorner = MOTORWAY.points.slice(1, -1).some(([x, z]) => Math.abs(n.x - x) <= MW_CORNER_RADIUS + 0.5 && Math.abs(n.z - z) <= MW_CORNER_RADIUS + 0.5);
      expect(onSide || nearCorner, id).toBe(true);
    }
  });

  it("turns gently: no bend sharper than 20 deg, 5-8 nodes on each corner", () => {
    for (let i = 1; i < MW_MAIN.length - 1; i++) {
      const t = turn(heading(MW_MAIN[i - 1], MW_MAIN[i]), heading(MW_MAIN[i], MW_MAIN[i + 1]));
      expect((t * 180) / Math.PI, MW_MAIN[i]).toBeLessThanOrEqual(20);
    }
    for (const [cx, cz] of MOTORWAY.points.slice(1, -1)) {
      const onArc = MW_MAIN.filter((id) => {
        const n = P(id);
        return Math.abs(n.x - cx) <= MW_CORNER_RADIUS + 0.5 && Math.abs(n.z - cz) <= MW_CORNER_RADIUS + 0.5;
      });
      expect(onArc.length).toBeGreaterThanOrEqual(5);
      expect(onArc.length).toBeLessThanOrEqual(8);
    }
  });

  it("puts every junction on the main carriageway at its published spot", () => {
    for (const j of MW_JUNCTIONS) {
      expect(MW_MAIN, j.id).toContain(j.id);
      expect(Math.hypot(P(j.id).x - j.at[0], P(j.id).z - j.at[1]), j.id).toBeLessThan(1);
    }
  });
});

describe("motorway network", () => {
  it("prefixes every node id with mw_ and keeps it inside the world", () => {
    for (const n of motorway.nodes) {
      expect(n.id.startsWith("mw_"), n.id).toBe(true);
      expect(Math.abs(n.x)).toBeLessThan(1080);
      expect(Math.abs(n.z)).toBeLessThan(1080);
    }
    expect(new Set(motorway.nodes.map((n) => n.id)).size).toBe(motorway.nodes.length);
  });

  it("every edge references a known node", () => {
    for (const e of motorway.edges) {
      expect(ROAD_NODES.has(e.a), e.a).toBe(true);
      expect(ROAD_NODES.has(e.b), e.b).toBe(true);
    }
  });

  it("reaches every motorway node from the depot, and the city from both termini", () => {
    for (const n of motorway.nodes) expect(findPath(PLACES.depot, n.id), n.id).not.toBeNull();
    expect(findPath("mw_j_ne", "g_0_0")).not.toBeNull();
    expect(findPath("mw_j_se", "dock_s")).not.toBeNull();
  });

  it("has radial links into the city from its own nodes", () => {
    // Old Town (mw_j_west) and Hampstead (mw_j_north, via the Bridges agent's viaduct) connect from their side.
    const targets = ["h_9", "h_12", "airport_gate", "dock_n", "dock_s", "mw_svc_hub"];
    for (const t of targets) expect(motorway.edges.some((e) => e.a === t || e.b === t), t).toBe(true);
  });

  it("has no zero-length edges touching motorway nodes", () => {
    for (const e of ROAD_EDGES.values())
      if (e.a.startsWith("mw_") || e.b.startsWith("mw_")) expect(e.length, e.key).toBeGreaterThan(1);
  });

  it("link nodes are no more than 60 m apart", () => {
    for (const ids of Object.values(MW_LINKS))
      for (let i = 1; i < ids.length; i++) {
        const a = P(ids[i - 1]), b = P(ids[i]);
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id}->${b.id}`).toBeLessThanOrEqual(60.5);
      }
  });

  it("only the main carriageway's own viaduct crosses the river", () => {
    const crossing = motorway.edges.filter((e) => crossesRiver(P(e.a), P(e.b)));
    expect(crossing.length).toBeGreaterThanOrEqual(1);
    for (const e of crossing) {
      expect(MW_MAIN.includes(e.a) && MW_MAIN.includes(e.b), `${e.a}->${e.b}`).toBe(true);
      expect(P(e.a).x).toBeLessThan(-800);
    }
  });

  it("bridge stubs sit on the banks, clear of the water", () => {
    for (const id of ["mw_bridge_e_n", "mw_bridge_e_s"]) {
      const d = distToRiver(P(id).x, P(id).z);
      expect(d, id).toBeGreaterThan(RIVER.width / 2 + 5);
      expect(d, id).toBeLessThan(RIVER.width / 2 + 60);
    }
    expect(P("mw_bridge_e_n").z).toBeLessThan(P("mw_bridge_e_s").z); // north is -z
  });
});
