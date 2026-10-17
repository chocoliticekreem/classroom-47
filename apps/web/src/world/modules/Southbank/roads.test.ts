import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { southbank, SB_FEATURES } from "../../districts/southbank";
import { ROAD_EDGES, ROAD_NODES, PLACES, findPath, getNode } from "../../roads";

const Z = ZONES.southbank;
// Connector nodes allowed to sit just outside the zone (ring / motorway links).
const CONNECTORS = new Set(["sb_mwl_1", "sb_mwl_2", "sb_mwl_3", "sb_mw_link"]);

const sbEdges = () => [...ROAD_EDGES.values()].filter((e) => e.a.startsWith("sb_") || e.b.startsWith("sb_"));

function segX(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe("southbank roads", () => {
  it("has a real network with sb_ prefixed ids", () => {
    expect(southbank.nodes.length).toBeGreaterThan(60);
    for (const n of southbank.nodes) expect(n.id.startsWith("sb_"), n.id).toBe(true);
    for (const e of southbank.edges) {
      expect(ROAD_NODES.has(e.a), e.a).toBe(true);
      expect(ROAD_NODES.has(e.b), e.b).toBe(true);
    }
  });

  it("stays inside the zone (except the named connectors)", () => {
    for (const n of southbank.nodes) if (!CONNECTORS.has(n.id)) expect(inBox(Z, n.x, n.z), `${n.id} ${n.x},${n.z}`).toBe(true);
  });

  it("is connected to the rest of the city", () => {
    for (const n of southbank.nodes) expect(findPath(PLACES.depot, n.id), n.id).not.toBeNull();
    const ext = new Set(sbEdges().flatMap((e) => [e.a, e.b]).filter((id) => !id.startsWith("sb_")));
    expect(ext.has("h_12")).toBe(true);
    expect(ext.has("h_11")).toBe(true);
    expect(ext.has("depot_yard_w")).toBe(true);
  });

  it("is organic: varied edge bearings, short curve segments", () => {
    const bins = new Array(12).fill(0);
    let n = 0;
    for (const e of sbEdges()) {
      const a = getNode(e.a), b = getNode(e.b);
      const deg = ((Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI + 180) % 180;
      bins[Math.floor(deg / 15) % 12]++;
      n++;
      if (e.a.startsWith("sb_") && e.b.startsWith("sb_")) {
        expect(e.length, e.key).toBeGreaterThan(8);
        expect(e.length, e.key).toBeLessThan(36);
      }
    }
    expect(bins.filter((c) => c > 0).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...bins) / n).toBeLessThan(0.3);
  });

  it("has two roundabouts with 8-node rings", () => {
    for (const r of SB_FEATURES.roundabouts) for (let k = 0; k < 8; k++) expect(ROAD_NODES.has(`${r.id}_${k}`)).toBe(true);
  });

  it("has no crossing edges without a junction", () => {
    const es = sbEdges().map((e) => {
      const a = getNode(e.a), b = getNode(e.b);
      return { e, p: [a.x, a.z] as [number, number], q: [b.x, b.z] as [number, number] };
    });
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        const A = es[i], B = es[j];
        if ([A.e.a, A.e.b].some((id) => id === B.e.a || id === B.e.b)) continue;
        expect(segX(A.p, A.q, B.p, B.q), `${A.e.key} x ${B.e.key}`).toBe(false);
      }
  });

  it("keeps the market street free of roads", () => {
    const m = SB_FEATURES.market;
    for (const e of sbEdges()) {
      const a = getNode(e.a), b = getNode(e.b);
      for (let i = 1; i < m.length; i++) expect(segX([a.x, a.z], [b.x, b.z], m[i - 1], m[i]), e.key).toBe(false);
    }
  });
});
