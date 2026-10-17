// Pure paramedic choreography for a cyclist_hit: once the ambulance is parked, a paramedic walks from
// the side door to the rider, kneels by them, then the rider is carried on a stretcher round the side
// of the ambulance to the back doors and loaded; the paramedic climbs in after them and the ambulance can go.

export type MedicPhase = "waiting" | "walk" | "kneel" | "carry" | "board" | "done";

export const MEDIC_S = { walk: 2.2, kneel: 6, carry: 4, board: 1.2 };

export interface Medic {
  phase: MedicPhase;
  t: number; // seconds in this phase
  x: number;
  z: number;
  h: number;
  kneel: number; // 0 standing .. 1 kneeling
  visible: boolean;
}

export interface Pose2 {
  x: number;
  z: number;
  h: number; // heading, 0 = +z
}

export interface MedicOut {
  /** Stretcher pose for the rider while being carried (null otherwise). */
  carry: { x: number; y: number; z: number; h: number } | null;
  /** The rider is in the ambulance. */
  loaded: boolean;
  /** The paramedic is back in: the ambulance can leave. */
  done: boolean;
}

export function newMedic(): Medic {
  return { phase: "waiting", t: 0, x: 0, z: 0, h: 0, kneel: 0, visible: false };
}

/** Side door (kerb side, front), side waypoint and back doors of an ambulance parked at `amb`. */
export function doors(amb: Pose2, halfLength: number) {
  const fx = Math.sin(amb.h);
  const fz = Math.cos(amb.h);
  const lx = fz; // left of travel = kerb side when driving on the left
  const lz = -fx;
  return {
    side: { x: amb.x + lx * 1.5 + fx * 0.9, z: amb.z + lz * 1.5 + fz * 0.9 },
    along: { x: amb.x + lx * 1.9, z: amb.z + lz * 1.9 },
    rear: { x: amb.x - fx * (halfLength + 0.9), z: amb.z - fz * (halfLength + 0.9) },
  };
}

/** Where the paramedic kneels: beside the rider, on the ambulance's side. */
export function kneelSpot(rider: { x: number; z: number }, from: { x: number; z: number }) {
  const dx = from.x - rider.x;
  const dz = from.z - rider.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: rider.x + (dx / d) * 0.75, z: rider.z + (dz / d) * 0.75 };
}

function lerp(m: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }, u: number) {
  m.x = a.x + (b.x - a.x) * u;
  m.z = a.z + (b.z - a.z) * u;
}

const ease = (u: number) => u * u * (3 - 2 * u);
const out: MedicOut = { carry: null, loaded: false, done: false };
const carry = { x: 0, y: 0, z: 0, h: 0 };
const p = { x: 0, z: 0 };

/**
 * Advance the paramedic. `parked`: the ambulance is at the scene. Returns a shared result object
 * (valid until the next call). Phases always run in order, each exactly once.
 */
export function stepMedic(m: Medic, dt: number, parked: boolean, amb: Pose2, halfLength: number, rider: { x: number; z: number }): MedicOut {
  out.carry = null;
  out.loaded = m.phase === "board" || m.phase === "done";
  out.done = m.phase === "done";
  if (m.phase === "done") {
    m.visible = false;
    return out;
  }
  if (m.phase === "waiting") {
    if (!parked) return out;
    m.phase = "walk";
    m.t = 0;
  }
  m.t += dt;
  const d = doors(amb, halfLength);
  const spot = kneelSpot(rider, d.side);
  m.visible = true;
  if (m.phase === "walk") {
    const u = Math.min(1, m.t / MEDIC_S.walk);
    lerp(m, d.side, spot, ease(u));
    m.h = Math.atan2(spot.x - d.side.x, spot.z - d.side.z);
    m.kneel = 0;
    if (u >= 1) {
      m.phase = "kneel";
      m.t = 0;
    }
  } else if (m.phase === "kneel") {
    m.x = spot.x;
    m.z = spot.z;
    m.h = Math.atan2(rider.x - spot.x, rider.z - spot.z);
    const u = m.t / MEDIC_S.kneel;
    m.kneel = Math.min(1, Math.min(u * 4, (1 - u) * 4)); // kneel down, then stand back up
    if (u >= 1) {
      m.phase = "carry";
      m.t = 0;
      m.kneel = 0;
    }
  } else if (m.phase === "carry") {
    // rider on a stretcher: rider -> along the kerb side -> back doors, paramedic walking alongside
    const u = Math.min(1, m.t / MEDIC_S.carry);
    const l1 = Math.hypot(d.along.x - rider.x, d.along.z - rider.z);
    const l2 = Math.hypot(d.rear.x - d.along.x, d.rear.z - d.along.z);
    const s = ease(u) * (l1 + l2);
    let hx: number;
    let hz: number;
    if (s <= l1 && l1 > 0) {
      lerp(p, rider, d.along, s / l1);
      hx = d.along.x - rider.x;
      hz = d.along.z - rider.z;
    } else {
      lerp(p, d.along, d.rear, l2 > 0 ? (s - l1) / l2 : 1);
      hx = d.rear.x - d.along.x;
      hz = d.rear.z - d.along.z;
    }
    const lift = Math.min(1, m.t / 0.6);
    carry.x = p.x;
    carry.z = p.z;
    carry.y = 0.15 + 0.7 * lift;
    carry.h = Math.atan2(hx, hz);
    out.carry = carry;
    // paramedic at the head end of the stretcher
    const fx = Math.sin(carry.h);
    const fz = Math.cos(carry.h);
    m.x = p.x + fx * 1.3;
    m.z = p.z + fz * 1.3;
    m.h = carry.h;
    if (u >= 1) {
      m.phase = "board";
      m.t = 0;
      out.carry = null;
      out.loaded = true;
    }
  } else if (m.phase === "board") {
    // the paramedic climbs in the back with the patient
    const u = Math.min(1, m.t / MEDIC_S.board);
    m.x = d.rear.x;
    m.z = d.rear.z;
    m.h = amb.h;
    if (u >= 1) {
      m.phase = "done";
      m.visible = false;
      out.done = true;
    }
  }
  return out;
}
