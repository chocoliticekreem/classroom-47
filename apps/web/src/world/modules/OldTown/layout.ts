// Pure planning for the Old Town: which houses go where (seeded), plus trees, lamps, wall runs and
// pedestrian paths. No three.js here, so it is cheap to test. Geometry lives in build.ts.
import { ZONES } from "../../config";
import { CLOSE, MARKET, OLD_TOWN, WALL_OVAL, ovalPoint } from "../../districts/oldTown";
import { ROAD_EDGES, getNode } from "../../roads";

export type P = [number, number];
export const ZONE = ZONES.oldTown;

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

// ---- Road segments near the zone --------------------------------------------------------------------

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  key: string;
  boulevard: boolean; // part of the ring boulevard (old wall line)
  main: boolean; // a lane touching the market square / churchyard (shops line these)
}

export function zoneSegments(): Seg[] {
  const out: Seg[] = [];
  for (const e of ROAD_EDGES.values()) {
    const a = getNode(e.a);
    const b = getNode(e.b);
    if (Math.max(a.x, b.x) < ZONE.minX - 20 || Math.min(a.x, b.x) > ZONE.maxX + 20) continue;
    if (Math.max(a.z, b.z) < ZONE.minZ - 20 || Math.min(a.z, b.z) > ZONE.maxZ + 20) continue;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const boulevard = onOval(a.x, a.z) && onOval(b.x, b.z);
    out.push({
      ax: a.x, az: a.z, bx: b.x, bz: b.z, key: e.key,
      boulevard,
      main: !boulevard && (Math.hypot(mx - MARKET.x, mz - MARKET.z) < 95 || Math.hypot(mx - CLOSE.x, mz - CLOSE.z) < 70),
    });
  }
  return out;
}

function onOval(x: number, z: number) {
  const r = Math.hypot((x - WALL_OVAL.x) / WALL_OVAL.rx, (z - WALL_OVAL.z) / WALL_OVAL.rz);
  return Math.abs(r - 1) < 0.06;
}

/** Normalised "radius" in the wall oval: < 1 inside the boulevard. */
export const ovalR = (x: number, z: number) => Math.hypot((x - WALL_OVAL.x) / WALL_OVAL.rx, (z - WALL_OVAL.z) / WALL_OVAL.rz);

export function distToSeg(px: number, pz: number, s: Seg) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2));
  return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
}

export function distToPolyline(px: number, pz: number, pts: readonly P[]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const s = { ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] } as Seg;
    best = Math.min(best, distToSeg(px, pz, s));
  }
  return best;
}

// ---- Landmark footprints (roads and houses keep out) -------------------------------------------------

const L = OLD_TOWN;
/** True where a landmark, lawn, the canal or the wall band claims the ground. */
export function reserved(x: number, z: number): boolean {
  // churchyard inside the loop
  if (Math.hypot((x - CLOSE.x) / (CLOSE.rx - 5), (z - CLOSE.z) / (CLOSE.rz - 5)) < 1) return true;
  if (Math.hypot(x - MARKET.x, z - MARKET.z) < MARKET.r - 5) return true;
  if (Math.abs(x - L.abbey.x) < L.abbey.len / 2 + 4 && Math.abs(z - L.abbey.z) < L.abbey.wid / 2 + 4) return true;
  if (Math.hypot(x - L.castle.x, z - L.castle.z) < L.castle.r + 2) return true;
  if (Math.abs(x - L.university.x) < L.university.w / 2 + 1.5 && Math.abs(z - L.university.z) < L.university.d / 2 + 1.5) return true;
  for (const ch of L.churches) if (inChurch(ch, x, z, 3)) return true;
  const c = L.crescent;
  if (z < ZONE.maxZ + 5 && Math.hypot(x - c.x, z - c.z) < c.r - 5) return true;
  const g = L.gardenSquare;
  if (Math.abs(x - g.x) < g.hw - 5 && Math.abs(z - g.z) < g.hd - 5) return true;
  if (distToPolyline(x, z, L.canal.points) < L.canal.width / 2 + 4) return true;
  const r = ovalR(x, z);
  if (r > 1.035 && r < 1.1) return true; // wall band (walls, towers, wall-walk trees)
  return false;
}

