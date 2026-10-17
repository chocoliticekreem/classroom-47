// Pure, seeded Southbank layout (no three.js, cheap to test). Reads the merged road graph and the
// district feature plan, then fills every block: shop-lined frontage along each street, the Georgian
// crescent, mews cottages, market-street shops, courtyard infill, plus street furniture and walkers.
import { ZONES, type Box } from "../../config";
import { SB_FEATURES } from "../../districts/southbank";
import { ROAD_EDGES, getNode, type RoadKind } from "../../roads";
import { mulberry32 } from "./night";

export type FacadeKind = "brick" | "render" | "georgian" | "modern" | "glass" | "concrete";
export const FACADE_KINDS: FacadeKind[] = ["brick", "render", "georgian", "modern", "glass", "concrete"];

/** Box standing on y (base), centred on x/z, rotated ry about y. Local +z faces the street. */
export interface RBox {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  ry: number;
  color: string;
}
export interface Walker {
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  speed: number;
  phase: number;
  color: string;
}
export interface Prop {
  x: number;
  z: number;
  ry: number;
  s: number;
  color: string;
}

export interface SouthbankLayout {
  bodies: Record<FacadeKind, RBox[]>;
  shopfronts: RBox[];
  trims: RBox[]; // parapets, fascias, cornices, chimneys
  roofs: RBox[]; // pitched prisms, ridge along local x
  acs: RBox[];
  awnings: RBox[];
  trees: Prop[];
  cars: Prop[];
  tables: Prop[];
  umbrellas: Prop[];
  stalls: Prop[];
  lamps: Prop[];
  benches: Prop[];
  walkers: Walker[];
  kerbs: RBox[];
}

// Special footprints (reserved before the generic fill).
export const TOWERS = [
  { x: -106, z: 372, w: 18, d: 18, h: 68, ry: 0.12 },
  { x: -112, z: 404, w: 20, d: 16, h: 98, ry: -0.08 },
  { x: -104, z: 436, w: 17, d: 17, h: 82, ry: 0.2 },
  { x: -111, z: 468, w: 20, d: 20, h: 116, ry: 0 },
  { x: -102, z: 500, w: 16, d: 18, h: 74, ry: 0.1 },
];
export const CULTURE = {
  arts: { x: -240, z: 584, w: 46, d: 36 },
  gallery: { x: -180, z: 586, w: 62, d: 30 },
  hall: { x: -112, z: 580, w: 40, d: 34 },
  plaza: { minX: -268, maxX: -88, minZ: 546, maxZ: 620 },
};
export const STADIUM_RESERVE: Box = { minX: -440, maxX: -292, minZ: 486, maxZ: 620 };

const Z = ZONES.southbank;
const CELL = 2;
const NX = Math.ceil((Z.maxX - Z.minX) / CELL);
const NZ = Math.ceil((Z.maxZ - Z.minZ) / CELL);
const HALF: Record<RoadKind, number> = { street: 4, ramp: 4, highway: 6, country: 3 };

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  kind: RoadKind;
  len: number;
  ux: number;
  uz: number;
  boulevard: boolean;
  high: boolean;
}

const PAL = {
  brick: ["#b5573c", "#a14a34", "#c06a45", "#8e3f2f", "#c9a066", "#b98a55", "#9c5a3c"],
  render: ["#f2e3c6", "#e9c9a8", "#cfe0e8", "#f0d1cf", "#dfe7cf", "#f5ecd9", "#e6d0e6", "#f2d58f"],
  georgian: ["#f4ead6", "#efe4cc", "#f7f0e0"],
  modern: ["#d9d6cf", "#c6ccd2", "#e4dccd", "#b9bec4", "#ece7df"],
  glass: ["#9fc4dc", "#a9d0e2", "#8fb3cc", "#b8d6e6", "#7fa6c0"],
  awning: ["#d9443a", "#2a7d4f", "#1f5f99", "#e8a33d", "#7a3b8f", "#1c6b6b", "#c2185b", "#ff6a1a"],
  car: ["#c8102e", "#1d3557", "#f1faee", "#2b2d42", "#8d99ae", "#e9c46a", "#264653", "#111111", "#a8dadc", "#6c757d"],
  clothes: ["#e4572e", "#2e86ab", "#f2c14e", "#3bb273", "#7768ae", "#e15554", "#1d3557", "#f4a261", "#2a9d8f", "#ef476f", "#3a3a3a", "#f5f5f5"],
};

