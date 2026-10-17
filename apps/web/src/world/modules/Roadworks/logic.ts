// Pure logic for the Roadworks module: spawn schedule, target choice, routes, the job state machine,
// road names and the cone/barrier/sign layout. No three.js, no React, so it is unit tested.
import { HIGHWAY_RING } from "../../config";
import { ROAD_EDGES, edgeKey, findPath, getEdge, getNode, type RoadEdge } from "../../roads";

export const MAX_CONCURRENT = 2;
export const FIRST_SPAWN_S = 15;
export const SPAWN_INTERVAL_S = 70;
export const RETRY_S = 10; // when all crews are busy, try again this much later
export const DEPLOY_S = 6; // crew hop out and lay out the site
export const PACK_S = 5; // crew pack the site up
export const ACTIVE_MIN_S = 45;
export const ACTIVE_MAX_S = 60;

// --- Scheduler ----------------------------------------------------------------

export interface Scheduler {
  nextAt: number; // sim seconds
}

export function createScheduler(): Scheduler {
  return { nextAt: FIRST_SPAWN_S };
}

/** True when a scheduled roadworks crew should leave now. Advances the schedule. */
export function schedulerDue(s: Scheduler, nowS: number, activeJobs: number): boolean {
  if (nowS < s.nextAt) return false;
  if (activeJobs >= MAX_CONCURRENT) {
    s.nextAt = nowS + RETRY_S;
    return false;
  }
  s.nextAt = nowS + SPAWN_INTERVAL_S;
  return true;
}

// --- Target choice --------------------------------------------------------------

/** How attractive a road is for emergency roadworks: highway and busy central streets first. */
export function targetWeight(e: RoadEdge): number {
  if (e.kind === "highway") return 3;
  if (e.kind === "ramp") return 1;
  if (e.kind === "street" && e.a.startsWith("g_") && e.b.startsWith("g_")) {
    const a = getNode(e.a);
    const b = getNode(e.b);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    return Math.max(Math.abs(mx), Math.abs(mz)) <= 100 ? 3 : 1;
  }
  return 0;
}

function travelTime(path: string[]) {
  let t = 0;
  for (let i = 1; i < path.length; i++) {
    const e = getEdge(path[i - 1], path[i])!;
    t += e.length / e.speedLimit;
  }
  return t;
}

export interface ChooseOpts {
  from: string; // the yard
  blocked: ReadonlySet<string>;
  exclude: ReadonlySet<string>; // roads other crews are already working on
  rand?: () => number;
}

/** Weighted random road to close. Null if nothing suitable. The road must be bypassable and reachable. */
export function chooseTarget({ from, blocked, exclude, rand = Math.random }: ChooseOpts): string | null {
  const pool: { e: RoadEdge; w: number }[] = [];
  let total = 0;
  for (const e of ROAD_EDGES.values()) {
    if (blocked.has(e.key) || exclude.has(e.key) || e.a === from || e.b === from) continue;
    let w = targetWeight(e);
    if (w <= 0) continue;
    // Don't pile closures onto the same junction: that just gridlocks the city.
    for (const k of [...blocked, ...exclude]) {
      const o = ROAD_EDGES.get(k);
      if (o && (o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b)) w *= 0.15;
    }
    pool.push({ e, w });
    total += w;
  }
  for (let attempt = 0; attempt < 25 && pool.length; attempt++) {
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      if (r < pool[idx].w) break;
      r -= pool[idx].w;
    }
    const { e, w } = pool[idx];
    const withIt = new Set(blocked);
    withIt.add(e.key);
    if (findPath(e.a, e.b, withIt) && planOutbound(e.key, from, blocked)) return e.key;
    pool.splice(idx, 1);
    total -= w;
  }
  return null;
}

// --- Routes -------------------------------------------------------------------------

/** Drive nodes[0] -> nodes[1] -> ... and stop on the last segment at t = endT. */
export interface Route {
  nodes: string[];
  endT: number;
}

export interface Cursor {
  seg: number; // segment index: nodes[seg] -> nodes[seg + 1]
  t: number; // 0..1 along that segment
}

