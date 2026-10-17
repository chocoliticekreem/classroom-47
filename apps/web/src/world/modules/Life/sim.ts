// Pure simulation for the Life module: pedestrians, cyclists, street furniture, paths.
// No three.js here so it's cheap to test. Everything mutates in place (no per-frame allocations).
import { BLOCK, GRID_HALF, LANE_OFFSET } from "../../config";

/** Downtown has 8x8 blocks, index 0..7 on each axis. */
export const BLOCKS = GRID_HALF * 2;
/** Cyclists ride this far left of the road centre line (the gutter). */
export const GUTTER_OFFSET = LANE_OFFSET + 1.2;

export function blockCentre(i: number) {
  return -GRID_HALF * BLOCK + BLOCK / 2 + i * BLOCK;
}

/** Small seeded RNG. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pose {
  x: number;
  z: number;
  heading: number; // rotation about y, 0 = facing +z
}

/**
 * Point on a square loop of half-size h around (0,0), s = distance along it from the (-h,-h) corner.
 * Sides: 0 (-h,-h)->(h,-h), 1 ->(h,h), 2 ->(-h,h), 3 ->(-h,-h). dir = -1 flips the heading.
 */
export function perimeterPoint(h: number, s: number, dir: number, out: Pose) {
  const L = 2 * h;
  const per = 4 * L;
  s = ((s % per) + per) % per;
  const k = Math.min(3, Math.floor(s / L));
  const u = s - k * L;
  let hd = 0;
  if (k === 0) {
    out.x = -h + u;
    out.z = -h;
    hd = Math.PI / 2;
  } else if (k === 1) {
    out.x = h;
    out.z = -h + u;
    hd = 0;
  } else if (k === 2) {
    out.x = h - u;
    out.z = h;
    hd = -Math.PI / 2;
  } else {
    out.x = -h;
    out.z = h - u;
    hd = Math.PI;
  }
  out.heading = dir > 0 ? hd : hd + Math.PI;
  return out;
}

// Corner k of the loop sits at s = k * 2h with these signs.
const CORNER_SX = [-1, 1, 1, -1];
const CORNER_SZ = [-1, -1, 1, 1];
function cornerIndex(sx: number, sz: number) {
  for (let k = 0; k < 4; k++) if (CORNER_SX[k] === sx && CORNER_SZ[k] === sz) return k;
  return 0;
}

// --- Pedestrians -------------------------------------------------------------

export interface Pedestrian extends Pose {
  bi: number;
  bj: number;
  h: number; // half-size of the loop this person walks around their block
  s: number;
  dir: 1 | -1;
  speed: number;
  mode: 0 | 1 | 2; // 0 walking, 1 waiting at a kerb, 2 crossing
  wait: number; // seconds spent waiting
  // pending crossing
  axis: 0 | 1; // 0 = crossing along x (over a north-south road), 1 = along z
  jx: number; // junction grid index (-4..4) next to the crossing
  jz: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ct: number; // 0..1 along the crossing
  nbi: number;
  nbj: number;
  ns: number;
  phase: number; // walk cycle, radians
}

/** Chance of crossing at each corner reached. */
const CROSS_CHANCE = 0.3;
const MAX_WAIT = 18;

export function createPedestrian(rand: () => number): Pedestrian {
  const h = 13.3 + rand();
  const p: Pedestrian = {
    bi: Math.floor(rand() * BLOCKS),
    bj: Math.floor(rand() * BLOCKS),
    h,
    s: rand() * 8 * h,
    dir: rand() < 0.5 ? 1 : -1,
    speed: 1.1 + rand() * 0.6,
    mode: 0,
    wait: 0,
    axis: 0,
    jx: 0,
    jz: 0,
    x0: 0,
    z0: 0,
    x1: 0,
    z1: 0,
    ct: 0,
    nbi: 0,
    nbj: 0,
    ns: 0,
    phase: rand() * Math.PI * 2,
    x: 0,
    z: 0,
    heading: 0,
  };
  placeOnLoop(p);
  return p;
}

function placeOnLoop(p: Pedestrian) {
  perimeterPoint(p.h, p.s, p.dir, p);
  p.x += blockCentre(p.bi);
  p.z += blockCentre(p.bj);
}

