// Pure placement for traffic lights, street lamps and zebra crossings. No three.js here.
import { ROAD_EDGES, ROAD_NODES, getNode, neighbours, type RoadEdge } from "../../roads";
import { hasSignal } from "../../signals";

export const SIGNAL_SETBACK = 5.2; // metres before the junction centre, along the approach
export const SIGNAL_KERB = 4.8; // metres left of the road centre line (road half-width is 4)

export interface SignalHead {
  node: string; // junction this head controls
  from: string; // neighbour the approaching traffic comes from
  x: number;
  z: number;
  yaw: number; // rotation.y so the head's +z face looks at the oncoming driver
}

/** Unit direction a->b and the LEFT vector of that direction of travel (matches roads.lanePosition). */
function frame(ax: number, az: number, bx: number, bz: number) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  return { dx, dz, lx: dz, lz: -dx, len };
}

/** One UK-style primary signal per approach: near-side left kerb, just before the stop line. */
export function signalHeads(): SignalHead[] {
  const out: SignalHead[] = [];
  for (const n of ROAD_NODES.values()) {
    if (!hasSignal(n.id)) continue;
    for (const from of neighbours(n.id)) {
      const f = getNode(from);
      const { dx, dz, lx, lz } = frame(f.x, f.z, n.x, n.z);
      out.push({
        node: n.id,
        from,
        x: n.x - dx * SIGNAL_SETBACK + lx * SIGNAL_KERB,
        z: n.z - dz * SIGNAL_SETBACK + lz * SIGNAL_KERB,
        yaw: Math.atan2(-dx, -dz),
      });
    }
  }
  return out;
}

export interface LampPost {
  x: number;
  z: number;
  yaw: number; // rotation.y so local +z (the arm) points over the road
}

const LAMP_SPACING = 20;

function lampOffset(e: RoadEdge): number | null {
  const a = getNode(e.a);
  const b = getNode(e.b);
  if (e.kind === "street" && a.zone === "downtown" && b.zone === "downtown") return 5;
  if (e.kind === "highway" || e.kind === "ramp") return 5.5;
  return null;
}

/** Lamps every ~20 m on both sides of downtown streets, ramps and the highway ring. */
export function lampPosts(): LampPost[] {
  const out: LampPost[] = [];
  for (const e of ROAD_EDGES.values()) {
    const off = lampOffset(e);
    if (off === null) continue;
    const a = getNode(e.a);
    const b = getNode(e.b);
    const { dx, dz, lx, lz, len } = frame(a.x, a.z, b.x, b.z);
    const n = Math.max(1, Math.round(len / LAMP_SPACING));
    for (let k = 0; k < n; k++) {
      const d = ((k + 0.5) / n) * len;
      const cx = a.x + dx * d;
      const cz = a.z + dz * d;
      for (const side of [1, -1]) {
        const x = cx + lx * off * side;
        const z = cz + lz * off * side;
        // arm points back toward the centre line: direction -left*side
        out.push({ x, z, yaw: Math.atan2(-lx * side, -lz * side) });
      }
    }
  }
  return out;
}

export interface ZebraCrossing {
  a: string;
  b: string;
  x: number; // crossing centre
  z: number;
  yaw: number; // rotation.y aligned with the road (local +z along a->b)
  lx: number; // left vector of a->b, for laying stripes across the road
  lz: number;
}

const ZEBRA_DIST = 17; // metres from the junction: between the lamps at 10 m and 30 m

const ZEBRA_EDGES: [string, string][] = [
  ["g_0_-1", "g_1_-1"],
  ["g_-1_1", "g_-1_2"],
  ["g_-3_0", "g_-2_0"],
  ["g_2_2", "g_2_3"],
  ["g_1_-3", "g_1_-2"],
  ["g_-2_-3", "g_-1_-3"],
  ["g_3_1", "g_3_0"],
  ["g_0_3", "g_-1_3"],
  ["g_-1_0", "g_-1_-1"],
];

export function zebraCrossings(): ZebraCrossing[] {
  return ZEBRA_EDGES.filter(([a, b]) => neighbours(a).includes(b)).map(([a, b]) => {
    const na = getNode(a);
    const nb = getNode(b);
    const { dx, dz, lx, lz } = frame(na.x, na.z, nb.x, nb.z);
    return { a, b, x: na.x + dx * ZEBRA_DIST, z: na.z + dz * ZEBRA_DIST, yaw: Math.atan2(dx, dz), lx, lz };
  });
}
