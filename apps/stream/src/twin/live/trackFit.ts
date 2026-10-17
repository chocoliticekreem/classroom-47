import type { TrackedClass, TrackedObject } from "@/platform/around/types";
import { nearestRoad, type RoadSnap, type SnapIndex } from "../network/snap";
import { frameCoordsOf, MAX_GROUND_M, projectInto, type CamFrame } from "./project";

/**
 * Turns one camera's raw YOLO vehicle tracks into trajectories a car can actually drive, so the compare
 * view shows cars on the road rather than boxes jittering across it:
 *
 *  1. Box bottoms cut off by the frame edge are dropped (they sit on the edge, not on the road), the rest are
 *     projected onto the road and smoothed with a robust local-linear fit (depth is noisy far away).
 *  2. Fragments of one vehicle are stitched together: ByteTrack ID switches, a car lost behind a bus for a
 *     second, or the same van seen as "truck" then "car" then "bus".
 *  3. Tracks that begin or end mid-view are extended (driving on, or waiting where they stood) until they
 *     leave the frame, so cars drive in and out of shot instead of popping up in the road.
 *  4. Each car is kept inside its carriageway, on the left for two-way roads, and points along the road.
 *
 * `separate()` then runs every frame: a car overlapping a nearer one is pushed back along its own camera
 * ray. Depth is what the camera measures worst, and a point moved along its ray stays on the same pixel.
 */

export type VehicleClass = Exclude<TrackedClass, "person">;

/** Real-world footprint per class: [width, height, length] in metres. */
export const DIMS: Record<VehicleClass, [number, number, number]> = {
  car: [1.85, 1.05, 4.4],
  bus: [2.55, 4.4, 10.8], // London double-decker
  truck: [2.5, 3.2, 7.5],
  motorcycle: [0.8, 1.25, 2.1],
  bicycle: [0.6, 1.15, 1.8],
};

export interface FittedVehicle {
  id: number;
  cls: VehicleClass;
  color: string | undefined;
  /** Sample k is at clip time (k0 + k) * DT. */
  k0: number;
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  /** 1 where the camera did not see the car (stitched gap or extension). */
  ext: Uint8Array;
  /** False when the track is already there at the clip's start (or still there at its end): no fade. */
  fadeIn: boolean;
  fadeOut: boolean;
}

export const DT = 0.1;
/** Box bottoms this close to the frame edge are cut off by it. */
const EDGE_U = 0.03;
const EDGE_V = 0.975;
/** Below this a car counts as stopped. */
const MOVING_MS = 1.5;
const MAX_SPEED_MS = 20;
const STITCH_GAP_S = 1.6;
const STITCH_M = 3.5;
/** Extra stitching slack per second of gap. */
const STITCH_MS = 2.5;
const DUPLICATE_M = 2.5;
const EXTEND_S = 3;
const HOLD_S = 5;
/** An extension keeps driving this long past the frame edge so the whole body is out before it goes. */
const PAST_EDGE_S = 0.6;
const CLIP_EDGE_S = 0.2;
const ROAD_M = 10;
/** A point further outside its carriageway than this is somewhere the network doesn't know (a forecourt, a car park): left alone. */
const OFF_ROAD_M = 4;
/** Slack between a body and the kerb. */
const KERB_M = 0.1;
/** Most a heading may differ from the road's while moving (lane changes, turns). */
const ROAD_YAW_RAD = 0.3;
const MIN_SEEN_S = 0.4;

interface Work {
  id: number;
  votes: Map<VehicleClass, number>;
  /** Colour and length (s) of the longest piece, which names the merged track's colour. */
  color: string | undefined;
  /** Median box (frame fractions) of the longest piece that has one. */
  box: [number, number] | undefined;
  colorLen: number;
  k0: number;
  x: number[];
  z: number[];
  vx: number[];
  vz: number[];
  ext: number[];
}

