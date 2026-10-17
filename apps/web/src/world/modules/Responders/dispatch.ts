// Pure dispatch planning for emergency responders: who goes, from where, and the route to the scene.
import type { IncidentKind } from "../../store";
import { PLACES, ROAD_EDGES, findPath, getEdge, getNode } from "../../roads";

export type UnitRole = "police" | "ambulance" | "fire" | "tow";
export type Side = "a" | "b"; // which end of the incident edge a unit drives in from

/** A route through road nodes; the unit stops at `stopT` on the final leg nodes[n-2] -> nodes[n-1]. */
export interface Route {
  nodes: string[];
  stopT: number;
}

export interface Approach {
  route: Route;
  side: Side;
  cost: number; // seconds at the speed limit, for comparing options
}

export interface IncidentLike {
  edgeKey: string;
  x: number;
  z: number;
}

export const BASE: Record<UnitRole, string> = {
  police: PLACES.policeStation,
  ambulance: PLACES.hospital,
  fire: PLACES.hospital,
  tow: PLACES.maintenanceYard,
};

/** How far (metres) behind the wreck each unit parks. */
export const GAP_M: Record<UnitRole, number> = { tow: 5.5, police: 10, ambulance: 17, fire: 25 };

/** Seconds after the call before each unit leaves base (so units from one base don't overlap). */
export const LEAVE_DELAY_S: Record<UnitRole, number> = { police: 0, ambulance: 0.4, fire: 2.2, tow: 2.5 };
/** Extra delay per repeat of the same role (pileups send two of some). */
export const REPEAT_DELAY_S = 3;
/** Extra parking gap per repeat, so a second unit stuck on the same side doesn't park inside the first. */
export const REPEAT_GAP_M = 6;

/** Cyclist hit: the ambulance goes first (straight away), police right behind, a tow (if any) last. */
export const CYCLIST_LEAVE_DELAY_S: Record<UnitRole, number> = { ambulance: 0, police: 1.2, fire: 2.2, tow: 3 };
/** Cyclist hit: the ambulance parks close to the rider, police further back to protect the scene. */
export const CYCLIST_GAP_M: Record<UnitRole, number> = { ambulance: 14, police: 24, fire: 30, tow: 5.5 };
/** Cyclist hit: the ambulance drives this much faster than the other units (the fastest response). */
export const CYCLIST_AMBULANCE_BOOST = 1.2;

/** Leave delays for a dispatch list: base delay per role plus REPEAT_DELAY_S for each repeat. */
export function leaveDelays(roles: readonly UnitRole[], kind?: IncidentKind): number[] {
  const seen: Partial<Record<UnitRole, number>> = {};
  const base = kind === "cyclist_hit" ? CYCLIST_LEAVE_DELAY_S : LEAVE_DELAY_S;
  return roles.map((r) => {
    const nth = seen[r] ?? 0;
    seen[r] = nth + 1;
    return base[r] + nth * REPEAT_DELAY_S;
  });
}

/** Parking gap behind the incident point for a role at this kind of incident. */
export function gapFor(role: UnitRole, kind: IncidentKind) {
  return kind === "cyclist_hit" ? CYCLIST_GAP_M[role] : GAP_M[role];
}

export interface DispatchOpts {
  /** Cyclist hit: the vehicle that hit them is wrecked too (a fast hit), so it needs a tow. */
  vehicleCrashed?: boolean;
}

/** Number of tow trucks the incident needs on scene before clearing can start. */
export function towsRequired(kind: IncidentKind, opts: DispatchOpts = {}) {
  return planDispatch(kind, opts).filter((r) => r === "tow").length;
}

/** Seconds every tow must have been on scene before "clearing" (cyclist hit: after the ambulance has left). */
export function towWorkSeconds(kind: IncidentKind) {
  if (kind === "cyclist_hit") return 2;
  return kind === "pileup" ? 10 : 8;
}

// Roadworks are owned by Roadworks; plane_crash / emergency_landing by Airport.
const HANDLED: ReadonlySet<IncidentKind> = new Set<IncidentKind>(["car_crash", "truck_crash", "pileup", "breakdown", "cyclist_hit"]);

