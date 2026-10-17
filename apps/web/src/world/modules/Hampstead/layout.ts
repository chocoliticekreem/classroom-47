// Hampstead layout: pure, seeded data (no three.js) so it can be unit tested.
// Produces static instanced "parts", GPU-animated "anims" (people, dogs, swimmers, kites, balls),
// text signs, and the observatory placement.
import { WIND, ZONES } from "../../config";
import { HP_LANES } from "../../districts/hampstead";
import {
  HEATH,
  OBSERVATORY,
  PATHS,
  PONDS,
  VIEWPOINT,
  hampsteadSegments,
  inPond,
  surfaceAt,
  heightAt,
  pathDistance,
  roadDistance,
  type Rect,
} from "./terrain";

// Geometry conventions (see Hampstead.tsx):
//   box, winLit, winDark, glow, water, fence: unit box, base at y.  prism: ridge along x, base at y.
//   pyramid, cyl (8 sides), disc (32 sides), pond (disc), cone (7 sides): base at y.
//   flat (box) and flatDisc (disc): ground-level surfaces (lawns, gravel, pitches, courts), drawn with a polygon
//   offset; use flat()/lflat(), which set the TOP height (>= 0.1, layered) so they never z-fight Ground's grass.
//   sphere, foliage: centred on y (unit diameter).  dome: hemisphere, base at y (unit diameter).
export type PoolName =
  | "box" | "prism" | "pyramid" | "cyl" | "disc" | "cone" | "sphere" | "foliage" | "dome"
  | "winLit" | "winDark" | "glow" | "water" | "pond" | "fence" | "flat" | "flatDisc";

export interface Part {
  pool: PoolName;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  tilt: number; // rotation about local x after ry
  color: string;
}

export type AnimPool = "aBody" | "aHead" | "aKite" | "aString";

/**
 * GPU-animated instance. Offset added in world space each frame (a = t * speed + phase):
 *   mode 0 (stroll/rally): dir * sin(a) + up * hop * |cos(a)|
 *   mode 1 (kite):         dir * sin(a) + up * hop * cos(2a)
 *   mode 2 (swim circle):  (cos(a), sin(3a) * hop / dirX, sin(a)) * dirX
 * aString instances span `x,y,z` -> `to`, and only their top follows the motion (weight = local y).
 */
export interface Anim {
  pool: AnimPool;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  color: string;
  dx: number;
  dy: number;
  dz: number;
  hop: number;
  phase: number;
  speed: number;
  mode: 0 | 1 | 2;
  to?: [number, number, number];
}

export interface Sign {
  text: string;
  bg: string;
  fg: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  ry: number; // plane faces local +z after this yaw
}

export interface Layout {
  parts: Part[];
  anims: Anim[];
  signs: Sign[];
  observatory: { x: number; y: number; z: number; r: number };
  counts: Record<string, number>;
}

/** Parts must stay this far from every road centre line (8 m street = 4 m half width). */
export const CLEARANCE = 4.3;
/** Nothing south of this: the motorway's 12 m carriageway runs along z = -700. */
export const SOUTH_LIMIT = -707;

export const CEMETERY: Rect = { minX: -606, maxX: -432, minZ: -946, maxZ: -818 };
export const CRICKET = { x: -490, z: -770, r: 34 };
export const TENNIS: Rect = { minX: -615, maxX: -565, minZ: -791, maxZ: -753 };

// ---------------------------------------------------------------------------------------------
// Helpers

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