const _uv = [0, 0];
const _xz = [0, 0];
const _road: RoadSnap = { px: 0, pz: 0, tx: 0, tz: 0, lateral: 0, width: 0, oneway: false, dist: 0 };

const end = (w: Work) => w.k0 + w.x.length - 1;

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Robust local-linear fit of (t, x, z) points onto the DT grid. Two passes: the second down-weights
 * points more than 3 m from the first fit (a box that briefly grabbed a neighbour or a shadow).
 */
function smooth(ts: number[], xs: number[], zs: number[], sigma: number): Pick<Work, "k0" | "x" | "z" | "vx" | "vz"> {
  const k0 = Math.round(ts[0] / DT);
  const n = Math.round(ts[ts.length - 1] / DT) - k0 + 1;
  const robust = new Array<number>(ts.length).fill(1);
  const out = { k0, x: new Array<number>(n), z: new Array<number>(n), vx: new Array<number>(n), vz: new Array<number>(n) };
  const reach = 2.5 * sigma;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const tau = (k0 + k) * DT;
      let s0 = 0, s1 = 0, s2 = 0, sx = 0, stx = 0, sz = 0, stz = 0;
      for (let i = 0; i < ts.length; i++) {
        const dt = ts[i] - tau;
        if (dt < -reach || dt > reach) continue;
        const w = Math.exp((-dt * dt) / (2 * sigma * sigma)) * robust[i];
        s0 += w;
        s1 += w * dt;
        s2 += w * dt * dt;
        sx += w * xs[i];
        stx += w * dt * xs[i];
        sz += w * zs[i];
        stz += w * dt * zs[i];
      }
      const det = s0 * s2 - s1 * s1;
      if (s0 < 1e-9) {
        out.x[k] = k ? out.x[k - 1] : xs[0];
        out.z[k] = k ? out.z[k - 1] : zs[0];
        out.vx[k] = out.vz[k] = 0;
      } else if (det < 1e-6 * s0 * s0) {
        out.x[k] = sx / s0;
        out.z[k] = sz / s0;
        out.vx[k] = out.vz[k] = 0;
      } else {
        out.x[k] = (s2 * sx - s1 * stx) / det;
        out.z[k] = (s2 * sz - s1 * stz) / det;
        out.vx[k] = (s0 * stx - s1 * sx) / det;
        out.vz[k] = (s0 * stz - s1 * sz) / det;
      }
    }
    if (pass === 1) break;
    for (let i = 0; i < ts.length; i++) {
      const k = Math.min(n - 1, Math.max(0, Math.round(ts[i] / DT) - k0));
      const r = Math.hypot(xs[i] - out.x[k], zs[i] - out.z[k]);
      robust[i] = r > 3 ? (3 / r) ** 2 : 1;
    }
  }
  for (let k = 0; k < n; k++) {
    const sp = Math.hypot(out.vx[k], out.vz[k]);
    if (sp > MAX_SPEED_MS) {
      out.vx[k] *= MAX_SPEED_MS / sp;
      out.vz[k] *= MAX_SPEED_MS / sp;
    }
  }
  return out;
}

function fromTrack(frame: CamFrame, tr: TrackedObject): Work | null {
  const cut = (p: TrackedObject["pts"][number]) => p[1] < EDGE_U || p[1] > 1 - EDGE_U || p[2] > EDGE_V;
  const clean = tr.pts.filter((p) => !cut(p));
  // A car cut by the frame edge for its whole track (parked at the bottom of shot) keeps its points.
  const pts = clean.length >= 3 ? clean : tr.pts;
  if (pts.length < 2) return null;
  const ts: number[] = [];
  const xs: number[] = [];
  const zs: number[] = [];
  const dists: number[] = [];
  for (const [t, u, v] of pts) {
    projectInto(frame, u, v, _xz);
    ts.push(t);
    xs.push(_xz[0]);
    zs.push(_xz[1]);
    dists.push(Math.hypot(_xz[0] - frame.x, _xz[1] - frame.z));
  }
  dists.sort((a, b) => a - b);
  // A pixel of jitter is a few cm up close and several metres near the horizon: smooth far tracks harder.
  const sigma = Math.min(0.9, 0.3 + dists[dists.length >> 1] / 150);
  const cls: VehicleClass = tr.cls && tr.cls !== "person" ? tr.cls : "car";
  const seen = pts[pts.length - 1][0] - pts[0][0];
  const fit = smooth(ts, xs, zs, sigma);
  return {
    id: tr.id,
    votes: new Map([[cls, seen + DT]]),
    color: tr.color,
    box: tr.box,
    colorLen: seen,
    ...fit,
    ext: new Array<number>(fit.x.length).fill(0),
  };
}

