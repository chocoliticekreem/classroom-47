// Pure logic for the Chases module: the pursuit state machine, getaway turn choice, police target
// selection, PIT box-in slots, speed cameras and the street-race launch. No three.js, no React: tested.
import { ROAD_EDGES, ROAD_NODES, edgeKey, getEdge, getNode, neighbours } from "../../roads";
import type { SignalColour } from "../../signals";

// --- Chase state machine ----------------------------------------------------------------------

export type Ending = "pit" | "crash" | "escape";
export type Phase = "fleeing" | "pit" | "crashed" | "escaped" | "arrest" | "leaving" | "done";
export type ChaseAction = "spin" | "crash" | "give_up" | "start_arrest" | "release" | "finish";

export interface ChaseState {
  phase: Phase;
  ending: Ending;
  t: number; // seconds since the getaway bolted
  phaseT: number; // seconds in the current phase
  minFleeS: number; // the ending can't happen before this
  motorwayT: number; // seconds the getaway has spent on the motorway / highway
}

export interface ChaseInput {
  gap: number; // metres from the nearest police car to the getaway (Infinity when none)
  pit: boolean; // a police car just made a successful PIT contact this frame
  collided: boolean; // the getaway just physically hit something
  settled: boolean; // the getaway's body has come to rest (after a spin or crash)
  onMotorway: boolean; // the getaway is on a highway-kind road
  allHome: boolean; // every chase vehicle has left the scene (despawned)
}

export const CHASE = {
  maxFleeS: 75, // after this the chase ends one way or another
  crashGraceS: 14, // a "crash" chase drives recklessly this long before it hits a lamppost anyway
  escapeGap: 80, // police give up when the getaway is this far ahead on the motorway
  escapeMotorwayS: 7, // ...or has been on the motorway this long
  spinMinS: 2.8, // time for the spin and the box-in before the arrest
  spinMaxS: 8,
  arrestS: 13,
  giveUpS: 2,
  leaveTimeoutS: 70,
} as const;

/** Random ending: PIT 40 %, crash 35 %, escape 25 %. */
export function rollEnding(r: number): Ending {
  return r < 0.4 ? "pit" : r < 0.75 ? "crash" : "escape";
}

export function newChase(ending: Ending, rand: () => number): ChaseState {
  const minFleeS = ending === "crash" ? 16 + rand() * 12 : ending === "pit" ? 12 + rand() * 8 : 12 + rand() * 6;
  return { phase: "fleeing", ending, t: 0, phaseT: 0, minFleeS, motorwayT: 0 };
}

/** Police may try a PIT now. */
export function pitAllowed(s: ChaseState) {
  return s.phase === "fleeing" && s.ending === "pit" && s.t >= s.minFleeS;
}

/** The getaway stops avoiding traffic (it's going to hit something). */
export function isReckless(s: ChaseState) {
  return s.phase === "fleeing" && s.ending === "crash" && s.t >= s.minFleeS;
}

function go(s: ChaseState, phase: Phase) {
  s.phase = phase;
  s.phaseT = 0;
}

/** Advance the chase by dt seconds. Returns the action to perform this frame (or null). Mutates `s`. */
export function stepChase(s: ChaseState, input: ChaseInput, dt: number): ChaseAction | null {
  s.t += dt;
  s.phaseT += dt;
  switch (s.phase) {
    case "fleeing": {
      s.motorwayT = input.onMotorway ? s.motorwayT + dt : 0;
      if (input.collided) {
        // any chase can end in a real collision
        s.ending = "crash";
        go(s, "crashed");
        return "crash";
      }
      if (input.pit && pitAllowed(s)) {
        go(s, "pit");
        return "spin";
      }
      if (s.ending === "crash" && s.t >= s.minFleeS + CHASE.crashGraceS) {
        go(s, "crashed"); // never hit anything: loses it into a lamppost
        return "crash";
      }
      if (s.ending === "escape" && s.t >= s.minFleeS && input.onMotorway && (input.gap >= CHASE.escapeGap || s.motorwayT >= CHASE.escapeMotorwayS)) {
        go(s, "escaped");
        return "give_up";
      }
      if (s.t >= CHASE.maxFleeS) {
        // PIT never landed: it ends in a crash instead. An escape that never reached the motorway: lost them.
        if (s.ending === "escape") {
          go(s, "escaped");
          return "give_up";
        }
        s.ending = "crash";
        go(s, "crashed");
        return "crash";
      }
      return null;
    }
    case "pit":
    case "crashed":
      if ((input.settled && s.phaseT >= CHASE.spinMinS) || s.phaseT >= CHASE.spinMaxS) {
        go(s, "arrest");
        return "start_arrest";
      }
      return null;
    case "arrest":
      if (s.phaseT >= CHASE.arrestS) {
        go(s, "leaving");
        return "release";
      }
      return null;
    case "escaped":
      if (s.phaseT >= CHASE.giveUpS) {
        go(s, "leaving");
        return "release";
      }
      return null;
    case "leaving":
      if (input.allHome || s.phaseT >= CHASE.leaveTimeoutS) {
        go(s, "done");
        return "finish";
      }
      return null;
    default:
      return null;
  }
}

