// Pure simulation for citywide cyclists on the shared road graph (street edges only: downtown and
// every district's streets). Riders keep to the left gutter (LANE_OFFSET + 1.2 from the centre line),
// stop at red/amber lights, brake for anything ahead (injected), avoid closed roads, and can be
// knocked off (down > 0: hidden until they respawn). No three.js; mutates in place, no allocations per step.
import { LANE_OFFSET, ROAD_WIDTH } from "../../config";
import { ROAD_EDGES, getNode, edgeKey } from "../../roads";

export const RIDER_GUTTER = LANE_OFFSET + 1.2;
/** Stop this far before the end of a street segment for a light (the segment already ends short of the junction). */
const STOP_BEFORE = 2.5;
/** Gap to keep to the thing ahead. */
const KEEP = 1.6;
/** Brake zone: start slowing this far behind something. */
const BRAKE_ZONE = 6;
/** Stuck behind a stopped obstacle this long: squeeze past it (ignore obstacles for a moment). */
const SQUEEZE_AFTER = 8;
const SQUEEZE_FOR = 3;

/** Street-only adjacency over the merged road graph (built once). */
export interface StreetGraph {
  adj: Map<string, string[]>;
  /** Undirected street edge keys, downtown first then the rest. */
  downtown: string[];
  districts: string[];
}

let cached: StreetGraph | null = null;

export function streetGraph(): StreetGraph {
  if (cached) return cached;
  const adj = new Map<string, string[]>();
  const downtown: string[] = [];
  const districts: string[] = [];
  for (const e of ROAD_EDGES.values()) {
    if (e.kind !== "street" || e.length < 8) continue;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
    if (e.a.startsWith("g_") && e.b.startsWith("g_")) downtown.push(e.key);
    else districts.push(e.key);
  }
  cached = { adj, downtown, districts };
  return cached;
}

export interface Rider {
  id: string;
  from: string;
  to: string;
  seg: 0 | 1; // 0 riding a street, 1 crossing a junction onto from->to
  d: number; // metres along the current segment
  len: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  edgeLen: number; // full from->to length
  setback: number; // metres the street segment starts after `from`
  cruise: number;
  speed: number;
  phase: number;
  x: number;
  z: number;
  heading: number;
  stuck: number; // seconds held by a stopped obstacle
  squeeze: number; // seconds left ignoring obstacles
  down: number; // > 0: knocked off, hidden for this many seconds
}

