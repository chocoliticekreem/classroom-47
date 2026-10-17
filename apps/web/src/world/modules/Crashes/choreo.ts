// Crash choreography: who hits what, when, and where everything ends up.
// Pure planning (no three.js). All poses are in the crash frame: +z is the direction of travel,
// x = +2 is the travel lane (we drive on the left), x = -2 the opposite lane, |x| = 4 the kerbs.
import type { VehicleKind } from "../../registry";

export type ActorModel = "car" | "hgv";
export type Role =
  | "lead"
  | "rear_end"
  | "jackknife"
  | "flip"
  | "barrier"
  | "fire"
  | "victim"
  | "runner"
  | "shunted"
  | "swiper";

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

export interface Actor {
  id: string;
  model: ActorModel;
  color: string;
  role: Role;
  impactAt: number; // seconds after the crash starts
  speed: number; // approach speed, m/s (0: parked until hit)
  contact: Pose; // pose at the moment of impact
  rest: Pose & { roll: number; fold: number }; // final resting pose (fold: HGV trailer angle)
  postDur: number; // seconds from contact to rest
  flip: number; // total roll radians while tumbling (0: no tumble; odd multiple of PI ends on the roof)
  arc: number; // tumble height, m
  fire: boolean;
  steam: boolean;
  crumpled: boolean;
}

export interface Impact {
  at: number;
  actor: number; // index into actors, -1 for a real vehicle
  vehicleId: string | null; // real registry vehicle to crash() at this moment
  strength: number; // 0..1 VFX scale
  crossover?: boolean;
}

export interface Choreo {
  actors: Actor[];
  impacts: Impact[]; // sorted by `at`
  tailZ: number; // most upstream local z of the wreckage
  duration: number; // seconds until the last impact
}

export interface RealRef {
  id: string;
  z: number; // local z now (s - headS)
  kind: VehicleKind;
}

type Rand = () => number;
const jit = (rand: Rand, a: number) => (rand() * 2 - 1) * a;

const base = (id: string, color: string, role: Role, model: ActorModel = "car"): Actor => ({
  id,
  model,
  color,
  role,
  impactAt: 0,
  speed: 0,
  contact: { x: 2, z: 0, yaw: 0 },
  rest: { x: 2, z: 0, yaw: 0, roll: 0, fold: 0 },
  postDur: 0.8,
  flip: 0,
  arc: 0,
  fire: false,
  steam: false,
  crumpled: false,
});

function finish(actors: Actor[], impacts: Impact[]): Choreo {
  impacts.sort((a, b) => a.at - b.at);
  let tail = 0;
  for (const a of actors) tail = Math.min(tail, a.rest.z, a.contact.z);
  return { actors, impacts, tailZ: tail, duration: impacts.length ? impacts[impacts.length - 1].at : 0 };
}

// --- Pileup -----------------------------------------------------------------

export interface PileupInput {
  rand: Rand;
  highway: boolean;
  room: number; // metres of road upstream of the head we may fill
  same: RealRef[]; // real vehicles on the travel lane
  opp: RealRef[]; // real vehicles on the opposite lane
  ids: () => string;
  colors: readonly string[];
}

export const PILEUP_MIN = 6;
export const PILEUP_MAX = 13; // lead + up to 12 piling in

/**
 * Chain-reaction pileup. The lead brakes/spins at t = 0, then everyone behind concertinas in over ~3-4 s,
 * nearest the head first. Real vehicles are used where they are; scripted wrecks fill the gaps and carry
 * the set pieces (jackknifed HGV, a car that flips onto its roof, one shoved onto the kerb, one on fire).
 */