function segments(): Seg[] {
  const out: Seg[] = [];
  const near = (x: number, z: number) => x > Z.minX - 40 && x < Z.maxX + 40 && z > Z.minZ - 40 && z < Z.maxZ + 40;
  for (const e of ROAD_EDGES.values()) {
    const a = getNode(e.a), b = getNode(e.b);
    if (!near(a.x, a.z) && !near(b.x, b.z)) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.push({
      ax: a.x, az: a.z, bx: b.x, bz: b.z, half: HALF[e.kind], kind: e.kind, len,
      ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      boulevard: e.a.startsWith("sb_bv") || e.b.startsWith("sb_bv") || (e.a === "sb_ra1_3" && e.b.startsWith("sb_bv")),
      high: e.a.startsWith("sb_hs") || e.b.startsWith("sb_hs"),
    });
  }
  return out;
}

function distSeg(px: number, pz: number, s: Seg) {
  const t = Math.max(0, Math.min(s.len, (px - s.ax) * s.ux + (pz - s.az) * s.uz));
  return Math.hypot(px - (s.ax + s.ux * t), pz - (s.az + s.uz * t));
}

function distPoly(px: number, pz: number, pts: readonly (readonly [number, number])[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const t = Math.max(0, Math.min(len, (px - ax) * ux + (pz - az) * uz));
    best = Math.min(best, Math.hypot(px - (ax + ux * t), pz - (az + uz * t)));
  }
  return best;
}