/** Street segment for from->to, offset onto the left gutter and set back from both junctions. */
function setStreet(r: Rider) {
  const a = getNode(r.from);
  const b = getNode(r.to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  // left of travel (ux, uz) is (uz, -ux): matches roads.lanePosition (drive on the left)
  const ox = uz * RIDER_GUTTER;
  const oz = -ux * RIDER_GUTTER;
  const s = Math.min(ROAD_WIDTH / 2, L * 0.25);
  r.x0 = a.x + ux * s + ox;
  r.z0 = a.z + uz * s + oz;
  r.x1 = b.x - ux * s + ox;
  r.z1 = b.z - uz * s + oz;
  r.len = L - 2 * s;
  r.edgeLen = L;
  r.setback = s;
  r.seg = 0;
  r.d = 0;
  r.heading = Math.atan2(ux, uz);
}

function place(r: Rider) {
  const t = r.len > 0 ? Math.min(1, r.d / r.len) : 1;
  r.x = r.x0 + (r.x1 - r.x0) * t;
  r.z = r.z0 + (r.z1 - r.z0) * t;
}

/** 0..1 along from->to (for the registry). Junction legs count as the start of the new street. */
export function riderT(r: Rider) {
  if (r.seg === 1) return 0;
  return Math.min(1, (r.setback + r.d) / (r.edgeLen || 1));
}

/** Put a rider on edge `key` (random direction and spot). */
export function placeRider(r: Rider, key: string, rand: () => number) {
  const e = ROAD_EDGES.get(key)!;
  const flip = rand() < 0.5;
  r.from = flip ? e.b : e.a;
  r.to = flip ? e.a : e.b;
  setStreet(r);
  r.d = rand() * Math.max(0, r.len - STOP_BEFORE - 1);
  r.speed = r.cruise;
  r.stuck = 0;
  r.squeeze = 0;
  r.down = 0;
  place(r);
}

export function createRider(id: string, key: string, rand: () => number): Rider {
  const r: Rider = {
    id, from: "", to: "", seg: 0, d: 0, len: 1, x0: 0, z0: 0, x1: 0, z1: 0, edgeLen: 1, setback: 0,
    cruise: 4 + rand() * 2.2, speed: 0, phase: rand() * Math.PI * 2, x: 0, z: 0, heading: 0, stuck: 0, squeeze: 0, down: 0,
  };
  placeRider(r, key, rand);
  return r;
}

/**
 * Spread `count` riders over distinct street edges: about 40% downtown, the rest across the districts.
 * Deterministic for a given rand.
 */
export function spawnRiders(count: number, rand: () => number, prefix = "bike"): Rider[] {
  const g = streetGraph();
  const out: Rider[] = [];
  const used = new Set<string>();
  const nDown = g.districts.length ? Math.round(count * 0.4) : count;
  for (let i = 0; i < count; i++) {
    const pool = i < nDown || !g.districts.length ? g.downtown : g.districts;
    if (!pool.length) break;
    let key = pool[Math.floor(rand() * pool.length)];
    for (let k = 0; k < 8 && used.has(key); k++) key = pool[Math.floor(rand() * pool.length)];
    used.add(key);
    out.push(createRider(`${prefix}-${i + 1}`, key, rand));
  }
  return out;
}

export interface RiderEnv {
  /** Light for traffic approaching `node` from `fromNode` is green (non-signal junctions: always). */
  isGreen(node: string, fromNode: string): boolean;
  isBlocked(key: string): boolean;
  /** Metres to the nearest obstacle ahead (Infinity when clear) and whether it's standing still. */
  ahead(r: Rider): number;
  aheadStopped(): boolean;
}

/** Pick the next node after arriving at r.to: no U-turns unless it's a dead end, avoid closed roads. */
export function nextNode(r: Rider, rand: () => number, isBlocked: (key: string) => boolean): string {
  const nbs = streetGraph().adj.get(r.to) ?? [];
  let pick = "";
  for (let pass = 0; pass < 3 && !pick; pass++) {
    let options = 0;
    for (const n of nbs) {
      if (pass < 2 && n === r.from) continue;
      if (pass < 1 && isBlocked(edgeKey(r.to, n))) continue;
      options++;
      if (rand() * options < 1) pick = n; // reservoir pick
    }
  }
  return pick || r.from;
}

/** Advance one rider by dt seconds. */
export function stepRider(r: Rider, dt: number, rand: () => number, env: RiderEnv) {
  if (r.down > 0) {
    r.down -= dt;
    r.speed = 0;
    return;
  }
  let target = r.cruise;
  // obstacle ahead (cars queueing, another bike, a wreck)
  if (r.squeeze > 0) r.squeeze -= dt;
  else {
    const gap = env.ahead(r);
    if (gap < BRAKE_ZONE) {
      target = Math.min(target, r.cruise * Math.max(0, (gap - KEEP) / (BRAKE_ZONE - KEEP)));
      if (target < 0.3) {
        target = 0;
        if (env.aheadStopped()) {
          r.stuck += dt;
          if (r.stuck > SQUEEZE_AFTER) {
            r.squeeze = SQUEEZE_FOR;
            r.stuck = 0;
          }
        }
      } else r.stuck = 0;
    } else r.stuck = 0;
  }
  // ease speed (bikes don't stop dead)
  r.speed += Math.max(-6 * dt, Math.min(2.5 * dt, target - r.speed));
  if (r.speed < 0.05 && target === 0) r.speed = 0;
  let move = r.speed * dt;
  // red light: stop at the line
  const stopAt = r.len - STOP_BEFORE;
  if (r.seg === 0 && r.d <= stopAt + 1e-6 && r.d + move > stopAt && !env.isGreen(r.to, r.from)) {
    move = Math.max(0, stopAt - r.d);
    r.speed = 0;
  }
  r.phase += move * 1.6;
  r.d += move;
  for (let guard = 0; guard < 4 && r.d >= r.len; guard++) {
    const extra = r.d - r.len;
    if (r.seg === 0) {
      const ex = r.x1;
      const ez = r.z1;
      const nxt = nextNode(r, rand, env.isBlocked);
      r.from = r.to;
      r.to = nxt;
      setStreet(r);
      // junction leg from where we are to the start of the next street
      const jl = Math.hypot(r.x0 - ex, r.z0 - ez);
      if (jl > 0.05) {
        r.x1 = r.x0;
        r.z1 = r.z0;
        r.x0 = ex;
        r.z0 = ez;
        r.len = jl;
        r.seg = 1;
        r.heading = Math.atan2(r.x1 - ex, r.z1 - ez);
      }
      r.d = extra;
    } else {
      setStreet(r);
      r.d = extra;
    }
  }
  place(r);
}
