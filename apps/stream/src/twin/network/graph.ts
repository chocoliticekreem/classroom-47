import type { TwinGeometry } from "../config";
import {
  PAVE_W,
  WALK_OFF,
  computeLayout,
  despike,
  offsetPolyline,
  polyCum,
  registerLayout,
  segmentAt,
} from "./layout";
import type { Footway, RoadEdge, RoadNetwork, RoadNode, XZ } from "./types";

export const ROAD_WIDTH = { major: 10, minor: 6 } as const;

/** Vertices closer than this (from different ways) become one shared node. */
const SNAP_M = 1.5;
/** Drivable fragments shorter than this in total are dropped as noise. */
const MIN_ROAD_COMPONENT_M = 120;
const MIN_PATH_COMPONENT_M = 20;
const LINK_M = 6;

interface Way {
  pts: XZ[];
  /** 1 on a bridge, 0 otherwise. Ways on different layers only meet at their ends. */
  layer: number;
  src: number;
}

interface RawEdge {
  from: number;
  to: number;
  pts: XZ[];
  ids: number[];
  src: number;
  length: number;
}

interface Planar {
  nodes: XZ[];
  edges: RawEdge[];
}

class SegGrid {
  private cells = new Map<number, number[]>();
  constructor(private cell: number) {}

  private key(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  add(ref: number, x0: number, z0: number, x1: number, z1: number, pad: number) {
    const c = this.cell;
    const ax = Math.floor((Math.min(x0, x1) - pad) / c);
    const bx = Math.floor((Math.max(x0, x1) + pad) / c);
    const az = Math.floor((Math.min(z0, z1) - pad) / c);
    const bz = Math.floor((Math.max(z0, z1) + pad) / c);
    for (let cx = ax; cx <= bx; cx++) {
      for (let cz = az; cz <= bz; cz++) {
        const k = this.key(cx, cz);
        const list = this.cells.get(k);
        if (list) list.push(ref);
        else this.cells.set(k, [ref]);
      }
    }
  }

  query(x0: number, z0: number, x1: number, z1: number): Set<number> {
    const c = this.cell;
    const out = new Set<number>();
    const ax = Math.floor(Math.min(x0, x1) / c);
    const bx = Math.floor(Math.max(x0, x1) / c);
    const az = Math.floor(Math.min(z0, z1) / c);
    const bz = Math.floor(Math.max(z0, z1) / c);
    for (let cx = ax; cx <= bx; cx++) {
      for (let cz = az; cz <= bz; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (list) for (const r of list) out.add(r);
      }
    }
    return out;
  }
}

function dedupePoints(pts: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push([p[0], p[1]]);
  }
  return out;
}

