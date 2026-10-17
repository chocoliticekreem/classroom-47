// Shipping: sea lanes. Centripetal Catmull-Rom splines through waypoints, sampled to an arc-length table so a
// ship's pose at distance s is a cheap lookup. Plus the harbour geometry: anchorage, berth swing points, lanes.
import { BERTHS, type BerthId } from "../../berths";
import { WATER_X } from "../../config";

export type P2 = readonly [number, number];

export interface Lane {
  x: Float32Array;
  z: Float32Array;
  /** heading (three.js rotation.y; bow direction = (sin h, cos h)) at each sample */
  h: Float32Array;
  step: number;
  count: number;
  length: number;
}

export interface Pose2 {
  x: number;
  z: number;
  heading: number;
}

function cr(p0: P2, p1: P2, p2: P2, p3: P2, t: number, out: [number, number]) {
  // centripetal Catmull-Rom (alpha 0.5), Barry-Goldman pyramid
  const d = (a: P2, b: P2) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (a: P2 | [number, number], b: P2 | [number, number], ta: number, tb: number, i: 0 | 1) =>
    ((tb - tt) / (tb - ta)) * a[i] + ((tt - ta) / (tb - ta)) * b[i];
  for (const i of [0, 1] as const) {
    const a1 = L(p0, p1, t0, t1, i), a2 = L(p1, p2, t1, t2, i), a3 = L(p2, p3, t2, t3, i);
    const b1 = ((t2 - tt) / (t2 - t0)) * a1 + ((tt - t0) / (t2 - t0)) * a2;
    const b2 = ((t3 - tt) / (t3 - t1)) * a2 + ((tt - t1) / (t3 - t1)) * a3;
    out[i] = ((t2 - tt) / (t2 - t1)) * b1 + ((tt - t1) / (t2 - t1)) * b2;
  }
}

/** Build a lane through the points. Optional start/end headings add phantom control points so the curve leaves
 *  and arrives along those headings. */
export function buildLane(points: P2[], step = 2, startHeading?: number, endHeading?: number): Lane {
  const pts = points.slice();
  const first = pts[0], last = pts[pts.length - 1];
  const head = startHeading !== undefined ? ([first[0] - Math.sin(startHeading) * 60, first[1] - Math.cos(startHeading) * 60] as P2) : ([2 * first[0] - pts[1][0], 2 * first[1] - pts[1][1]] as P2);
  const tail = endHeading !== undefined ? ([last[0] + Math.sin(endHeading) * 60, last[1] + Math.cos(endHeading) * 60] as P2) : ([2 * last[0] - pts[pts.length - 2][0], 2 * last[1] - pts[pts.length - 2][1]] as P2);
  const ctl = [head, ...pts, tail];
  // dense polyline
  const dense: [number, number][] = [];
  const o: [number, number] = [0, 0];
  for (let i = 1; i < ctl.length - 2; i++) {
    const segLen = Math.hypot(ctl[i + 1][0] - ctl[i][0], ctl[i + 1][1] - ctl[i][1]);
    const n = Math.max(4, Math.ceil(segLen / 1));
    for (let k = 0; k < n; k++) {
      cr(ctl[i - 1], ctl[i], ctl[i + 1], ctl[i + 2], k / n, o);
      dense.push([o[0], o[1]]);
    }
  }
  dense.push([last[0], last[1]]);
  // arc length resample
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const length = cum[cum.length - 1];
  const count = Math.max(2, Math.floor(length / step) + 1);
  const x = new Float32Array(count), z = new Float32Array(count), h = new Float32Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / (count - 1)) * length;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    x[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f;
    z[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f;
  }
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1), b = Math.min(count - 1, i + 1);
    h[i] = Math.atan2(x[b] - x[a], z[b] - z[a]);
  }
  if (startHeading !== undefined) h[0] = startHeading;
  if (endHeading !== undefined) h[count - 1] = endHeading;
  return { x, z, h, step: length / (count - 1), count, length };
}

/** Pose at arc length s (clamped). Writes into out to avoid allocation. */
export function laneAt(l: Lane, s: number, out: Pose2): Pose2 {
  const u = Math.min(l.count - 1, Math.max(0, s / l.step));
  const i = Math.min(l.count - 2, Math.floor(u));
  const f = u - i;
  out.x = l.x[i] + (l.x[i + 1] - l.x[i]) * f;
  out.z = l.z[i] + (l.z[i + 1] - l.z[i]) * f;
  out.heading = l.h[i] + wrapAngle(l.h[i + 1] - l.h[i]) * f;
  return out;
}

export function wrapAngle(a: number) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function lerpAngle(a: number, b: number, t: number) {
  return a + wrapAngle(b - a) * t;
}

// ---------- speed profile ----------

export interface Motion {
  s: number;
  v: number;
}

/** Advance along a lane: accelerate to vmax, then brake so v reaches 0 exactly at `stopAt` (default lane end).
 *  Returns true when stopped at the end. */
export function advance(m: Motion, dt: number, vmax: number, accel: number, decel: number, stopAt: number): boolean {
  const remain = stopAt - m.s;
  if (remain <= 0.02) {
    m.s = stopAt;
    m.v = 0;
    return true;
  }
  const vBrake = Math.sqrt(2 * decel * remain);
  const target = Math.min(vmax, vBrake);
  if (m.v < target) m.v = Math.min(target, m.v + accel * dt);
  else m.v = Math.max(target, m.v - decel * 2 * dt);
  m.v = Math.max(m.v, Math.min(0.25, remain)); // never stall short of the mark
  m.s = Math.min(stopAt, m.s + m.v * dt);
  if (stopAt - m.s <= 0.02) {
    m.s = stopAt;
    m.v = 0;
    return true;
  }
  return false;
}

