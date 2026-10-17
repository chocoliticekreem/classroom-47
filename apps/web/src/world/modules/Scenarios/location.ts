// Pure location picking for staged scenes. Every scene gets a local frame:
//   origin = a kerb point (or an anchor point), +x runs along the road, +z points AWAY from the road
//   (towards the door / frontage), so the road is at local z < 0. rot = mesh.rotation.y for that frame.
import { getNode, ROAD_EDGES, type RoadEdge } from "../../roads";
import type { Where } from "../../scenarios";

export interface SceneLoc {
  x: number;
  z: number;
  rot: number;
  edgeKey: string | null; // the road this scene sits on (null for the office)
  /** Road centre point the frame was built from (for road scenes like the storm). */
  roadX: number;
  roadZ: number;
  /** Length of the edge (road scenes span it). */
  edgeLen: number;
  /** Local z of the frontage (house door / shop face / dock wall). */
  front: number;
  /** Local z where our prop van parks, half on the kerb, clear of the traffic lane. */
  vanZ: number;
}

export const KERB_OFFSET = 6; // road half width 4 + a little sidewalk
/** Downtown buildings start 7 m from the road centre, so downtown scenes sit on the sidewalk middle. */
export const OFFSETS: Record<Where, { kerb: number; front: number }> = {
  suburbs: { kerb: 6, front: 6 },
  downtown: { kerb: 5.5, front: 1.4 },
  depot: { kerb: 6, front: 4 },
  docks: { kerb: 6, front: 4 },
  road: { kerb: 6, front: 3 },
  office: { kerb: 0, front: 0 },
};
export const OFFICE = { x: 100, z: -60 };
const MIN_SEPARATION = 26;

const isZone = (e: RoadEdge, prefix: string) => e.a.startsWith(prefix) && e.b.startsWith(prefix);

/** Candidate edges per place. Depot/docks also include their access edges. */
export function edgesFor(where: Where): RoadEdge[] {
  const all = [...ROAD_EDGES.values()];
  switch (where) {
    case "suburbs":
      return all.filter((e) => isZone(e, "sub_"));
    case "downtown":
      // stay off the outer ring of the grid (ramps, highway clutter) for kerb scenes
      return all.filter((e) => isZone(e, "g_") && [e.a, e.b].every((id) => {
        const n = getNode(id);
        return Math.abs(n.x) <= 120 && Math.abs(n.z) <= 120;
      }));
    case "depot":
      return all.filter((e) => isZone(e, "depot_"));
    case "docks":
      return all.filter((e) => isZone(e, "dock_") || (e.a === "dock_gate" || e.b === "dock_gate"));
    case "road":
      // city streets and the highway ring only: never a zone access road (blocking one could strand the depot)
      return all.filter((e) => (e.kind === "street" || e.kind === "highway") && [e.a, e.b].every((id) => id.startsWith("g_") || id.startsWith("h_")));
    case "office":
      return [];
  }
}

/** Frame at fraction t along edge, on side `side` (+1 / -1) of the road. */
export function frameOnEdge(e: RoadEdge, t: number, side: 1 | -1, offset = KERB_OFFSET, front = 4): SceneLoc {
  const a = getNode(e.a);
  const b = getNode(e.b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  // normal pointing to the chosen side
  const nx = -uz * side;
  const nz = ux * side;
  const cx = a.x + dx * t;
  const cz = a.z + dz * t;
  return {
    x: cx + nx * offset,
    z: cz + nz * offset,
    rot: Math.atan2(nx, nz), // local +z -> (nx, nz)
    edgeKey: e.key,
    roadX: cx,
    roadZ: cz,
    edgeLen: len,
    front,
    vanZ: 4 - offset,
  };
}

export interface PickOpts {
  rand: () => number;
  taken?: readonly { x: number; z: number }[];
  blocked?: ReadonlySet<string>;
  /** road scenes sit on the centre line (storm) instead of the kerb */
  onRoad?: boolean;
}

function farEnough(x: number, z: number, taken: readonly { x: number; z: number }[], d = MIN_SEPARATION) {
  return taken.every((p) => Math.hypot(p.x - x, p.z - z) >= d);
}

function officeLoc(x: number): SceneLoc {
  return { x, z: OFFICE.z, rot: 0, edgeKey: null, roadX: x, roadZ: OFFICE.z, edgeLen: 0, front: 0, vanZ: 0 };
}

export function pickLocation(where: Where, opts: PickOpts): SceneLoc {
  const { rand, taken = [], blocked = new Set<string>() } = opts;
  if (where === "office") {
    // up to 4 tickets side by side around the tower
    const slots = [0, 1, -1, 2];
    for (const k of slots) {
      const x = OFFICE.x + k * 7;
      if (farEnough(x, OFFICE.z, taken, 5)) return officeLoc(x);
    }
    return officeLoc(OFFICE.x);
  }
  const pool = edgesFor(where).filter((e) => !blocked.has(e.key));
  const edges = pool.length ? pool : edgesFor(where);
  let best: SceneLoc | null = null;
  let bestD = -1;
  for (let i = 0; i < 16; i++) {
    const e = edges[Math.floor(rand() * edges.length)];
    const t = 0.35 + rand() * 0.3;
    const side: 1 | -1 = rand() < 0.5 ? 1 : -1;
    const o = OFFSETS[where];
    const loc = opts.onRoad ? frameOnEdge(e, 0.5, side, 0, 0) : frameOnEdge(e, t, side, o.kerb, o.front);
    if (farEnough(loc.x, loc.z, taken)) return loc;
    const d = Math.min(...taken.map((p) => Math.hypot(p.x - loc.x, p.z - loc.z)));
    if (d > bestD) {
      bestD = d;
      best = loc;
    }
  }
  return best!;
}