/** Distance between the two tracks where they would join, or Infinity when they can't be one vehicle. */
function joinCost(a: Work, b: Work): number {
  const gapK = b.k0 - end(a);
  if (gapK > 0) {
    const gap = gapK * DT;
    if (gap > STITCH_GAP_S) return Infinity;
    const ia = a.x.length - 1;
    const sa = Math.hypot(a.vx[ia], a.vz[ia]);
    const sb = Math.hypot(b.vx[0], b.vz[0]);
    if (sa > MOVING_MS && sb > MOVING_MS) {
      const turn = Math.abs(wrapAngle(Math.atan2(a.vx[ia], a.vz[ia]) - Math.atan2(b.vx[0], b.vz[0])));
      if (turn > Math.PI / 3) return Infinity;
    }
    const d = Math.hypot(a.x[ia] + a.vx[ia] * gap - b.x[0], a.z[ia] + a.vz[ia] * gap - b.z[0]);
    return d <= STITCH_M + STITCH_MS * gap ? d : Infinity;
  }
  // Overlapping in time: the same vehicle twice (an ID switch, or two classes for one van).
  const k1 = Math.min(end(a), end(b));
  let sum = 0;
  let n = 0;
  for (let k = b.k0; k <= k1; k++) {
    sum += Math.hypot(a.x[k - a.k0] - b.x[k - b.k0], a.z[k - a.k0] - b.z[k - b.k0]);
    n++;
  }
  const mean = n ? sum / n : Infinity;
  return mean <= DUPLICATE_M ? mean : Infinity;
}

/** One track from two, `a` starting first: overlaps cross-fade from a to b, gaps are interpolated. */
function merge(a: Work, b: Work): Work {
  const k0 = a.k0;
  const k1 = Math.max(end(a), end(b));
  const n = k1 - k0 + 1;
  const m: Work = {
    id: a.id,
    votes: new Map(a.votes),
    color: a.colorLen >= b.colorLen ? a.color : b.color,
    box: (a.colorLen >= b.colorLen ? a.box : b.box) ?? a.box ?? b.box,
    colorLen: Math.max(a.colorLen, b.colorLen),
    k0,
    x: new Array(n),
    z: new Array(n),
    vx: new Array(n),
    vz: new Array(n),
    ext: new Array(n),
  };
  for (const [c, s] of b.votes) m.votes.set(c, (m.votes.get(c) ?? 0) + s);
  const ovA = b.k0;
  const ovB = Math.min(end(a), end(b));
  // b inside a's span is a duplicate: a carries on rather than handing over and jumping back.
  const inside = end(b) <= end(a);
  const ia = a.x.length - 1;
  for (let i = 0; i < n; i++) {
    const k = k0 + i;
    const inA = k <= end(a);
    const inB = k >= b.k0 && k <= end(b);
    if (inA && inB) {
      const w = inside ? 0 : ovB > ovA ? (k - ovA) / (ovB - ovA) : 0.5;
      const ja = k - a.k0;
      const jb = k - b.k0;
      m.x[i] = a.x[ja] + (b.x[jb] - a.x[ja]) * w;
      m.z[i] = a.z[ja] + (b.z[jb] - a.z[ja]) * w;
      m.vx[i] = a.vx[ja] + (b.vx[jb] - a.vx[ja]) * w;
      m.vz[i] = a.vz[ja] + (b.vz[jb] - a.vz[ja]) * w;
      m.ext[i] = a.ext[ja] && b.ext[jb];
    } else if (inA || inB) {
      const src = inA ? a : b;
      const j = k - src.k0;
      m.x[i] = src.x[j];
      m.z[i] = src.z[j];
      m.vx[i] = src.vx[j];
      m.vz[i] = src.vz[j];
      m.ext[i] = src.ext[j];
    } else {
      // In the gap between a's end and b's start.
      const w = (k - end(a)) / (b.k0 - end(a));
      m.x[i] = a.x[ia] + (b.x[0] - a.x[ia]) * w;
      m.z[i] = a.z[ia] + (b.z[0] - a.z[ia]) * w;
      m.vx[i] = a.vx[ia] + (b.vx[0] - a.vx[ia]) * w;
      m.vz[i] = a.vz[ia] + (b.vz[0] - a.vz[ia]) * w;
      m.ext[i] = 1;
    }
  }
  return m;
}