type Rng = () => number;
const pick = <T,>(rng: Rng, arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

export function glowForHour(h: number) {
  const hr = ((Math.floor(h) % 24) + 24) % 24;
  if (hr >= 20 || hr < 6) return 1;
  if (hr === 19 || hr === 6) return 0.7;
  if (hr === 18 || hr === 7) return 0.3;
  return 0;
}

/** A local frame: origin (cx, cz), yaw ry (local +z maps to (sin ry, cos ry)), base height y0. */
class Frame {
  readonly c: number;
  readonly s: number;
  constructor(readonly cx: number, readonly cz: number, readonly ry: number, readonly y0 = 0) {
    this.c = Math.cos(ry);
    this.s = Math.sin(ry);
  }
  x(lx: number, lz: number) {
    return this.cx + lx * this.c + lz * this.s;
  }
  z(lx: number, lz: number) {
    return this.cz - lx * this.s + lz * this.c;
  }
}

const SEGS = hampsteadSegments();
const WIND_LEN = Math.hypot(WIND[0], WIND[1]);
const WX = WIND[0] / WIND_LEN;
const WZ = WIND[1] / WIND_LEN;

/** Clearance of a rotated w x d footprint (frame-local centre lx, lz) from every Hampstead road. */
function footprintClear(F: Frame, lx: number, lz: number, w: number, d: number, min: number) {
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0.5], [0, -0.5], [0.5, 0], [-0.5, 0], [0, 0]]) {
    const x = F.x(lx + a * w, lz + b * d);
    const z = F.z(lx + a * w, lz + b * d);
    if (roadDistance(x, z, SEGS) < min) return false;
    if (x < ZONES.hampstead.minX + 0.5 || x > ZONES.hampstead.maxX - 0.5) return false;
    if (z < ZONES.hampstead.minZ + 0.5 || z > SOUTH_LIMIT - 0.5) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The builder

const SKIN = ["#f1c7a5", "#d9a47c", "#a8714f", "#7a4b32", "#e8b896", "#5b3a26"];
const CLOTHES = ["#ff6a1a", "#2f5d8a", "#c0392b", "#f2c14e", "#3c8d5a", "#6c4f9c", "#e4e4e4", "#333740", "#d96c9a", "#4fb0c6", "#8a6d3b"];
const TROUSERS = ["#2c3340", "#41474f", "#5b4a3a", "#1f2a44", "#6b6f78"];
const GREENS = ["#4f8a3c", "#5c9a45", "#467d36", "#3f7232", "#6aa64e", "#557f3a"];
const AUTUMN = ["#d38a2e", "#c9a23a", "#b5652a", "#e0b04a"];

export function buildLayout(seed = 7311): Layout {
  const rng = mulberry32(seed);
  const parts: Part[] = [];
  const anims: Anim[] = [];
  const signs: Sign[] = [];
  const occupied: { x: number; z: number; r: number }[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  const free = (x: number, z: number, r: number) => occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r);
  const occupy = (x: number, z: number, r: number) => occupied.push({ x, z, r });

  const put = (pool: PoolName, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, color: string, tilt = 0) =>
    parts.push({ pool, x, y, z, sx, sy, sz, ry, tilt, color });
  /** Frame-local part. */
  const lp = (F: Frame, pool: PoolName, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: string, dry = 0, tilt = 0) =>
    put(pool, F.x(lx, lz), F.y0 + ly, F.z(lx, lz), sx, sy, sz, F.ry + dry, color, tilt);

  /** Ground-level surface with its top at `top` (layer lawns 0.10, drives/courts 0.13, lines 0.15...). */
  const flat = (pool: "flat" | "flatDisc", x: number, z: number, w: number, d: number, top: number, ry: number, color: string, y0 = 0) =>
    put(pool, x, y0 + top - 0.12, z, w, 0.12, d, ry, color);
  const lflat = (F: Frame, lx: number, lz: number, w: number, d: number, top: number, color: string) =>
    flat("flat", F.x(lx, lz), F.z(lx, lz), w, d, top, F.ry, color, F.y0);

  const anim = (a: Omit<Anim, "dx" | "dy" | "dz" | "hop" | "phase" | "speed" | "mode"> & Partial<Anim>) =>
    anims.push({ dx: 0, dy: 0, dz: 0, hop: 0, phase: 0, speed: 0, mode: 0, ...a });

  /** A person (legs, torso, head) at ground (x, y, z), with an optional motion. */
  function person(x: number, y: number, z: number, ry: number, motion: Partial<Anim> = {}, opts: { shirt?: string; legs?: string; head?: string; sit?: boolean; scale?: number } = {}) {
    const k = opts.scale ?? 1;
    const shirt = opts.shirt ?? pick(rng, CLOTHES);
    const legs = opts.legs ?? pick(rng, TROUSERS);
    const head = opts.head ?? pick(rng, SKIN);
    const sit = opts.sit ?? false;
    const legH = sit ? 0.45 : 0.85;
    anim({ pool: "aBody", x, y, z, sx: 0.42 * k, sy: legH * k, sz: (sit ? 0.7 : 0.3) * k, ry, color: legs, ...motion });
    anim({ pool: "aBody", x, y: y + legH * k, z, sx: 0.56 * k, sy: 0.68 * k, sz: 0.34 * k, ry, color: shirt, ...motion });
    anim({ pool: "aHead", x, y: y + (legH + 0.68 + 0.2) * k, z, sx: 0.36 * k, sy: 0.4 * k, sz: 0.36 * k, ry, color: head, ...motion });
    bump("people");
  }

  function dog(x: number, y: number, z: number, ry: number, motion: Partial<Anim>) {
    const col = pick(rng, ["#e8d7b0", "#3a2a1e", "#8a5a2b", "#f4f1ea", "#222222", "#b9772e"]);
    const m = { ...motion, hop: (motion.hop ?? 0) + 0.18 };
    anim({ pool: "aBody", x, y: y + 0.25, z, sx: 0.32, sy: 0.32, sz: 0.75, ry, color: col, ...m });
    const hx = x + Math.sin(ry) * 0.42;
    const hz = z + Math.cos(ry) * 0.42;
    anim({ pool: "aHead", x: hx, y: y + 0.7, z: hz, sx: 0.3, sy: 0.3, sz: 0.36, ry, color: col, ...m });
    bump("dogs");
  }

  function tree(x: number, y: number, z: number, size: number, kind: "oak" | "birch" | "pine" | "yew" | "cedar", autumn = false) {
    const leaf = autumn ? pick(rng, AUTUMN) : pick(rng, GREENS);
    if (kind === "pine" || kind === "yew") {
      put("cyl", x, y, z, 0.35 * size, 1.4 * size, 0.35 * size, 0, "#5a4030");
      put("cone", x, y + 1.0 * size, z, 2.6 * size, (kind === "yew" ? 4.2 : 6) * size, 2.6 * size, rng() * 6, kind === "yew" ? "#2d4a30" : "#33583a");
    } else if (kind === "cedar") {
      put("cyl", x, y, z, 1.2 * size, 5 * size, 1.2 * size, 0, "#4e3a2a");
      for (let k = 0; k < 3; k++)
        put("cone", x + range(rng, -1, 1), y + (3 + k * 2.4) * size, z + range(rng, -1, 1), (12 - k * 3) * size, 1.6 * size, (11 - k * 3) * size, rng() * 6, "#2f4d2e");
    } else if (kind === "birch") {
      put("cyl", x, y, z, 0.28 * size, 4 * size, 0.28 * size, 0, "#e9e4da");
      put("foliage", x, y + 4.6 * size, z, 2.2 * size, 3.6 * size, 2.2 * size, rng() * 6, autumn ? pick(rng, AUTUMN) : "#86b25a");
    } else {
      put("cyl", x, y, z, 0.6 * size, 2.6 * size, 0.6 * size, 0, "#5a4030");
      const n = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++)
        put("foliage", x + range(rng, -1.2, 1.2) * size, y + range(rng, 3.6, 5) * size, z + range(rng, -1.2, 1.2) * size,
          range(rng, 3.2, 4.4) * size, range(rng, 2.8, 3.6) * size, range(rng, 3.2, 4.4) * size, rng() * 6, k === 0 ? leaf : pick(rng, GREENS));
    }
    bump("trees");
  }

  function bench(F: Frame, lx: number, lz: number, color = "#6b4a2e") {
    lp(F, "box", lx, 0.42, lz, 1.8, 0.08, 0.5, color);
    lp(F, "box", lx, 0.5, lz - 0.24, 1.8, 0.45, 0.06, color);
    lp(F, "box", lx - 0.75, 0, lz, 0.08, 0.42, 0.45, "#2a2a2a");
    lp(F, "box", lx + 0.75, 0, lz, 0.08, 0.42, 0.45, "#2a2a2a");
    bump("benches");
  }

  /** Windows on the front (+z) and back (-z) faces of a frame-local box body. */
  function windows(F: Frame, bx: number, bz: number, w: number, d: number, floors: number, floorH: number, base: number, litP: number, winW = 1.1, sides = true) {
    const n = Math.max(1, Math.floor(w / 2.8));
    for (let f = 0; f < floors; f++) {
      const y = base + f * floorH + floorH * 0.32;
      for (let i = 0; i < n; i++) {
        const x = bx - w / 2 + (w * (i + 0.5)) / n;
        for (const side of [1, -1]) lp(F, rng() < litP ? "winLit" : "winDark", x, y, bz + side * (d / 2 + 0.04), winW, floorH * 0.45, 0.12, "#2b3440");
      }
      if (sides)
        for (const side of [1, -1]) lp(F, rng() < litP ? "winLit" : "winDark", bx + side * (w / 2 + 0.04), y, bz, 0.12, floorH * 0.45, winW, "#2b3440");
    }
  }

  function sign(F: Frame, lx: number, ly: number, lz: number, w: number, h: number, text: string, bg: string, fg: string, dry = 0) {
    signs.push({ text, bg, fg, x: F.x(lx, lz), y: F.y0 + ly, z: F.z(lx, lz), w, h, ry: F.ry + dry });
  }

  function car(F: Frame, lx: number, lz: number, dry = 0) {
    const col = pick(rng, ["#111316", "#c9ccd1", "#1f4d36", "#f4f4f2", "#2a3f6b", "#7a1f25", "#3a3a3a"]);
    const c = Math.cos(dry);
    const s = Math.sin(dry);
    const at = (ox: number, oz: number): [number, number] => [lx + ox * c + oz * s, lz - ox * s + oz * c];
    const [x0, z0] = at(0, 0);
    lp(F, "box", x0, 0.3, z0, 1.85, 0.75, 4.4, col, dry);
    const [x1, z1] = at(0, -0.3);
    lp(F, "box", x1, 1.05, z1, 1.65, 0.6, 2.4, "#2b3440", dry);
    bump("cars");
  }

  // ===========================================================================================
  // 1. High Street: shops both sides, a pub, a church at the roundabout.
  const church = new Frame(66, -801, Math.PI / 2);
  occupy(66, -801, 15);
  {
    const F = church;
    // nave along local z (world x), tower at the west end (local -z).
    lp(F, "box", 0, 0, 2, 9, 8, 20, "#b9ab8e");
    lp(F, "prism", 0, 8, 2, 20.4, 5, 9.6, "#5a5f66", Math.PI / 2);
    lp(F, "box", 0, 0, -10.5, 5.5, 15, 5.5, "#a99b7f");
    lp(F, "pyramid", 0, 15, -10.5, 5.2, 13, 5.2, "#4e535a");
    lp(F, "glow", 0, 11, -13.3, 1.4, 1.4, 0.1, "#f6f0dc"); // clock face
    for (let k = 0; k < 4; k++) for (const side of [1, -1]) lp(F, k % 2 ? "winLit" : "winDark", side * 4.55, 2.4, -5 + k * 5, 0.12, 3.8, 1.4, "#3a4a7a");
    lp(F, "winLit", 0, 2.5, 12.05, 2.6, 4, 0.12, "#7a3a5a"); // rose window end
    // churchyard
    for (let k = 0; k < 16; k++) {
      const lx = range(rng, -12, 12);
      const lz = range(rng, -14, 14);
      if (Math.abs(lx) < 6.5 && lz > -14 && lz < 13) continue;
      lp(F, "box", lx, 0, lz, 0.7, range(rng, 0.7, 1.1), 0.16, pick(rng, ["#8a8a86", "#9a978f", "#6f6d68"]), rng() * 0.3 - 0.15, rng() * 0.2 - 0.1);
    }
    tree(F.x(-11, 10), 0, F.z(-11, 10), 1.1, "yew");
    tree(F.x(11, -6), 0, F.z(11, -6), 1.2, "oak", true);
    sign(F, 0, 0.6, 12.2, 3, 1.1, "ST JOHN'S", "#1d2b4a", "#f2e6c8");
    bump("church");
  }

  const SHOPS = ["Keats Café", "Heath Books", "Holly & Vine", "Whitestone Bakery", "Flask Walk Deli", "Pond St Florist",
    "Vale Wines", "Constable Gallery", "Downshire Butchers", "Rosslyn Optician", "Village Cheese", "Fitzjohn Estates",
    "Perrin's Hardware", "Heath Street Toys", "Church Row Antiques", "The Spaniards Grocer", "Belsize Pharmacy",
    "Hampstead Cycles", "Oriel Tailors", "Gayton Fishmonger", "Willow Patisserie", "Frognal Framers", "Lyndhurst Shoes",
    "Haverstock Barbers", "Well Walk Wool", "Golders Gelato", "Redington Records", "Vale Yoga"];
  const FASCIA = [["#1f3b2d", "#f2e6c8"], ["#1d2b4a", "#f4e7c6"], ["#5a1e2b", "#f6e9cf"], ["#111111", "#e8c46a"], ["#f2ede0", "#1f3b2d"], ["#2f5d6a", "#ffffff"]];
  const SHOP_BODY = ["#9c4a34", "#c8a46a", "#efe6d2", "#b55a3c", "#e9dfc8", "#8e4430", "#d7c4a0", "#f2ede0", "#a9b8a0", "#c9b6d2"];
  let shopIx = 0;
  {
    const pts = HP_LANES.high;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (const side of [1, -1]) {
        // normal pointing to this side: (−uz, ux) * side
        const nx = -uz * side;
        const nz = ux * side;
        let s = 3;
        while (s < len - 3) {
          const w = range(rng, 7, 9.5);
          const d = range(rng, 9, 11);
          const off = 4 + 2.8 + d / 2;
          const cx = ax + ux * (s + w / 2) + nx * off;
          const cz = az + uz * (s + w / 2) + nz * off;
          const F = new Frame(cx, cz, Math.atan2(-nx, -nz));
          s += w + 0.15;
          if (!footprintClear(F, 0, 0, w + 0.2, d, CLEARANCE + 2.4) || !free(cx, cz, Math.min(w, d) / 2)) continue;
          occupy(cx, cz, Math.max(w, d) * 0.5);
          const floors = 2 + Math.floor(rng() * 3);
          const fh = 3.3;
          const h = 1 + floors * fh;
          const body = pick(rng, SHOP_BODY);
          lp(F, "box", 0, 0, 0, w, h, d, body);
          // shopfront glass + stall riser + door
          lp(F, "winLit", 0, 0.5, d / 2 + 0.04, w * 0.78, 2.5, 0.12, "#3b4654");
          lp(F, "box", 0, 0, d / 2 + 0.06, w * 0.84, 0.5, 0.2, "#2a2f36");
          const [bg, fg] = pick(rng, FASCIA);
          lp(F, "box", 0, 3.05, d / 2 + 0.1, w * 0.92, 0.95, 0.18, bg);
          const name = SHOPS[shopIx++ % SHOPS.length];
          sign(F, 0, 3.52, d / 2 + 0.21, w * 0.86, 0.78, name, bg, fg);
          if (rng() < 0.55) lp(F, "box", 0, 3.0, d / 2 + 0.95, w * 0.84, 0.12, 1.7, pick(rng, ["#ff6a1a", "#1f3b2d", "#8a1f2b", "#2f5d8a", "#e2b33a"]), 0, -0.32);
          // upper floors
          const n = Math.max(2, Math.floor(w / 2.6));
          for (let f = 1; f < floors; f++)
            for (let k = 0; k < n; k++) lp(F, rng() < 0.5 ? "winLit" : "winDark", -w / 2 + (w * (k + 0.5)) / n, 1 + f * fh + 0.7, d / 2 + 0.04, 1.05, 1.8, 0.12, "#2b3440");
          for (let f = 1; f < floors; f++) lp(F, rng() < 0.4 ? "winLit" : "winDark", 0, 1 + f * fh + 0.7, -d / 2 - 0.04, 1.4, 1.8, 0.12, "#2b3440");
          // roof
          if (rng() < 0.5) {
            lp(F, "prism", 0, h, 0, w + 0.1, 2.6, d + 0.3, pick(rng, ["#4e535a", "#5b4a44", "#3f444b"]));
          } else {
            lp(F, "box", 0, h, d / 2 - 0.15, w, 0.8, 0.3, body);
            lp(F, "box", 0, h, 0, w - 0.4, 0.2, d - 0.4, "#5d5f62");
          }
          lp(F, "box", w / 2 - 0.8, h, -d / 4, 0.9, 1.8, 1.4, "#8e4430");
          bump("shops");
          // pavement life
          if (rng() < 0.75) {
            const px = cx - nx * (d / 2 + 1.4);
            const pz = cz - nz * (d / 2 + 1.4);
            const amp = range(rng, 3, 9);
            person(px, 0, pz, Math.atan2(ux, uz), { dx: ux * amp, dz: uz * amp, hop: 0.05, phase: rng() * 6.28, speed: range(rng, 0.12, 0.22) });
          }
        }
      }
    }
  }

  // Terraced mews cottages behind the south side of the High Street, and mansion blocks at its east end.
  {
    let x = 34;
    while (x < 252) {
      const w = range(rng, 5.5, 7);
      const F = new Frame(x + w / 2, -727, 0);
      x += w;
      if (!footprintClear(F, 0, 0, w, 9, CLEARANCE + 1) || !free(F.cx, F.cz, 3)) continue;
      occupy(F.cx, F.cz, 3.2);
      const col = pick(rng, ["#f2d8c8", "#d8e4d0", "#f4eac8", "#cfdbe6", "#efe6d2", "#e6c9c9", "#c8a46a", "#9c4a34"]);
      const h = range(rng, 5.6, 7.2);
      lp(F, "box", 0, 0, 0, w, h, 8, col);
      lp(F, "prism", 0, h, 0, w + 0.05, 2.4, 8.4, pick(rng, ["#4e535a", "#5b4a44"]));
      lp(F, "box", w / 2 - 0.6, h + 1.2, 0, 0.6, 1.6, 0.9, "#8e4430");
      lp(F, "box", -w / 4, 0, 4.04, 1, 2.1, 0.1, pick(rng, ["#1f3b2d", "#5a1e2b", "#1d2b4a", "#e2b33a", "#ffffff"]));
      windows(F, 0, 0, w, 8, 2, 2.8, 0.2, 0.5, 1.1, false);
      lflat(F, 0, 6, w - 0.2, 3.6, 0.1, "#6aa64e");
      lp(F, "box", 0, 0, 7.9, w, 0.9, 0.3, "#3d6b34");
      bump("cottages");
    }
    for (const [mx, mz, w, d] of [[230, -760, 22, 16], [236, -790, 18, 14]] as const) {
      const F = new Frame(mx, mz, 0.08);
      if (!footprintClear(F, 0, 0, w, d, CLEARANCE + 1.5) || !free(mx, mz, Math.min(w, d) / 2)) continue;
      occupy(mx, mz, Math.max(w, d) / 2);
      const h = 17;
      lp(F, "box", 0, 0, 0, w, h, d, "#a14b35");
      lp(F, "box", 0, h, 0, w + 0.3, 0.5, d + 0.3, "#e9e2d6");
      lp(F, "prism", 0, h + 0.5, 0, w - 1, 3, d - 2, "#4e535a");
      for (const ex of [-w / 3, w / 3]) lp(F, "box", ex, h + 0.5, 0, 1.2, 4.2, 1.6, "#8e4430");
      for (let f = 0; f < 5; f++) lp(F, "box", 0, 3.3 * (f + 1) - 0.15, d / 2 + 0.05, w, 0.3, 0.15, "#e9e2d6");
      windows(F, 0, 0, w, d, 5, 3.3, 0.2, 0.55);
      bump("mansions");
    }
  }

  // ===========================================================================================
  // 2. Villas: big detached houses with gardens and pools, set back from the contour lanes.
  {
    const villaLanes = ["crescent", "bishops", "temple", "heathst", "high"];
    for (const name of villaLanes) {
      const pts = HP_LANES[name];
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        for (let s = 2; s < len; s += 3) {
          for (const side of [1, -1]) {
            const R = range(rng, 11.5, 14.5);
            const set = R + 5.2 + rng() * 2;
            const nx = -uz * side;
            const nz = ux * side;
            const cx = ax + ux * s + nx * set;
            const cz = az + uz * s + nz * set;
            if (cx < 30 + R || cx > ZONES.hampstead.maxX - R - 1 || cz < ZONES.hampstead.minZ + R + 1 || cz > -790) continue;
            if (roadDistance(cx, cz, SEGS) < R + 4.8 || !free(cx, cz, R)) continue;
            occupy(cx, cz, R);
            villa(new Frame(cx, cz, Math.atan2(-nx, -nz)), R);
          }
        }
      }
    }
  }

  function villa(F: Frame, R: number) {
    const s = R * 1.38; // garden square side (fits inside the lot circle)
    const h2 = s / 2;
    lflat(F, 0, 0, s, s, 0.1, pick(rng, ["#6aa64e", "#62a048", "#73ad55", "#5f9a46"]));
    // hedges with a gap for the drive
    const driveX = (rng() < 0.5 ? -1 : 1) * s * 0.28;
    const hedge = pick(rng, ["#2f5a2c", "#355f30", "#2b5230"]);
    lp(F, "box", 0, 0, -h2 + 0.4, s, 1.4, 0.8, hedge);
    lp(F, "box", -h2 + 0.4, 0, 0, 0.8, 1.4, s, hedge);
    lp(F, "box", h2 - 0.4, 0, 0, 0.8, 1.4, s, hedge);
    const gapL = driveX - 2.2;
    const gapR = driveX + 2.2;
    if (gapL + h2 > 0.5) lp(F, "box", (-h2 + gapL) / 2, 0, h2 - 0.4, gapL + h2, 1.2, 0.8, hedge);
    if (h2 - gapR > 0.5) lp(F, "box", (h2 + gapR) / 2, 0, h2 - 0.4, h2 - gapR, 1.2, 0.8, hedge);
    lp(F, "box", driveX - 2.3, 0, h2 - 0.4, 0.6, 1.8, 0.6, "#d9d2c3");
    lp(F, "box", driveX + 2.3, 0, h2 - 0.4, 0.6, 1.8, 0.6, "#d9d2c3");

    const style = Math.floor(rng() * 4);
    const w = s * range(rng, 0.52, 0.64);
    const d = s * range(rng, 0.29, 0.34);
    const hz = s * 0.1; // house slightly towards the road
    const floors = rng() < 0.3 ? 3 : 2;
    const fh = 3.2;
    const h = floors * fh + 0.4;
    const front = hz + d / 2;
    // drive (gravel) from the gate to the front door
    lflat(F, driveX, (front + h2) / 2, 3.6, h2 - front, 0.13, "#cfc3a8");
    car(F, driveX, (front + h2) / 2, Math.PI / 2 + (rng() < 0.5 ? 0 : Math.PI));
    if (style === 0) {
      // Arts & Crafts: red brick, steep tiled roof, tall chimneys
      const col = pick(rng, ["#9c4a34", "#a85a3c", "#8e4430"]);
      lp(F, "box", 0, 0, hz, w, h, d, col);
      lp(F, "prism", 0, h, hz, w + 1.2, range(rng, 4, 5.5), d + 1.2, pick(rng, ["#5a3a30", "#4a3a34", "#6b3f2e"]));
      lp(F, "prism", -w * 0.25, h - 0.6, front + 1.2, 4, 3, 3, pick(rng, ["#5a3a30", "#4a3a34"]), Math.PI / 2);
      lp(F, "box", -w * 0.25, 0, front + 1.2, 4, h - 0.6, 2.6, col);
      for (const ex of [-w / 2 + 1, w / 2 - 1]) lp(F, "box", ex, h - 1, hz, 1, 6, 1.4, "#7a3a2a");
    } else if (style === 1) {
      // Georgian / Regency stucco, hipped slate roof, porch columns
      const col = pick(rng, ["#f2ede0", "#efe6d2", "#e9e2d6", "#f4efe4"]);
      lp(F, "box", 0, 0, hz, w, h, d, col);
      lp(F, "box", 0, h, hz, w + 0.4, 0.5, d + 0.4, "#ffffff");
      lp(F, "pyramid", 0, h + 0.5, hz, w * 0.95, 3, d * 0.95, "#5b6470");
      for (const ex of [-1.4, 1.4]) lp(F, "cyl", ex, 0, front + 1.4, 0.45, 3.4, 0.45, "#ffffff");
      lp(F, "box", 0, 3.4, front + 1.2, 3.8, 0.4, 2.6, "#ffffff");
      lp(F, "box", w / 2 - 1.2, h + 0.5, hz, 1, 2.2, 1.8, "#d8d0c0");
    } else if (style === 2) {
      // Modern: stacked boxes, flat roofs, lots of glass
      const col = pick(rng, ["#f4f4f2", "#d9d9d4", "#37393d", "#c9b79c"]);
      lp(F, "box", 0, 0, hz, w, fh, d, col);
      lp(F, "box", w * 0.15, fh, hz - 0.8, w * 0.8, fh, d + 1.6, pick(rng, ["#f4f4f2", "#37393d", "#8b6b4a"]));
      lp(F, "box", w * 0.15, fh * 2, hz - 0.8, w * 0.8 + 0.3, 0.3, d + 1.9, "#2a2c30");
      lp(F, "box", 0, fh, hz, w + 0.3, 0.25, d + 0.3, "#2a2c30");
      lp(F, "winLit", -w * 0.1, 0.3, front + 0.05, w * 0.7, 2.5, 0.1, "#4c6070");
      lp(F, "winLit", w * 0.15, fh + 0.3, hz - 0.8 + (d + 1.6) / 2 + 0.05, w * 0.6, 2.5, 0.1, "#4c6070");
      lp(F, "winLit", -w * 0.1, 0.3, hz - d / 2 - 0.05, w * 0.7, 2.5, 0.1, "#4c6070");
    } else {
      // Victorian: London stock brick, gable to the front, bay window
      const col = pick(rng, ["#c8a46a", "#cdb07a", "#b99a62"]);
      lp(F, "box", 0, 0, hz, w, h, d, col);
      lp(F, "prism", 0, h, hz, d + 1, range(rng, 4.5, 6), w + 0.8, "#4e535a", Math.PI / 2);
      lp(F, "box", w * 0.25, 0, front + 0.9, 3.4, fh * 1.6, 1.8, "#e9e2d6");
      lp(F, "winLit", w * 0.25, 0.8, front + 1.82, 2.8, 2, 0.1, "#3b4654");
      lp(F, "box", -w / 2 + 1, h + 1.5, hz, 1, 3.5, 1.4, "#8e4430");
    }
    if (style !== 2) {
      windows(F, 0, hz, w, d, floors, fh, 0.2, 0.55);
      lp(F, "box", style === 3 ? -w * 0.2 : 0, 0, front + 0.06, 1.3, 2.4, 0.14, pick(rng, ["#1f3b2d", "#1d2b4a", "#5a1e2b", "#111111"]));
    }
    // back garden: pool + terrace + loungers, or a pond/greenhouse
    const back = hz - d / 2;
    const poolZ = (back + -h2) / 2;
    const room = back + h2; // depth of the back garden
    if (room > 6.5 && rng() < 0.85) {
      const pw = Math.min(w * 0.9, range(rng, 7, 10));
      const pd = Math.min(room - 3.2, range(rng, 3.4, 4.6));
      const px = range(rng, -s * 0.12, s * 0.12);
      lflat(F, px, poolZ, pw + 2.4, pd + 2.4, 0.13, "#e3dccb");
      lp(F, "water", px, 0, poolZ, pw, 0.17, pd, "#38c5e0");
      for (const lx of [-1.2, 0.2]) lp(F, "box", px + pw / 2 + 0.6 + lx * 0, 0.13, poolZ + lx * 1.4, 0.7, 0.35, 1.9, "#ffffff", Math.PI / 2);
      lp(F, "cyl", px - pw / 2 - 0.4, 0, poolZ - pd / 2 - 0.6, 0.08, 2.4, 0.08, "#dddddd");
      lp(F, "cone", px - pw / 2 - 0.4, 2.0, poolZ - pd / 2 - 0.6, 2.8, 0.7, 2.8, pick(rng, ["#ff6a1a", "#ffffff", "#2f5d8a", "#e2b33a"]));
      bump("pools");
      if (rng() < 0.35) person(F.x(px, poolZ), 0.13, F.z(px, poolZ), F.ry, { dx: Math.sin(F.ry + Math.PI / 2) * pw * 0.35, dz: Math.cos(F.ry + Math.PI / 2) * pw * 0.35, phase: rng() * 6, speed: 0.25, hop: 0.05 }, { scale: 0.85, legs: "#1f2a44" });
    } else {
      lp(F, "box", s * 0.2, 0, poolZ, 3, 2.4, 4.5, "#cfe3e0");
      lp(F, "prism", s * 0.2, 2.4, poolZ, 3.1, 1, 4.6, "#e8f2f0", Math.PI / 2);
    }
    // garden trees
    for (const [tx, tz] of [[-h2 + 2.5, -h2 + 2.5], [h2 - 2.5, -h2 + 2.5], [h2 - 2.5, h2 - 3.2]] as const)
      if (rng() < 0.75) tree(F.x(tx, tz), 0, F.z(tx, tz), range(rng, 0.55, 0.8), pick(rng, ["oak", "oak", "birch", "pine"]), rng() < 0.25);
    bump("villas");
  }

  // ===========================================================================================
  // 3. The heath: ponds, swimmers, trees, paths, kites, dog walkers, viewpoint, observatory.
  for (const p of PONDS) {
    put("pond", p.x, 0, p.z, p.rx * 2, 0.15, p.rz * 2, 0, "#3f7f8f");
    // reed clumps round the edge
    for (let k = 0; k < 18; k++) {
      const a = rng() * Math.PI * 2;
      const m = range(rng, 0.92, 1.06);
      put("cone", p.x + Math.cos(a) * p.rx * m, 0, p.z + Math.sin(a) * p.rz * m, 1.4, range(rng, 1.2, 2), 1.4, rng() * 6, pick(rng, ["#6f8a3a", "#8a8a4a", "#5d7a35"]));
    }
    if (p.swim) {
      // jetty from the north bank, a lifeguard hut and a life ring
      const jx = p.x + p.rx * 0.2;
      const jz = p.z - p.rz;
      put("box", jx, 0.22, jz + 3, 2.2, 0.2, 9, 0, "#8a6a48");
      for (const dx of [-1, 1]) for (const dz of [0, 3, 6]) put("cyl", jx + dx, 0, jz + dz, 0.2, 0.35, 0.2, 0, "#5a4030");
      put("box", jx - 5, 0, jz - 4, 3, 2.6, 2.6, 0, "#e9e2d6");
      put("prism", jx - 5, 2.6, jz - 4, 3.3, 1.2, 2.9, 0, "#8e4430");
      put("cyl", jx + 1.6, 0.6, jz + 1, 0.9, 0.2, 0.9, 0, "#ff6a1a");
      person(jx - 5, 0, jz - 2.2, 0, {}, { shirt: "#c0392b", legs: "#f2c14e" });
      const n = p.rx > 20 ? 14 : 10;
      for (let k = 0; k < n; k++) {
        // circle centre well inside the ellipse, radius small enough to stay in the water
        const a = rng() * Math.PI * 2;
        const m = Math.sqrt(rng()) * 0.5;
        const cx = p.x + Math.cos(a) * p.rx * m;
        const cz = p.z + Math.sin(a) * p.rz * m;
        const r = range(rng, 1, Math.min(p.rx, p.rz) * 0.35);
        const motion = { dx: r, hop: 0.06, phase: rng() * 6.28, speed: range(rng, 0.08, 0.16) * (rng() < 0.5 ? 1 : -1), mode: 2 as const };
        anim({ pool: "aBody", x: cx, y: 0.05, z: cz, sx: 0.55, sy: 0.18, sz: 0.4, ry: 0, color: pick(rng, SKIN), ...motion });
        anim({ pool: "aHead", x: cx, y: 0.32, z: cz, sx: 0.32, sy: 0.3, sz: 0.34, ry: 0, color: pick(rng, ["#ff6a1a", "#ffffff", "#f2c14e", "#d96c9a", "#2f5d8a"]), ...motion });
        bump("swimmers");
      }
    } else {
      for (let k = 0; k < 6; k++) {
        const a = rng() * Math.PI * 2;
        const m = Math.sqrt(rng()) * 0.45;
        const cx = p.x + Math.cos(a) * p.rx * m;
        const cz = p.z + Math.sin(a) * p.rz * m;
        const motion = { dx: range(rng, 1, Math.min(p.rx, p.rz) * 0.4), hop: 0.02, phase: rng() * 6.28, speed: range(rng, 0.05, 0.1), mode: 2 as const };
        const swan = k < 2;
        const col = swan ? "#f6f6f2" : pick(rng, ["#5b4a3a", "#6b5a3a", "#3c6b4a"]);
        anim({ pool: "aBody", x: cx, y: 0.15, z: cz, sx: swan ? 0.6 : 0.35, sy: 0.35, sz: swan ? 1 : 0.55, ry: 0, color: col, ...motion });
        anim({ pool: "aHead", x: cx, y: swan ? 0.9 : 0.55, z: cz, sx: 0.2, sy: swan ? 0.5 : 0.22, sz: 0.2, ry: 0, color: swan ? "#f6f6f2" : "#2f5a3c", ...motion });
        bump("birds");
      }
      if (p.name.startsWith("Model")) {
        for (let k = 0; k < 3; k++) {
          const motion = { dx: range(rng, 2, 5), phase: rng() * 6, speed: 0.3, mode: 2 as const, hop: 0.02 };
          anim({ pool: "aBody", x: p.x + range(rng, -3, 3), y: 0.15, z: p.z + range(rng, -2, 2), sx: 0.5, sy: 0.25, sz: 1.2, ry: 0, color: "#ffffff", ...motion });
          anim({ pool: "aKite", x: p.x, y: 1.0, z: p.z, sx: 0.06, sy: 1.2, sz: 0.7, ry: 0, color: pick(rng, ["#ff6a1a", "#ffffff"]), ...motion });
        }
      }
    }
    const lx = p.x + p.rx + 2;
    signs.push({ text: p.name, bg: "#1f3b2d", fg: "#f2e6c8", x: lx, y: surfaceAt(lx, p.z) + 1.2, z: p.z, w: 3.2, h: 0.7, ry: Math.PI / 2 });
    put("box", lx - 0.05, surfaceAt(lx, p.z), p.z, 0.12, 1.2, 0.12, 0, "#3a2a1e");
  }

  // Observatory on its hill.
  const obsY = surfaceAt(OBSERVATORY.x, OBSERVATORY.z);
  {
    const { x, z } = OBSERVATORY;
    put("cyl", x, 0, z, 26, obsY + 0.3, 26, 0, "#b9b2a3");
    put("cyl", x, obsY + 0.3, z, 12, 5.2, 12, 0, "#e9e1cf");
    put("cyl", x, obsY + 5.5, z, 12.8, 0.4, 12.8, 0, "#bfb6a2");
    const F = new Frame(x, z, Math.PI * 0.15, obsY + 0.3);
    lp(F, "box", 0, 0, 8.5, 6, 4.2, 6, "#e9e1cf");
    lp(F, "prism", 0, 4.2, 8.5, 6.4, 1.8, 6.4, "#8e4430");
    lp(F, "box", 0, 0, 11.55, 1.4, 2.4, 0.12, "#1d2b4a");
    for (const ex of [-2, 2]) lp(F, "winLit", ex, 1.4, 11.55, 1, 1.4, 0.12, "#2b3440");
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      put(k % 2 ? "winLit" : "winDark", x + Math.cos(a) * 6.02, obsY + 2.2, z + Math.sin(a) * 6.02, 0.12, 1.3, 0.8, -a, "#2b3440");
    }
    sign(F, 0, 4.6, 11.7, 5.6, 1, "HAMPSTEAD OBSERVATORY", "#1d2b4a", "#f2e6c8");
    for (let k = 0; k < 4; k++) person(F.x(range(rng, -4, 4), range(rng, 12, 16)), surfaceAt(F.x(0, 14), F.z(0, 14)), F.z(range(rng, -4, 4), 14), F.ry + Math.PI, { dx: 0.4, phase: rng() * 6, speed: 0.3 });
    bump("observatory");
  }

  // Viewpoint (Parliament Hill): bench facing south over the city, a coin telescope, kite flyers.
  {
    const { x, z } = VIEWPOINT;
    const y = surfaceAt(x, z);
    const F = new Frame(x, z + 3, 0, y - 0.15);
    bench(F, -1.2, 0);
    bench(F, 1.4, 0.3);
    lflat(F, 0, 1.2, 7, 2.5, 0.19, "#cfc3a8");
    person(F.x(-1.6, 0.1), F.y0 + 0.05, F.z(-1.6, 0.1), 0, {}, { sit: true });
    person(F.x(-0.7, 0.1), F.y0 + 0.05, F.z(-0.7, 0.1), 0, {}, { sit: true });
    // coin telescope
    lp(F, "cyl", 4, 0, 1.2, 0.25, 1.2, 0.25, "#2f5d6a");
    lp(F, "cyl", 4, 1.25, 1.2, 0.35, 0.9, 0.35, "#2f5d6a", 0, Math.PI / 2 - 0.25);
    person(F.x(4, 0.2), F.y0, F.z(4, 0.2), 0, {});
    sign(F, -5, 1.1, 1.3, 3, 0.9, "PARLIAMENT HILL", "#1f3b2d", "#f2e6c8");
    lp(F, "box", -5, 0, 1.25, 0.14, 1.1, 0.14, "#3a2a1e");
    // kite flyers: upwind of the summit, kites drift downwind (with WIND)
    for (let k = 0; k < 16; k++) {
      const a = rng() * Math.PI * 2;
      const r = range(rng, 6, 34);
      const fx = x + Math.cos(a) * r;
      const fz = z + Math.sin(a) * r;
      if (inPond(fx, fz, 4) || roadDistance(fx, fz, SEGS) < 12) continue;
      const fy = surfaceAt(fx, fz);
      const ry = Math.atan2(WX, WZ);
      person(fx, fy, fz, ry, { dx: 0.25 * WZ, dz: -0.25 * WX, phase: rng() * 6, speed: 0.5 });
      const L = range(rng, 18, 34);
      const elev = range(rng, 0.65, 1.05);
      const hand: [number, number, number] = [fx + WX * 0.4, fy + 1.4, fz + WZ * 0.4];
      const kx = hand[0] + WX * L * Math.cos(elev);
      const ky = hand[1] + L * Math.sin(elev);
      const kz = hand[2] + WZ * L * Math.cos(elev);
      const sway = range(rng, 1.5, 3.2);
      const motion = { dx: WZ * sway, dz: -WX * sway, hop: range(rng, 0.8, 1.6), phase: rng() * 6.28, speed: range(rng, 0.5, 0.9), mode: 1 as const };
      anim({ pool: "aKite", x: kx, y: ky, z: kz, sx: 1.4, sy: 1.8, sz: 0.08, ry, color: pick(rng, ["#ff6a1a", "#e23b3b", "#f2c14e", "#2f8ad6", "#7ac143", "#d96c9a", "#6c4f9c"]), ...motion });
      anim({ pool: "aKite", x: kx, y: ky - 1.6, z: kz, sx: 0.5, sy: 0.6, sz: 0.04, ry, color: pick(rng, ["#ffffff", "#f2c14e"]), ...motion, phase: motion.phase - 0.3 });
      anim({ pool: "aString", x: hand[0], y: hand[1], z: hand[2], sx: 0.03, sy: 1, sz: 0.03, ry: 0, color: "#eeeeee", to: [kx, ky, kz], ...motion });
      bump("kites");
    }
  }

  // Heath paths: benches beside them, dog walkers, joggers and strollers along them.
  {
    const pathSegs = PATHS.flatMap((p) => p.slice(1).map((q, i) => [p[i], q] as const));
    for (let k = 0; k < 70; k++) {
      const [[ax, az], [bx, bz]] = pick(rng, pathSegs);
      const t = range(rng, 0.2, 0.8);
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const kind = rng();
      const amp = Math.min(len * 0.35, kind < 0.2 ? range(rng, 10, 18) : range(rng, 4, 10));
      const side = rng() < 0.5 ? -0.7 : 0.7;
      const cx = ax + (bx - ax) * t - uz * side;
      const cz = az + (bz - az) * t + ux * side;
      if (inPond(cx, cz, 3) || inPond(cx + ux * amp, cz + uz * amp, 2) || inPond(cx - ux * amp, cz - uz * amp, 2)) continue;
      const y0 = surfaceAt(cx - ux * amp, cz - uz * amp);
      const y1 = surfaceAt(cx + ux * amp, cz + uz * amp);
      const yc = surfaceAt(cx, cz);
      const motion = { dx: ux * amp, dy: (y1 - y0) / 2, dz: uz * amp, phase: rng() * 6.28 };
      const ry = Math.atan2(ux, uz);
      const y = Math.max(yc, (y0 + y1) / 2);
      if (kind < 0.2) {
        person(cx, y, cz, ry, { ...motion, hop: 0.16, speed: range(rng, 0.25, 0.4) }, { shirt: pick(rng, ["#ff6a1a", "#e23b3b", "#4fb0c6", "#f2c14e"]), legs: "#1f2a44" });
        bump("joggers");
      } else if (kind < 0.65) {
        const m = { ...motion, hop: 0.05, speed: range(rng, 0.1, 0.18) };
        person(cx, y, cz, ry, m);
        dog(cx + uz * 1.1, y, cz - ux * 1.1, ry, m);
        if (rng() < 0.3) dog(cx + uz * 1.6 + ux, y, cz - ux * 1.6 + uz, ry, m);
      } else {
        const m = { ...motion, hop: 0.05, speed: range(rng, 0.08, 0.15) };
        person(cx, y, cz, ry, m);
        if (rng() < 0.6) person(cx - uz * 0.8, y, cz + ux * 0.8, ry, m);
      }
    }
    // benches along the paths
    for (let k = 0; k < 18; k++) {
      const [[ax, az], [bx, bz]] = pick(rng, pathSegs);
      const t = range(rng, 0.2, 0.8);
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const x = ax + (bx - ax) * t + nx * 2.4;
      const z = az + (bz - az) * t + nz * 2.4;
      if (inPond(x, z, 3)) continue;
      const F = new Frame(x, z, Math.atan2(-nx, -nz), surfaceAt(x, z) - 0.1);
      bench(F, 0, 0);
      if (rng() < 0.5) person(F.x(-0.4, 0.05), F.y0 + 0.1, F.z(-0.4, 0.05), F.ry, {}, { sit: true });
    }
    // picnics on the grass
    for (let k = 0; k < 14; k++) {
      const x = range(rng, HEATH.minX + 30, HEATH.maxX - 30);
      const z = range(rng, HEATH.minZ + 30, HEATH.maxZ - 20);
      if (inPond(x, z, 6) || pathDistance(x, z) < 4 || Math.hypot(x - OBSERVATORY.x, z - OBSERVATORY.z) < 18) continue;
      const y = surfaceAt(x, z);
      const F = new Frame(x, z, rng() * 6, y + 0.02);
      lflat(F, 0, 0, 2.4, 2, 0.04, pick(rng, ["#e23b3b", "#2f8ad6", "#f2c14e", "#ffffff", "#7ac143"]));
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        person(F.x(Math.cos(a) * 1.5, Math.sin(a) * 1.3), y, F.z(Math.cos(a) * 1.5, Math.sin(a) * 1.3), F.ry + Math.PI / 2 - a, {}, { sit: true });
      }
      lp(F, "box", 0.3, 0.04, 0.1, 0.6, 0.35, 0.4, "#8a6a48");
      bump("picnics");
    }
    // trees and gorse: woodland to the north and west, scattered oaks elsewhere
    let tries = 0;
    let trees = 0;
    while (trees < 280 && tries < 6000) {
      tries++;
      const x = range(rng, HEATH.minX + 3, HEATH.maxX - 3);
      const z = range(rng, HEATH.minZ + 3, HEATH.maxZ - 3);
      const woodland = z < -893 || x < -350 || (x > -70 && z < -840);
      if (rng() > (woodland ? 0.85 : 0.18)) continue;
      if (roadDistance(x, z, SEGS) < 9 || inPond(x, z, 5) || pathDistance(x, z) < 3.5) continue;
      if (Math.hypot(x - VIEWPOINT.x, z - VIEWPOINT.z) < 42 || Math.hypot(x - OBSERVATORY.x, z - OBSERVATORY.z) < 17) continue;
      const y = surfaceAt(x, z) - 0.2;
      const r = rng();
      if (r < 0.12) {
        put("foliage", x, y + 0.6, z, range(rng, 2, 3.5), range(rng, 1.2, 1.8), range(rng, 2, 3.5), rng() * 6, pick(rng, ["#6f8a3a", "#8a9a3a", "#c9a23a"]));
        continue;
      }
      tree(x, y, z, range(rng, 0.8, 1.3), r < 0.65 ? "oak" : r < 0.85 ? "birch" : "pine", rng() < 0.18);
      trees++;
    }
  }

  // ===========================================================================================
  // 4. Highgate-style Victorian cemetery: walls, gate, chapel, Circle of Lebanon, Egyptian Avenue.
  {
    const C = CEMETERY;
    const cx = (C.minX + C.maxX) / 2;
    const gateZ = -880;
    const wall = "#7d7468";
    put("box", cx, 0, C.minZ, C.maxX - C.minX, 2.4, 0.7, 0, wall);
    put("box", cx, 0, C.maxZ, C.maxX - C.minX, 2.4, 0.7, 0, wall);
    put("box", C.minX, 0, (C.minZ + C.maxZ) / 2, 0.7, 2.4, C.maxZ - C.minZ, 0, wall);
    put("box", C.maxX, 0, (C.minZ + gateZ - 4) / 2, 0.7, 2.4, gateZ - 4 - C.minZ, 0, wall);
    put("box", C.maxX, 0, (gateZ + 4 + C.maxZ) / 2, 0.7, 2.4, C.maxZ - gateZ - 4, 0, wall);
    for (const dz of [-4.3, 4.3]) {
      put("box", C.maxX, 0, gateZ + dz, 1.4, 4.2, 1.4, 0, "#9a9080");
      put("pyramid", C.maxX, 4.2, gateZ + dz, 1.6, 1.2, 1.6, 0, "#6f675b");
    }
    put("box", C.maxX, 4.2, gateZ, 0.5, 0.6, 8, 0, "#2a2a2a");
    signs.push({ text: "HIGHGATE CEMETERY", bg: "#2a2a2a", fg: "#e8c46a", x: C.maxX + 0.3, y: 4.5, z: gateZ, w: 6.5, h: 0.8, ry: Math.PI / 2 });
    // paths (gravel)
    const gravel = "#bdb3a0";
    const lebanon = { x: -520, z: gateZ };
    flat("flat", (C.maxX + lebanon.x) / 2 + 6, gateZ, C.maxX - lebanon.x - 12, 4, 0.1, 0, gravel);
    flat("flatDisc", lebanon.x, lebanon.z, 34, 34, 0.1, 0, gravel);
    flat("flatDisc", lebanon.x, lebanon.z, 26, 26, 0.13, 0, "#5d7a45");
    const egyptX = -566;
    flat("flat", egyptX, (C.minZ + C.maxZ) / 2, 4, C.maxZ - C.minZ - 4, 0.1, 0, gravel);
    flat("flat", (C.minX + lebanon.x) / 2 - 2, gateZ, lebanon.x - C.minX - 14, 3, 0.1, 0, gravel);
    for (const pz of [-838, -926]) flat("flat", cx, pz, C.maxX - C.minX - 4, 2.6, 0.1, 0, gravel);
    // Cedar of Lebanon in the circle
    tree(lebanon.x, 0, lebanon.z, 1.2, "cedar");
    // mausoleums round the circle (facing in) and along the Egyptian Avenue (facing the path)
    const mausoleum = (F: Frame) => {
      const col = pick(rng, ["#a39e92", "#8f8a7e", "#b9b2a3", "#7f7a70"]);
      const w = range(rng, 3.4, 4.6);
      const d = range(rng, 4, 5.5);
      const h = range(rng, 3, 4.2);
      lp(F, "box", 0, 0, 0, w + 0.6, 0.4, d + 0.6, "#8a857a");
      lp(F, "box", 0, 0.4, 0, w, h, d, col);
      const roof = rng();
      if (roof < 0.4) lp(F, "prism", 0, h + 0.4, 0, d + 0.3, 1.6, w + 0.3, col, Math.PI / 2);
      else if (roof < 0.7) lp(F, "pyramid", 0, h + 0.4, 0, w + 0.2, 2.4, d + 0.2, col);
      else lp(F, "dome", 0, h + 0.4, 0, w * 0.9, w * 0.9, w * 0.9, "#7d8a86");
      for (const ex of [-w / 2 + 0.4, w / 2 - 0.4]) lp(F, "cyl", ex, 0.4, d / 2 + 0.5, 0.4, h - 0.2, 0.4, "#c9c2b2");
      lp(F, "box", 0, 0.4 + h - 0.3, d / 2 + 0.5, w, 0.4, 1, col);
      lp(F, "box", 0, 0.4, d / 2 + 0.02, 1.2, 2.2, 0.1, "#1e2522");
      bump("mausoleums");
    };
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      if (Math.abs(Math.cos(a)) > 0.93) continue; // keep the avenue openings
      const F = new Frame(lebanon.x + Math.cos(a) * 21, lebanon.z + Math.sin(a) * 21, Math.atan2(-Math.cos(a), -Math.sin(a)));
      mausoleum(F);
    }
    for (let zz = C.maxZ - 10; zz > C.minZ + 8; zz -= 8) {
      if (Math.abs(zz - gateZ) < 6) continue;
      mausoleum(new Frame(egyptX - 6, zz, Math.PI / 2));
      mausoleum(new Frame(egyptX + 6, zz, -Math.PI / 2));
    }
    // chapel by the gate
    {
      const F = new Frame(-452, -858, Math.PI / 2);
      lp(F, "box", 0, 0, 0, 7, 6, 13, "#a39e92");
      lp(F, "prism", 0, 6, 0, 13.4, 3.6, 7.6, "#4e535a", Math.PI / 2);
      lp(F, "box", 0, 6, 6.5, 1.4, 4.5, 1.4, "#a39e92");
      lp(F, "pyramid", 0, 10.5, 6.5, 1.6, 2.5, 1.6, "#4e535a");
      for (let k = 0; k < 3; k++) for (const sd of [1, -1]) lp(F, "winLit", sd * 3.55, 1.8, -4 + k * 4, 0.12, 2.6, 1, "#5a3a7a");
      lp(F, "box", 0, 0, 6.55, 1.6, 2.6, 0.12, "#3a2a1e");
    }
    // graves on a jittered grid
    const avoid = (x: number, z: number) =>
      Math.abs(z - gateZ) < 4.5 ||
      Math.hypot(x - lebanon.x, z - lebanon.z) < 28 ||
      Math.abs(x - egyptX) < 11.5 ||
      Math.abs(z + 838) < 2.8 || Math.abs(z + 926) < 2.8 ||
      (x > -462 && z > -868 && z < -848);
    for (let x = C.minX + 3; x < C.maxX - 2.5; x += 2.7)
      for (let z = C.minZ + 3; z < C.maxZ - 2.5; z += 3.3) {
        const gx = x + range(rng, -0.4, 0.4);
        const gz = z + range(rng, -0.3, 0.3);
        if (avoid(gx, gz) || rng() > 0.62) continue;
        const stone = pick(rng, ["#8a8a86", "#9a978f", "#6f6d68", "#b5b2a8", "#6d7563", "#7c7a72"]);
        const tilt = rng() < 0.4 ? range(rng, -0.22, 0.22) : 0;
        const ry = range(rng, -0.12, 0.12);
        const r = rng();
        if (r < 0.5) put("box", gx, 0, gz, 0.75, range(rng, 0.7, 1.3), 0.16, ry, stone, tilt);
        else if (r < 0.68) {
          put("box", gx, 0, gz, 0.16, 1.5, 0.16, ry, stone, tilt);
          put("box", gx, 0.95, gz, 0.8, 0.16, 0.16, ry, stone, tilt);
        } else if (r < 0.82) {
          put("box", gx, 0, gz, 1.1, 0.5, 2.1, ry, stone);
          put("box", gx, 0, gz - 1.05, 0.8, 0.9, 0.16, ry, stone);
        } else if (r < 0.93) {
          put("box", gx, 0, gz, 0.9, 0.8, 0.9, ry, stone);
          put("pyramid", gx, 0.8, gz, 0.55, range(rng, 2.4, 4), 0.55, ry, stone);
          bump("obelisks");
        } else {
          put("box", gx, 0, gz, 0.8, 1.2, 0.8, ry, stone);
          put("sphere", gx, 1.75, gz, 0.6, 1.1, 0.5, ry, "#e4e1d8");
          put("box", gx, 1.6, gz - 0.25, 1.3, 0.7, 0.08, ry, "#e4e1d8", 0.3);
          bump("angels");
        }
        bump("graves");
      }
    // yews and overgrown trees, ivy-dark
    for (let k = 0; k < 90; k++) {
      const x = range(rng, C.minX + 3, C.maxX - 3);
      const z = range(rng, C.minZ + 3, C.maxZ - 3);
      if (Math.abs(x - egyptX) < 3 || Math.abs(z - gateZ) < 3 || Math.hypot(x - lebanon.x, z - lebanon.z) < 13) continue;
      tree(x, 0, z, range(rng, 0.8, 1.3), rng() < 0.4 ? "yew" : "oak", rng() < 0.15);
    }
    // a few visitors
    for (let k = 0; k < 10; k++) {
      const alongX = rng() < 0.5;
      const z = alongX ? gateZ + range(rng, -1, 1) : range(rng, C.minZ + 10, C.maxZ - 10);
      const x = alongX ? range(rng, -500, -440) : egyptX + range(rng, -1, 1);
      const amp = range(rng, 3, 8);
      person(x, 0, z, alongX ? Math.PI / 2 : 0, { dx: alongX ? amp : 0, dz: alongX ? 0 : amp, phase: rng() * 6, speed: 0.08, hop: 0.04 }, { shirt: pick(rng, ["#333740", "#5b4a3a", "#2f5d8a", "#6c4f9c"]) });
    }
  }

  // ===========================================================================================
  // 5. Cricket green with a match on, and a pavilion.
  {
    const { x, z, r } = CRICKET;
    flat("flatDisc", x, z, r * 2, r * 2, 0.1, 0, "#78b65a");
    for (let k = -3; k <= 3; k++) flat("flat", x, z + k * 8, Math.sqrt(Math.max(0, r * r - (k * 8) ** 2)) * 2 - 1, 4, 0.12, 0, "#86c266");
    flat("flat", x - 9, z, 22, 3.2, 0.14, 0, "#d8c99a");
    for (const ex of [-19, 1]) {
      flat("flat", x + ex + 0.6, z, 0.08, 3, 0.16, 0, "#ffffff");
      for (const dz of [-0.12, 0, 0.12]) put("box", x + ex, 0, z + dz, 0.05, 0.72, 0.05, 0, "#f4efe0");
    }
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      put("box", x + Math.cos(a) * (r - 1), 0, z + Math.sin(a) * (r - 1), 0.25, 0.12, 1.5, -a, "#ffffff");
    }
    for (const ex of [-r - 2, r + 2]) put("box", x + ex, 0, z, 0.4, 3.6, 7, 0, "#f6f6f2");
    const WHITE = { shirt: "#f4f2ea", legs: "#f4f2ea" };
    // striker, non-striker, keeper, bowler running in, ball, umpires
    person(x + 1.5, 0, z + 0.3, -Math.PI / 2, { dx: 0, hop: 0.02, speed: 1.2 }, { ...WHITE, head: "#1d2b4a" });
    person(x - 19.6, 0, z - 1.2, -Math.PI / 2, {}, { ...WHITE, head: "#1d2b4a" });
    person(x + 4, 0, z, -Math.PI / 2, { dx: 0.4, speed: 0.9 }, WHITE);
    person(x - 26, 0, z + 0.6, Math.PI / 2, { dx: 6, hop: 0.18, speed: 0.55, phase: 0 }, WHITE);
    anim({ pool: "aHead", x: x - 9.5, y: 0.25, z: z + 0.2, sx: 0.14, sy: 0.14, sz: 0.14, ry: 0, color: "#b01e1e", dx: 10, hop: 1.4, speed: 1.1, phase: 0.6 });
    person(x - 21, 0, z - 1.4, Math.PI / 2, {}, { shirt: "#ffffff", legs: "#2c3340", head: "#111111" });
    person(x + 1, 0, z + 15, Math.PI, {}, { shirt: "#ffffff", legs: "#2c3340", head: "#111111" });
    // fielders
    for (const [fx, fz] of [[6, -3], [7, -6], [-2, -16], [-12, -22], [-24, 14], [-12, 20], [2, 18], [16, 10], [20, -14], [-28, -8]] as const)
      person(x + fx, 0, z + fz, Math.atan2(-fx, -fz), { dx: 0.35, dz: 0.2, speed: range(rng, 0.2, 0.4), phase: rng() * 6, hop: 0.03 }, WHITE);
    // spectators on benches and deckchairs along the boundary
    for (let k = 0; k < 16; k++) {
      const a = Math.PI * (0.15 + 0.7 * (k / 15)) * (k % 2 ? 1 : -1) + Math.PI / 2;
      const sx = x + Math.cos(a) * (r + 3);
      const sz = z + Math.sin(a) * (r + 3);
      if (roadDistance(sx, sz, SEGS) < 7) continue;
      const F = new Frame(sx, sz, Math.atan2(x - sx, z - sz));
      lp(F, "box", 0, 0.3, 0, 0.8, 0.08, 1, pick(rng, ["#ff6a1a", "#2f5d8a", "#e23b3b", "#f2c14e", "#3c8d5a"]), 0, -0.4);
      person(sx, 0.05, sz, F.ry, {}, { sit: true });
    }
    // pavilion
    const F = new Frame(-439, -794, -Math.PI / 2);
    lp(F, "box", 0, 0, 1, 16, 0.6, 12, "#a9907a");
    lp(F, "box", 0, 0.6, -1, 15, 4.2, 7, "#f6f4ee");
    lp(F, "prism", 0, 4.8, -1, 16.4, 3, 8.4, "#2f5a3c");
    lp(F, "box", 0, 4.8, 3.3, 16, 0.3, 3.4, "#2f5a3c");
    for (const ex of [-7, -2.5, 2.5, 7]) lp(F, "cyl", ex, 0.6, 4.6, 0.25, 4.2, 0.25, "#ffffff");
    lp(F, "glow", 0, 6.2, 3.3, 1.2, 1.2, 0.1, "#f6f0dc");
    windows(F, 0, -1, 15, 7, 1, 4, 0.8, 0.6, 1.8, false);
    lp(F, "cyl", 6.5, 7.8, -1, 0.1, 5, 0.1, "#dddddd");
    lp(F, "box", 7.2, 11.8, -1, 1.4, 0.9, 0.05, "#ff6a1a");
    for (let k = 0; k < 5; k++) person(F.x(-6 + k * 2.6, 3.4), 0.6, F.z(-6 + k * 2.6, 3.4), F.ry, {}, { sit: true, shirt: k % 2 ? "#f4f2ea" : pick(rng, CLOTHES) });
    sign(F, 0, 3.9, 2.55, 6, 0.8, "HAMPSTEAD CC", "#2f5a3c", "#f6f4ee");
    // scoreboard by the south lane
    const S = new Frame(x - 18, -738, Math.PI);
    lp(S, "box", 0, 0, 0, 6.4, 3.4, 0.6, "#1f3b2d");
    lp(S, "box", -2.8, 0, 0, 0.3, 1, 0.3, "#3a2a1e");
    sign(S, 0, 2.2, 0.32, 6, 2, "HCC 187/4  OV 41", "#1f3b2d", "#ffffff");
    bump("cricket");
  }

  // ===========================================================================================
  // 6. Lawn tennis club: three courts with nets, a fence and rallies.
  {
    const T = TENNIS;
    const tz = (T.minZ + T.maxZ) / 2;
    flat("flat", (T.minX + T.maxX) / 2, tz, T.maxX - T.minX, T.maxZ - T.minZ, 0.1, 0, "#3f7d5a");
    for (const [k, cx] of [-604, -590, -576].entries()) {
      flat("flat", cx, tz, 10.97, 23.77, 0.13, 0, k === 1 ? "#c4673a" : "#3b6db0");
      const L = "#ffffff";
      for (const ex of [-5.48, 5.48, -4.11, 4.11]) flat("flat", cx + ex, tz, 0.06, 23.77, 0.15, 0, L);
      for (const ez of [-11.88, 11.88]) flat("flat", cx, tz + ez, 10.97, 0.06, 0.15, 0, L);
      for (const ez of [-6.4, 6.4]) flat("flat", cx, tz + ez, 8.23, 0.06, 0.15, 0, L);
      flat("flat", cx, tz, 0.06, 12.8, 0.15, 0, L);
      put("box", cx, 0, tz, 12.6, 0.95, 0.05, 0, "#222222");
      put("box", cx, 0.92, tz, 12.6, 0.08, 0.07, 0, "#ffffff");
      for (const ex of [-6.3, 6.3]) put("cyl", cx + ex, 0, tz, 0.12, 1.07, 0.12, 0, "#2a2a2a");
      const doubles = k === 2;
      const ph = rng() * 6.28;
      for (const [ez, n] of [[-11.5, doubles ? 2 : 1], [11.5, doubles ? 2 : 1]] as const)
        for (let i = 0; i < n; i++)
          person(cx + (n === 2 ? (i ? 2.4 : -2.4) : 0), 0.13, tz + ez - Math.sign(ez) * (i ? 5 : 0), ez < 0 ? 0 : Math.PI,
            { dx: 2.6, speed: 1.4, phase: ph + (ez > 0 ? Math.PI : 0), hop: 0.06 }, { shirt: "#ffffff", legs: pick(rng, ["#ffffff", "#1f2a44"]) });
      anim({ pool: "aHead", x: cx, y: 0.6, z: tz, sx: 0.13, sy: 0.13, sz: 0.13, ry: 0, color: "#d8f03a", dz: 11, hop: 2, speed: 1.4, phase: ph });
      bump("tennisCourts");
    }
    // fence: translucent panels round the club, gate gap on the east
    const fh = 3.4;
    const mx = (T.minX + T.maxX) / 2;
    put("fence", mx, 0, T.minZ, T.maxX - T.minX, fh, 0.05, 0, "#2a4a34");
    put("fence", mx, 0, T.maxZ, T.maxX - T.minX, fh, 0.05, 0, "#2a4a34");
    put("fence", T.minX, 0, tz, 0.05, fh, T.maxZ - T.minZ, 0, "#2a4a34");
    put("fence", T.maxX, 0, tz - 6, 0.05, fh, T.maxZ - T.minZ - 12, 0, "#2a4a34");
    for (let x = T.minX; x <= T.maxX + 0.1; x += 5)
      for (const zz of [T.minZ, T.maxZ]) put("cyl", x, 0, zz, 0.1, fh, 0.1, 0, "#1d2b22");
    signs.push({ text: "HEATH LAWN TENNIS CLUB", bg: "#1f3b2d", fg: "#f2e6c8", x: mx, y: fh + 0.6, z: T.maxZ + 0.1, w: 7, h: 0.8, ry: 0 });
    put("box", mx, fh + 0.2, T.maxZ + 0.04, 7.2, 0.9, 0.05, 0, "#1f3b2d");
  }

  // ===========================================================================================
  // 7. Street furniture on every Hampstead lane: Victorian lamps, plane trees, phone and post boxes.
  {
    for (const [name, pts] of Object.entries(HP_LANES)) {
      let acc = 10;
      let side = 1;
      const leafy = name !== "high" && name !== "southlink" && name !== "villagelink";
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        let s = acc;
        for (; s < len; s += 24) {
          side = -side;
          const nx = -uz * side;
          const nz = ux * side;
          const lx = ax + ux * s + nx * 5.7;
          const lz = az + uz * s + nz * 5.7;
          if (roadDistance(lx, lz, SEGS) < 5.5 || !free(lx, lz, 0.3) || lz > SOUTH_LIMIT - 1 || inPond(lx, lz, 1)) continue;
          const F = new Frame(lx, lz, Math.atan2(-nx, -nz));
          lp(F, "cyl", 0, 0, 0, 0.26, 4.8, 0.26, "#1d2622");
          lp(F, "box", 0, 4.6, 0.35, 0.12, 0.12, 0.8, "#1d2622");
          lp(F, "glow", 0, 4.05, 0.75, 0.42, 0.55, 0.42, "#ffd58a");
          lp(F, "pyramid", 0, 4.6, 0.75, 0.55, 0.35, 0.55, "#1d2622");
          bump("lamps");
          if (leafy) {
            const tx = ax + ux * (s + 12) - nx * 7.4;
            const tz = az + uz * (s + 12) - nz * 7.4;
            if (roadDistance(tx, tz, SEGS) >= 7.2 && free(tx, tz, 2.2) && tz < SOUTH_LIMIT - 3 && !inPond(tx, tz, 3) &&
              !(tx > HEATH.minX && tx < HEATH.maxX && tz > HEATH.minZ && tz < HEATH.maxZ && heightAt(tx, tz) > 0.3))
              tree(tx, 0, tz, range(rng, 0.55, 0.7), "oak", rng() < 0.3);
          }
        }
        acc = s - len;
      }
    }
    // red phone boxes and post boxes on the high street and by the roundabout
    for (const [x, z, ry] of [[44, -752, Math.PI], [104, -775, 0], [158, -754, Math.PI]] as const) {
      if (roadDistance(x, z, SEGS) < 5.2 || !free(x, z, 1)) continue;
      put("box", x, 0, z, 1, 2.5, 1, ry, "#c8102e");
      put("winDark", x, 0.9, z, 1.04, 1.3, 1.04, ry, "#c8102e");
      put("dome", x, 2.5, z, 1.05, 0.4, 1.05, ry, "#c8102e");
      put("cyl", x + 1.6, 0, z, 0.55, 1.4, 0.55, 0, "#c8102e");
      bump("phoneBoxes");
    }
  }

  return { parts, anims, signs, observatory: { x: OBSERVATORY.x, y: obsY + 5.7, z: OBSERVATORY.z, r: 6.4 }, counts };
}
