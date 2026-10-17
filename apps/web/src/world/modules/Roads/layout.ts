// Builds every static road surface, marking, sidewalk, barrier and gantry from the road graph. Pure: no React.
import { BLOCK, GRID_HALF, HIGHWAY_RING, ROAD_WIDTH } from "../../config";
import { ROAD_EDGES, getEdge, getNode, neighbours, type RoadEdge, type RoadKind, type RoadNode } from "../../roads";
import { FlatBuilder, boxAlong, dashes, type BoxInst } from "./geometry";

export const HALF: Record<RoadKind, number> = { street: ROAD_WIDTH / 2, ramp: ROAD_WIDTH / 2, highway: 6, country: 3 };

/** Layer heights. Every flat surface stays inside 0.02..0.06; polygonOffset in the materials does the rest. */
export const Y = {
  country: 0.02,
  street: 0.026,
  patch: 0.032,
  highway: 0.038,
  marking: 0.046,
  hwMarking: 0.05,
  closure: 0.058,
} as const;

const R = HIGHWAY_RING;
const LINE = 0.16; // marking line width
const SIDEWALK = 3;
const SIDEWALK_H = 0.14;
const HW_GAP = 9; // gap in highway barriers/lines where a ramp or road joins

export interface Gantry {
  x: number;
  z: number;
  /** unit direction a -> b */
  dx: number;
  dz: number;
  /** sign text for traffic travelling along +d, and along -d */
  fwd: [string, string];
  back: [string, string];
}

export interface RoadLayout {
  street: FlatBuilder; // streets + ramps
  highway: FlatBuilder;
  country: FlatBuilder;
  patches: FlatBuilder; // downtown junction squares
  markings: FlatBuilder; // all white paint
  sidewalks: BoxInst[];
  curbs: BoxInst[];
  centralBarrier: BoxInst[];
  rails: BoxInst[];
  railPosts: BoxInst[];
  gantryMetal: BoxInst[];
  gantries: Gantry[];
}

const isDowntown = (n: RoadNode) => n.zone === "downtown";
const isCorner = (n: RoadNode) => Math.abs(n.x) === R && Math.abs(n.z) === R;

/** How far from a node the paint on a non-highway edge must stop (keeps junctions clean). */
export function paintTrim(id: string): number {
  const n = getNode(id);
  if (isDowntown(n)) return HALF.street + 4.5;
  const nbs = neighbours(id);
  if (nbs.length <= 1) return 0.5;
  let m = 0;
  for (const nb of nbs) m = Math.max(m, HALF[getEdge(id, nb)!.kind]);
  return m + 1;
}

/** How far from a node a closure overlay starts (so it covers the road, not the junction). */
export function closureTrim(id: string, kind: RoadKind): number {
  const n = getNode(id);
  if (n.zone === "highway") return kind === "highway" ? (isCorner(n) ? 0 : HW_GAP - 2) : HALF.highway + 0.5;
  if (isDowntown(n)) return HALF.street + 0.5;
  return Math.max(0.5, paintTrim(id) - 0.5);
}

function edgeEnds(e: RoadEdge) {
  const a = getNode(e.a);
  const b = getNode(e.b);
  return { a, b, len: e.length, dx: (b.x - a.x) / e.length, dz: (b.z - a.z) / e.length };
}

/** For a highway node, does a non-highway road leave it on the given side (sign of n . (nb - node))? */
function hasSideRoad(node: RoadNode, nx: number, nz: number, side: 1 | -1 | 0) {
  for (const id of neighbours(node.id)) {
    if (getEdge(node.id, id)!.kind === "highway") continue;
    if (side === 0) return true;
    const o = getNode(id);
    if (Math.sign((o.x - node.x) * nx + (o.z - node.z) * nz) === side) return true;
  }
  return false;
}

const GANTRY_DEFS: { a: string; b: string; t: number; fwd: [string, string]; back: [string, string] }[] = [
  { a: "h_6", b: "h_7", t: 0.4, fwd: ["A-RING", "DEPOT ↓"], back: ["A-RING", "DOCKS ↗"] },
  { a: "h_9", b: "h_10", t: 0.45, fwd: ["A-RING", "DEPOT ↓"], back: ["A-RING", "DOCKS ↗"] },
  { a: "h_13", b: "h_14", t: 0.55, fwd: ["A-RING", "FARMS ←"], back: ["A-RING", "DEPOT ↓"] },
  { a: "h_1", b: "h_2", t: 0.55, fwd: ["A-RING", "SUBURBS ↑"], back: ["A-RING", "FARMS ←"] },
  { a: "h_4", b: "h_5", t: 0.5, fwd: ["A-RING", "CITY ↖"], back: ["A-RING", "SUBURBS ↑"] },
  { a: "h_10", b: "h_11", t: 0.55, fwd: ["A-RING", "CITY ↗"], back: ["A-RING", "DEPOT ↓"] },
];