function stitch(works: Work[]): Work[] {
  const list = [...works];
  for (;;) {
    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j || list[i].k0 > list[j].k0 || (list[i].k0 === list[j].k0 && i > j)) continue;
        const c = joinCost(list[i], list[j]);
        if (c < best) {
          best = c;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return list;
    const merged = merge(list[bi], list[bj]);
    list.splice(Math.max(bi, bj), 1);
    list.splice(Math.min(bi, bj), 1, merged);
  }
}

/** Whether a ground point is in (or within a body's length of) the camera's frame. */
function inShot(frame: CamFrame, x: number, z: number) {
  if (Math.hypot(x - frame.x, z - frame.z) > MAX_GROUND_M) return false;
  if (!frameCoordsOf(frame, x, z, _uv)) return false;
  return _uv[0] > -0.04 && _uv[0] < 1.04 && _uv[1] > -0.04 && _uv[1] < 1.06;
}

/**
 * Prepends (dir -1) or appends (dir 1) samples: a moving car keeps its speed until it has left the frame,
 * a stopped one stays where it was. Both stop at the clip's start or end.
 */
function extend(w: Work, frame: CamFrame, dir: -1 | 1, duration: number, seenS: number) {
  const i = dir < 0 ? 0 : w.x.length - 1;
  const k = w.k0 + i;
  const room = dir < 0 ? k * DT : duration - k * DT;
  if (room < CLIP_EDGE_S) return;
  // Speed from a short window, not the edge sample alone.
  let vx = 0;
  let vz = 0;
  const span = Math.min(5, w.x.length);
  for (let j = 0; j < span; j++) {
    vx += w.vx[dir < 0 ? j : w.x.length - 1 - j] / span;
    vz += w.vz[dir < 0 ? j : w.x.length - 1 - j] / span;
  }
  const moving = Math.hypot(vx, vz) > MOVING_MS;
  if (!moving) vx = vz = 0;
  // A glimpse is no evidence of a car for long: never extend by more than twice what the camera saw.
  const steps = Math.floor(Math.min(room, moving ? EXTEND_S : HOLD_S, Math.max(1, 2 * seenS)) / DT);
  const add = { x: [] as number[], z: [] as number[] };
  let outside = 0;
  for (let s = 1; s <= steps; s++) {
    const x = w.x[i] + dir * vx * s * DT;
    const z = w.z[i] + dir * vz * s * DT;
    add.x.push(x);
    add.z.push(z);
    if (moving && !inShot(frame, x, z) && ++outside * DT >= PAST_EDGE_S) break;
  }
  const n = add.x.length;
  if (!n) return;
  if (dir < 0) {
    add.x.reverse();
    add.z.reverse();
    w.k0 -= n;
    w.x.unshift(...add.x);
    w.z.unshift(...add.z);
    w.vx.unshift(...new Array<number>(n).fill(vx));
    w.vz.unshift(...new Array<number>(n).fill(vz));
    w.ext.unshift(...new Array<number>(n).fill(1));
  } else {
    w.x.push(...add.x);
    w.z.push(...add.z);
    w.vx.push(...new Array<number>(n).fill(vx));
    w.vz.push(...new Array<number>(n).fill(vz));
    w.ext.push(...new Array<number>(n).fill(1));
  }
}

