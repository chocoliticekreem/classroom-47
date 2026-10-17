// Airport fire service: two crash tenders and an ambulance. Airside they cross the grass; to a crash off the
// airfield they drive the public road graph (left-hand lanes) and finish off-road next to the wreck.
import { findPath, getNode, lanePosition, ROAD_NODES } from "../../roads";
import {
  CREW_EAST_X,
  CREW_HOMES,
  CREW_NORTH_Z,
  CREW_WEST_X,
  SERVICE_ROAD_Z,
} from "./layout";
import { Path, roundCorners, v3, type V3 } from "./path";

export type CrewKind = "fire" | "ambulance";
export type CrewState = "home" | "out" | "onscene" | "returning";

export interface RoadSeg {
  d0: number;
  d1: number;
  from: string;
  to: string;
}

export interface CrewUnit {
  id: string;
  kind: CrewKind;
  index: number;
  home: { x: number; z: number; yaw: number };
  state: CrewState;
  path: Path | null;
  segs: RoadSeg[];
  d: number;
  speed: number;
  vmax: number;
  delay: number;
  x: number;
  z: number;
  yaw: number;
  /** Point the unit faces / sprays at once on scene. */
  target: V3 | null;
  spraying: boolean;
  /** live road position for the registry */
  from: string | null;
  to: string | null;
  t: number;
}

const ROAD_NODE = "airport_terminal";
const tmp = v3(0, 0, 0);

export function makeCrew(): CrewUnit[] {
  return CREW_HOMES.map((h, i) => ({
    id: i < 2 ? `ARFF-${i + 1}` : "AMB-AP",
    kind: i < 2 ? "fire" : "ambulance",
    index: i,
    home: { ...h },
    state: "home",
    path: null,
    segs: [],
    d: 0,
    speed: 0,
    vmax: 14,
    delay: 0,
    x: h.x,
    z: h.z,
    yaw: h.yaw,
    target: null,
    spraying: false,
    from: null,
    to: null,
    t: 0,
  }));
}

const flat = (x: number, z: number) => v3(x, 0, z);

/** Airside: west around the station, north past the runway threshold, east along the north strip. */
export function airsideOut(u: CrewUnit, dest: { x: number; z: number }): V3[] {
  return [
    flat(u.x, u.z),
    flat(u.x, u.z - 6),
    flat(CREW_WEST_X, u.z - 10),
    flat(CREW_WEST_X, CREW_NORTH_Z + u.index * 1.5),
    flat(dest.x - 12, CREW_NORTH_Z + u.index * 1.5),
    flat(dest.x, dest.z),
  ];
}

export function airsideBack(u: CrewUnit): V3[] {
  const h = u.home;
  return [
    flat(u.x, u.z),
    flat(u.x - 10, CREW_NORTH_Z + u.index * 1.5),
    flat(CREW_WEST_X, CREW_NORTH_Z + u.index * 1.5),
    flat(CREW_WEST_X, h.z - 10),
    flat(h.x, h.z - 8),
    flat(h.x, h.z),
  ];
}

/** Lane points along a node path, with the distance ranges of each road edge (measured on the raw polyline). */
function lanePoints(nodes: string[], pts: V3[], segs: RoadSeg[]) {
  let d = polyLen(pts);
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [ax, az] = lanePosition(nodes[i], nodes[i + 1], 0);
    const [bx, bz] = lanePosition(nodes[i], nodes[i + 1], 1);
    const last = pts[pts.length - 1];
    d += Math.hypot(ax - last.x, az - last.z);
    pts.push(flat(ax, az));
    const len = Math.hypot(bx - ax, bz - az);
    segs.push({ d0: d, d1: d + len, from: nodes[i], to: nodes[i + 1] });
    d += len;
    pts.push(flat(bx, bz));
  }
}

