import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import {
  BILLBOARD, HALF, JUNCTION_CLEAR, OFFSET, VERGE, buildStreetscape, distToSegment, inWater, worldGraph,
  type GEdge, type GNode, type Graph, type Streetscape,
} from "./placement";

// A small organic test district far from downtown: a curved high street, a T junction,
// a roundabout, a cul-de-sac and a highway with a junction.
function testGraph(): Graph {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const n = (id: string, x: number, z: number) => nodes.set(id, { id, x, z, zone: "southbank" });
  const e = (a: string, b: string, kind: GEdge["kind"] = "street") => edges.push({ key: a < b ? `${a}|${b}` : `${b}|${a}`, a, b, kind });
  // curved high street (arc, 20 m steps)
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * Math.PI * 0.6;
    n(`c${i}`, -300 + Math.sin(t) * 120, 400 - Math.cos(t) * 120);
    if (i) e(`c${i - 1}`, `c${i}`);
  }
  // side road from c5 (T junction) to a roundabout
  n("s0", -300 + Math.sin(0.3 * Math.PI) * 120 - 60, 400 - Math.cos(0.3 * Math.PI) * 120 + 40);
  e("c5", "s0");
  const rc = { x: nodes.get("s0")!.x - 40, z: nodes.get("s0")!.z + 20 };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    n(`r${k}`, rc.x + Math.cos(a) * 14, rc.z + Math.sin(a) * 14);
    if (k) e(`r${k - 1}`, `r${k}`);
  }
  e("r7", "r0");
  e("s0", "r0");
  // cul-de-sac off the roundabout
  n("cd", rc.x - 70, rc.z + 10);
  e("r4", "cd");
  // highway passing south with a junction to the end of the high street
  n("hw0", -500, 560);
  n("hw1", -260, 560);
  n("hw2", -20, 560);
  e("hw0", "hw1", "highway");
  e("hw1", "hw2", "highway");
  e("c10", "hw1");
  return { nodes, edges };
}

const byKey = new WeakMap<Graph, Map<string, GEdge>>();
function seg(g: Graph, key: string) {
  let m = byKey.get(g);
  if (!m) byKey.set(g, (m = new Map(g.edges.map((x) => [x.key, x]))));
  const e = m.get(key)!;
  const a = g.nodes.get(e.a)!;
  const b = g.nodes.get(e.b)!;
  return { e, a, b };
}

/** Collects every violated invariant as a readable string (one expect at the end keeps big graphs fast). */
function violations(g: Graph, s: Streetscape): string[] {
  const bad: string[] = [];
  const edges = g.edges;
  const deg = new Map<string, number>();
  for (const e of edges) for (const id of [e.a, e.b]) deg.set(id, (deg.get(id) ?? 0) + 1);
  const junctions = [...g.nodes.values()].filter((n) => (deg.get(n.id) ?? 0) >= 3);
  const P = (x: number, z: number) => `(${x.toFixed(1)},${z.toFixed(1)})`;
  const nearestOther = (x: number, z: number, own: string | null) => {
    let worst: { key: string; gap: number } | null = null;
    for (const o of edges) {
      if (o.key === own) continue;
      const oa = g.nodes.get(o.a)!;
      const ob = g.nodes.get(o.b)!;
      const gap = distToSegment(x, z, oa.x, oa.z, ob.x, ob.z) - HALF[o.kind];
      if (!worst || gap < worst.gap) worst = { key: o.key, gap };
    }
    return worst;
  };

  for (const p of s.props) {
    const at = `${p.kind}@${P(p.x, p.z)}`;
    // kerbside band: on the pavement, never on the carriageway or beyond the frontage
    if (p.offset < 4.5 || p.offset > 7) bad.push(`${at} offset ${p.offset}`);
    const { a, b } = seg(g, p.edge);
    const d = distToSegment(p.x, p.z, a.x, a.z, b.x, b.z);
    if (Math.abs(d - p.offset) > 0.01) bad.push(`${at} is ${d.toFixed(2)} m from its road, expected ${p.offset}`);
    const o = nearestOther(p.x, p.z, p.edge);
    if (o && o.gap < 0.3) bad.push(`${at} sits on road ${o.key}`);
    // junction mouths stay clear
    const minJ = p.kind === "car" ? JUNCTION_CLEAR.car : p.kind === "bollard" ? JUNCTION_CLEAR.bollard : 6;
    for (const j of junctions) if (Math.hypot(j.x - p.x, j.z - p.z) < minJ) bad.push(`${at} inside junction ${j.id}`);
    if (inBox(ZONES.downtown, p.x, p.z)) bad.push(`${at} downtown`);
    if (inWater(p.x, p.z)) bad.push(`${at} in water`);
  }
  for (const kind of ["car", "tree"] as const) {
    const min = kind === "car" ? 5.2 : 9;
    const list = s.props.filter((p) => p.kind === kind);
    for (let i = 0; i < list.length; i++)
      for (let k = i + 1; k < list.length; k++)
        if (Math.hypot(list[i].x - list[k].x, list[i].z - list[k].z) < min) bad.push(`${kind}s overlap at ${P(list[i].x, list[i].z)}`);
  }
  for (const v of s.verges) {
    const { e, a, b } = seg(g, v.edge);
    if (e.kind !== "highway") bad.push(`verge on ${e.kind}`);
    if (Math.abs(distToSegment(v.x, v.z, a.x, a.z, b.x, b.z) - (VERGE.inner + VERGE.outer) / 2) > 0.01) bad.push(`verge off its band`);
    const o = nearestOther(v.x, v.z, v.edge);
    if (o && o.gap < v.width / 2) bad.push(`verge @${P(v.x, v.z)} overlaps ${o.key}`);
  }
  for (const bb of s.billboards) {
    const o = nearestOther(bb.x, bb.z, null);
    if (o && o.gap < 3) bad.push(`billboard @${P(bb.x, bb.z)} too close to ${o.key}`);
  }
  return bad;
}