function polyLength(pts: XZ[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/**
 * Turns overlapping polylines into a proper graph: crossings and T-junctions get a vertex in both
 * ways, vertices of different ways within SNAP_M merge into one node, and every way is cut at nodes
 * shared with another way (or at its own ends).
 */
function planarise(input: Way[]): Planar {
  const ways = input
    .map((w) => ({ pts: dedupePoints(w.pts), layer: w.layer, src: w.src }))
    .filter((w) => w.pts.length >= 2);

  const grid = new SegGrid(24);
  ways.forEach((w, wi) => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      grid.add(wi * 65536 + i, w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1], SNAP_M);
    }
  });

  const inserts: { seg: number; t: number; x: number; z: number }[][] = ways.map(() => []);

  ways.forEach((a, ai) => {
    for (let i = 0; i < a.pts.length - 1; i++) {
      const [ax, az] = a.pts[i];
      const [bx, bz] = a.pts[i + 1];
      for (const ref of grid.query(ax, az, bx, bz)) {
        const bi = Math.floor(ref / 65536);
        const j = ref % 65536;
        if (bi <= ai) continue;
        const b = ways[bi];
        if (b.layer !== a.layer) continue;
        const [cx, cz] = b.pts[j];
        const [dx, dz] = b.pts[j + 1];
        const rx = bx - ax;
        const rz = bz - az;
        const sx = dx - cx;
        const sz = dz - cz;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * sz - (cz - az) * sx) / den;
        const u = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
        const x = ax + rx * t;
        const z = az + rz * t;
        inserts[ai].push({ seg: i, t, x, z });
        inserts[bi].push({ seg: j, t: u, x, z });
      }
    }
  });

  ways.forEach((a, ai) => {
    a.pts.forEach(([vx, vz], k) => {
      const isEnd = k === 0 || k === a.pts.length - 1;
      for (const ref of grid.query(vx - SNAP_M, vz - SNAP_M, vx + SNAP_M, vz + SNAP_M)) {
        const bi = Math.floor(ref / 65536);
        const j = ref % 65536;
        if (bi === ai) continue;
        const b = ways[bi];
        if (!isEnd && b.layer !== a.layer) continue;
        const [cx, cz] = b.pts[j];
        const [dx, dz] = b.pts[j + 1];
        const ex = dx - cx;
        const ez = dz - cz;
        const l2 = ex * ex + ez * ez;
        if (l2 < 1e-9) continue;
        const t = ((vx - cx) * ex + (vz - cz) * ez) / l2;
        if (t <= 0 || t >= 1) continue;
        if (Math.hypot(vx - (cx + ex * t), vz - (cz + ez * t)) > SNAP_M) continue;
        if (Math.hypot(vx - cx, vz - cz) <= SNAP_M || Math.hypot(vx - dx, vz - dz) <= SNAP_M) continue;
        inserts[bi].push({ seg: j, t, x: vx, z: vz });
      }
    });
  });

  ways.forEach((w, wi) => {
    if (!inserts[wi].length) return;
    const bySeg = new Map<number, { t: number; x: number; z: number }[]>();
    for (const ins of inserts[wi]) {
      const list = bySeg.get(ins.seg);
      if (list) list.push(ins);
      else bySeg.set(ins.seg, [ins]);
    }
    const pts: XZ[] = [];
    for (let i = 0; i < w.pts.length; i++) {
      pts.push(w.pts[i]);
      const list = bySeg.get(i);
      if (!list) continue;
      list.sort((p, q) => p.t - q.t);
      for (const ins of list) pts.push([ins.x, ins.z]);
    }
    w.pts = dedupePoints(pts);
  });

  interface Cluster {
    x: number;
    z: number;
    mask: number;
    end: boolean;
    lastWay: number;
    nWays: number;
    loop: boolean;
  }
  const clusters: Cluster[] = [];
  const cgrid = new Map<number, number[]>();
  const ckey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const seqs: number[][] = [];

  ways.forEach((w, wi) => {
    const seq: number[] = [];
    const bit = 1 << w.layer;
    w.pts.forEach(([px, pz], k) => {
      const isEnd = k === 0 || k === w.pts.length - 1;
      const cx = Math.floor(px / SNAP_M);
      const cz = Math.floor(pz / SNAP_M);
      let best = -1;
      let bestD = SNAP_M;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = cgrid.get(ckey(cx + dx, cz + dz));
          if (!list) continue;
          for (const id of list) {
            const c = clusters[id];
            const d = Math.hypot(c.x - px, c.z - pz);
            if (d <= bestD && (c.mask & bit || isEnd || c.end)) {
              best = id;
              bestD = d;
            }
          }
        }
      }
      if (best < 0) {
        best = clusters.length;
        clusters.push({ x: px, z: pz, mask: 0, end: false, lastWay: -1, nWays: 0, loop: false });
        const key = ckey(cx, cz);
        const list = cgrid.get(key);
        if (list) list.push(best);
        else cgrid.set(key, [best]);
      }
      const c = clusters[best];
      c.mask |= bit;
      if (isEnd) c.end = true;
      if (seq[seq.length - 1] === best) return;
      if (c.lastWay === wi) c.loop = true;
      else {
        c.nWays++;
        c.lastWay = wi;
      }
      seq.push(best);
    });
    seqs.push(seq);
  });

  const edges: RawEdge[] = [];
  const emit = (ids: number[], src: number) => {
    const pts: XZ[] = ids.map((id) => [clusters[id].x, clusters[id].z]);
    const from = ids[0];
    const to = ids[ids.length - 1];
    if (from === to) {
      if (ids.length < 5) return;
      const m = ids.length >> 1;
      emit(ids.slice(0, m + 1), src);
      emit(ids.slice(m), src);
      return;
    }
    const length = polyLength(pts);
    if (length < 0.5) return;
    edges.push({ from, to, pts, ids, src, length });
  };

  seqs.forEach((seq, wi) => {
    let start = 0;
    for (let k = 1; k < seq.length; k++) {
      const c = clusters[seq[k]];
      if (k === seq.length - 1 || c.end || c.nWays >= 2 || c.loop) {
        emit(seq.slice(start, k + 1), ways[wi].src);
        start = k;
      }
    }
  });

  const seen = new Map<string, RawEdge[]>();
  const unique = edges.filter((e) => {
    const key = e.from < e.to ? `${e.from}:${e.to}` : `${e.to}:${e.from}`;
    const list = seen.get(key);
    if (list?.some((o) => Math.abs(o.length - e.length) < 4)) return false;
    if (list) list.push(e);
    else seen.set(key, [e]);
    return true;
  });

  return { nodes: clusters.map((c) => [c.x, c.z] as XZ), edges: unique };
}