export function planPileup(p: PileupInput): Choreo {
  const { rand } = p;
  const spacing = p.highway ? 6.5 : 5.5;
  const speed = p.highway ? 21 : 12;
  const fit = Math.max(PILEUP_MIN, Math.floor((p.room + 10) / spacing) + 1);
  const n = Math.min(fit, 7 + Math.floor(rand() * 6)); // 7..12 participants

  const same = p.same.filter((r) => r.z <= 4 && r.z >= -p.room - 10).sort((a, b) => b.z - a.z);
  const realLead = same.length && same[0].z > -6 ? same[0] : null;
  const maxReal = Math.max(0, n - 3 - (realLead ? 0 : 1));
  const reals = same.slice(0, maxReal);
  const cross = p.opp.find((o) => Math.abs(o.z) < 25) ?? null;
  const needScripted = Math.max(3 + (realLead ? 0 : 1), n - reals.length - (cross ? 1 : 0));

  // Scripted slots: every `spacing` metres back from the head, skipping real vehicles.
  const limit = realLead ? realLead.z - spacing * 0.6 : Infinity;
  const slots: number[] = [];
  for (let k = 0; slots.length < needScripted && k < 60; k++) {
    const z = -k * spacing;
    if (z > limit) continue;
    if (reals.some((r) => Math.abs(r.z - z) < spacing * 0.6)) continue;
    slots.push(z);
  }

  type P = { z: number; real: RealRef | null; slot: number };
  const parts: P[] = [...reals.map((r) => ({ z: r.z, real: r, slot: -1 })), ...slots.map((z, i) => ({ z, real: null, slot: i }))];
  parts.sort((a, b) => b.z - a.z);

  // Timing: lead at 0, the rest every ~0.3 s with a little jitter, done in 2.8-3.8 s.
  const total = 2.8 + rand();
  const step = parts.length > 1 ? (total - 0.45) / Math.max(1, parts.length - 2) : 0;
  const times: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) times.push(0);
    else {
      const t = 0.45 + (i - 1) * step + jit(rand, step * 0.25);
      times.push(Math.max(t, times[i - 1] + 0.08));
    }
  }

  // Roles for the scripted ones (not the lead): HGV mid-pile, then flip, barrier, fire.
  const scriptedIdx = parts.map((pt, i) => (pt.real ? -1 : i)).filter((i) => i > 0);
  const roles = new Map<number, Role>();
  const onFire = new Set<number>();
  if (scriptedIdx.length) {
    const mid = scriptedIdx[Math.floor(scriptedIdx.length / 2)];
    roles.set(mid, "jackknife");
    const rest = scriptedIdx.filter((i) => i !== mid);
    if (rest.length > 0) roles.set(rest[0], "flip"); // near the front: the money shot
    if (rest.length > 1) roles.set(rest[rest.length - 1], "barrier");
    const free = rest.find((i) => !roles.has(i));
    if (free !== undefined) roles.set(free, "fire");
    else if (rest.length > 1) onFire.add(rest[rest.length - 1]); // barrier car burns too
    else onFire.add(mid);
  }

  const actors: Actor[] = [];
  const impacts: Impact[] = [];
  let shift = 0; // the HGV is long: push scripted cars behind it further back
  for (let i = 0; i < parts.length; i++) {
    const pt = parts[i];
    const at = times[i];
    if (pt.real) {
      impacts.push({ at, actor: -1, vehicleId: pt.real.id, strength: pt.real.kind === "truck" ? 1 : 0.75 });
      continue;
    }
    const z = pt.z + shift;
    const role: Role = i === 0 ? "lead" : (roles.get(i) ?? "rear_end");
    const a = base(p.ids(), p.colors[Math.floor(rand() * p.colors.length)], role, role === "jackknife" ? "hgv" : "car");
    a.impactAt = at;
    // don't start further back than the road we own (the run may begin at a corner): slow down instead
    a.speed = Math.min(speed * (0.85 + rand() * 0.3), Math.max(4, (p.room + z + 15) / Math.max(at + 0.15, 0.2)));
    a.contact = { x: 2 + jit(rand, 0.3), z, yaw: jit(rand, 0.05) };
    a.rest = { x: 2 + jit(rand, 1.1), z: z + 1 + rand() * 1.5, yaw: jit(rand, 0.6), roll: jit(rand, 0.06), fold: 0 };
    a.crumpled = true;
    a.steam = rand() < 0.5;
    a.postDur = 0.7;
    const sign = rand() < 0.5 ? -1 : 1;
    switch (role) {
      case "lead":
        a.crumpled = false;
        a.steam = false;
        a.rest = { x: 0.2, z: z + 4, yaw: sign * (1.8 + rand()), roll: 0, fold: 0 };
        a.postDur = 1.3;
        break;
      case "jackknife":
        a.contact.x = 2;
        a.rest = { x: 0.8, z: z + 2.5, yaw: sign * 0.45, roll: 0.05, fold: -sign * 1.55 };
        a.postDur = 1.5;
        a.steam = false;
        shift -= 5;
        break;
      case "flip":
        a.contact.yaw = 0.25 * sign;
        a.rest = { x: -2.2, z: z + 7, yaw: sign * 0.9, roll: 0, fold: 0 };
        a.flip = sign * Math.PI * (rand() < 0.5 ? 3 : 5); // rolls 1-2 times, odd multiple of PI: lands on its roof
        a.arc = 2.4;
        a.postDur = 1.6;
        break;
      case "barrier":
        a.rest = { x: 4.4, z: z + 2.5, yaw: 0.5, roll: -0.22, fold: 0 };
        a.postDur = 0.9;
        break;
      case "fire":
        a.fire = true;
        a.steam = false;
        break;
    }
    if (onFire.has(i)) a.fire = true;
    actors.push(a);
    impacts.push({ at, actor: actors.length - 1, vehicleId: null, strength: role === "lead" ? 0.45 : role === "jackknife" ? 1 : 0.75 });
  }
  if (cross) impacts.push({ at: total * 0.4 + jit(rand, 0.2), actor: -1, vehicleId: cross.id, strength: 0.8, crossover: true });
  return finish(actors, impacts);
}

