// The residence helicopter's flight schedule (pure): parked on the South Lawn pad, spins up, lifts off, flies a
// loop out over the sea and back, lands and spins down. One cycle every HELI_CYCLE seconds.
import { HELIPAD } from "./layout";

export const HELI_CYCLE = 150;
const PAD_Y = 0.3;
const HOVER_Y = 18;
const T_SPIN_UP = 44;
const T_LIFT = 52;
const T_FLY = 60;
const T_DESCEND = 130;
const T_LANDED = 140;

export interface HeliState {
  x: number;
  y: number;
  z: number;
  yaw: number; // about y, 0 = nose facing +z
  rotor: number; // 0..1 rotor speed
}

// Loop waypoints [x, y, z]: east over the sea and back round to the pad.
const WP: [number, number, number][] = [
  [HELIPAD.x, HOVER_Y, HELIPAD.z],
  [352, 34, -150],
  [420, 58, -205],
  [505, 70, -170],
  [512, 70, -95],
  [445, 58, -82],
  [372, 36, -112],
  [HELIPAD.x, HOVER_Y, HELIPAD.z],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const _p: [number, number, number] = [0, 0, 0];
function pathAt(u: number, out: [number, number, number]) {
  const segs = WP.length - 1;
  const f = Math.min(Math.max(u, 0), 1) * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const t = f - i;
  const a = WP[Math.max(0, i - 1)];
  const b = WP[i];
  const c = WP[i + 1];
  const d = WP[Math.min(WP.length - 1, i + 2)];
  for (let k = 0; k < 3; k++) out[k] = catmull(a[k], b[k], c[k], d[k], t);
  return out;
}

const _q: [number, number, number] = [0, 0, 0];
function yawAt(u: number) {
  pathAt(Math.max(0, u - 0.004), _p);
  pathAt(Math.min(1, u + 0.004), _q);
  return Math.atan2(_q[0] - _p[0], _q[2] - _p[2]);
}
const YAW_START = yawAt(0.02);
const YAW_END = yawAt(0.98);

const smooth = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Fills `out` with the helicopter's state at time `t` seconds (any t; wraps every HELI_CYCLE). */
export function heliState(t: number, out: HeliState): HeliState {
  const c = ((t % HELI_CYCLE) + HELI_CYCLE) % HELI_CYCLE;
  out.x = HELIPAD.x;
  out.z = HELIPAD.z;
  out.y = PAD_Y;
  out.yaw = YAW_END; // parked as it landed
  out.rotor = 0;
  if (c < T_SPIN_UP) return out;
  if (c < T_LIFT) {
    out.rotor = smooth((c - T_SPIN_UP) / (T_LIFT - T_SPIN_UP));
    return out;
  }
  out.rotor = 1;
  if (c < T_FLY) {
    const k = smooth((c - T_LIFT) / (T_FLY - T_LIFT));
    out.y = PAD_Y + (HOVER_Y - PAD_Y) * k;
    // turn on the spot while lifting, to face the outbound leg
    const d = Math.atan2(Math.sin(YAW_START - YAW_END), Math.cos(YAW_START - YAW_END));
    out.yaw = YAW_END + d * k;
    return out;
  }
  if (c < T_DESCEND) {
    const s = (c - T_FLY) / (T_DESCEND - T_FLY);
    const u = s - Math.sin(2 * Math.PI * s) / (2 * Math.PI); // ease in and out
    pathAt(u, _p);
    out.x = _p[0];
    out.y = _p[1];
    out.z = _p[2];
    out.yaw = yawAt(Math.min(0.98, Math.max(0.02, u)));
    return out;
  }
  out.yaw = YAW_END;
  if (c < T_LANDED) {
    out.y = HOVER_Y + (PAD_Y - HOVER_Y) * smooth((c - T_DESCEND) / (T_LANDED - T_DESCEND));
    return out;
  }
  out.rotor = 1 - smooth((c - T_LANDED) / (HELI_CYCLE - T_LANDED));
  return out;
}