/** Cathedral footprint in its local frame (dome at the origin, west front with steps to -40). */
export function inCathedral(dx: number, dz: number) {
  if (dx > -40 && dx < 36 && Math.abs(dz) < 11) return true; // nave, choir, apse, portico, steps
  if (dx > -36 && dx < -24 && Math.abs(dz) < 17.5) return true; // west towers
  return Math.abs(dx) < 10 && Math.abs(dz) < 32; // transepts + porches
}

/** Church footprint: 26 x 11 m nave plus a 7 m tower at the west (-x local) end. */
export function inChurch(ch: { x: number; z: number; ry: number }, x: number, z: number, pad = 0) {
  const dx = x - ch.x;
  const dz = z - ch.z;
  const c = Math.cos(ch.ry);
  const s = Math.sin(ch.ry);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < 15 + pad && Math.abs(lz) < 6 + pad;
}

export const LANDMARK_CLEARANCE: { name: string; inside: (x: number, z: number) => boolean }[] = [
  { name: "cathedral", inside: (x, z) => inCathedral(x - L.cathedral.x, z - L.cathedral.z) },
  { name: "abbey", inside: (x, z) => Math.abs(x - L.abbey.x) < L.abbey.len / 2 && Math.abs(z - L.abbey.z) < L.abbey.wid / 2 },
  { name: "castle", inside: (x, z) => Math.hypot(x - L.castle.x, z - L.castle.z) < L.castle.r },
  { name: "university", inside: (x, z) => Math.abs(x - L.university.x) < L.university.w / 2 && Math.abs(z - L.university.z) < L.university.d / 2 },
  ...L.churches.map((ch, i) => ({ name: `church ${i}`, inside: (x: number, z: number) => inChurch(ch, x, z) })),
  { name: "market hall", inside: (x, z) => Math.hypot(x - MARKET.x, z - MARKET.z) < 12 },
];

// ---- Occupancy grid --------------------------------------------------------------------------------