/** Number of vehicles taking part (scripted + real). */
export function participants(c: Choreo) {
  return c.actors.length + c.impacts.filter((i) => i.actor < 0).length;
}

// --- Secondary collisions ------------------------------------------------------

export interface Approaching {
  id: string;
  behind: number; // metres behind the tail of the wreckage
  speed: number;
}

/** Fast vehicles closing on the tail may fail to stop. Small chance each, at most 2. */
export function planSecondary(list: Approaching[], startAt: number, rand: Rand, chance = 0.3): Impact[] {
  const out: Impact[] = [];
  const sorted = list.filter((v) => v.speed > 8 && v.behind > 4 && v.behind < 80).sort((a, b) => a.behind - b.behind);
  for (const v of sorted) {
    if (out.length >= 2) break;
    if (rand() >= chance) continue;
    const at = startAt + Math.min(4, Math.max(0.6, (v.behind / v.speed) * 0.85));
    out.push({ at, actor: -1, vehicleId: v.id, strength: 0.6 });
  }
  return out;
}

// --- Ordinary scripted crashes ----------------------------------------------

interface Simple {
  rand: Rand;
  ids: () => string;
  colors: readonly string[];
}
const pick = (s: Simple) => s.colors[Math.floor(s.rand() * s.colors.length)];

/**
 * Red-light T-bone at a junction (frame origin = junction centre). Car A crosses on green heading +z;
 * car B runs the red from the `side` (+1: from +x, -1: from -x) and hits A's flank.
 */
export function planJunction(s: Simple, side: 1 | -1): Choreo {
  const { rand } = s;
  const laneZ = side === 1 ? 2 : -2; // B's lane (left of its travel direction)
  const a = base(s.ids(), pick(s), "victim");
  a.impactAt = 1.6;
  a.speed = 10;
  a.contact = { x: 2, z: laneZ, yaw: 0 };
  a.rest = { x: 2 - side * (3 + rand() * 2), z: laneZ + 3, yaw: -side * (0.9 + rand() * 0.8), roll: -side * 0.08, fold: 0 };
  a.postDur = 1.1;
  a.crumpled = false;
  const b = base(s.ids(), pick(s), "runner");
  b.impactAt = 1.6;
  b.speed = 14;
  b.contact = { x: 2 + side * 3.05, z: laneZ, yaw: side === 1 ? -Math.PI / 2 : Math.PI / 2 };
  b.rest = { x: 2 + side * 1.6, z: laneZ + 1.2, yaw: b.contact.yaw + side * 0.35, roll: 0, fold: 0 };
  b.postDur = 0.9;
  b.crumpled = true;
  b.steam = true;
  return finish([a, b], [{ at: 1.6, actor: 1, vehicleId: null, strength: 0.9 }, { at: 1.62, actor: 0, vehicleId: null, strength: 0.4 }]);
}

/** Car B rear-ends car A waiting in the lane and shunts it forward a few metres. */
export function planShunt(s: Simple): Choreo {
  const { rand } = s;
  const a = base(s.ids(), pick(s), "shunted");
  a.impactAt = 1.2;
  a.contact = { x: 2, z: 4, yaw: 0 };
  a.rest = { x: 2.3, z: 4 + 3 + rand() * 2, yaw: jit(rand, 0.2), roll: 0, fold: 0 };
  a.postDur = 0.9;
  const b = base(s.ids(), pick(s), "rear_end");
  b.impactAt = 1.2;
  b.speed = 15;
  b.contact = { x: 2, z: -0.3, yaw: 0 };
  b.rest = { x: 2 + jit(rand, 0.4), z: 0.6, yaw: jit(rand, 0.25), roll: 0, fold: 0 };
  b.postDur = 0.5;
  b.crumpled = true;
  b.steam = true;
  return finish([a, b], [{ at: 1.2, actor: 1, vehicleId: null, strength: 0.8 }]);
}

