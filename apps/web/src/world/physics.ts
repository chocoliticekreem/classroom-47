// Vehicle physics contract: look-ahead "raycast" and collision detection over the live registry.
// Driving modules call obstacleAhead() each frame (or every few frames) to brake for anything in
// front of them, not just vehicles on the same lane. The Collisions module (modules/Collisions.tsx)
// detects real overlaps and turns them into crashes. Implemented by the physics agent; signatures fixed.
//
// Implementation: a uniform grid (spatial hash) over allVehicles(), rebuilt once per frame. The
// Collisions module calls rebuildSpatialIndex() from a negative-priority useFrame (before every other
// module's update); if it isn't mounted, the first query of a frame rebuilds lazily. Each vehicle is an
// oriented box: footprint(kind), with object.userData.half (half length) / userData.halfWidth overriding.
// Everything here is allocation-free per frame: typed arrays, reused result objects.
import { allVehicles, type VehicleEntry } from "./registry";

export interface Hit {
  id: string; // registry id of the thing hit / ahead
  dist: number; // metres from the ray origin to the obstacle's near edge
  kind: VehicleEntry["kind"];
  stopped: boolean;
}

/** Approximate footprint half-extents for a registry kind (length/2, width/2) in metres. */
export function footprint(kind: VehicleEntry["kind"]): { halfLength: number; halfWidth: number } {
  switch (kind) {
    case "truck": case "roadworks": case "fire": case "tow": return FP_BIG;
    case "bus": return FP_BIG;
    case "van": case "ambulance": return FP_VAN;
    case "cyclist": return FP_BIKE;
    default: return FP_CAR;
  }
}
const FP_BIG = { halfLength: 5.5, halfWidth: 1.3 };
const FP_VAN = { halfLength: 2.8, halfWidth: 1.05 };
const FP_CAR = { halfLength: 2.2, halfWidth: 0.95 };
/** A bike + rider: about 1.8 m long, 0.7 m wide. Rides in the gutter (LANE_OFFSET + 1.2 from the centre line). */
const FP_BIKE = { halfLength: 0.9, halfWidth: 0.35 };

// --- Spatial index -------------------------------------------------------------------------------

const CELL = 16; // metres; bigger than any two footprints' combined radius in the common case
const HALF_SPAN = 1200; // grid covers ±1200 m; positions outside clamp to the border cells
const GRID_N = Math.ceil((2 * HALF_SPAN) / CELL);
const head = new Int32Array(GRID_N * GRID_N).fill(-1);
const usedCells: number[] = []; // cells written this build, to reset cheaply

let cap = 0;
let next = new Int32Array(0);
let px = new Float32Array(0);
let pz = new Float32Array(0);
let fx = new Float32Array(0); // forward unit (sin h, cos h)
let fz = new Float32Array(0);
let hl = new Float32Array(0); // half length
let hw = new Float32Array(0); // half width
let rad = new Float32Array(0); // bounding radius
const ents: VehicleEntry[] = [];
let count = 0;
let maxRad = 0;

function grow(n: number) {
  if (n <= cap) return;
  cap = Math.max(n, cap * 2, 256);
  // keep what's been written so far (grow can happen mid-build)
  const i32 = (a: Int32Array) => { const b = new Int32Array(cap); b.set(a); return b; };
  const f32 = (a: Float32Array) => { const b = new Float32Array(cap); b.set(a); return b; };
  next = i32(next);
  px = f32(px);
  pz = f32(pz);
  fx = f32(fx);
  fz = f32(fz);
  hl = f32(hl);
  hw = f32(hw);
  rad = f32(rad);
}

function cellCoord(v: number) {
  const c = Math.floor((v + HALF_SPAN) / CELL);
  return c < 0 ? 0 : c >= GRID_N ? GRID_N - 1 : c;
}

/** Debug counters (read by window.__cityPhysics). */
export const physicsStats = { vehicles: 0, queries: 0, queriesPerFrame: 0, rebuilds: 0, buildMs: 0 };

let lastBuildAt = -1e9;
let lastExplicitAt = -1e9;