/**
 * Advance one pedestrian. `canCross(jx, jz, axis)` says whether it's safe to cross next to junction
 * (jx, jz) (grid indices) along `axis` (0 = x, 1 = z), i.e. the traffic on the crossed road has a red.
 */
export function stepPedestrian(
  p: Pedestrian,
  dt: number,
  rand: () => number,
  canCross: (jx: number, jz: number, axis: 0 | 1) => boolean,
) {
  if (p.mode === 1) {
    p.wait += dt;
    if (canCross(p.jx, p.jz, p.axis)) {
      p.mode = 2;
      p.ct = 0;
      p.heading = Math.atan2(p.x1 - p.x0, p.z1 - p.z0);
    } else if (p.wait > MAX_WAIT) {
      p.mode = 0; // give up, keep walking round the block
      p.dir = p.dir > 0 ? -1 : 1;
      placeOnLoop(p);
    }
    return;
  }
  p.phase += dt * p.speed * 7;
  if (p.mode === 2) {
    const len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0) || 1;
    p.ct += (p.speed * 1.25 * dt) / len; // hurry a bit on the road
    if (p.ct >= 1) {
      p.bi = p.nbi;
      p.bj = p.nbj;
      p.s = p.ns;
      p.mode = 0;
      p.dir = rand() < 0.5 ? 1 : -1;
      placeOnLoop(p);
      return;
    }
    p.x = p.x0 + (p.x1 - p.x0) * p.ct;
    p.z = p.z0 + (p.z1 - p.z0) * p.ct;
    return;
  }

  const L = 2 * p.h;
  const per = 4 * L;
  const next = p.s + p.dir * p.speed * dt;
  const kb = Math.floor(p.s / L);
  const ka = Math.floor(next / L);
  let cornerS = -1;
  if (p.dir > 0 && ka > kb) cornerS = ka * L;
  else if (p.dir < 0 && ka < kb) cornerS = kb * L;

  if (cornerS >= 0 && rand() < CROSS_CHANCE) {
    const k = Math.round(cornerS / L) % 4;
    const sx = CORNER_SX[k];
    const sz = CORNER_SZ[k];
    const canX = p.bi + sx >= 0 && p.bi + sx < BLOCKS;
    const canZ = p.bj + sz >= 0 && p.bj + sz < BLOCKS;
    if (canX || canZ) {
      const axis: 0 | 1 = canX && canZ ? (rand() < 0.5 ? 0 : 1) : canX ? 0 : 1;
      const cx = blockCentre(p.bi);
      const cz = blockCentre(p.bj);
      p.s = cornerS % per;
      p.x0 = cx + sx * p.h;
      p.z0 = cz + sz * p.h;
      p.axis = axis;
      p.jx = p.bi - GRID_HALF + (sx > 0 ? 1 : 0);
      p.jz = p.bj - GRID_HALF + (sz > 0 ? 1 : 0);
      if (axis === 0) {
        p.x1 = cx + sx * (BLOCK - p.h);
        p.z1 = p.z0;
        p.nbi = p.bi + sx;
        p.nbj = p.bj;
        p.ns = cornerIndex(-sx, sz) * L;
      } else {
        p.x1 = p.x0;
        p.z1 = cz + sz * (BLOCK - p.h);
        p.nbi = p.bi;
        p.nbj = p.bj + sz;
        p.ns = cornerIndex(sx, -sz) * L;
      }
      p.x = p.x0;
      p.z = p.z0;
      p.heading = Math.atan2(p.x1 - p.x0, p.z1 - p.z0);
      p.mode = 1;
      p.wait = 0;
      return;
    }
  }
  p.s = ((next % per) + per) % per;
  placeOnLoop(p);
}

// --- Cyclists ----------------------------------------------------------------

export interface Cyclist extends Pose {
  fi: number; // from node (grid indices)
  fj: number;
  ti: number; // to node
  tj: number;
  seg: 0 | 1; // 0 riding a street, 1 crossing a junction
  d: number; // metres along the current segment
  len: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  cruise: number; // m/s
  speed: number; // m/s right now
  phase: number; // pedal phase
}