export function generateSouthbank(seed = 7041): SouthbankLayout {
  const rand = mulberry32(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const range = (a: number, b: number) => a + rand() * (b - a);

  const L: SouthbankLayout = {
    bodies: { brick: [], render: [], georgian: [], modern: [], glass: [], concrete: [] },
    shopfronts: [], trims: [], roofs: [], acs: [], awnings: [], trees: [], cars: [], tables: [], umbrellas: [],
    stalls: [], lamps: [], benches: [], walkers: [], kerbs: [],
  };

  const segs = segments();
  // --- occupancy grid: 0 free, 1 road/pavement, 2 reserved feature, 3 building
  const occ = new Uint8Array(NX * NZ);
  const edgeDist = new Float32Array(NX * NZ);
  const nearSeg = new Int16Array(NX * NZ);
  const cx = (i: number) => Z.minX + (i + 0.5) * CELL;
  const cz = (j: number) => Z.minZ + (j + 0.5) * CELL;
  const F = SB_FEATURES;
  // distance to the nearest road edge: each segment only touches cells within REACH of it
  const REACH = 60;
  edgeDist.fill(1e9);
  segs.forEach((s, si) => {
    const i0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - REACH - Z.minX) / CELL));
    const i1 = Math.min(NX - 1, Math.floor((Math.max(s.ax, s.bx) + REACH - Z.minX) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - REACH - Z.minZ) / CELL));
    const j1 = Math.min(NZ - 1, Math.floor((Math.max(s.az, s.bz) + REACH - Z.minZ) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * NX + i;
        const d = distSeg(cx(i), cz(j), s) - s.half;
        if (d < edgeDist[k]) {
          edgeDist[k] = d;
          nearSeg[k] = si;
        }
      }
  });
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const x = cx(i), z = cz(j), k = j * NX + i;
      const best = edgeDist[k], bi = nearSeg[k];
      const pav = segs[bi].kind === "country" ? 1.2 : 3.5;
      if (best < pav) occ[k] = 1;
      else if (
        distPoly(x, z, F.market) < F.marketWidth / 2 + 0.5 ||
        (x >= F.park.minX && x <= F.park.maxX && z >= F.park.minZ && z <= F.park.maxZ) ||
        (x >= STADIUM_RESERVE.minX && x <= STADIUM_RESERVE.maxX && z >= STADIUM_RESERVE.minZ && z <= STADIUM_RESERVE.maxZ) ||
        (x >= CULTURE.plaza.minX && x <= CULTURE.plaza.maxX && z >= CULTURE.plaza.minZ && z <= CULTURE.plaza.maxZ) ||
        Math.hypot(x - F.crescent.x, z - F.crescent.z) < F.crescent.r - 6 ||
        F.roundabouts.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 6)
      )
        occ[k] = 2;
    }

  /** Visits grid cells covered by a rotated rect (+pad). Returns false early if `fn` returns false. */
  const cover = (x: number, z: number, w: number, d: number, ry: number, pad: number, fn: (k: number) => boolean | void) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const hw = w / 2 + pad, hd = d / 2 + pad;
    const r = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((x - r - Z.minX) / CELL)), i1 = Math.min(NX - 1, Math.floor((x + r - Z.minX) / CELL));
    const j0 = Math.max(0, Math.floor((z - r - Z.minZ) / CELL)), j1 = Math.min(NZ - 1, Math.floor((z + r - Z.minZ) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = cx(i) - x, pz = cz(j) - z;
        // local coords: local x axis = (c, -s), local z axis = (s, c) for rotation ry about y
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd && fn(j * NX + i) === false) return false;
      }
    return true;
  };
  const inside = (x: number, z: number, w: number, d: number, ry: number) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = x + (a * w * c) / 2 + (b * d * s) / 2;
      const pz = z - (a * w * s) / 2 + (b * d * c) / 2;
      if (px < Z.minX + 1 || px > Z.maxX - 1 || pz < Z.minZ + 1 || pz > Z.maxZ - 1) return false;
    }
    return true;
  };
  const fits = (x: number, z: number, w: number, d: number, ry: number, pad: number) =>
    inside(x, z, w, d, ry) && cover(x, z, w, d, ry, pad, (k) => occ[k] === 0);
  const claim = (x: number, z: number, w: number, d: number, ry: number, v = 3) => cover(x, z, w, d, ry, 0, (k) => void (occ[k] = v));

  // Reserve the towers and culture buildings.
  for (const t of TOWERS) claim(t.x, t.z, t.w + 4, t.d + 4, t.ry, 2);

  // ---------------------------------------------------------------- building kit
  const local = (b: { x: number; z: number; ry: number }, lx: number, lz: number): [number, number] => {
    const c = Math.cos(b.ry), s = Math.sin(b.ry);
    return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
  };

  type Style = "mixed" | "infill" | "market" | "mews" | "terrace";
  const addBuilding = (x: number, z: number, w: number, d: number, ry: number, style: Style, nearBoulevard = false) => {
    let kind: FacadeKind;
    let floors: number;
    const shop = style === "mixed" || style === "market";
    if (style === "terrace") {
      kind = "georgian";
      floors = 4;
    } else if (style === "mews") {
      kind = rand() < 0.7 ? "brick" : "render";
      floors = 2 + Math.floor(rand() * 2);
    } else if (style === "market") {
      kind = rand() < 0.55 ? "brick" : "render";
      floors = 4 + Math.floor(rand() * 3);
    } else if (style === "infill") {
      kind = pick(["brick", "brick", "render", "modern", "modern"] as FacadeKind[]);
      floors = 5 + Math.floor(rand() * 4);
    } else {
      const r = rand();
      kind = nearBoulevard ? (r < 0.45 ? "modern" : r < 0.75 ? "render" : r < 0.88 ? "glass" : "brick") : r < 0.42 ? "brick" : r < 0.75 ? "render" : r < 0.95 ? "modern" : "glass";
      floors = 5 + Math.floor(rand() * 8); // 5..12 storeys
    }
    const shopH = shop ? 4 : 0;
    const floorH = style === "terrace" ? 3.4 : 3.2;
    const h = shopH + floors * floorH;
    const color = kind === "glass" ? pick(PAL.glass) : pick(PAL[kind === "concrete" ? "modern" : kind]);
    const b = { x, z, ry };
    if (shop) {
      // recessed glazed ground floor, fascia, striped awning on the street side
      L.shopfronts.push({ x, y: 0, z, w: w - 0.6, d: d - 0.6, h: shopH, ry, color: "#ffffff" });
      L.bodies[kind].push({ x, y: shopH, z, w, d, h: h - shopH, ry, color });
      L.trims.push({ x, y: shopH - 0.35, z, w: w + 0.3, d: d + 0.3, h: 0.5, ry, color: "#3a3330" });
      if (rand() < 0.75) {
        const [ax, az] = local(b, 0, d / 2 + 0.75);
        L.awnings.push({ x: ax, y: shopH - 0.9, z: az, w: w * range(0.6, 0.9), d: 1.6, h: 0.12, ry, color: pick(PAL.awning) });
      }
    } else {
      L.bodies[kind].push({ x, y: 0, z, w, d, h, ry, color });
    }
    // roof
    if (style === "mews" || style === "terrace" || (floors <= 5 && rand() < 0.35 && kind !== "modern" && kind !== "glass")) {
      const roofH = style === "terrace" ? 3.2 : range(2.2, 3.4);
      L.roofs.push({ x, y: h, z, w: w + 0.4, d: d + 0.4, h: roofH, ry, color: style === "terrace" ? "#5b6670" : pick(["#6b4b3a", "#59606a", "#7a4a3a", "#4f555c"]) });
      // chimney stacks on the party walls
      for (const sx of [-w / 2 + 0.6, w / 2 - 0.6]) {
        const [qx, qz] = local(b, sx, 0);
        L.trims.push({ x: qx, y: h, z: qz, w: 0.9, d: 2.2, h: roofH + 1.4, ry, color: kind === "georgian" ? "#d9cdb5" : "#8e4a36" });
      }
    } else {
      L.trims.push({ x, y: h, z, w: w + 0.2, d: d + 0.2, h: 0.7, ry, color: kind === "glass" ? "#5d6b78" : kind === "brick" ? "#d9cfbf" : "#8a8580" });
      const n = Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const [qx, qz] = local(b, range(-w / 3, w / 3), range(-d / 3, d / 3));
        L.acs.push({ x: qx, y: h + 0.7, z: qz, w: range(1.2, 2.6), d: range(1.2, 2.4), h: range(0.8, 1.8), ry, color: pick(["#c9ccd0", "#a9aeb3", "#dadada"]) });
      }
      if (rand() < 0.25 && floors >= 7) {
        // set-back penthouse
        L.bodies[kind === "brick" ? "modern" : kind].push({ x, y: h, z, w: w * 0.6, d: d * 0.6, h: 3.2, ry, color: "#e8e4dc" });
      }
    }
  };

  // ---------------------------------------------------------------- 1. the Georgian crescent
  {
    const C = F.crescent;
    const N = 16;
    const depth = 13, rMid = C.r + 4 + 4 + depth / 2;
    for (let i = 0; i < N; i++) {
      const a0 = C.from + ((C.to - C.from) * i) / N, a1 = C.from + ((C.to - C.from) * (i + 1)) / N;
      const am = (a0 + a1) / 2;
      const w = 2 * (rMid - depth / 2) * Math.sin((a1 - a0) / 2) + 0.3;
      const x = C.x + rMid * Math.cos(am), z = C.z + rMid * Math.sin(am);
      const ry = Math.atan2(-Math.cos(am), -Math.sin(am)); // local +z faces the lawn
      if (!fits(x, z, w, depth, ry, -0.5)) continue;
      claim(x, z, w, depth, ry);
      addBuilding(x, z, w, depth, ry, "terrace");
    }
    // lawn trees ring
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = C.r - 10;
      const x = C.x + r * Math.cos(a), z = C.z + r * Math.sin(a);
      if (x > Z.minX + 2) L.trees.push({ x, z, ry: rand() * 6, s: range(0.9, 1.3), color: "#4f8a3c" });
    }
  }

  // ---------------------------------------------------------------- 2. market street frontage
  {
    const m = F.market;
    for (let i = 1; i < m.length; i++) {
      const [ax, az] = m[i - 1], [bx, bz] = m[i];
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = ux * side; // normal pointing away from the street
        let s = 0;
        while (s < len - 4) {
          const w = Math.min(range(7, 11), len - s);
          const d = range(12, 16);
          const off = F.marketWidth / 2 + 1 + d / 2;
          const x = ax + ux * (s + w / 2) + nx * off, z = az + uz * (s + w / 2) + nz * off;
          const ry = Math.atan2(-nx, -nz);
          if (fits(x, z, w, d, ry, 0)) {
            claim(x, z, w, d, ry);
            addBuilding(x, z, w, d, ry, "market");
          }
          s += w;
        }
        // stalls down the middle, alternating sides
        for (let t = 4; t < len - 2; t += 6) {
          const o = side * 2.6;
          L.stalls.push({ x: ax + ux * t - uz * o, z: az + uz * t + ux * o, ry: Math.atan2(ux, uz), s: 1, color: pick(PAL.awning) });
        }
      }
      // crowds: shoppers wandering up and down
      for (let k = 0; k < 70; k++) {
        const o = range(-5, 5), t = range(0, len);
        const dir = rand() < 0.5 ? 1 : -1;
        L.walkers.push({
          x: ax + ux * t - uz * o, z: az + uz * t + ux * o, dx: ux * dir, dz: uz * dir,
          len: rand() < 0.15 ? 0.01 : range(4, 22), speed: rand() < 0.15 ? 0 : range(0.8, 1.5), phase: rand(), color: pick(PAL.clothes),
        });
      }
      // café tables at the market edges
      for (let t = 3; t < len; t += 5)
        if (rand() < 0.55) {
          const o = (rand() < 0.5 ? 1 : -1) * 4.8;
          const x = ax + ux * t - uz * o, z = az + uz * t + ux * o;
          L.tables.push({ x, z, ry: 0, s: 1, color: "#ffffff" });
          L.umbrellas.push({ x, z, ry: 0, s: 1, color: pick(PAL.awning) });
        }
    }
  }

  // ---------------------------------------------------------------- 3. street frontage (mixed-use, shops below)
  const isMews = (s: Seg) => s.kind === "country";
  for (const s of segs) {
    if (s.kind === "highway") continue;
    for (const side of [1, -1]) {
      const nx = -s.uz * side, nz = s.ux * side;
      let t = rand() * 3;
      while (t < s.len - 3) {
        const mews = isMews(s);
        const w = mews ? range(6, 8.5) : range(9, 15);
        const d = mews ? range(7, 9) : range(12, 20);
        const ry = Math.atan2(-nx, -nz);
        let placed = false;
        for (const shrink of [1, 0.75, 0.55]) {
          const dd = d * shrink;
          const o2 = s.half + (mews ? 1.4 : 4.5) + dd / 2;
          const xx = s.ax + s.ux * (t + w / 2) + nx * o2, zz = s.az + s.uz * (t + w / 2) + nz * o2;
          if (dd >= 6 && fits(xx, zz, w, dd, ry, -0.5)) {
            claim(xx, zz, w, dd, ry);
            addBuilding(xx, zz, w, dd, ry, mews ? "mews" : "mixed", s.boulevard);
            placed = true;
            break;
          }
        }
        t += placed ? w : 3;
      }
    }
  }

  // ---------------------------------------------------------------- 4. courtyard infill: fill every block
  {
    const order: number[] = [];
    for (let k = 0; k < NX * NZ; k += 1) if (occ[k] === 0 && (k % NX) % 2 === 0 && Math.floor(k / NX) % 2 === 0) order.push(k);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const k of order) {
      if (occ[k] !== 0) continue;
      const x = cx(k % NX), z = cz(Math.floor(k / NX));
      const sg = segs[nearSeg[k]];
      const ry = Math.atan2(sg.ux, sg.uz) + Math.PI / 2;
      for (const sz of [[range(14, 22), range(12, 20)], [range(9, 13), range(9, 13)], [6.5, 6.5]]) {
        if (fits(x, z, sz[0], sz[1], ry, 1)) {
          claim(x, z, sz[0], sz[1], ry);
          addBuilding(x, z, sz[0], sz[1], ry, edgeDist[k] < 12 ? "mixed" : "infill");
          break;
        }
      }
    }
    // leftover yards get a tree
    for (let k = 0; k < NX * NZ; k += 3) {
      if (occ[k] !== 0 || edgeDist[k] < 5) continue;
      if (rand() < 0.12) L.trees.push({ x: cx(k % NX), z: cz(Math.floor(k / NX)), ry: rand() * 6, s: range(0.7, 1.1), color: pick(["#4f8a3c", "#5d9a3e", "#3f7a34"]) });
    }
  }

  // ---------------------------------------------------------------- 5. street life along every street
  for (const s of segs) {
    if (s.kind === "highway" || s.len < 6) continue;
    const ownStreet = [s.ax, s.bx].every((x) => x >= Z.minX - 1 && x <= Z.maxX + 1) && [s.az, s.bz].every((z) => z >= Z.minZ - 1 && z <= Z.maxZ + 1);
    if (!ownStreet) continue;
    const mews = isMews(s);
    const ry = Math.atan2(s.ux, s.uz);
    const at = (t: number, o: number): [number, number] => [s.ax + s.ux * t - s.uz * o, s.az + s.uz * t + s.ux * o];
    // kerbs
    if (!mews)
      for (const o of [s.half + 0.12, -(s.half + 0.12)]) {
        const [x, z] = at(s.len / 2, o);
        L.kerbs.push({ x, y: 0, z, w: 0.25, d: Math.max(0, s.len - 7), h: 0.16, ry, color: "#b9b4aa" });
      }
    if (mews) {
      for (let k = 0; k < 4; k++) {
        const [x, z] = at(range(0, s.len), range(-1.5, 1.5));
        L.walkers.push({ x, z, dx: s.ux, dz: s.uz, len: 0.01, speed: 0, phase: rand(), color: pick(PAL.clothes) });
      }
      continue;
    }
    for (const side of [1, -1]) {
      // lamp posts
      for (let t = 6 + (side > 0 ? 0 : 12); t < s.len - 4; t += 24) {
        const [x, z] = at(t, side * (s.half + 0.8));
        L.lamps.push({ x, z, ry, s: 1, color: "#2c2f33" });
      }
      // trees: dense on the boulevard, scattered elsewhere
      const treeStep = s.boulevard ? 9 : 26;
      if (s.boulevard || rand() < 0.5)
        for (let t = 5; t < s.len - 4; t += treeStep) {
          const [x, z] = at(t, side * (s.half + 3.2));
          L.trees.push({ x, z, ry: rand() * 6, s: s.boulevard ? 1.15 : range(0.8, 1.05), color: s.boulevard ? "#4a8c3a" : pick(["#4f8a3c", "#5d9a3e"]) });
        }
      // parked cars in the kerbside bay
      if (rand() < (s.high || s.boulevard ? 0.8 : 0.55))
        for (let t = 7; t < s.len - 7; t += range(5.5, 9)) {
          if (rand() < 0.25) continue;
          const [x, z] = at(t, side * (s.half + 1.3));
          L.cars.push({ x, z, ry: ry + (side > 0 ? 0 : Math.PI), s: 1, color: pick(PAL.car) });
        }
      // cafés with outdoor seating on the high street and boulevard
      if ((s.high || s.boulevard) && rand() < 0.6) {
        for (let t = 4; t < s.len - 4; t += 4.5)
          if (rand() < 0.6) {
            const [x, z] = at(t, side * (s.half + 3.6));
            L.tables.push({ x, z, ry: 0, s: 1, color: "#ffffff" });
            if (rand() < 0.7) L.umbrellas.push({ x, z, ry: 0, s: 1, color: pick(PAL.awning) });
          }
      }
      // pedestrians on the pavement
      const n = s.high ? 9 : s.boulevard ? 7 : 3;
      for (let k = 0; k < n; k++) {
        const t = range(0, s.len * 0.6), dir = rand() < 0.5 ? 1 : -1;
        const [x, z] = at(dir > 0 ? t : s.len - t, side * (s.half + range(1.8, 4)));
        L.walkers.push({ x, z, dx: s.ux * dir, dz: s.uz * dir, len: range(6, s.len * 0.4 + 6), speed: range(0.9, 1.5), phase: rand(), color: pick(PAL.clothes) });
      }
    }
  }

  // ---------------------------------------------------------------- 6. park: trees, benches, strollers
  {
    const P = F.park, lk = F.lake;
    for (let i = 0; i < 70; i++) {
      const x = range(P.minX + 3, P.maxX - 3), z = range(P.minZ + 3, P.maxZ - 3);
      const e = Math.pow((x - lk.x) / (lk.rx + 6), 2) + Math.pow((z - lk.z) / (lk.rz + 6), 2);
      if (e < 1 || Math.hypot(x - F.bandstand.x, z - F.bandstand.z) < 12) continue;
      if (Math.abs(x - (P.minX + P.maxX) / 2) < 2.5 || Math.abs(z - (P.minZ + 8)) < 2.5) continue; // paths
      L.trees.push({ x, z, ry: rand() * 6, s: range(0.9, 1.6), color: pick(["#4f8a3c", "#5d9a3e", "#3f7a34", "#6aa84f"]) });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      L.benches.push({ x: lk.x + (lk.rx + 4) * Math.cos(a), z: lk.z + (lk.rz + 4) * Math.sin(a), ry: -a + Math.PI / 2, s: 1, color: "#6b4a2f" });
    }
    // loop path walkers round the lake, and along the cross paths
    for (let k = 0; k < 60; k++) {
      const horiz = rand() < 0.5;
      const dir = rand() < 0.5 ? 1 : -1;
      if (horiz) L.walkers.push({ x: P.minX + 4 + rand() * 20, z: P.minZ + 8 + range(-1, 1), dx: dir, dz: 0, len: range(20, 60), speed: range(0.7, 1.3), phase: rand(), color: pick(PAL.clothes) });
      else L.walkers.push({ x: (P.minX + P.maxX) / 2 + range(-1, 1), z: P.minZ + 4 + rand() * 20, dx: 0, dz: dir, len: range(20, 60), speed: range(0.7, 1.3), phase: rand(), color: pick(PAL.clothes) });
    }
    // picnickers on the lawn and a crowd around the bandstand
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2, r = range(6, 13);
      L.walkers.push({ x: F.bandstand.x + r * Math.cos(a), z: F.bandstand.z + r * Math.sin(a), dx: -Math.cos(a), dz: -Math.sin(a), len: 0.01, speed: 0, phase: rand(), color: pick(PAL.clothes) });
    }
  }

  // ---------------------------------------------------------------- 7. culture plaza and stadium forecourt crowds
  {
    const pl = CULTURE.plaza;
    for (let k = 0; k < 90; k++) {
      const a = rand() * Math.PI * 2;
      L.walkers.push({ x: range(pl.minX + 4, pl.maxX - 4), z: range(pl.minZ + 1, pl.minZ + 12), dx: Math.cos(a), dz: Math.sin(a), len: range(5, 25), speed: range(0.6, 1.3), phase: rand(), color: pick(PAL.clothes) });
    }
    for (let i = 0; i < 12; i++) L.trees.push({ x: pl.minX + 8 + i * 15, z: pl.minZ + 2, ry: rand() * 6, s: 1, color: "#4f8a3c" });
    // fans streaming along the stadium approach (S1) towards the turnstiles
    for (let k = 0; k < 160; k++) {
      const z = range(475, 610), x = range(-301, -296);
      L.walkers.push({ x, z, dx: 0, dz: rand() < 0.7 ? 1 : -1, len: range(10, 40), speed: range(1, 1.6), phase: rand(), color: rand() < 0.7 ? pick(["#c8102e", "#ffffff", "#c8102e"]) : pick(PAL.clothes) });
    }
  }

  return L;
}