function build() {
  const t0 = performance.now();
  for (const c of usedCells) head[c] = -1;
  usedCells.length = 0;
  count = 0;
  maxRad = 0;
  for (const v of allVehicles()) {
    if (count >= cap) grow(count + 1);
    const i = count++;
    ents[i] = v;
    const o = v.object;
    px[i] = o.position.x;
    pz[i] = o.position.z;
    const h = o.rotation.y;
    fx[i] = Math.sin(h);
    fz[i] = Math.cos(h);
    const fp = footprint(v.kind);
    const ud = o.userData;
    const L = typeof ud.half === "number" ? ud.half : fp.halfLength;
    const W = typeof ud.halfWidth === "number" ? ud.halfWidth : fp.halfWidth;
    hl[i] = L;
    hw[i] = W;
    const r = Math.sqrt(L * L + W * W);
    rad[i] = r;
    if (r > maxRad) maxRad = r;
    const c = cellCoord(px[i]) * GRID_N + cellCoord(pz[i]);
    if (head[c] === -1) usedCells.push(c);
    next[i] = head[c];
    head[c] = i;
  }
  ents.length = count;
  physicsStats.vehicles = count;
  physicsStats.queriesPerFrame = physicsStats.queries;
  physicsStats.queries = 0;
  physicsStats.rebuilds++;
  const t1 = performance.now();
  physicsStats.buildMs = t1 - t0;
  lastBuildAt = t1;
}

/**
 * Rebuild the grid from the registry. Call once per frame before any queries (the Collisions module
 * does, from a negative-priority useFrame). Without it, queries rebuild lazily at most every 8 ms.
 */
export function rebuildSpatialIndex() {
  lastExplicitAt = performance.now();
  build();
}

function ensureIndex() {
  const now = performance.now();
  if (now - lastExplicitAt > 250 && now - lastBuildAt > 8) build();
}

// --- Corridor raycast ----------------------------------------------------------------------------

const hit: Hit = { id: "", dist: 0, kind: "car", stopped: false };

/**
 * Nearest distance along the ray (s) at which the oriented box (c, f, L, W) enters the corridor
 * 0 <= s <= range, |lateral| <= halfW. Ray origin (ox, oz), unit direction (dx, dz). Returns -1 when
 * the box misses the corridor; 0 when it already overlaps the origin. Pure maths, exported for tests.
 */
export function corridorEntry(
  ox: number, oz: number, dx: number, dz: number, range: number, halfW: number,
  cx: number, cz: number, bfx: number, bfz: number, L: number, W: number,
): number {
  // box corners in ray space (s along, l lateral); lateral axis = (dz, -dx)
  const rx = cx - ox;
  const rz = cz - oz;
  const cs = rx * dx + rz * dz;
  const cl = rx * dz - rz * dx;
  // forward / side half-vectors of the box in ray space
  const as = (bfx * dx + bfz * dz) * L;
  const al = (bfx * dz - bfz * dx) * L;
  const bs = (bfz * dx - bfx * dz) * W; // box side axis = (bfz, -bfx)
  const bl = (bfz * dz + bfx * dx) * W;
  let minS = Infinity;
  let maxS = -Infinity;
  // 4 corners in order around the box: +a+b, +a-b, -a-b, -a+b
  for (let k = 0; k < 4; k++) {
    const sa = k < 2 ? 1 : -1;
    const sb = k === 0 || k === 3 ? 1 : -1;
    const s0 = cs + sa * as + sb * bs;
    const l0 = cl + sa * al + sb * bl;
    if (l0 <= halfW && l0 >= -halfW) {
      if (s0 < minS) minS = s0;
      if (s0 > maxS) maxS = s0;
    }
    const k2 = (k + 1) & 3;
    const sa2 = k2 < 2 ? 1 : -1;
    const sb2 = k2 === 0 || k2 === 3 ? 1 : -1;
    const s1 = cs + sa2 * as + sb2 * bs;
    const l1 = cl + sa2 * al + sb2 * bl;
    const dl = l1 - l0;
    if (dl !== 0) {
      // crossings of the edge with l = +halfW and l = -halfW
      let u = (halfW - l0) / dl;
      if (u > 0 && u < 1) {
        const s = s0 + (s1 - s0) * u;
        if (s < minS) minS = s;
        if (s > maxS) maxS = s;
      }
      u = (-halfW - l0) / dl;
      if (u > 0 && u < 1) {
        const s = s0 + (s1 - s0) * u;
        if (s < minS) minS = s;
        if (s > maxS) maxS = s;
      }
    }
  }
  // a bounded box that meets the slab must have a corner inside it or an edge crossing its sides
  if (minS === Infinity) return -1;
  if (maxS < 0 || minS > range) return -1;
  return minS < 0 ? 0 : minS;
}

