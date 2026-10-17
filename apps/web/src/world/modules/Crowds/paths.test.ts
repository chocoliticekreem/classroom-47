import { describe, expect, it } from "vitest";
import { edgeKey, ROAD_EDGES, ROAD_NODES, type RoadEdge, type RoadNode } from "../../roads";
import {
  chainLoop, HIGHWAY_CLEARANCE, loopLength, mulberry32, packPaths, parkPaths, resampleLoop, samplePacked,
  segDist, SIDEWALK_OFFSET, sidewalks, streetPaths, walkableEdges, type Graph,
} from "./paths";

const SHARED: Graph = { nodes: ROAD_NODES, edges: ROAD_EDGES };

function distToEdge(x: number, z: number, key: string) {
  const e = ROAD_EDGES.get(key)!;
  const a = ROAD_NODES.get(e.a)!;
  const b = ROAD_NODES.get(e.b)!;
  return segDist(x, z, a.x, a.z, b.x, b.z);
}

/** A tiny synthetic graph: a street, a junction, a highway and a ramp. */
function toyGraph(): Graph {
  const nodes = new Map<string, RoadNode>();
  const edges = new Map<string, RoadEdge>();
  const n = (id: string, x: number, z: number, zone: RoadNode["zone"] = "downtown") => nodes.set(id, { id, x, z, zone });
  const e = (a: string, b: string, kind: RoadEdge["kind"]) => {
    const A = nodes.get(a)!, B = nodes.get(b)!;
    edges.set(edgeKey(a, b), { key: edgeKey(a, b), a, b, kind, length: Math.hypot(A.x - B.x, A.z - B.z), speedLimit: 10 });
  };
  n("a", 0, 0); n("b", 40, 0); n("c", 80, 0); n("d", 40, 40); n("h1", 0, -200, "highway"); n("h2", 200, -200, "highway"); n("f", 0, -120, "countryside");
  e("a", "b", "street"); e("b", "c", "street"); e("b", "d", "street");
  e("h1", "h2", "highway"); e("a", "h1", "ramp"); e("h1", "f", "country");
  return { nodes, edges };
}

describe("sidewalk extraction", () => {
  it("makes two sidewalks per street edge and none for highway, ramp or country roads", () => {
    const g = toyGraph();
    const s = sidewalks(g);
    expect(s).toHaveLength(3 * 2);
    expect(new Set(s.map((w) => w.edge))).toEqual(new Set([edgeKey("a", "b"), edgeKey("b", "c"), edgeKey("b", "d")]));
  });

  it("covers every street edge of the real city, both sides, and nothing else", () => {
    const streets = [...ROAD_EDGES.values()].filter((e) => e.kind === "street");
    expect(walkableEdges(SHARED)).toHaveLength(streets.length);
    const s = sidewalks(SHARED);
    expect(s).toHaveLength(streets.length * 2);
    for (const w of s) expect(ROAD_EDGES.get(w.edge)!.kind).toBe("street");
  });

  it("offsets sidewalks 5-6.5 m from the centre line, one on each side", () => {
    for (const w of sidewalks(SHARED)) {
      for (const [x, z] of [[w.ax, w.az], [w.bx, w.bz], [(w.ax + w.bx) / 2, (w.az + w.bz) / 2]]) {
        const d = distToEdge(x, z, w.edge);
        expect(d).toBeGreaterThanOrEqual(5);
        expect(d).toBeLessThanOrEqual(6.5);
      }
    }
    const [l, r] = sidewalks(toyGraph()).slice(0, 2);
    expect(Math.sign(l.az)).toBe(-Math.sign(r.az)); // the a-b street runs along x: one side each
  });
});