/** Highway side-swipe: B overtakes, clips A, both spin out. */
export function planSideswipe(s: Simple): Choreo {
  const { rand } = s;
  const a = base(s.ids(), pick(s), "victim");
  a.impactAt = 1.3;
  a.speed = 20;
  a.contact = { x: 2, z: 0, yaw: 0 };
  a.rest = { x: 3.6, z: 14, yaw: 2.6 + rand() * 0.9, roll: 0.05, fold: 0 };
  a.postDur = 1.6;
  const b = base(s.ids(), pick(s), "swiper");
  b.impactAt = 1.3;
  b.speed = 24;
  b.contact = { x: 0.1, z: 0.6, yaw: 0.18 };
  b.rest = { x: -2.6, z: 19, yaw: -(2 + rand()), roll: -0.05, fold: 0 };
  b.postDur = 1.7;
  b.crumpled = true;
  return finish([a, b], [{ at: 1.3, actor: 1, vehicleId: null, strength: 0.7 }]);
}

/** A car clips the kerb, rolls and lands on its roof. */
export function planRollover(s: Simple): Choreo {
  const { rand } = s;
  const a = base(s.ids(), pick(s), "flip");
  a.impactAt = 1.1;
  a.speed = 18;
  a.contact = { x: 2.6, z: 0, yaw: 0.3 };
  a.rest = { x: -1, z: 11, yaw: 0.7 + rand() * 0.4, roll: 0, fold: 0 };
  a.flip = Math.PI * 3; // one and a half rolls: ends on its roof
  a.arc = 2.2;
  a.postDur = 1.5;
  a.crumpled = true;
  a.steam = true;
  return finish([a], [{ at: 1.1, actor: 0, vehicleId: null, strength: 0.75 }]);
}

/** HGV jackknifes across both lanes and catches fire; a car behind can't stop. */
export function planJackknife(s: Simple): Choreo {
  const { rand } = s;
  const sign = rand() < 0.5 ? -1 : 1;
  const h = base(s.ids(), "#ff6a1a", "jackknife", "hgv");
  h.impactAt = 1.2;
  h.speed = 17;
  h.contact = { x: 2, z: 0, yaw: 0 };
  h.rest = { x: 0.8, z: 5, yaw: sign * 0.45, roll: 0.05, fold: -sign * 1.55 };
  h.postDur = 1.5;
  h.fire = true;
  const c = base(s.ids(), pick(s), "rear_end");
  c.impactAt = 2.3;
  c.speed = 16;
  c.contact = { x: 2, z: -9, yaw: 0 };
  c.rest = { x: 2.5, z: -8, yaw: 0.35, roll: 0, fold: 0 };
  c.postDur = 0.6;
  c.crumpled = true;
  c.steam = true;
  return finish(
    [h, c],
    [
      { at: 1.2, actor: 0, vehicleId: null, strength: 1 },
      { at: 2.3, actor: 1, vehicleId: null, strength: 0.7 },
    ],
  );
}

// --- Animation --------------------------------------------------------------

export interface ActorPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  fold: number;
  moving: boolean;
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

/** Pose of a scripted actor at time t (seconds since the crash started). Writes into `out`. */
export function actorPose(a: Actor, t: number, out: ActorPose): ActorPose {
  if (t < a.impactAt) {
    const d = a.speed * (a.impactAt - t);
    out.x = a.contact.x - Math.sin(a.contact.yaw) * d;
    out.z = a.contact.z - Math.cos(a.contact.yaw) * d;
    out.y = 0;
    out.yaw = a.contact.yaw;
    out.roll = 0;
    out.fold = 0;
    out.moving = a.speed > 0;
    return out;
  }
  const u = Math.min(1, (t - a.impactAt) / a.postDur);
  const e = easeOut(u);
  out.x = a.contact.x + (a.rest.x - a.contact.x) * e;
  out.z = a.contact.z + (a.rest.z - a.contact.z) * e;
  out.yaw = a.contact.yaw + (a.rest.yaw - a.contact.yaw) * e;
  out.fold = a.rest.fold * e;
  if (a.flip) {
    out.roll = a.flip * u;
    out.y = Math.sin(Math.PI * u) * a.arc;
  } else {
    out.roll = a.rest.roll * e;
    out.y = a.role === "barrier" ? 0.18 * e : 0;
  }
  out.moving = u < 1;
  return out;
}