/** Classes YOLO confuses with each other on JamCams (a red SUV as a bus, a van as a car): the size settles it. */
const SIZED: VehicleClass[] = ["car", "truck", "bus"];
/** Keeping YOLO's own class costs nothing; switching has to explain the box this much better (log units). */
const SWITCH_COST = 0.25;

/**
 * The class whose real-world box, placed where the track says the vehicle is and facing its way, projects to
 * the box the camera actually saw. YOLO's vote wins ties.
 */
function checkClass(w: Work, voted: VehicleClass, frame: CamFrame, snap: SnapIndex | null): VehicleClass {
  if (!w.box || !SIZED.includes(voted)) return voted;
  // A moment the camera really saw it, as far from the frame edge as the track gets.
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < w.x.length; i++) {
    if (w.ext[i] || !frameCoordsOf(frame, w.x[i], w.z[i], _uv)) continue;
    const score = Math.min(_uv[0], 1 - _uv[0], 1 - _uv[1]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return voted;
  const x0 = w.x[best];
  const z0 = w.z[best];
  const moving = Math.hypot(w.vx[best], w.vz[best]) > MOVING_MS;
  let yaw = moving ? Math.atan2(w.vx[best], w.vz[best]) : Math.atan2(x0 - frame.x, z0 - frame.z);
  if (!moving && snap && nearestRoad(snap, x0, z0, NaN, _road, ROAD_M)) yaw = Math.atan2(_road.tx, _road.tz);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = x0 - frame.x;
  const rz = z0 - frame.z;
  const rl = Math.hypot(rx, rz) || 1;
  let pick = voted;
  let lowest = Infinity;
  for (const cls of SIZED) {
    const [width, height, length] = DIMS[cls];
    const c = Math.abs((rx / rl) * fx + (rz / rl) * fz);
    const push = 0.5 * (c * length + Math.sqrt(1 - Math.min(1, c * c)) * width);
    const cx = x0 + (rx / rl) * push;
    const cz = z0 + (rz / rl) * push;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const a = (k & 1 ? 0.5 : -0.5) * length;
      const b = (k & 2 ? 0.5 : -0.5) * width;
      ok = frameCoordsOf(frame, cx + fx * a + fz * b, cz + fz * a - fx * b, _uv, k & 4 ? height : 0);
      u0 = Math.min(u0, _uv[0]);
      u1 = Math.max(u1, _uv[0]);
      v0 = Math.min(v0, _uv[1]);
      v1 = Math.max(v1, _uv[1]);
    }
    if (!ok) continue;
    const err = Math.abs(Math.log((u1 - u0) / w.box[0])) + Math.abs(Math.log((v1 - v0) / w.box[1])) + (cls === voted ? 0 : SWITCH_COST);
    if (err < lowest) {
      lowest = err;
      pick = cls;
    }
  }
  return pick;
}

function majority(votes: Map<VehicleClass, number>): VehicleClass {
  let best: VehicleClass = "car";
  let most = -1;
  for (const [c, s] of votes) {
    if (s > most) {
      most = s;
      best = c;
    }
  }
  return best;
}