const STREET_START = GUTTER_OFFSET;
const STREET_END = BLOCK - GUTTER_OFFSET;
const STOP_AT = BLOCK - 6.5; // stop line, metres from the from-node

function inGrid(i: number) {
  return i >= -GRID_HALF && i <= GRID_HALF;
}

/** Street segment endpoints for from->to, on the left gutter. */
function setStreet(c: Cyclist) {
  const dx = Math.sign(c.ti - c.fi);
  const dz = Math.sign(c.tj - c.fj);
  // left of travel (dx, dz) is (dz, -dx)
  const ox = dz * GUTTER_OFFSET;
  const oz = -dx * GUTTER_OFFSET;
  const ax = c.fi * BLOCK;
  const az = c.fj * BLOCK;
  c.x0 = ax + dx * STREET_START + ox;
  c.z0 = az + dz * STREET_START + oz;
  c.x1 = ax + dx * STREET_END + ox;
  c.z1 = az + dz * STREET_END + oz;
  c.len = STREET_END - STREET_START;
  c.seg = 0;
  c.d = 0;
  c.heading = Math.atan2(dx, dz);
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function createCyclist(rand: () => number): Cyclist {
  const c: Cyclist = {
    fi: 0,
    fj: 0,
    ti: 0,
    tj: 0,
    seg: 0,
    d: 0,
    len: 1,
    x0: 0,
    z0: 0,
    x1: 0,
    z1: 0,
    cruise: 4 + rand() * 2,
    speed: 0,
    phase: rand() * Math.PI * 2,
    x: 0,
    z: 0,
    heading: 0,
  };
  for (;;) {
    c.fi = Math.floor(rand() * (BLOCKS + 1)) - GRID_HALF;
    c.fj = Math.floor(rand() * (BLOCKS + 1)) - GRID_HALF;
    const [dx, dz] = DIRS[Math.floor(rand() * 4)];
    if (inGrid(c.fi + dx) && inGrid(c.fj + dz)) {
      c.ti = c.fi + dx;
      c.tj = c.fj + dz;
      break;
    }
  }
  setStreet(c);
  c.d = rand() * STOP_AT * 0.9;
  c.speed = c.cruise;
  place(c);
  return c;
}

function place(c: Cyclist) {
  const t = c.len > 0 ? c.d / c.len : 1;
  c.x = c.x0 + (c.x1 - c.x0) * t;
  c.z = c.z0 + (c.z1 - c.z0) * t;
}

/**
 * Advance one cyclist.
 * `isGreen(ti, tj, fi, fj)`: light for traffic approaching node (ti,tj) from (fi,fj).
 * `isBlocked(ai, aj, bi, bj)`: the street between the two nodes is closed.
 */
export function stepCyclist(
  c: Cyclist,
  dt: number,
  rand: () => number,
  isGreen: (ti: number, tj: number, fi: number, fj: number) => boolean,
  isBlocked: (ai: number, aj: number, bi: number, bj: number) => boolean,
) {
  let move = c.cruise * dt;
  c.speed = c.cruise;
  if (c.seg === 0 && c.d <= STOP_AT && c.d + move > STOP_AT && !isGreen(c.ti, c.tj, c.fi, c.fj)) {
    move = STOP_AT - c.d;
    c.speed = 0;
  }
  c.phase += move * 1.6;
  c.d += move;
  while (c.d >= c.len) {
    const extra = c.d - c.len;
    if (c.seg === 0) {
      // pick the next street, no U-turns unless there's no other way
      const ex = c.x1;
      const ez = c.z1;
      const bdx = c.fi - c.ti;
      const bdz = c.fj - c.tj;
      let options = 0;
      let pick = -1;
      for (let pass = 0; pass < 3 && pick < 0; pass++) {
        options = 0;
        for (let k = 0; k < 4; k++) {
          const [dx, dz] = DIRS[k];
          const ni = c.ti + dx;
          const nj = c.tj + dz;
          if (!inGrid(ni) || !inGrid(nj)) continue;
          if (pass < 2 && dx === bdx && dz === bdz) continue;
          if (pass < 1 && isBlocked(c.ti, c.tj, ni, nj)) continue;
          options++;
          if (rand() * options < 1) pick = k; // reservoir pick
        }
      }
      const [dx, dz] = DIRS[pick];
      c.fi = c.ti;
      c.fj = c.tj;
      c.ti = c.fi + dx;
      c.tj = c.fj + dz;
      setStreet(c);
      // junction leg from where we are to the start of the next street
      const sx = c.x0;
      const sz = c.z0;
      const jl = Math.hypot(sx - ex, sz - ez);
      if (jl > 0.01) {
        c.x1 = sx;
        c.z1 = sz;
        c.x0 = ex;
        c.z0 = ez;
        c.len = jl;
        c.seg = 1;
        c.heading = Math.atan2(sx - ex, sz - ez);
      }
      c.d = extra;
    } else {
      setStreet(c);
      c.d = extra;
    }
  }
  place(c);
}

// --- Street furniture --------------------------------------------------------

export type FurnitureKind = "bench" | "bin" | "phone" | "post" | "shelter";

export interface Furniture extends Pose {
  kind: FurnitureKind;
}

const KIND_WEIGHTS: [FurnitureKind, number][] = [
  ["bench", 0.3],
  ["bin", 0.3],
  ["phone", 0.12],
  ["post", 0.12],
  ["shelter", 0.16],
];

function pickKind(r: number): FurnitureKind {
  for (const [k, w] of KIND_WEIGHTS) {
    if (r < w) return k;
    r -= w;
  }
  return "bin";
}

/** Seeded street furniture along the kerb side of every downtown sidewalk. */
export function placeFurniture(seed: number): Furniture[] {
  const rand = mulberry32(seed);
  const out: Furniture[] = [];
  for (let bi = 0; bi < BLOCKS; bi++)
    for (let bj = 0; bj < BLOCKS; bj++) {
      const cx = blockCentre(bi);
      const cz = blockCentre(bj);
      for (let side = 0; side < 4; side++) {
        const n = Math.floor(rand() * 3.2); // 0..3 items per side
        const used: number[] = [];
        for (let k = 0; k < n; k++) {
          const u = -10 + rand() * 20;
          if (used.some((v) => Math.abs(v - u) < 3.5)) continue;
          used.push(u);
          const kind = pickKind(rand());
          const off = kind === "shelter" ? 15.3 : 15.2;
          // side 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x); items face the road
          const f: Furniture = { kind, x: cx, z: cz, heading: 0 };
          if (side === 0) {
            f.x += u;
            f.z -= off;
            f.heading = Math.PI;
          } else if (side === 1) {
            f.x += off;
            f.z += u;
            f.heading = Math.PI / 2;
          } else if (side === 2) {
            f.x += u;
            f.z += off;
            f.heading = 0;
          } else {
            f.x -= off;
            f.z += u;
            f.heading = -Math.PI / 2;
          }
          out.push(f);
        }
      }
    }
  return out;
}

// --- Misc paths --------------------------------------------------------------

/**
 * Point on a stadium (racetrack) loop: two straights along z of half-length `half` at x = cx ± r,
 * joined by semicircles. s = distance travelled. Runs north on the west straight.
 */
export function stadiumPoint(s: number, cx: number, cz: number, r: number, half: number, out: Pose) {
  const straight = 2 * half;
  const arc = Math.PI * r;
  const per = 2 * straight + 2 * arc;
  s = ((s % per) + per) % per;
  if (s < straight) {
    out.x = cx - r;
    out.z = cz + half - s;
    out.heading = Math.PI;
  } else if (s < straight + arc) {
    const a = (s - straight) / r; // 0..PI, turning right over the north end
    out.x = cx - r * Math.cos(a);
    out.z = cz - half - r * Math.sin(a);
    out.heading = Math.PI - a;
  } else if (s < 2 * straight + arc) {
    out.x = cx + r;
    out.z = cz - half + (s - straight - arc);
    out.heading = 0;
  } else {
    const a = (s - 2 * straight - arc) / r;
    out.x = cx + r * Math.cos(a);
    out.z = cz + half + r * Math.sin(a);
    out.heading = -a;
  }
  return out;
}

/** 0 by day, 1 at night, smooth at dusk and dawn. */
export function nightness(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (h < 12) return 1 - ramp(5, 7, h);
  return ramp(17.5, 20, h);
}
