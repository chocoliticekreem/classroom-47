// The river centre line as a smooth, arc-length sampled curve (Catmull-Rom through RIVER.points, extended
// a little upstream past the world edge and downstream out to sea for ships). Pure, allocation-free lookups.
import * as THREE from "three";
import { RIVER } from "../../config";

export const HALF_W = RIVER.width / 2; // 35
export const STEP = 4; // metres between samples

/** Upstream extension (hidden in haze) + config points + sea run-out for ships. */
const CONTROL: [number, number][] = [[-1500, -520], ...RIVER.points, [560, -620], [820, -620]];

export interface RiverPath {
  /** Sample arrays, uniform spacing STEP along the curve. */
  x: Float32Array;
  z: Float32Array;
  /** Unit tangent (direction of flow, west -> east). */
  tx: Float32Array;
  tz: Float32Array;
  count: number;
  length: number;
}

function build(): RiverPath {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "centripetal",
  );
  const length = curve.getLength();
  const count = Math.floor(length / STEP) + 1;
  const pts = curve.getSpacedPoints(count - 1);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  const tx = new Float32Array(count);
  const tz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = pts[i].x;
    z[i] = pts[i].z;
  }
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  return { x, z, tx, tz, count, length: (count - 1) * STEP };
}

export const PATH = build();

export interface Pose {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** Pose at arc length s (clamped), written into `out`. Normal (to the right of the flow) is (-tz, tx). */
export function poseAt(s: number, out: Pose): Pose {
  const f = Math.min(PATH.count - 1.0001, Math.max(0, s / STEP));
  const i = Math.floor(f);
  const t = f - i;
  out.x = PATH.x[i] + (PATH.x[i + 1] - PATH.x[i]) * t;
  out.z = PATH.z[i] + (PATH.z[i + 1] - PATH.z[i]) * t;
  const tx = PATH.tx[i] + (PATH.tx[i + 1] - PATH.tx[i]) * t;
  const tz = PATH.tz[i] + (PATH.tz[i + 1] - PATH.tz[i]) * t;
  const l = Math.hypot(tx, tz) || 1;
  out.tx = tx / l;
  out.tz = tz / l;
  return out;
}

/** Arc length where the curve reaches x (the curve is monotonic in x). */
export function sAtX(x: number): number {
  let lo = 0;
  let hi = PATH.count - 1;
  if (x <= PATH.x[lo]) return 0;
  if (x >= PATH.x[hi]) return PATH.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PATH.x[mid] < x) lo = mid;
    else hi = mid;
  }
  const t = (x - PATH.x[lo]) / (PATH.x[hi] - PATH.x[lo] || 1);
  return (lo + t) * STEP;
}

const _p: Pose = { x: 0, z: 0, tx: 1, tz: 0 };
/** Smoothed centre z at x. */
export function centreZ(x: number): number {
  return poseAt(sAtX(x), _p).z;
}

/** Visible extents of the embankments (m of x): walls stop where the land meets the sea. */
export const BANK_X0 = -1180;
export const BANK_X1 = 322;
/** The water ribbon runs from far upstream and fades into the sea over WATER_FADE metres past BANK_X1. */
export const WATER_X0 = -1480;
export const WATER_FADE = 28;