function polyLen(pts: V3[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
}

/**
 * The road node the crews drive to: the nearest one to the site that can still be reached from the airport
 * with the current closures (the cordon around a crash seals off the nodes right next to it).
 */
export function approachNode(site: { x: number; z: number }, blocked: ReadonlySet<string>): { node: string; nodes: string[] } | null {
  const near = [...ROAD_NODES.values()]
    .map((n) => ({ id: n.id, d: Math.hypot(n.x - site.x, n.z - site.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 14);
  for (const n of near) {
    const nodes = findPath(ROAD_NODE, n.id, blocked);
    if (nodes) return { node: n.id, nodes };
  }
  return null;
}

/** Where each unit parks: on the line from its road node toward the fire, fanned out, short of the wreck. */
export function standoff(site: { x: number; z: number }, node: string, index: number, dist: number): { x: number; z: number } {
  const n = getNode(node);
  const dx = n.x - site.x;
  const dz = n.z - site.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const side = (index - 1) * 9;
  const back = Math.min(l, index === 2 ? dist + 12 : dist);
  return { x: site.x + ux * back - uz * side, z: site.z + uz * back + ux * side };
}

export interface RoadRoute {
  pts: V3[];
  segs: RoadSeg[];
}

/** Station -> service road -> road graph (left lanes) -> off-road to a standoff point by the fire. */
export function roadOut(u: CrewUnit, site: { x: number; z: number }, blocked: ReadonlySet<string>, dist: number): RoadRoute | null {
  const ap = approachNode(site, blocked);
  if (!ap) return null;
  const pts: V3[] = [
    flat(u.x, u.z),
    flat(CREW_EAST_X, u.z),
    flat(CREW_EAST_X, SERVICE_ROAD_Z - 1.5),
    flat(getNode(ROAD_NODE).x - 6, SERVICE_ROAD_Z - 1.5),
  ];
  const segs: RoadSeg[] = [];
  if (ap.nodes.length > 1) lanePoints(ap.nodes, pts, segs);
  const so = standoff(site, ap.node, u.index, dist);
  pts.push(flat(so.x, so.z));
  return { pts, segs };
}

/** Back from the fire to the station by road. */
export function roadBack(u: CrewUnit, site: { x: number; z: number }, blocked: ReadonlySet<string>): RoadRoute | null {
  const ap = approachNode(site, blocked);
  if (!ap) return null;
  const pts: V3[] = [flat(u.x, u.z)];
  const segs: RoadSeg[] = [];
  const back = [...ap.nodes].reverse();
  if (back.length > 1) lanePoints(back, pts, segs);
  else {
    const n = getNode(back[0]);
    pts.push(flat(n.x, n.z));
  }
  pts.push(flat(getNode(ROAD_NODE).x - 6, SERVICE_ROAD_Z + 1.5));
  pts.push(flat(CREW_EAST_X + 3, SERVICE_ROAD_Z + 1.5));
  pts.push(flat(CREW_EAST_X + 3, u.home.z));
  pts.push(flat(u.home.x, u.home.z));
  return { pts, segs };
}

export function dispatch(u: CrewUnit, pts: V3[], segs: RoadSeg[], delay: number, vmax: number, state: CrewState) {
  u.path = new Path(roundCorners(pts, 7, 6));
  u.segs = segs;
  u.d = 0;
  u.speed = 0;
  u.delay = delay;
  u.vmax = vmax;
  u.state = state;
  u.spraying = false;
}

/** Advance one unit; returns true on the frame it arrives. */
export function stepCrew(u: CrewUnit, dt: number): boolean {
  if (!u.path || (u.state !== "out" && u.state !== "returning")) {
    u.from = u.to = null;
    const aim = u.state === "onscene" && u.target ? Math.atan2(u.target.x - u.x, u.target.z - u.z) : u.state === "home" ? u.home.yaw : null;
    if (aim !== null) {
      // tenders swing round to aim the monitor; back at the station they square up to their bay
      const want = aim;
      let dy = want - u.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      u.yaw += dy * Math.min(1, dt * 1.5);
    }
    return false;
  }
  if (u.delay > 0) {
    u.delay -= dt;
    return false;
  }
  const remaining = u.path.length - u.d;
  const want = Math.min(u.vmax, 2 + remaining * 0.7);
  u.speed += Math.max(-8 * dt, Math.min(4 * dt, want - u.speed));
  u.d = Math.min(u.path.length, u.d + u.speed * dt);
  u.path.sample(u.d, tmp);
  u.x = tmp.x;
  u.z = tmp.z;
  u.path.tangent(u.d, tmp);
  u.yaw = Math.atan2(tmp.x, tmp.z);
  u.from = u.to = null;
  for (const s of u.segs)
    if (u.d >= s.d0 && u.d <= s.d1) {
      u.from = s.from;
      u.to = s.to;
      u.t = s.d1 > s.d0 ? (u.d - s.d0) / (s.d1 - s.d0) : 0;
      break;
    }
  if (u.d >= u.path.length - 0.05) {
    u.path = null;
    u.speed = 0;
    if (u.state === "returning") {
      u.state = "home";
      u.target = null;
    } else u.state = "onscene";
    return true;
  }
  return false;
}