export function shouldHandle(kind: IncidentKind) {
  return HANDLED.has(kind);
}

export function planDispatch(kind: IncidentKind, opts: DispatchOpts = {}): UnitRole[] {
  if (!shouldHandle(kind)) return [];
  // Cyclist hit: ambulance FIRST (it leaves at once and drives fastest), then police; a tow only when
  // the vehicle that hit them is wrecked.
  if (kind === "cyclist_hit") return opts.vehicleCrashed ? ["ambulance", "police", "tow"] : ["ambulance", "police"];
  // Multi-vehicle pileup: everything, doubled up (second wave listed after the first, so it leaves later).
  if (kind === "pileup") return ["police", "ambulance", "fire", "tow", "police", "ambulance", "tow"];
  const roles: UnitRole[] = ["police"];
  if (kind === "car_crash" || kind === "truck_crash") roles.push("ambulance");
  if (kind === "truck_crash") roles.push("fire");
  roles.push("tow");
  return roles;
}

/** Where the incident sits along its edge, as t on e.a -> e.b, kept away from the junctions. */
export function incidentT(edgeKey: string, x: number, z: number) {
  const e = ROAD_EDGES.get(edgeKey);
  if (!e) return 0.5;
  const a = getNode(e.a);
  const b = getNode(e.b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
  return Math.min(0.85, Math.max(0.15, t));
}

function pathTime(path: string[]) {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const e = getEdge(path[i - 1], path[i]);
    if (e) s += e.length / e.speedLimit;
  }
  return s;
}

/**
 * Route from `from` to just behind the incident. The incident's own edge is allowed only as the
 * final leg: the approach path to an endpoint treats it as blocked, so a unit never drives through
 * the wreck to reach the other end. Returns null when neither end is reachable.
 */
export function planApproach(
  from: string,
  inc: IncidentLike,
  role: UnitRole,
  blocked: ReadonlySet<string>,
  avoidSide?: Side,
  extraGap = 0,
): Approach | null {
  const e = ROAD_EDGES.get(inc.edgeKey);
  if (!e || !ROAD_EDGES.size) return null;
  const avoid = new Set(blocked);
  avoid.add(e.key);
  const tW = incidentT(e.key, inc.x, inc.z);
  const options: Approach[] = [];
  for (const side of ["a", "b"] as const) {
    const end = side === "a" ? e.a : e.b;
    const other = side === "a" ? e.b : e.a;
    let path: string[] | null = null;
    try {
      path = findPath(from, end, avoid);
    } catch {
      path = null;
    }
    if (!path) continue;
    const wreckT = side === "a" ? tW : 1 - tW;
    const stopT = Math.max(0.04, wreckT - (GAP_M[role] + extraGap) / e.length);
    options.push({
      route: { nodes: [...path, other], stopT },
      side,
      cost: pathTime(path) + (e.length * stopT) / e.speedLimit,
    });
  }
  if (!options.length) return null;
  options.sort((p, q) => p.cost - q.cost);
  if (avoidSide) {
    const alt = options.find((o) => o.side !== avoidSide);
    if (alt) return alt;
  }
  return options[0];
}

/** Route home: finish the current leg from -> to, then the shortest path to base. */
export function planReturn(from: string, to: string, base: string, blocked: ReadonlySet<string>): Route | null {
  let path: string[] | null = null;
  try {
    path = findPath(to, base, blocked);
  } catch {
    path = null;
  }
  if (!path) return null;
  return { nodes: [from, ...path], stopT: 1 };
}

/**
 * Other roads closed by the same incident (a pileup can block two adjacent edges). Crashes doesn't
 * record the second edge on the Incident, so match blocked edges that touch the incident edge and
 * carry the same reason (Crashes uses the incident note as the reason).
 */
export function companionEdges(incEdge: string, note: string, blocked: Readonly<Record<string, string>>): string[] {
  const e = ROAD_EDGES.get(incEdge);
  if (!e || !note) return [];
  const out: string[] = [];
  for (const [k, reason] of Object.entries(blocked)) {
    if (k === incEdge || reason !== note) continue;
    const [a, b] = k.split("|");
    if (a === e.a || a === e.b || b === e.a || b === e.b) out.push(k);
  }
  return out;
}