/** Departure: accelerate to vmax, no braking (sail off to the horizon). */
export function accelerate(m: Motion, dt: number, vmax: number, accel: number, end: number) {
  m.v = Math.min(vmax, m.v + accel * dt);
  m.s = Math.min(end, m.s + m.v * dt);
  return m.s >= end;
}

export function smoother(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// ---------- harbour geometry ----------
//
// Each berth has its own lanes so the two berths never cross each other:
//   docks (z ~ 0):      anchorage N1 (north-east) -> hold point W_D -> swing point F_D, inbound heading south;
//                       tugs turn it 180 deg to bow-north, push it alongside. Departs east along z ~ 0.
//   terminal (z ~ 225): anchorage S1/S2 (south-east) -> hold point W_T -> swing point F_T, inbound heading NNW;
//                       tugs straighten it to bow-north, push it alongside. Departs east along z ~ 250.
// A queued ship may sail to its hold point while the previous ship is still alongside; it continues to the
// swing point once the berth is released (previous ship well clear on its way out).

/** Moored heading: bow north (-z). Bay 0 of the deck grid is then at the berth's zMin end. */
export const MOORED_HEADING = Math.PI;
/** Outbound heading after the tugs swing the ship off the berth: east, out to sea. */
export const OUTBOUND_HEADING = Math.PI / 2;
/** Default distance off the quay line where the ship is turned (the swing point), then pushed sideways from.
 *  Ships use swingOffFor(half): just enough room to swing their length clear of the quay. */
export const SWING_OFF = 130;
export function swingOffFor(half: number, quayX: number) {
  return WATER_X + half + 10 - quayX;
}

/** Anchor heading: lying west, towards the port (small swing added at runtime). */
export const ANCHOR_HEADING = -Math.PI / 2;

export interface Spot {
  x: number;
  z: number;
  berth: BerthId;
}
/** Anchorage spots. N1 serves the docks (north lane), S1 and S2 the terminal (south lane). */
export const ANCHORAGE: Spot[] = [
  { x: 850, z: -190, berth: "docks" },
  { x: 930, z: 460, berth: "terminal" },
  { x: 1000, z: 640, berth: "terminal" },
];

/** Tug + pilot pontoons, one near each berth (tug team per berth). */
export const TUG_BASE: Record<BerthId, P2> = { docks: [395, -205], terminal: [395, 410] };

/** Hold points: a queued ship waits here (clear of the departing ship's swing circle and outbound lane). */
export const HOLD: Record<BerthId, P2> = { docks: [600, -160], terminal: [690, 430] };

export function berthCentre(b: BerthId): P2 {
  const B = BERTHS[b];
  return [B.quayX, (B.zMin + B.zMax) / 2];
}

/** Where the approach lane ends: abreast of the berth, SWING_OFF out. */
export function swingPoint(b: BerthId, off = SWING_OFF): P2 {
  const [x, z] = berthCentre(b);
  return [x + off, z];
}

export interface ApproachLane {
  lane: Lane;
  /** Arc length of the hold point on the lane. */
  holdS: number;
}

function nearestS(l: Lane, p: P2) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < l.count; i++) {
    const d = (l.x[i] - p[0]) ** 2 + (l.z[i] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best * l.step;
}

/** Anchorage spot -> hold point -> swing point. */
export function approachLane(b: BerthId, from: P2, fromHeading: number, off = SWING_OFF): ApproachLane {
  const F = swingPoint(b, off);
  const W = HOLD[b];
  const ahead: P2 = [from[0] + Math.sin(fromHeading) * 120, from[1] + Math.cos(fromHeading) * 120];
  let pts: P2[];
  if (b === "docks") pts = [from, ahead, W, [F[0] + 46, F[1] - 110], [F[0] + 8, F[1] - 50], F];
  else if (from[1] > 560) pts = [from, ahead, [780, 515], W, [F[0] + 86, F[1] + 130], [F[0] + 26, F[1] + 65], F];
  else pts = [from, ahead, W, [F[0] + 86, F[1] + 130], [F[0] + 26, F[1] + 65], F];
  const lane = buildLane(pts, 2, fromHeading);
  return { lane, holdS: nearestS(lane, W) };
}

/** Swing point (after the tugs turn it east) -> out past the horizon along the berth's own outbound lane. */
export function departureLane(b: BerthId, off = SWING_OFF): Lane {
  const F = swingPoint(b, off);
  const pts: P2[] =
    b === "terminal"
      ? [F, [640, 240], [1000, 270], [1600, 300], [2700, 330]]
      : [F, [640, -10], [1000, -40], [1600, -70], [2700, -110]];
  return buildLane(pts, 2, OUTBOUND_HEADING);
}

/** Horizon -> anchorage spot, steaming west. */
export function inboundLane(spot: number): Lane {
  const S = ANCHORAGE[spot];
  const dz = S.z < 0 ? -130 : 100;
  return buildLane([[2450, S.z + dz], [1700, S.z + dz * 0.5], [1200, S.z + dz * 0.1], [S.x, S.z]], 2, undefined, ANCHOR_HEADING);
}

/** x beyond which a departing ship is over the horizon (hidden in the haze) and leaves the simulation. */
export const HORIZON_X = 2650;