/** Route from the yard to the midpoint of `target`, entering it from whichever end is quicker. */
export function planOutbound(target: string, from: string, blocked: ReadonlySet<string>): Route | null {
  const e = ROAD_EDGES.get(target);
  if (!e) return null;
  const bl = new Set(blocked);
  bl.add(target);
  let best: string[] | null = null;
  let bestT = Infinity;
  for (const [entry, exit] of [
    [e.a, e.b],
    [e.b, e.a],
  ]) {
    const p = findPath(from, entry, bl);
    if (!p) continue;
    const t = travelTime(p);
    if (t < bestT) {
      bestT = t;
      best = [...p, exit];
    }
  }
  return best ? { nodes: best, endT: 0.5 } : null;
}

/** Route home from the site (stopped at t = 0.5 on a -> b): carry on to b, then drive to the yard. Falls back to a U-turn. */
export function planReturn(a: string, b: string, yard: string, blocked: ReadonlySet<string>): { route: Route; cursor: Cursor } | null {
  const fwd = b === yard ? [b] : findPath(b, yard, blocked);
  if (fwd) return { route: { nodes: [a, ...fwd], endT: 1 }, cursor: { seg: 0, t: 0.5 } };
  const back = a === yard ? [a] : findPath(a, yard, blocked);
  if (back) return { route: { nodes: [b, ...back], endT: 1 }, cursor: { seg: 0, t: 0.5 } };
  return null;
}

/** Move `dist` metres along the route (mutates cursor). Returns true once at the end. */
export function advanceRoute(route: Route, c: Cursor, dist: number): boolean {
  const last = route.nodes.length - 2;
  if (last < 0) return true;
  while (true) {
    const e = getEdge(route.nodes[c.seg], route.nodes[c.seg + 1]);
    const len = e ? e.length : 1;
    const endT = c.seg === last ? route.endT : 1;
    const remaining = (endT - c.t) * len;
    if (dist < remaining) {
      c.t += dist / len;
      return false;
    }
    dist -= remaining;
    if (c.seg === last) {
      c.t = endT;
      return true;
    }
    c.seg += 1;
    c.t = 0;
  }
}

/** True if a road after the current one is now blocked (ignoring our own site). */
export function needsRepath(route: Route, c: Cursor, blocked: ReadonlySet<string>, ignore?: string): boolean {
  for (let i = c.seg + 1; i < route.nodes.length - 1; i++) {
    const k = edgeKey(route.nodes[i], route.nodes[i + 1]);
    if (k !== ignore && blocked.has(k)) return true;
  }
  return false;
}

/** Replace everything after the current segment with `tail` (tail[0] must be the node we're heading to). */
export function spliceRoute(route: Route, c: Cursor, tail: Route) {
  route.nodes = [...route.nodes.slice(0, c.seg + 2), ...tail.nodes.slice(1)];
  route.endT = tail.endT;
}

// --- Job state machine -------------------------------------------------------------

export type Phase = "outbound" | "deploying" | "active" | "packing" | "returning" | "done";
export type JobAction = "arrived" | "close_road" | "start_packing" | "reopen_road" | "despawn";

export interface JobClock {
  phase: Phase;
  phaseT: number; // seconds spent in the current phase
  activeFor: number; // how long the road stays closed
}

export function createJobClock(rand: () => number = Math.random): JobClock {
  return { phase: "outbound", phaseT: 0, activeFor: ACTIVE_MIN_S + rand() * (ACTIVE_MAX_S - ACTIVE_MIN_S) };
}

function enter(j: JobClock, p: Phase) {
  j.phase = p;
  j.phaseT = 0;
}

/** Advance the job clock. `arrived` = the truck reached the end of its current route. */
export function stepJob(j: JobClock, dt: number, arrived: boolean): JobAction[] {
  j.phaseT += dt;
  switch (j.phase) {
    case "outbound":
      if (!arrived) return [];
      enter(j, "deploying");
      return ["arrived"];
    case "deploying":
      if (j.phaseT < DEPLOY_S) return [];
      enter(j, "active");
      return ["close_road"];
    case "active":
      if (j.phaseT < j.activeFor) return [];
      enter(j, "packing");
      return ["start_packing"];
    case "packing":
      if (j.phaseT < PACK_S) return [];
      enter(j, "returning");
      return ["reopen_road"];
    case "returning":
      if (!arrived) return [];
      enter(j, "done");
      return ["despawn"];
    default:
      return [];
  }
}