/**
 * Cast a ray from (x, z) along `heading` (radians, 0 = +z, same as mesh.rotation.y) for `range` metres
 * with a corridor `halfWidth` either side. Returns the nearest registry vehicle (other than `selfId`)
 * whose footprint intersects the corridor, or null. The returned Hit is a shared object, valid until
 * the next call: copy what you need.
 */
export function obstacleAhead(selfId: string, x: number, z: number, heading: number, range: number, halfWidth = 1.2): Hit | null {
  ensureIndex();
  physicsStats.queries++;
  if (!count || range <= 0) return null;
  const dx = Math.sin(heading);
  const dz = Math.cos(heading);
  const ex = x + dx * range;
  const ez = z + dz * range;
  const pad = halfWidth + maxRad;
  const c0x = cellCoord(Math.min(x, ex) - pad);
  const c1x = cellCoord(Math.max(x, ex) + pad);
  const c0z = cellCoord(Math.min(z, ez) - pad);
  const c1z = cellCoord(Math.max(z, ez) + pad);
  let best = -1;
  let bestD = Infinity;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let i = head[cx * GRID_N + cz]; i !== -1; i = next[i]) {
        const rx = px[i] - x;
        const rz = pz[i] - z;
        const s = rx * dx + rz * dz;
        const r = rad[i];
        if (s < -r || s > range + r || s - r > bestD) continue;
        const l = rx * dz - rz * dx;
        if (l > halfWidth + r || l < -halfWidth - r) continue;
        if (ents[i].id === selfId) continue;
        const d = corridorEntry(x, z, dx, dz, range, halfWidth, px[i], pz[i], fx[i], fz[i], hl[i], hw[i]);
        if (d >= 0 && d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  if (best < 0) return null;
  const v = ents[best];
  hit.id = v.id;
  hit.dist = bestD;
  hit.kind = v.kind;
  hit.stopped = v.stopped;
  return hit;
}

/**
 * Vehicles whose centre is within `r` metres of (x, z), written into `out` (cleared first) so the
 * caller can reuse one array. Allocation-free.
 */
export function nearby(x: number, z: number, r: number, out: VehicleEntry[]): VehicleEntry[] {
  ensureIndex();
  physicsStats.queries++;
  out.length = 0;
  const c0x = cellCoord(x - r);
  const c1x = cellCoord(x + r);
  const c0z = cellCoord(z - r);
  const c1z = cellCoord(z + r);
  const r2 = r * r;
  for (let cx = c0x; cx <= c1x; cx++)
    for (let cz = c0z; cz <= c1z; cz++)
      for (let i = head[cx * GRID_N + cz]; i !== -1; i = next[i]) {
        const dx = px[i] - x;
        const dz = pz[i] - z;
        if (dx * dx + dz * dz <= r2) out.push(ents[i]);
      }
  return out;
}

// --- Overlaps (SAT on 2D oriented boxes) ---------------------------------------------------------

/** Minimum translation of the last obbOverlap(): unit axis from A to B, and penetration depth. */
export const mtv = { nx: 0, nz: 0, depth: 0 };

/**
 * Separating-axis test for two oriented rectangles (centre, forward unit vector, half length, half
 * width). Returns the penetration depth (> 0 when overlapping, <= 0 when apart) and fills `mtv`.
 */
export function obbOverlap(
  ax: number, az: number, afx: number, afz: number, aL: number, aW: number,
  bx: number, bz: number, bfx: number, bfz: number, bL: number, bW: number,
): number {
  const tx = bx - ax;
  const tz = bz - az;
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  for (let k = 0; k < 4; k++) {
    // axes: A forward, A side, B forward, B side
    let ux: number;
    let uz: number;
    if (k === 0) { ux = afx; uz = afz; }
    else if (k === 1) { ux = afz; uz = -afx; }
    else if (k === 2) { ux = bfx; uz = bfz; }
    else { ux = bfz; uz = -bfx; }
    const ra = aL * Math.abs(afx * ux + afz * uz) + aW * Math.abs(afz * ux - afx * uz);
    const rb = bL * Math.abs(bfx * ux + bfz * uz) + bW * Math.abs(bfz * ux - bfx * uz);
    const d = tx * ux + tz * uz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) {
      mtv.depth = o;
      return o;
    }
    if (o < best) {
      best = o;
      const sgn = d < 0 ? -1 : 1;
      nx = ux * sgn;
      nz = uz * sgn;
    }
  }
  mtv.nx = nx;
  mtv.nz = nz;
  mtv.depth = best;
  return best;
}