describe("streetscape placement (synthetic organic district)", () => {
  const g = testGraph();
  const s = buildStreetscape(g);

  it("places every kind of kerbside prop", () => {
    const kinds = new Set(s.props.map((p) => p.kind));
    for (const k of ["tree", "lamp", "bin", "car", "signSpeed", "bollard"] as const) expect(kinds.has(k)).toBe(true);
    expect(kinds.has("signGiveWay") || kinds.has("signKeepLeft")).toBe(true);
  });

  it("keeps props on the pavement, off other roads and out of junctions", () => expect(violations(g, s)).toEqual([]));

  it("uses the documented offsets per kind", () => {
    for (const p of s.props) expect(p.offset).toBe(OFFSET[p.kind === "signSpeed" || p.kind === "signGiveWay" || p.kind === "signKeepLeft" ? "sign" : p.kind]);
  });

  it("trees roughly every 15 m along the curved high street", () => {
    const trees = s.props.filter((p) => p.kind === "tree" && p.edge.startsWith("c"));
    const streetLen = 120 * Math.PI * 0.6; // both sides => ~2 * len / 15
    expect(trees.length).toBeGreaterThan(streetLen / 15);
  });

  it("puts verges and shrubs along the highway and a billboard near its junction", () => {
    expect(s.verges.length).toBeGreaterThan(20);
    expect(s.shrubs.length).toBeGreaterThan(10);
    expect(s.billboards.length).toBeGreaterThan(0);
    for (const bb of s.billboards) expect(Math.hypot(bb.x + 260, bb.z - 560)).toBeLessThan(BILLBOARD.back + BILLBOARD.side + 1);
  });

  it("is deterministic", () => {
    expect(buildStreetscape(testGraph())).toEqual(s);
  });
});

describe("streetscape placement (world graph)", () => {
  const g = worldGraph();
  const s = buildStreetscape(g);

  it("holds the same invariants on the live road graph", () => expect(violations(g, s)).toEqual([]));

  it("leaves downtown streets alone and covers the rest", () => {
    expect(s.props.length).toBeGreaterThan(50);
    expect(s.props.every((p) => !p.edge.startsWith("g_") || !p.edge.split("|")[1].startsWith("g_"))).toBe(true);
  });

  it("has verges along the ring and billboards near ring junctions", () => {
    expect(s.verges.length).toBeGreaterThan(50);
    expect(s.billboards.length).toBeGreaterThanOrEqual(4);
  });
});