/** 0..1: how much of the site is laid out right now. */
export function siteProgress(j: JobClock): number {
  switch (j.phase) {
    case "deploying":
      return Math.min(1, j.phaseT / (DEPLOY_S * 0.85));
    case "active":
      return 1;
    case "packing":
      return Math.max(0, 1 - j.phaseT / (PACK_S * 0.85));
    default:
      return 0;
  }
}

// --- Road names -----------------------------------------------------------------------

// Downtown: rows (constant z, roads running east-west) and columns (constant x, north-south), index -4..4.
const ROW_NAMES = ["Euston Rd", "Oxford St", "Holborn", "Fleet St", "The Strand", "Victoria St", "Lambeth Rd", "Kennington Ln", "Old Kent Rd"];
const COL_NAMES = ["Baker St", "Edgware Rd", "Regent St", "Charing Cross Rd", "Kingsway", "Chancery Ln", "Bishopsgate", "Tower Bridge Rd", "Commercial Rd"];

export function roadName(key: string): string {
  const e = ROAD_EDGES.get(key);
  if (!e) return "the road";
  const a = getNode(e.a);
  const b = getNode(e.b);
  if (e.kind === "highway") {
    const R = HIGHWAY_RING;
    if (a.z === -R && b.z === -R) return "the North Circular";
    if (a.z === R && b.z === R) return "the South Circular";
    if (a.x === R && b.x === R) return "the A12 East Cross Route";
    return "the A40 Western Avenue";
  }
  if (e.kind === "ramp") {
    const ring = a.zone === "highway" ? a : b;
    const side = ring.z === -HIGHWAY_RING ? "north" : ring.z === HIGHWAY_RING ? "south" : ring.x === HIGHWAY_RING ? "east" : "west";
    return `the ${side} slip road`;
  }
  const ga = /^g_(-?\d+)_(-?\d+)$/.exec(e.a);
  const gb = /^g_(-?\d+)_(-?\d+)$/.exec(e.b);
  if (ga && gb) {
    if (ga[2] === gb[2]) return ROW_NAMES[Number(ga[2]) + 4] ?? "the high street";
    return COL_NAMES[Number(ga[1]) + 4] ?? "the high street";
  }
  if (a.zone === "docks" || b.zone === "docks") return "Dock Rd";
  if (a.zone === "countryside" || b.zone === "countryside") return "Mill Ln";
  if (a.zone === "depot" || b.zone === "depot") return "Depot Rd";
  if (a.zone === "suburbs" || b.zone === "suburbs") return "Maple Ave";
  return "the high street";
}

// --- Site layout -------------------------------------------------------------------------

export type SiteItemKind = "cone" | "barrier" | "sign";

/**
 * One object of the works site in the edge's local frame (a -> b): `s` metres along the road from the
 * midpoint (+ towards b), `left` metres to the left of the centre line (the truck's lane is left = +2).
 * `facing` is +1 to face b (traffic coming from b sees it), -1 to face a. Order = placement order.
 */
export interface SiteItem {
  kind: SiteItemKind;
  s: number;
  left: number;
  facing: 1 | -1;
}

export function siteLayout(edgeLength: number): SiteItem[] {
  const L = Math.max(8, Math.min(18, edgeLength / 2 - 5)); // barrier lines at +-L
  const items: SiteItem[] = [];
  const push = (kind: SiteItemKind, s: number, left: number, facing: 1 | -1) => items.push({ kind, s, left, facing });
  // Near end (traffic arriving from a, behind the truck)
  push("sign", -(L + 1.5), 3.6, -1);
  push("barrier", -L, 2, -1);
  push("barrier", -L, -2, -1);
  // Taper: from the far (right) kerb behind the truck, funnelling in to the centre line
  const taperN = 6;
  for (let i = 0; i < taperN; i++) {
    const k = i / (taperN - 1);
    push("cone", -L + 1.5 + k * (L - 5.5), -3.3 + k * 3.3, -1);
  }
  // Kerb line on the truck's side, behind the truck
  for (let s = -L + 1.5; s <= -5; s += 3) push("cone", s, 3.6, -1);
  // Centre line past the truck
  for (let s = -2.5; s <= L - 2; s += 2.6) push("cone", s, 0, 1);
  // Far end (traffic arriving from b)
  for (let i = 0; i < 4; i++) push("cone", L - 1.5 - i * 1.8, -3.3 + i * 0.9, 1);
  push("barrier", L, 2, 1);
  push("barrier", L, -2, 1);
  push("sign", L + 1.5, -3.6, 1);
  return items;
}