export type Pair = [VehicleEntry, VehicleEntry];
const pairs: Pair[] = [];
const pairPool: Pair[] = [];
/** Per-pair minimum translation (unit normal A->B, depth), parallel to overlapping()'s result. */
const pairNx: number[] = [];
const pairNz: number[] = [];
const pairDepth: number[] = [];

/**
 * Pairs of registry vehicles whose oriented footprints intersect right now, from the current index.
 * Pairs where both vehicles are `stopped` are skipped (parked wrecks at a scene) unless
 * `includeStopped`. The array and its tuples are reused: valid until the next call.
 */
export function overlapping(includeStopped = false): Pair[] {
  ensureIndex();
  pairs.length = 0;
  pairNx.length = pairNz.length = pairDepth.length = 0;
  for (let i = 0; i < count; i++) {
    const reach = rad[i] + maxRad;
    const c0x = cellCoord(px[i] - reach);
    const c1x = cellCoord(px[i] + reach);
    const c0z = cellCoord(pz[i] - reach);
    const c1z = cellCoord(pz[i] + reach);
    const si = ents[i].stopped;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let j = head[cx * GRID_N + cz]; j !== -1; j = next[j]) {
          if (j <= i) continue;
          if (!includeStopped && si && ents[j].stopped) continue;
          const dx = px[j] - px[i];
          const dz = pz[j] - pz[i];
          const rr = rad[i] + rad[j];
          if (dx * dx + dz * dz >= rr * rr) continue;
          const o = obbOverlap(px[i], pz[i], fx[i], fz[i], hl[i], hw[i], px[j], pz[j], fx[j], fz[j], hl[j], hw[j]);
          if (o <= 0) continue;
          const n = pairs.length;
          let p = pairPool[n];
          if (!p) p = pairPool[n] = [ents[i], ents[j]];
          p[0] = ents[i];
          p[1] = ents[j];
          pairs.push(p);
          pairNx.push(mtv.nx);
          pairNz.push(mtv.nz);
          pairDepth.push(mtv.depth);
        }
      }
    }
  }
  return pairs;
}

/** Minimum translation for overlapping()[i]: unit normal from a to b and depth in metres. */
export function pairMtv(i: number): { nx: number; nz: number; depth: number } {
  mtv.nx = pairNx[i] ?? 0;
  mtv.nz = pairNz[i] ?? 0;
  mtv.depth = pairDepth[i] ?? 0;
  return mtv;
}

// --- Separation hints for slow overlaps ----------------------------------------------------------

interface Push { x: number; z: number; frame: number }
const pushes = new Map<string, Push>();
let pushFrame = 0;

/** Collisions: start a new frame of separation hints (old ones expire). */
export function beginSeparation() {
  pushFrame++;
}

/** Collisions: ask vehicle `id` to move by (x, z) metres to get out of a slow overlap. */
export function addSeparation(id: string, x: number, z: number) {
  let p = pushes.get(id);
  if (!p) {
    p = { x: 0, z: 0, frame: -1 };
    pushes.set(id, p);
  }
  if (p.frame !== pushFrame) {
    p.x = p.z = 0;
    p.frame = pushFrame;
  }
  p.x += x;
  p.z += z;
}

/**
 * Owners: how far (metres, world x/z) this vehicle should nudge this frame to stop overlapping
 * something slowly (a queue that bunched up, a responder parking in a wreck). Null when none.
 */
export function separation(id: string): { x: number; z: number } | null {
  const p = pushes.get(id);
  return p && p.frame === pushFrame ? p : null;
}

/** Owners: drop the hint record when a vehicle unregisters (optional; keeps the map small). */
export function forgetSeparation(id: string) {
  pushes.delete(id);
}