/** Keeps only connected components whose total length reaches `minLen`; node ids are re-numbered. */
function compact(planar: Planar, minLen: number): { nodes: XZ[]; edges: RawEdge[] } {
  const parent = planar.nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const e of planar.edges) parent[find(e.from)] = find(e.to);
  const total = new Map<number, number>();
  for (const e of planar.edges) total.set(find(e.from), (total.get(find(e.from)) ?? 0) + e.length);
  const kept = planar.edges.filter((e) => (total.get(find(e.from)) ?? 0) >= minLen);

  const remap = new Map<number, number>();
  const nodes: XZ[] = [];
  const id = (n: number) => {
    let r = remap.get(n);
    if (r === undefined) {
      r = nodes.length;
      remap.set(n, r);
      nodes.push(planar.nodes[n]);
    }
    return r;
  };
  const edges = kept.map((e) => ({ ...e, from: id(e.from), to: id(e.to) }));
  return { nodes, edges };
}

function isNearRoad(path: XZ[], reach: SegGrid, segs: RoadEdge[], flat: { e: number; i: number }[]): boolean {
  let near = 0;
  let total = 0;
  const len = polyLength(path);
  const cum = polyCum(path);
  const samples = Math.max(2, Math.ceil(len / 4));
  for (let s = 0; s <= samples; s++) {
    const d = (len * s) / samples;
    const k = segmentAt(cum, d);
    const t = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
    const px = path[k][0] + (path[k + 1][0] - path[k][0]) * t;
    const pz = path[k][1] + (path[k + 1][1] - path[k][1]) * t;
    total++;
    for (const ref of reach.query(px, pz, px, pz)) {
      const { e, i } = flat[ref];
      const edge = segs[e];
      const [ax, az] = edge.pts[i];
      const [bx, bz] = edge.pts[i + 1];
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez || 1;
      const u = Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / l2));
      if (Math.hypot(px - (ax + ex * u), pz - (az + ez * u)) <= edge.width / 2 + PAVE_W + 2.5) {
        near++;
        break;
      }
    }
  }
  return near / total >= 0.6;
}