/** Gaussian smoothing in place: positions plainly, angles through their unit vectors. */
function blur(a: Float32Array, sigmaK: number, angle = false) {
  const n = a.length;
  const r = Math.ceil(2.5 * sigmaK);
  const src = Float32Array.from(a);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    let wsum = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
      const w = Math.exp(-((j - i) ** 2) / (2 * sigmaK * sigmaK));
      if (angle) {
        s += w * Math.sin(src[j]);
        c += w * Math.cos(src[j]);
      } else s += w * src[j];
      wsum += w;
    }
    a[i] = angle ? Math.atan2(s, c) : s / wsum;
  }
}

/**
 * Places the car's centre (YOLO sees its near bottom edge), lines it up with the road it is on and keeps
 * it inside that road's carriageway, on its own side.
 */
function onRoad(w: Work, cls: VehicleClass, frame: CamFrame, snap: SnapIndex | null, duration: number): FittedVehicle {
  const n = w.x.length;
  const [width, , length] = DIMS[cls];
  const fv: FittedVehicle = {
    id: w.id,
    cls,
    color: w.color,
    k0: w.k0,
    x: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    ext: Uint8Array.from(w.ext),
    fadeIn: w.k0 * DT > CLIP_EDGE_S,
    fadeOut: (w.k0 + n - 1) * DT < duration - CLIP_EDGE_S,
  };
  // Overall direction of travel, for the moments the car is stopped (in a queue, at a light).
  const dx = w.x[n - 1] - w.x[0];
  const dz = w.z[n - 1] - w.z[0];
  const travel = Math.hypot(dx, dz) > 3 ? Math.atan2(dx, dz) : NaN;
  let lastMoving = travel;
  for (let i = 0; i < n; i++) {
    const speed = Math.hypot(w.vx[i], w.vz[i]);
    const moving = speed > MOVING_MS;
    const vel = moving ? Math.atan2(w.vx[i], w.vz[i]) : NaN;
    if (moving) lastMoving = vel;
    const pref = moving ? vel : lastMoving;
    let x = w.x[i];
    let z = w.z[i];
    const rx = x - frame.x;
    const rz = z - frame.z;
    const rl = Math.hypot(rx, rz) || 1;
    let yaw = Math.atan2(rx, rz);
    let road = snap ? nearestRoad(snap, x, z, pref, _road, ROAD_M) : false;
    let along = 1;
    if (road) {
      // Travelling from→to unless the motion says otherwise; a stopped car with no history keeps left (UK).
      along = !Number.isNaN(pref) ? (Math.sin(pref) * _road.tx + Math.cos(pref) * _road.tz >= 0 ? 1 : -1) : _road.oneway || _road.lateral >= 0 ? 1 : -1;
      yaw = Math.atan2(_road.tx * along, _road.tz * along);
    } else if (!Number.isNaN(pref)) yaw = pref;
    // Push the centre away from the camera by half the footprint seen along the ray.
    const c = Math.abs((rx / rl) * Math.sin(yaw) + (rz / rl) * Math.cos(yaw));
    const push = 0.5 * (c * length + Math.sqrt(1 - Math.min(1, c * c)) * width);
    x += (rx / rl) * push;
    z += (rz / rl) * push;
    if (road && snap) road = nearestRoad(snap, x, z, yaw, _road, ROAD_M);
    if (road) {
      const half = Math.max(0.2, _road.width / 2 - width / 2 - KERB_M);
      // Offset to the left of the direction of travel.
      const left = _road.lateral * along;
      if (Math.abs(left) <= half + OFF_ROAD_M) {
        const lo = _road.oneway ? -half : Math.min(half, 0.5);
        const kept = Math.min(half, Math.max(lo, left)) * along;
        x = _road.px + _road.tz * kept;
        z = _road.pz - _road.tx * kept;
        const roadYaw = Math.atan2(_road.tx * along, _road.tz * along);
        yaw = moving ? roadYaw + Math.max(-ROAD_YAW_RAD, Math.min(ROAD_YAW_RAD, wrapAngle(vel - roadYaw))) : roadYaw;
      }
    }
    fv.x[i] = x;
    fv.z[i] = z;
    fv.yaw[i] = yaw;
  }
  // Snapping can step between segments at a junction; a short blur turns the steps into a drive.
  blur(fv.x, 2);
  blur(fv.z, 2);
  blur(fv.yaw, 3, true);
  // A car that never really moved (parked, or stuck in the queue all clip) stands perfectly still.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (fv.ext[i]) continue;
    minX = Math.min(minX, fv.x[i]);
    maxX = Math.max(maxX, fv.x[i]);
    minZ = Math.min(minZ, fv.z[i]);
    maxZ = Math.max(maxZ, fv.z[i]);
  }
  if (Math.hypot(maxX - minX, maxZ - minZ) < 2) {
    const mx = (minX + maxX) / 2;
    const mz = (minZ + maxZ) / 2;
    let s = 0;
    let cc = 0;
    for (let i = 0; i < n; i++) {
      s += Math.sin(fv.yaw[i]);
      cc += Math.cos(fv.yaw[i]);
    }
    fv.x.fill(mx);
    fv.z.fill(mz);
    fv.yaw.fill(Math.atan2(s, cc));
  }
  return fv;
}