describe("walk loops", () => {
  it("a single-edge loop is a rectangle round the street: out one side, back the other, crossing at both ends", () => {
    const loop = chainLoop([[0, 0], [40, 0]], 5.75, 6, 6)!;
    expect(loop).toEqual([6, 5.75, 34, 5.75, 34, -5.75, 6, -5.75]);
    expect(loopLength(loop)).toBeCloseTo(28 * 2 + 11.5 * 2);
  });

  it("mitres corners so straight runs stay exactly on the sidewalk line", () => {
    const loop = chainLoop([[0, 0], [40, 0], [40, 40]], 5.75, 6, 6)!;
    // side A corner (inner), side B corner (outer)
    expect(loop.slice(2, 4)).toEqual([34.25, 5.75]);
    expect(loop.slice(8, 10)).toEqual([45.75, -5.75]);
  });

  const rand = mulberry32(7);
  const paths = streetPaths(rand, SHARED);

  it("builds roughly one loop per street and only walks along streets", () => {
    const streets = walkableEdges(SHARED).length;
    expect(paths.length).toBeGreaterThan(streets * 0.8);
    expect(paths.length).toBeLessThanOrEqual(streets);
    for (const p of paths)
      for (let i = 0; i < p.chain.length - 1; i++) expect(ROAD_EDGES.get(edgeKey(p.chain[i], p.chain[i + 1]))?.kind).toBe("street");
  });

  it("keeps every loop corner off the highways", () => {
    const highways = [...ROAD_EDGES.values()].filter((e) => e.kind === "highway");
    let closest = Infinity;
    for (const p of paths)
      for (let i = 0; i < p.corners.length; i += 2)
        for (const h of highways) closest = Math.min(closest, distToEdge(p.corners[i], p.corners[i + 1], h.key));
    expect(highways.length).toBeGreaterThan(0);
    expect(closest).toBeGreaterThanOrEqual(HIGHWAY_CLEARANCE);
  });

  it("puts the straight stretches of each loop on the sidewalk line", () => {
    for (const p of paths.slice(0, 120)) {
      const n = p.chain.length;
      // side A segment i runs along chain edge i; its midpoint is SIDEWALK_OFFSET from that edge
      for (let i = 0; i < n - 1; i++) {
        const mx = (p.corners[i * 2] + p.corners[i * 2 + 2]) / 2;
        const mz = (p.corners[i * 2 + 1] + p.corners[i * 2 + 3]) / 2;
        expect(distToEdge(mx, mz, edgeKey(p.chain[i], p.chain[i + 1]))).toBeCloseTo(SIDEWALK_OFFSET, 3);
      }
    }
  });

  it("weights downtown above the outskirts", () => {
    const avg = (zone: string) => {
      const ps = paths.filter((p) => p.zone === zone);
      return ps.reduce((s, p) => s + p.weight / loopLength(p.corners), 0) / ps.length;
    };
    expect(avg("downtown")).toBeGreaterThan(avg("suburbs"));
    expect(avg("downtown")).toBeGreaterThan(avg("docks"));
  });
});

describe("GPU packing", () => {
  it("resamples loops at a uniform step and the CPU mirror of the shader lookup walks the loop", () => {
    const r = resampleLoop([0, 0, 10, 0, 10, 10, 0, 10], 1);
    expect(r.count).toBe(40);
    expect(r.length).toBeCloseTo(40);
    const packed = packPaths([{ kind: "park", corners: [0, 0, 10, 0, 10, 10, 0, 10], chain: [], zone: "downtown", weight: 1, y: 0.3, lateral: 0 }], 1, 16);
    expect(packed.width).toBe(16);
    expect(packed.height).toBe(3);
    expect(Array.from(packed.heads.slice(0, 4))).toEqual([0, 40, 40, expect.closeTo(0.3, 5)]);
    expect(samplePacked(packed, 0, 15)).toEqual([10, 5]);
    expect(samplePacked(packed, 0, -5)).toEqual([0, 5]); // walking backwards wraps
  });

  it("park paths sit inside the park cell", () => {
    for (const p of parkPaths())
      for (let i = 0; i < p.corners.length; i += 2) {
        expect(Math.abs(p.corners[i] - 20)).toBeLessThan(13.6);
        expect(Math.abs(p.corners[i + 1] - 20)).toBeLessThan(13.6);
      }
  });
});