export function buildRoadLayout(): RoadLayout {
  const L: RoadLayout = {
    street: new FlatBuilder(),
    highway: new FlatBuilder(),
    country: new FlatBuilder(),
    patches: new FlatBuilder(),
    markings: new FlatBuilder(),
    sidewalks: [],
    curbs: [],
    centralBarrier: [],
    rails: [],
    railPosts: [],
    gantryMetal: [],
    gantries: [],
  };

  for (const e of ROAD_EDGES.values()) {
    const { a, b, len, dx, dz } = edgeEnds(e);
    const half = HALF[e.kind];

    if (e.kind === "highway") {
      L.highway.strip(a.x, a.z, b.x, b.z, -half, len + half, half, Y.highway);
      // outward side vector (away from the city centre)
      let nx = -dz;
      let nz = dx;
      if (nx * (a.x + b.x) + nz * (a.z + b.z) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const sideSign = nx === -dz && nz === dx ? 1 : -1; // FlatBuilder offsets are along (-dz, dx)
      // a line/barrier at outward offset o: mitred at ring corners, gapped where a road joins on that side
      const span = (o: number): [number, number] => {
        const side = o > 0.01 ? 1 : o < -0.01 ? -1 : 0;
        const s0 = isCorner(a) ? -o : hasSideRoad(a, nx, nz, side) ? HW_GAP : 0;
        const s1 = isCorner(b) ? len + o : hasSideRoad(b, nx, nz, side) ? len - HW_GAP : len;
        return [s0, s1];
      };
      const solid = (o: number) => {
        const [s0, s1] = span(o);
        L.markings.strip(a.x, a.z, b.x, b.z, s0, s1, LINE / 2, Y.hwMarking, o * sideSign);
      };
      for (const o of [5.5, -5.5, 0.7, -0.7]) solid(o);
      for (const o of [3.1, -3.1]) {
        const [s0, s1] = span(o);
        for (const [d0, d1] of dashes(s0 + 2, s1 - 2, 4, 6))
          L.markings.strip(a.x, a.z, b.x, b.z, d0, d1, LINE / 2, Y.hwMarking, o * sideSign);
      }
      // central concrete barrier
      {
        const [s0, s1] = span(0);
        L.centralBarrier.push(boxAlong(a.x, a.z, b.x, b.z, s0, s1, 0, 0.5, 0.85));
      }
      // side crash barriers: a steel rail on posts
      for (const o of [6.3, -6.3]) {
        const [s0, s1] = span(o);
        if (s1 - s0 < 1) continue;
        L.rails.push(boxAlong(a.x, a.z, b.x, b.z, s0, s1, o * sideSign, 0.12, 0.32, 0.42));
        const n = Math.max(1, Math.floor((s1 - s0) / 4));
        for (let i = 0; i <= n; i++) {
          const s = s0 + ((s1 - s0) * i) / n;
          L.railPosts.push(boxAlong(a.x, a.z, b.x, b.z, s - 0.08, s + 0.08, (o + 0.12 * Math.sign(o)) * sideSign, 0.14, 0.75));
        }
      }
      continue;
    }

    const target = e.kind === "country" ? L.country : L.street;
    const y = e.kind === "country" ? Y.country : Y.street;
    target.strip(a.x, a.z, b.x, b.z, -half, len + half, half, y);

    // paint
    const s0 = paintTrim(a.id);
    const s1 = len - paintTrim(b.id);
    if (e.kind === "country") {
      for (const [d0, d1] of dashes(s0, s1, 2, 5)) L.markings.strip(a.x, a.z, b.x, b.z, d0, d1, 0.07, Y.marking);
    } else {
      for (const [d0, d1] of dashes(s0, s1, 3, 3)) L.markings.strip(a.x, a.z, b.x, b.z, d0, d1, LINE / 2, Y.marking);
      const downtownStreet = isDowntown(a) && isDowntown(b);
      if (!downtownStreet) {
        for (const o of [half - 0.45, -(half - 0.45)]) L.markings.strip(a.x, a.z, b.x, b.z, s0, s1, LINE / 2, Y.marking, o);
      }
    }
  }

  // Junction patches for the non-downtown, non-ring nodes so angled joins look filled in
  const seen = new Set<string>();
  for (const e of ROAD_EDGES.values()) {
    for (const id of [e.a, e.b]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = getNode(id);
      if (n.zone === "highway" || isDowntown(n)) continue;
      let widest: RoadKind = "country";
      for (const nb of neighbours(id)) {
        const k = getEdge(id, nb)!.kind;
        if (k !== "highway" && HALF[k] > HALF[widest]) widest = k;
      }
      const b = widest === "country" ? L.country : L.street;
      b.disc(n.x, n.z, HALF[widest] * 1.15, widest === "country" ? Y.country : Y.street, 20);
    }
  }

  // Downtown: junction squares, zebra crossings, stop lines
  for (let i = -GRID_HALF; i <= GRID_HALF; i++)
    for (let j = -GRID_HALF; j <= GRID_HALF; j++) {
      const id = `g_${i}_${j}`;
      const n = getNode(id);
      L.patches.rect(n.x, n.z, ROAD_WIDTH, ROAD_WIDTH, Y.patch);
      for (const nb of neighbours(id)) {
        const o = getNode(nb);
        const len = Math.hypot(o.x - n.x, o.z - n.z);
        // zebra: stripes parallel to the road, spread across it
        for (let k = 0; k < 7; k++) {
          const off = -3 + k;
          L.markings.strip(n.x, n.z, o.x, o.z, 4.7, 7.3, 0.28, Y.marking, off);
        }
        // stop line across the incoming (left-hand) lane
        if (len > 20) L.markings.strip(n.x, n.z, o.x, o.z, 7.8, 8.2, 1.85, Y.marking, 1.95);
      }
    }

  // Downtown sidewalks and curbs: a 3 m ring inside every block
  const cells: number[] = [];
  for (let c = -GRID_HALF; c < GRID_HALF; c++) cells.push(c * BLOCK + BLOCK / 2);
  const inner = BLOCK / 2 - HALF.street; // 16
  for (const cx of cells)
    for (const cz of cells) {
      const sw = (x: number, z: number, sx: number, sz: number) =>
        L.sidewalks.push({ x, y: SIDEWALK_H / 2, z, rotY: 0, sx, sy: SIDEWALK_H, sz });
      const mid = inner - SIDEWALK / 2;
      sw(cx, cz - mid, inner * 2, SIDEWALK); // north
      sw(cx, cz + mid, inner * 2, SIDEWALK); // south
      sw(cx - mid, cz, SIDEWALK, (inner - SIDEWALK) * 2); // west
      sw(cx + mid, cz, SIDEWALK, (inner - SIDEWALK) * 2); // east
      const cb = (x: number, z: number, sx: number, sz: number) =>
        L.curbs.push({ x, y: (SIDEWALK_H + 0.04) / 2, z, rotY: 0, sx, sy: SIDEWALK_H + 0.04, sz });
      const ce = inner - 0.12;
      cb(cx, cz - ce, inner * 2, 0.24);
      cb(cx, cz + ce, inner * 2, 0.24);
      cb(cx - ce, cz, 0.24, inner * 2 - 0.48);
      cb(cx + ce, cz, 0.24, inner * 2 - 0.48);
    }

  // Overhead sign gantries
  for (const g of GANTRY_DEFS) {
    const e = getEdge(g.a, g.b);
    if (!e) continue;
    const a = getNode(g.a);
    const b = getNode(g.b);
    const dx = (b.x - a.x) / e.length;
    const dz = (b.z - a.z) / e.length;
    const s = e.length * g.t;
    L.gantries.push({ x: a.x + dx * s, z: a.z + dz * s, dx, dz, fwd: g.fwd, back: g.back });
    const box = (s0: number, s1: number, off: number, w: number, h: number, base: number) =>
      L.gantryMetal.push(boxAlong(a.x, a.z, b.x, b.z, s + s0, s + s1, off, w, h, base));
    box(-0.2, 0.2, 7.5, 0.4, 7.9, 0); // posts
    box(-0.2, 0.2, -7.5, 0.4, 7.9, 0);
    box(-0.25, 0.25, 0, 15.4, 0.5, 7.3); // beam
    // sign backing boards: traffic along +d drives on its left, i.e. side offset -3; along -d at +3
    box(-0.27, -0.12, -3, 5.7, 2.5, 5.0);
    box(0.12, 0.27, 3, 5.7, 2.5, 5.0);
  }

  return L;
}