/** Drivable trajectories for one camera's clip. */
export function fitVehicles(frame: CamFrame, tracks: TrackedObject[], duration: number, snap: SnapIndex | null): FittedVehicle[] {
  const works: Work[] = [];
  for (const tr of tracks) {
    if (tr.kind !== "vehicle") continue;
    const w = fromTrack(frame, tr);
    if (w) works.push(w);
  }
  const out: FittedVehicle[] = [];
  for (const w of stitch(works)) {
    let seen = 0;
    for (const e of w.ext) if (!e) seen++;
    if (seen * DT < MIN_SEEN_S) continue;
    extend(w, frame, -1, duration, seen * DT);
    extend(w, frame, 1, duration, seen * DT);
    out.push(onRoad(w, checkClass(w, majority(w.votes), frame, snap), frame, snap, duration));
  }
  return out;
}

export interface VehiclePose {
  x: number;
  z: number;
  yaw: number;
  /** Not seen by the camera at this moment (extended or bridged). */
  ext: boolean;
}

/** Pose at clip time t, interpolated; false outside the track. */
export function sampleVehicle(fv: FittedVehicle, t: number, out: VehiclePose) {
  const f = t / DT - fv.k0;
  const last = fv.x.length - 1;
  if (f < 0 || f > last) return false;
  const i = Math.min(last - 1, Math.floor(f));
  if (i < 0) {
    out.x = fv.x[0];
    out.z = fv.z[0];
    out.yaw = fv.yaw[0];
    out.ext = fv.ext[0] === 1;
    return true;
  }
  const k = f - i;
  out.x = fv.x[i] + (fv.x[i + 1] - fv.x[i]) * k;
  out.z = fv.z[i] + (fv.z[i + 1] - fv.z[i]) * k;
  out.yaw = fv.yaw[i] + wrapAngle(fv.yaw[i + 1] - fv.yaw[i]) * k;
  out.ext = fv.ext[k < 0.5 ? i : i + 1] === 1;
  return true;
}

/** Clip-time span of a fitted track. */
export function spanOf(fv: FittedVehicle): [number, number] {
  return [fv.k0 * DT, (fv.k0 + fv.x.length - 1) * DT];
}

/** Scratch for `separate`: one entry per vehicle drawn this frame. */
export interface Placed {
  n: number;
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  halfL: Float32Array;
  halfW: Float32Array;
  /** Camera position the car was seen from; it is pushed along the ray from here. */
  camX: Float32Array;
  camZ: Float32Array;
  group: Int32Array;
  ext: Uint8Array;
  /** Metres pushed back along the ray (output), and -1 for a car hidden as a duplicate. */
  push: Float32Array;
  order: Int32Array;
}