const CELL = 1;
export class Grid {
  readonly nx = Math.ceil((ZONE.maxX - ZONE.minX) / CELL);
  readonly nz = Math.ceil((ZONE.maxZ - ZONE.minZ) / CELL);
  readonly cells = new Uint8Array(this.nx * this.nz); // 0 free, 1 house, 2 blocked
  idx(x: number, z: number) {
    const i = Math.floor((x - ZONE.minX) / CELL);
    const j = Math.floor((z - ZONE.minZ) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  /** Visit cell centres inside an oriented rect (half sizes hw, hd, rotated ry). */
  rect(x: number, z: number, hw: number, hd: number, ry: number, fn: (k: number) => boolean | void) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const ex = Math.abs(c) * hw + Math.abs(s) * hd;
    const ez = Math.abs(s) * hw + Math.abs(c) * hd;
    for (let cz = z - ez; cz <= z + ez + CELL; cz += CELL)
      for (let cx = x - ex; cx <= x + ex + CELL; cx += CELL) {
        const gx = Math.floor((cx - ZONE.minX) / CELL);
        const gz = Math.floor((cz - ZONE.minZ) / CELL);
        const px = ZONE.minX + (gx + 0.5) * CELL - x;
        const pz = ZONE.minZ + (gz + 0.5) * CELL - z;
        // into local frame (local x along the facade, z into the plot)
        const lx = px * c - pz * s;
        const lz = px * s + pz * c;
        if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
        if (gx < 0 || gz < 0 || gx >= this.nx || gz >= this.nz) {
          if (fn(-1) === false) return false;
          continue;
        }
        if (fn(gz * this.nx + gx) === false) return false;
      }
    return true;
  }
  free(x: number, z: number, hw: number, hd: number, ry: number) {
    return this.rect(x, z, hw, hd, ry, (k) => k >= 0 && this.cells[k] === 0) !== false;
  }
  mark(x: number, z: number, hw: number, hd: number, ry: number, v = 1) {
    this.rect(x, z, hw, hd, ry, (k) => {
      if (k >= 0) this.cells[k] = Math.max(this.cells[k], v);
    });
  }
}

// ---- Houses ---------------------------------------------------------------------------------------

export type Style = "tudor" | "stone" | "brick" | "georgian" | "bath" | "stucco";
export type Roof = "gable" | "hip" | "flat" | "mansard";

export interface House {
  x: number;
  z: number;
  ry: number; // local +z (the front) faces the street
  w: number; // along the street
  d: number; // depth
  h: number; // eaves height
  floors: number;
  style: Style;
  roof: Roof;
  shop: boolean;
  pub: boolean;
  seed: number; // 0..1, drives colours and details
}

export const SETBACK = 6.2; // road centre -> building front (4 m half road + 2.2 m pavement)

function styleFor(x: number, z: number, r: () => number): Style {
  if (z > 196) return r() < 0.75 ? "georgian" : "stucco";
  if (ovalR(x, z) > 1) return r() < 0.6 ? "brick" : r() < 0.5 ? "georgian" : "stucco";
  const near = Math.hypot(x - MARKET.x, z - MARKET.z) < 80;
  const v = r();
  if (near) return v < 0.45 ? "tudor" : v < 0.75 ? "stone" : "brick";
  return v < 0.3 ? "tudor" : v < 0.6 ? "stone" : v < 0.85 ? "brick" : "stucco";
}

function makeHouse(x: number, z: number, ry: number, w: number, d: number, style: Style, r: () => number, front: boolean, main: boolean): House {
  const floorsBy: Record<Style, [number, number]> = {
    tudor: [2, 3], stone: [2, 3], brick: [3, 4], georgian: [3, 4], bath: [4, 4], stucco: [3, 5],
  };
  const [fmin, fmax] = floorsBy[style];
  const floors = fmin + Math.floor(r() * (fmax - fmin + 1));
  const roofBy: Record<Style, Roof[]> = {
    tudor: ["gable", "gable", "gable", "hip"],
    stone: ["gable", "hip", "gable"],
    brick: ["gable", "hip", "mansard"],
    georgian: ["flat", "mansard", "hip"],
    bath: ["mansard"],
    stucco: ["flat", "mansard", "hip"],
  };
  const roofs = roofBy[style];
  const shop = front && main && r() < 0.65;
  return {
    x, z, ry, w, d,
    h: floors * 3.1 + (shop ? 0.6 : 0),
    floors, style,
    roof: roofs[Math.floor(r() * roofs.length)],
    shop,
    pub: front && r() < (main ? 0.16 : 0.07),
    seed: r(),
  };
}

export interface Tree {
  x: number;
  z: number;
  s: number;
  kind: 0 | 1 | 2; // 0 round broadleaf, 1 tall plane tree, 2 yew/cone
}

export interface OldTownLayout {
  houses: House[];
  trees: Tree[];
  lamps: P[];
  segs: Seg[];
  walls: { a: P; b: P }[]; // surviving wall pieces (outer line of the old walls)
  wallTowers: P[];
  walkers: [number, number, number, number][]; // pedestrian back-and-forth segments
  stalls: { x: number; z: number; ry: number; seed: number }[];
}

export function buildLayout(seed = 1701): OldTownLayout {
  const r = mulberry32(seed);
  const segs = zoneSegments();
  const grid = new Grid();

  // 1. Block out roads + pavements, reserved landmark ground
  for (const s of segs) {
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const ry = Math.atan2(s.bz - s.az, s.bx - s.ax);
    grid.mark(mx, mz, len / 2 + SETBACK - 0.3, SETBACK - 0.3, -ry, 2);
    grid.mark(s.ax, s.az, SETBACK - 0.3, SETBACK - 0.3, 0, 2);
    grid.mark(s.bx, s.bz, SETBACK - 0.3, SETBACK - 0.3, 0, 2);
  }
  for (let j = 0; j < grid.nz; j++)
    for (let i = 0; i < grid.nx; i++) {
      const x = ZONE.minX + (i + 0.5) * CELL;
      const z = ZONE.minZ + (j + 0.5) * CELL;
      if (reserved(x, z)) grid.cells[j * grid.nx + i] = 2;
    }

  // coarse spatial index of the lanes, for exact kerb checks
  const BUCKET = 24;
  const buckets = new Map<string, Seg[]>();
  for (const sg of segs) {
    const x0 = Math.floor(Math.min(sg.ax, sg.bx) / BUCKET) - 1;
    const x1 = Math.floor(Math.max(sg.ax, sg.bx) / BUCKET) + 1;
    const z0 = Math.floor(Math.min(sg.az, sg.bz) / BUCKET) - 1;
    const z1 = Math.floor(Math.max(sg.az, sg.bz) / BUCKET) + 1;
    for (let i = x0; i <= x1; i++)
      for (let j = z0; j <= z1; j++) {
        const k = `${i},${j}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(sg);
      }
  }
  /** Exact checks on the full footprint: inside the zone, off reserved ground, 5.9 m+ from every lane's centre line. */
  const clearOfKerbs = (x: number, z: number, hw: number, hd: number, ry: number) => {
    const near = buckets.get(`${Math.floor(x / BUCKET)},${Math.floor(z / BUCKET)}`) ?? [];
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    for (const fx of [-1, 0, 1])
      for (const fz of [-1, 0, 1]) {
        const lx = fx * hw;
        const lz = fz * hd;
        const px = x + lx * c + lz * sn;
        const pz = z - lx * sn + lz * c;
        if (px < ZONE.minX + 0.5 || px > ZONE.maxX - 0.5 || pz < ZONE.minZ + 0.5 || pz > ZONE.maxZ - 0.5) return false;
        if (reserved(px, pz)) return false;
        for (const sg of near) if (distToSeg(px, pz, sg) < 5.9) return false;
      }
    return true;
  };

  const houses: House[] = [];
  const tryHouse = (x: number, z: number, ry: number, w: number, d: number, style: Style, front: boolean, main: boolean) => {
    if (!grid.free(x, z, w / 2 - 0.3, d / 2 - 0.3, ry)) return false;
    if (!clearOfKerbs(x, z, w / 2, d / 2, ry)) return false;
    grid.mark(x, z, w / 2 + 0.2, d / 2 + 0.2, ry, 1);
    houses.push(makeHouse(x, z, ry, w, d, style, r, front, main));
    return true;
  };

  // 2a. The crescent: one grand curved terrace of Bath-stone houses on the outer side of the arc
  {
    const c = OLD_TOWN.crescent;
    const R0 = c.r + SETBACK + 6;
    for (let a = c.from + 2; a <= c.to - 2; a += 4.4) {
      const t = (a * Math.PI) / 180;
      const x = c.x + R0 * Math.cos(t);
      const z = c.z + R0 * Math.sin(t);
      const ry = Math.atan2(-Math.cos(t), -Math.sin(t)); // face the lawn (the arc centre)
      const w = ((R0 - 6) * 4.4 * Math.PI) / 180 + 0.4;
      if (!grid.free(x, z, w / 2 - 0.35, 5.6, ry) || !clearOfKerbs(x, z, w / 2, 6, ry)) continue;
      grid.mark(x, z, w / 2, 6, ry, 1);
      houses.push({ ...makeHouse(x, z, ry, w, 12, "bath", r, false, false), floors: 4, h: 13.2, roof: "mansard", shop: false, pub: false });
    }
  }

  // 2. Street frontage: terraces along both sides of every lane, following its curves
  for (const s of segs) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    if (len < 4) continue;
    const ux = dx / len;
    const uz = dz / len;
    for (const side of [-1, 1]) {
      const nx = -uz * side; // outward normal (towards the plot)
      const nz = ux * side;
      const ry = Math.atan2(-nx, -nz); // front faces the road
      let t = 1 + r() * 2;
      while (t < len - 2) {
        const mx = s.ax + ux * t;
        const mz = s.az + uz * t;
        const style = s.boulevard && ovalR(mx + nx * 10, mz + nz * 10) > 1 ? "georgian" : styleFor(mx, mz, r);
        const w = style === "georgian" || style === "bath" ? 6.5 + r() * 2 : 5.5 + r() * 4.5;
        const d = 9 + r() * 6;
        const setback = SETBACK + (style === "tudor" ? 0 : r() * 0.6);
        const cx = mx + ux * (w / 2) + nx * (setback + d / 2);
        const cz = mz + uz * (w / 2) + nz * (setback + d / 2);
        if (t + w > len + 3) break;
        if (tryHouse(cx, cz, ry, w, d, style, true, s.main)) t += w;
        else t += 1.5;
      }
    }
  }

  // 3. Backland infill: every gap left in the blocks gets a smaller house (or a garden tree)
  const trees: Tree[] = [];
  const order: number[] = [];
  for (let k = 0; k < grid.cells.length; k += 3) order.push(k);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const k of order) {
    if (grid.cells[k] !== 0) continue;
    const x = ZONE.minX + ((k % grid.nx) + 0.5) * CELL;
    const z = ZONE.minZ + (Math.floor(k / grid.nx) + 0.5) * CELL;
    if (!grid.free(x, z, 1.9, 1.9, 0)) continue;
    // orient with the nearest street
    let best = Infinity;
    let ry = 0;
    for (const s of segs) {
      const d = distToSeg(x, z, s);
      if (d < best) {
        best = d;
        ry = -Math.atan2(s.bz - s.az, s.bx - s.ax);
      }
    }
    if (best > 70) continue;
    const style = styleFor(x, z, r);
    let placed = false;
    for (const sz of [9, 7.5, 6, 4.8]) {
      const w = sz * (0.8 + r() * 0.5);
      const d = sz * (0.8 + r() * 0.4);
      if (tryHouse(x, z, ry, w, d, style, false, false)) {
        placed = true;
        break;
      }
    }
    if (!placed && r() < 0.5 && grid.free(x, z, 2.5, 2.5, 0)) {
      grid.mark(x, z, 2.6, 2.6, 0, 1);
      trees.push({ x, z, s: 0.6 + r() * 0.5, kind: r() < 0.7 ? 0 : 2 });
    }
  }

  // 4. Trees: churchyard, garden square, crescent lawn, the old wall walk, the abbey and university greens
  const tree = (x: number, z: number, s: number, kind: Tree["kind"]) => trees.push({ x, z, s, kind });
  for (let a = 0; a < 360; a += 15) {
    const t = (a * Math.PI) / 180;
    const x = CLOSE.x + (CLOSE.rx - 9) * Math.cos(t);
    const z = CLOSE.z + (CLOSE.rz - 8.5) * Math.sin(t);
    const dx = x - L.cathedral.x;
    const dz = z - L.cathedral.z;
    if (inCathedral(dx, dz) || inCathedral(dx + 3, dz) || inCathedral(dx - 3, dz) || inCathedral(dx, dz + 3) || inCathedral(dx, dz - 3)) continue;
    tree(x, z, 0.75 + r() * 0.3, Math.abs(Math.cos(t)) > 0.75 ? 2 : 1);
  }
  const g = OLD_TOWN.gardenSquare;
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    tree(g.x + (g.hw - 9) * Math.cos(t), g.z + (g.hd - 9) * Math.sin(t), 1 + r() * 0.3, 1);
  }
  const c = OLD_TOWN.crescent;
  for (let a = c.from + 10; a <= c.to - 10; a += 16) {
    const t = (a * Math.PI) / 180;
    tree(c.x + (c.r - 10) * Math.cos(t), c.z + (c.r - 10) * Math.sin(t), 0.9 + r() * 0.3, 0);
  }
  for (let a = 0; a < 360; a += 2.6) {
    const [x, z] = ovalPoint(a, 7.5);
    if (segs.some((s) => distToSeg(x, z, s) < 6)) continue;
    if (r() < 0.75) tree(x, z, 0.75 + r() * 0.35, 1);
  }
  const ab = OLD_TOWN.abbey;
  for (let i = 0; i < 6; i++) tree(ab.x - ab.len / 2 - 2 + r() * (ab.len + 4), ab.z + ab.wid / 2 + 2.5, 0.7, 2);

  // 5. Surviving town walls: the outer line of the oval, broken wherever a road passes
  const walls: OldTownLayout["walls"] = [];
  const wallTowers: P[] = [];
  let run = 0;
  for (let a = 0; a < 360; a += 2) {
    const A = ovalPoint(a, 10);
    const B = ovalPoint(a + 2, 10);
    const m: P = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const blocked = segs.some((s) => !s.boulevard && distToSeg(m[0], m[1], s) < 9);
    const ruined = Math.sin(a * 0.11 + 1.3) > 0.72; // a few lost stretches
    if (blocked || ruined) {
      if (run > 0) wallTowers.push(A);
      run = 0;
      continue;
    }
    if (run === 0) wallTowers.push(A);
    else if (run % 14 === 0) wallTowers.push(A);
    walls.push({ a: A, b: B });
    run++;
  }

  // 6. Gas lamps along every lane (alternating sides) and pedestrians on the pavements
  const lamps: P[] = [];
  const walkers: OldTownLayout["walkers"] = [];
  for (const s of segs) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    if (len < 6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const inZone = (x: number, z: number) => x > ZONE.minX && x < ZONE.maxX && z > ZONE.minZ && z < ZONE.maxZ;
    for (let t = 6; t < len - 4; t += 19) {
      const side = Math.round(t / 19) % 2 ? 1 : -1;
      const x = s.ax + ux * t - uz * side * 5.1;
      const z = s.az + uz * t + ux * side * 5.1;
      if (!inZone(x, z)) continue;
      if (segs.some((o) => o !== s && distToSeg(x, z, o) < 4.9)) continue;
      lamps.push([x, z]);
    }
    for (const side of [-1, 1]) {
      const ox = -uz * side * 5.3;
      const oz = ux * side * 5.3;
      const ax = s.ax + ux * 3 + ox;
      const az = s.az + uz * 3 + oz;
      if (!inZone(ax, az) || r() < 0.25) continue;
      const n = s.main ? 3 : 1;
      for (let i = 0; i < n; i++) walkers.push([ax, az, s.bx - ux * 3 + ox, s.bz - uz * 3 + oz]);
    }
  }
  // market-day crowd strolling round the square: an outer ring past the stalls and an inner ring by the hall
  for (let i = 0; i < 70; i++) {
    const outer = i % 3 !== 0;
    const rr = outer ? 16 + r() * 0.9 : 11.6 + r() * 0.8;
    const a = r() * Math.PI * 2;
    const b = a + (r() < 0.5 ? -1 : 1) * (0.2 + r() * (outer ? 0.3 : 0.25));
    walkers.push([MARKET.x + rr * Math.cos(a), MARKET.z + rr * Math.sin(a), MARKET.x + rr * Math.cos(b), MARKET.z + rr * Math.sin(b)]);
  }
  // churchyard visitors on the paths round the cathedral
  for (let i = 0, tries = 0; i < 36 && tries < 400; tries++) {
    const a = r() * Math.PI * 2;
    const b = a + 0.15 + r() * 0.25;
    const pa: P = [CLOSE.x + (CLOSE.rx - 7.5) * Math.cos(a), CLOSE.z + (CLOSE.rz - 7) * Math.sin(a)];
    const pb: P = [CLOSE.x + (CLOSE.rx - 7.5) * Math.cos(b), CLOSE.z + (CLOSE.rz - 7) * Math.sin(b)];
    let hit = false;
    for (let k = 0; k <= 4; k++) {
      const x = pa[0] + ((pb[0] - pa[0]) * k) / 4 - L.cathedral.x;
      const z = pa[1] + ((pb[1] - pa[1]) * k) / 4 - L.cathedral.z;
      if (inCathedral(x, z) || inCathedral(x + 1, z) || inCathedral(x - 1, z) || inCathedral(x, z + 1) || inCathedral(x, z - 1)) hit = true;
    }
    if (hit) continue;
    walkers.push([pa[0], pa[1], pb[0], pb[1]]);
    i++;
  }

  const stalls: OldTownLayout["stalls"] = [];
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2 + 0.2;
    stalls.push({ x: MARKET.x + 14.5 * Math.cos(t), z: MARKET.z + 14.5 * Math.sin(t), ry: -t + Math.PI / 2, seed: r() });
  }

  return { houses, trees, lamps, segs, walls, wallTowers, walkers, stalls };
}