/** Seconds until the next chase. */
export function nextChaseDelay(rand: () => number) {
  return 90 + rand() * 60;
}

// --- Geometry helpers -------------------------------------------------------------------------

/** +1 left turn at b, -1 right, 0 straight, 2 for a U-turn. */
export function turnKind(a: string, b: string, c: string): -1 | 0 | 1 | 2 {
  if (a === c) return 2;
  const na = getNode(a);
  const nb = getNode(b);
  const nc = getNode(c);
  const l1 = Math.hypot(nb.x - na.x, nb.z - na.z) || 1;
  const l2 = Math.hypot(nc.x - nb.x, nc.z - nb.z) || 1;
  const d1x = (nb.x - na.x) / l1;
  const d1z = (nb.z - na.z) / l1;
  const d2x = (nc.x - nb.x) / l2;
  const d2z = (nc.z - nb.z) / l2;
  const dot = d1x * d2x + d1z * d2z;
  if (dot < -0.9) return 2;
  if (dot > 0.94) return 0;
  return d2x * d1z - d2z * d1x > 0 ? 1 : -1;
}

/** Metres of (nearly) straight road ahead of position t on path[idx] -> path[idx + 1]. */
export function straightAhead(path: readonly string[], idx: number, t: number, cap = 200): number {
  const len0 = getEdge(path[idx], path[idx + 1])?.length ?? 0;
  let m = (1 - t) * len0;
  for (let k = idx + 1; k + 1 < path.length && m < cap; k++) {
    if (turnKind(path[k - 1], path[k], path[k + 1]) !== 0) return m;
    m += getEdge(path[k], path[k + 1])?.length ?? 0;
  }
  return Math.min(m, cap);
}

// --- Getaway turn choice -----------------------------------------------------------------------

const HOME_RADIUS = 650; // the getaway prefers to stay in the dense city (good for the camera)

/**
 * The getaway's next node after arriving at `cur` from `prev`: a random open road, never straight back
 * unless it's a dead end. Prefers straights (more weaving) and staying near the city centre.
 */
export function chooseTurn(prev: string, cur: string, blocked: ReadonlySet<string>, rand: () => number): string | null {
  const opts: string[] = [];
  const weights: number[] = [];
  for (const nb of neighbours(cur)) {
    if (nb === prev) continue;
    if (blocked.has(edgeKey(cur, nb))) continue;
    const n = getNode(nb);
    if (nb.startsWith("depot_")) continue;
    let w = turnKind(prev, cur, nb) === 0 ? 1.5 : 1;
    if (Math.hypot(n.x, n.z) > HOME_RADIUS) w *= 0.25;
    if (neighbours(nb).length <= 1) w *= 0.1; // dead end
    opts.push(nb);
    weights.push(w);
  }
  if (!opts.length) {
    // dead end (or everything closed): back the way we came if that's open
    return blocked.has(edgeKey(cur, prev)) ? null : prev;
  }
  let r = rand() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < opts.length; i++) {
    r -= weights[i];
    if (r <= 0) return opts[i];
  }
  return opts[opts.length - 1];
}

/** A node on the motorway (mw_*) to escape to, else a highway ring node far from `near`. */
export function escapeNode(near: { x: number; z: number }, rand: () => number): string {
  const mw = [...ROAD_NODES.values()].filter((n) => n.id.startsWith("mw_"));
  const pool = mw.length ? mw : [...ROAD_NODES.values()].filter((n) => n.zone === "highway");
  // pick among the farther half so the getaway actually drives along the motorway
  const sorted = pool.slice().sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
  const far = sorted.slice(Math.floor(sorted.length / 2));
  return far[Math.floor(rand() * far.length)]?.id ?? sorted[sorted.length - 1].id;
}

export function isMotorwayEdge(a: string, b: string) {
  const e = getEdge(a, b);
  return !!e && (e.kind === "highway" || a.startsWith("mw_") || b.startsWith("mw_"));
}

// --- Pursuit target selection -----------------------------------------------------------------

export interface GetawayView {
  from: string;
  to: string;
  path: readonly string[];
  idx: number; // current edge is path[idx] -> path[idx + 1]
}

/**
 * Which node police unit `role` drives to: unit 0 tails the getaway (its current target node); the others
 * cut it off at `predicted` (where it will be by the time they get there, see dynamics.predictNode).
 * Never returns the node the police car is already heading to (that would be an empty path), falling
 * back along the getaway's route.
 */