export function buildNetwork(geometry: TwinGeometry): RoadNetwork {
  const sources = geometry.roads.filter(
    (r) => (r.kind === "major" || r.kind === "minor") && !r.tunnel && r.line.length >= 2,
  );
  const planar = compact(
    planarise(sources.map((r, i) => ({ pts: r.line, layer: r.bridge ? 1 : 0, src: i }))),
    MIN_ROAD_COMPONENT_M,
  );

  const nodes: RoadNode[] = planar.nodes.map((p, id) => ({ id, x: p[0], z: p[1], edges: [], junction: false }));
  const edges: RoadEdge[] = planar.edges.map((e, id) => {
    const road = sources[e.src];
    const kind = road.kind === "major" ? "major" : "minor";
    const cum = polyCum(e.pts);
    nodes[e.from].edges.push(id);
    nodes[e.to].edges.push(id);
    return {
      id,
      from: e.from,
      to: e.to,
      kind,
      width: ROAD_WIDTH[kind],
      oneway: !!road.oneway,
      bridge: !!road.bridge,
      pts: e.pts,
      cum,
      length: cum[cum.length - 1],
    };
  });
  for (const n of nodes) n.junction = n.edges.length >= 3;

  const layout = computeLayout(nodes, edges);

  const footways: Footway[] = [];
  const links: Set<number>[] = [];
  const addFootway = (pts: XZ[]): number => {
    const cum = polyCum(pts);
    footways.push({ id: footways.length, pts, cum, length: cum[cum.length - 1], neighbours: [] });
    links.push(new Set());
    return footways.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    links[a].add(b);
    links[b].add(a);
  };

  const leftFoot: number[] = [];
  const rightFoot: number[] = [];
  edges.forEach((edge, i) => {
    const strip = layout.strips[i];
    if (!strip) {
      leftFoot.push(-1);
      rightFoot.push(-1);
      return;
    }
    const off = edge.width / 2 + WALK_OFF;
    leftFoot.push(addFootway(despike(offsetPolyline(strip.pts, off), strip.pts)));
    rightFoot.push(addFootway(despike(offsetPolyline(strip.pts, -off), strip.pts)));
  });

  const endOf = (fid: number, atStart: boolean): XZ => {
    const pts = footways[fid].pts;
    return atStart ? pts[0] : pts[pts.length - 1];
  };

  layout.items.forEach((items) => {
    if (items.length < 2) return;
    const ccw = items.map((it) => (it.atStart ? leftFoot[it.edge] : rightFoot[it.edge]));
    const cw = items.map((it) => (it.atStart ? rightFoot[it.edge] : leftFoot[it.edge]));
    items.forEach((it, i) => {
      link(cw[i], ccw[(i + 1) % items.length]);
      if (!it.crossing || ccw[i] < 0 || cw[i] < 0) return;
      const crossing = addFootway([endOf(ccw[i], it.atStart), endOf(cw[i], it.atStart)]);
      link(crossing, ccw[i]);
      link(crossing, cw[i]);
    });
  });

  const reach = new SegGrid(24);
  const flat: { e: number; i: number }[] = [];
  edges.forEach((edge) => {
    for (let i = 0; i < edge.pts.length - 1; i++) {
      reach.add(flat.length, edge.pts[i][0], edge.pts[i][1], edge.pts[i + 1][0], edge.pts[i + 1][1], 12);
      flat.push({ e: edge.id, i });
    }
  });

  const pathSources = geometry.roads.filter(
    (r) => r.kind === "path" && !r.tunnel && r.line.length >= 2 && !isNearRoad(r.line, reach, edges, flat),
  );
  const paths = compact(
    planarise(pathSources.map((r, i) => ({ pts: r.line, layer: r.bridge ? 1 : 0, src: i }))),
    MIN_PATH_COMPONENT_M,
  );
  const atNode = new Map<number, number[]>();
  for (const e of paths.edges) {
    const id = addFootway(e.pts);
    layout.pathIds.push(id);
    for (const n of [e.from, e.to]) {
      const list = atNode.get(n);
      if (list) {
        for (const other of list) link(id, other);
        list.push(id);
      } else atNode.set(n, [id]);
    }
  }

  const ends = new Map<number, number[]>();
  const endKey = (x: number, z: number) => (Math.floor(x / LINK_M) + 4096) * 8192 + Math.floor(z / LINK_M) + 4096;
  const registerEnd = (fid: number, p: XZ) => {
    const k = endKey(p[0], p[1]);
    const list = ends.get(k);
    if (list) list.push(fid);
    else ends.set(k, [fid]);
  };
  footways.forEach((f) => {
    if (f.pts.length < 2 || f.length < 0.01) return;
    registerEnd(f.id, f.pts[0]);
    registerEnd(f.id, f.pts[f.pts.length - 1]);
  });
  for (const pid of layout.pathIds) {
    for (const p of [footways[pid].pts[0], footways[pid].pts[footways[pid].pts.length - 1]]) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = ends.get(endKey(p[0] + dx * LINK_M, p[1] + dz * LINK_M));
          if (!list) continue;
          for (const other of list) {
            if (other === pid) continue;
            const q = footways[other];
            const near = Math.min(
              Math.hypot(q.pts[0][0] - p[0], q.pts[0][1] - p[1]),
              Math.hypot(q.pts[q.pts.length - 1][0] - p[0], q.pts[q.pts.length - 1][1] - p[1]),
            );
            if (near <= LINK_M) link(pid, other);
          }
        }
      }
    }
  }
  footways.forEach((f, i) => {
    f.neighbours = [...links[i]];
  });

  const net: RoadNetwork = {
    nodes,
    edges,
    footways,
    sample(edgeId, dist, lateral, out) {
      const e = edges[edgeId];
      const d = Math.min(Math.max(dist, 0), e.length);
      const s = segmentAt(e.cum, d);
      const dx = e.pts[s + 1][0] - e.pts[s][0];
      const dz = e.pts[s + 1][1] - e.pts[s][1];
      const l = Math.hypot(dx, dz) || 1;
      const t = (d - e.cum[s]) / (e.cum[s + 1] - e.cum[s] || 1);
      out[0] = e.pts[s][0] + dx * t + (dz / l) * lateral;
      out[1] = e.pts[s][1] + dz * t - (dx / l) * lateral;
      return Math.atan2(dx, dz);
    },
    sampleFootway(footwayId, dist, out) {
      const f = footways[footwayId];
      const d = Math.min(Math.max(dist, 0), f.length);
      const s = segmentAt(f.cum, d);
      const dx = f.pts[s + 1][0] - f.pts[s][0];
      const dz = f.pts[s + 1][1] - f.pts[s][1];
      const t = (d - f.cum[s]) / (f.cum[s + 1] - f.cum[s] || 1);
      out[0] = f.pts[s][0] + dx * t;
      out[1] = f.pts[s][1] + dz * t;
      return Math.atan2(dx, dz);
    },
  };
  registerLayout(net, layout);
  return net;
}