export function makePlaced(capacity: number): Placed {
  return {
    n: 0,
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    yaw: new Float32Array(capacity),
    halfL: new Float32Array(capacity),
    halfW: new Float32Array(capacity),
    camX: new Float32Array(capacity),
    camZ: new Float32Array(capacity),
    group: new Int32Array(capacity),
    ext: new Uint8Array(capacity),
    push: new Float32Array(capacity),
    order: new Int32Array(capacity),
  };
}

/** Separating-axis test for two footprints (a slight touch is allowed). */
function overlaps(p: Placed, a: number, ax: number, az: number, b: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const reach = p.halfL[a] + p.halfL[b];
  if (dx * dx + dz * dz > reach * reach) return false;
  const ax0 = Math.sin(p.yaw[a]);
  const az0 = Math.cos(p.yaw[a]);
  const bx0 = Math.sin(p.yaw[b]);
  const bz0 = Math.cos(p.yaw[b]);
  // Candidate axes: each body's forward and side.
  for (let k = 0; k < 4; k++) {
    const nx = k === 0 ? ax0 : k === 1 ? az0 : k === 2 ? bx0 : bz0;
    const nz = k === 0 ? az0 : k === 1 ? -ax0 : k === 2 ? bz0 : -bx0;
    const ra = p.halfL[a] * Math.abs(ax0 * nx + az0 * nz) + p.halfW[a] * Math.abs(az0 * nx - ax0 * nz);
    const rb = p.halfL[b] * Math.abs(bx0 * nx + bz0 * nz) + p.halfW[b] * Math.abs(bz0 * nx - bx0 * nz);
    if (Math.abs(dx * nx + dz * nz) >= (ra + rb) * TOUCH) return false;
  }
  return true;
}

/** Footprints may overlap by this share before they count as clipping (boxes are a little generous). */
const TOUCH = 0.92;

const PUSH_STEP_M = 0.25;
const PUSH_MAX_M = 15;

/**
 * Resolves overlaps within each camera's cars. Cars the camera actually sees go first, nearest first; each
 * is pushed back along its ray until it clears the ones already placed. A car that is only extrapolated
 * and lands on a seen one is a stale copy of it and is hidden (push = -1).
 */
export function separate(p: Placed) {
  const { n, order } = p;
  for (let i = 0; i < n; i++) order[i] = i;
  const dist = (i: number) => Math.hypot(p.x[i] - p.camX[i], p.z[i] - p.camZ[i]) + (p.ext[i] ? 1e4 : 0);
  // Insertion sort: a few dozen cars, nearly sorted frame to frame.
  for (let i = 1; i < n; i++) {
    const v = order[i];
    const dv = dist(v);
    let j = i - 1;
    while (j >= 0 && dist(order[j]) > dv) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = v;
  }
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi];
    p.push[i] = 0;
    const rx = p.x[i] - p.camX[i];
    const rz = p.z[i] - p.camZ[i];
    const rl = Math.hypot(rx, rz) || 1;
    for (let push = 0; push <= PUSH_MAX_M; push += PUSH_STEP_M) {
      const x = p.x[i] + (rx / rl) * push;
      const z = p.z[i] + (rz / rl) * push;
      let hit = false;
      for (let oj = 0; oj < oi && !hit; oj++) {
        const j = order[oj];
        if (p.push[j] < 0 || p.group[j] !== p.group[i]) continue;
        const jx = p.x[j] + ((p.x[j] - p.camX[j]) / (Math.hypot(p.x[j] - p.camX[j], p.z[j] - p.camZ[j]) || 1)) * p.push[j];
        const jz = p.z[j] + ((p.z[j] - p.camZ[j]) / (Math.hypot(p.x[j] - p.camX[j], p.z[j] - p.camZ[j]) || 1)) * p.push[j];
        hit = overlaps(p, j, jx, jz, i, x, z);
      }
      if (!hit) {
        p.push[i] = push;
        break;
      }
      if (p.ext[i]) {
        p.push[i] = -1;
        break;
      }
    }
  }
}