export function pursuitTarget(role: number, g: GetawayView, policeTo: string, predicted?: string): string {
  const ahead: string[] = [];
  for (let k = g.idx + 1; k < g.path.length; k++) ahead.push(g.path[k]);
  if (!ahead.length) ahead.push(g.to);
  let order = ahead;
  if (role !== 0) {
    const p = predicted && ahead.includes(predicted) ? ahead.indexOf(predicted) : Math.min(2, ahead.length - 1);
    order = [...ahead.slice(1, p + 1).reverse(), ...ahead];
  }
  for (const id of order) if (id !== policeTo) return id;
  return g.from !== policeTo ? g.from : g.to;
}

// --- PIT box-in -------------------------------------------------------------------------------

export interface Slot {
  x: number;
  z: number;
  h: number;
}

/**
 * Where the police park to box in a spun-out car at pose (x, z, h): one nosed into its front,
 * one behind, one alongside. Headings point the police cars at the getaway.
 */
export function boxSlots(x: number, z: number, h: number, n: number): Slot[] {
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const rx = -fz; // right-hand vector of the getaway
  const rz = fx;
  const rel: [number, number][] = [
    [6.2, 1.6], // in front, a little to the right
    [-6.4, -1.4], // behind
    [0.4, 4.4], // alongside, right
  ];
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const [f, r] = rel[i % rel.length];
    const sx = x + fx * f + rx * r;
    const sz = z + fz * f + rz * r;
    const nose = Math.atan2(x - sx, z - sz); // face the getaway
    out.push({ x: sx, z: sz, h: nose + (i === 2 ? 0.35 : 0.5 * (i === 0 ? 1 : -1)) });
  }
  return out;
}

// --- Speed cameras ----------------------------------------------------------------------------

export interface CameraSite {
  key: string; // edge key
  a: string;
  b: string;
  t: number; // where along a -> b the post stands
  limit: number;
  x: number; // post position (on the kerb, left of a -> b)
  z: number;
  h: number; // post facing (towards traffic from a)
}

export const CAMERA_FACTOR = 1.3;
export const CAMERA_WINDOW_M = 5;

const CAMERA_EDGES: [string, string][] = [
  ["g_0_-2", "g_0_-1"], // central avenue, north
  ["g_1_0", "g_2_0"], // east-west avenue
  ["g_-2_3", "g_-1_3"], // past the police station
  ["h_1", "h_2"], // ring north
  ["h_5", "h_6"], // ring east
  ["h_13", "h_14"], // ring west
];

/** The 6 camera posts on main roads (skipping any edge that doesn't exist). */
export function cameraSites(): CameraSite[] {
  const out: CameraSite[] = [];
  for (const [a, b] of CAMERA_EDGES) {
    const e = getEdge(a, b);
    if (!e) continue;
    const na = getNode(a);
    const nb = getNode(b);
    const len = e.length || 1;
    const dx = (nb.x - na.x) / len;
    const dz = (nb.z - na.z) / len;
    const t = 0.55;
    const kerb = e.kind === "highway" ? 7.2 : 5.2;
    // left of travel = minus the right-hand vector (-dz, dx)
    out.push({
      key: e.key, a, b, t, limit: e.speedLimit,
      x: na.x + dx * len * t + dz * kerb,
      z: na.z + dz * len * t - dx * kerb,
      h: Math.atan2(-dx, -dz),
    });
  }
  return out;
}

export interface CameraVehicle {
  edgeKey: string | null;
  from: string | null;
  t: number;
  speed: number;
}

/** True when this vehicle is passing the camera faster than CAMERA_FACTOR x the limit. */
export function speedingHit(cam: CameraSite, v: CameraVehicle): boolean {
  if (v.edgeKey !== cam.key || !v.from) return false;
  if (v.speed <= cam.limit * CAMERA_FACTOR) return false;
  const len = ROAD_EDGES.get(cam.key)?.length ?? 1;
  const tOnAB = v.from === cam.a ? v.t : 1 - v.t;
  return Math.abs(tOnAB - cam.t) * len <= CAMERA_WINDOW_M;
}

// --- Street racers ----------------------------------------------------------------------------

export function isNight(hour: number) {
  return hour < 6.5 || hour > 19;
}

/** Drag race strip: a straight downtown row from one edge of the grid to the other, plus a ramp onto the ring. */
export function raceStrip(row: number, eastbound: boolean): string[] {
  const cols: number[] = [];
  for (let i = -4; i <= 4; i++) cols.push(i);
  if (!eastbound) cols.reverse();
  const path = cols.map((i) => `g_${i}_${row}`).filter((id) => ROAD_NODES.has(id));
  const end = path[path.length - 1];
  const ramp = end ? neighbours(end).find((n) => n.startsWith("h_")) : undefined;
  if (ramp) path.push(ramp);
  return path;
}

/** Racers launch on the first green after they've sat through a red. */
export function racerLaunch(sawRed: boolean, colour: SignalColour): { sawRed: boolean; go: boolean } {
  if (colour === "red") return { sawRed: true, go: false };
  return { sawRed, go: sawRed && colour === "green" };
}
