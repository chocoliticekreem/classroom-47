// Pure, seeded downtown layout. No three.js here so it is cheap to test.
// Every block is centred on (cx, cz) with a buildable square of +-13 m.

export type BodyKind = "glass" | "office" | "brick" | "stucco";

/** Axis-aligned box standing on y (base), centred on x/z. */
export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  w: number; // along x
  d: number; // along z
  h: number;
  color: string;
  g: number; // building group: everything with the same g collapses / rebuilds together
}
export interface Body extends BoxSpec {
  kind: BodyKind;
}
/** Pitched roof prism: ridge along local x, rotated by ry about y. */
export interface RoofSpec extends BoxSpec {
  ry: number;
}
/** Shop awning, ry turns local +z to face the street. */
export interface AwningSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  ry: number;
  color: string;
  g: number;
}
export interface TankSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  g: number;
}
export interface AntennaSpec {
  x: number;
  y: number;
  z: number;
  h: number;
  g: number;
}
export interface LandmarkSpec {
  kind: "shard" | "gherkin";
  x: number;
  z: number;
  h: number;
  r: number;
  g: number;
}
export interface CityLayout {
  bodies: Body[];
  trims: BoxSpec[];
  roofs: RoofSpec[];
  shopfronts: BoxSpec[];
  awnings: AwningSpec[];
  acs: BoxSpec[];
  tanks: TankSpec[];
  antennas: AntennaSpec[];
  lights: { x: number; y: number; z: number; g: number }[];
  landmarks: LandmarkSpec[];
  /** Number of building groups; ids are 1..groups. Pushes use the current group (out.groups). */
  groups: number;
}

export const BLOCK_CENTRES = [-140, -100, -60, -20, 20, 60, 100, 140] as const;
export const RESERVED: readonly [number, number][] = [
  [-140, 140], // police
  [140, -140], // hospital
  [-140, -140], // maintenance yard
  [20, 20], // park + clock tower
  [140, 20], // ferris wheel
];
const HALF = 13;
const SHARD_CELL: [number, number] = [-20, -20];
const GHERKIN_CELL: [number, number] = [20, -20];
const HERO_CELL: [number, number] = [-20, 20];

export function cellOf(x: number, z: number): [number, number] | null {
  const snap = (v: number) => BLOCK_CENTRES.find((c) => Math.abs(v - c) <= 16) ?? null;
  const cx = snap(x);
  const cz = snap(z);
  return cx === null || cz === null ? null : [cx, cz];
}

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
const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
const pick = <T,>(r: Rng, arr: readonly T[]) => arr[Math.floor(r() * arr.length)];

export const PALETTE = {
  glass: ["#86b9d9", "#5f9fca", "#a4cfe2", "#74b0a8", "#a9bccc", "#5584ad", "#bcd8e6", "#8fb0c2", "#9aa7c9"],
  office: ["#ece4d4", "#dcd6cb", "#cbd1d6", "#f1e8d0", "#d9c9ae", "#c1c8ce", "#e3d2ba", "#e8dccb"],
  brick: ["#a8452e", "#b9563b", "#913b29", "#c26a40", "#9e4b36", "#b96c4c", "#813b2c", "#a85a3c"],
  stucco: ["#f5ecd9", "#ebd8bf", "#d6e5e0", "#f2dfc6", "#ecc9bf", "#cfdeea", "#f6e7b4", "#e3e8d2"],
  awning: ["#ff6a1a", "#d7263d", "#1b998b", "#2e86ab", "#f4c430", "#3d5a80", "#8e44ad", "#2a9d58", "#e0607e"],
  shopfront: ["#1f3b2d", "#1d2a44", "#5a1f24", "#222222", "#2f4f4f", "#6b3e1f", "#33415c"],
  slate: ["#505a68", "#5c6572", "#6a5b56", "#4a5260"],
  stone: "#e9e1d0",
  chimney: "#8a3d2b",
  cap: "#566370",
} as const;

function emptyLayout(): CityLayout {
  return { bodies: [], trims: [], roofs: [], shopfronts: [], awnings: [], acs: [], tanks: [], antennas: [], lights: [], landmarks: [], groups: 0 };
}

// ---------------------------------------------------------------- roof clutter

function roofProps(out: CityLayout, r: Rng, x: number, z: number, w: number, d: number, top: number, tank: boolean) {
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const aw = range(r, 1.2, 2.2);
    const ad = range(r, 1, 1.6);
    if (w < aw + 2 || d < ad + 2) break;
    out.acs.push({ g: out.groups,
      x: x + range(r, -(w - aw) / 2 + 0.6, (w - aw) / 2 - 0.6),
      z: z + range(r, -(d - ad) / 2 + 0.6, (d - ad) / 2 - 0.6),
      y: top,
      w: aw,
      d: ad,
      h: range(r, 0.8, 1.2),
      color: "#c9ced3",
    });
  }
  if (tank && w > 5 && d > 5) {
    const tr = range(r, 1, 1.4);
    out.tanks.push({ g: out.groups, x: x + range(r, -w / 2 + 2, w / 2 - 2), z: z + range(r, -d / 2 + 2, d / 2 - 2), y: top, r: tr, h: range(r, 2, 2.8) });
  }
}

function antenna(out: CityLayout, x: number, z: number, top: number, h: number) {
  out.antennas.push({ g: out.groups, x, z, y: top, h });
  out.lights.push({ g: out.groups, x, z, y: top + h + 0.3 });
}

/** A tower, optionally stepped, with roof clutter or a mast. */
function tower(out: CityLayout, r: Rng, kind: BodyKind, x: number, z: number, w: number, d: number, h: number, y = 0, mast = false) {
  if (y === 0) out.groups++; // a tower on a podium shares the podium's group
  const color = pick(r, PALETTE[kind]);
  out.bodies.push({ g: out.groups, kind, x, z, y, w, d, h, color });
  let top = y + h;
  let tw = w;
  let td = d;
  if (r() < 0.45 && w > 9 && d > 9) {
    const tiers = 1 + Math.floor(r() * 2);
    for (let t = 0; t < tiers; t++) {
      tw *= range(r, 0.62, 0.78);
      td *= range(r, 0.62, 0.78);
      const th = range(r, 5, 12);
      out.bodies.push({ g: out.groups, kind, x, z, y: top, w: tw, d: td, h: th, color });
      top += th;
    }
  }
  // dark cap so the silhouette reads against the sky
  out.trims.push({ g: out.groups, x, z, y: top, w: tw, d: td, h: 0.6, color: PALETTE.cap });
  top += 0.6;
  if (mast) antenna(out, x, z, top, range(r, 8, 14));
  else roofProps(out, r, x, z, tw, td, top, kind === "office" && r() < 0.5);
  return top;
}

// ---------------------------------------------------------------- block types

function towerBlock(out: CityLayout, r: Rng, cx: number, cz: number, hMin: number, hMax: number) {
  const v = r();
  if (v < 0.45) {
    let y = 0;
    if (r() < 0.55) {
      const ph = range(r, 6, 9);
      out.groups++;
      out.bodies.push({ g: out.groups, kind: "office", x: cx, z: cz, y: 0, w: 2 * HALF, d: 2 * HALF, h: ph, color: pick(r, PALETTE.office) });
      out.trims.push({ g: out.groups, x: cx, z: cz, y: ph, w: 2 * HALF, d: 2 * HALF, h: 0.4, color: PALETTE.stone });
      y = ph + 0.4;
    }
    const w = range(r, 14, 20);
    const d = range(r, 14, 20);
    const ox = range(r, -(HALF - w / 2), HALF - w / 2) * 0.5;
    const oz = range(r, -(HALF - d / 2), HALF - d / 2) * 0.5;
    const h = range(r, hMin, hMax);
    tower(out, r, r() < 0.8 ? "glass" : "office", cx + ox, cz + oz, w, d, h, y, h > 0.85 * hMax);
  } else if (v < 0.8) {
    const alongX = r() < 0.5;
    for (const s of [-1, 1]) {
      const a = range(r, 9.5, 11.5); // width across the split
      const b = range(r, 14, 24); // length along it
      const off = s * (HALF - a / 2);
      const h = range(r, hMin, hMax) * (s < 0 ? 1 : range(r, 0.6, 0.9));
      const kind: BodyKind = r() < 0.75 ? "glass" : "office";
      if (alongX) tower(out, r, kind, cx + off, cz + range(r, -1, 1) * (HALF - b / 2), a, b, h, 0, h > 0.85 * hMax);
      else tower(out, r, kind, cx + range(r, -1, 1) * (HALF - b / 2), cz + off, b, a, h, 0, h > 0.85 * hMax);
    }
  } else {
    const sx = r() < 0.5 ? -1 : 1;
    const sz = r() < 0.5 ? -1 : 1;
    const tw = range(r, 13, 15);
    tower(out, r, "glass", cx + sx * (HALF - tw / 2), cz + sz * (HALF - tw / 2), tw, tw, range(r, hMin, hMax), 0, true);
    // L-shaped office wrapping the rest: two boxes
    const ow = 2 * HALF - tw - 1;
    const oh = range(r, hMin * 0.35, hMin * 0.6);
    tower(out, r, "office", cx - sx * (HALF - ow / 2), cz, ow, 2 * HALF, oh);
    tower(out, r, "office", cx + sx * (HALF - tw / 2), cz - sz * (HALF - (2 * HALF - tw - 1) / 2), tw, 2 * HALF - tw - 1, oh * range(r, 0.7, 1.1));
  }
}

function officeBlock(out: CityLayout, r: Rng, cx: number, cz: number, hMin: number, hMax: number, glassChance: number) {
  const gap = 0.6;
  const plots: [number, number, number, number][] = []; // x0, z0, x1, z1 in block-local
  const v = r();
  const m = range(r, -3, 3);
  if (v < 0.3) {
    if (r() < 0.5) plots.push([-HALF, -HALF, m, HALF], [m, -HALF, HALF, HALF]);
    else plots.push([-HALF, -HALF, HALF, m], [-HALF, m, HALF, HALF]);
  } else if (v < 0.65) {
    const m2 = range(r, -3, 3);
    plots.push([-HALF, -HALF, m, m2], [m, -HALF, HALF, m2], [-HALF, m2, m, HALF], [m, m2, HALF, HALF]);
  } else {
    const m2 = range(r, -3, 3);
    plots.push([-HALF, -HALF, m, HALF], [m, -HALF, HALF, m2], [m, m2, HALF, HALF]);
  }
  for (const [x0, z0, x1, z1] of plots) {
    const w = x1 - x0 - gap;
    const d = z1 - z0 - gap;
    const x = cx + (x0 + x1) / 2 + (x0 === -HALF ? gap / 2 : 0) - (x1 === HALF ? gap / 2 : 0);
    const z = cz + (z0 + z1) / 2 + (z0 === -HALF ? gap / 2 : 0) - (z1 === HALF ? gap / 2 : 0);
    const kind: BodyKind = r() < glassChance ? "glass" : "office";
    tower(out, r, kind, x, z, w, d, range(r, hMin, hMax));
  }
}

/** Victorian terraces and high-street shops around the block edge. */
function terraceBlock(out: CityLayout, r: Rng, cx: number, cz: number) {
  const depth = range(r, 8, 9.5);
  // n = outward facade normal; rows on N/S span the full width, E/W fill the gap between them.
  const sides: { nx: number; nz: number; from: number; to: number }[] = [
    { nx: 0, nz: -1, from: -HALF, to: HALF },
    { nx: 0, nz: 1, from: -HALF, to: HALF },
    { nx: -1, nz: 0, from: -HALF + depth, to: HALF - depth },
    { nx: 1, nz: 0, from: -HALF + depth, to: HALF - depth },
  ];
  let shopsLeft = 1 + Math.floor(r() * 2); // 1-2 shop rows per block
  sides.forEach((s, i) => {
    if (s.to - s.from < 4) return;
    const shops = shopsLeft > 0 && (r() < 0.5 || i >= 4 - shopsLeft);
    if (shops) shopsLeft--;
    const kind: BodyKind = r() < 0.6 ? "brick" : "stucco";
    const floors = shops ? 3 : 2 + Math.floor(r() * 2);
    const rowColor = pick(r, PALETTE[kind]);
    const roofColor = pick(r, PALETTE.slate);
    let u = s.from;
    while (s.to - u > 3.5) {
      let hw = range(r, 5, 7);
      if (s.to - u - hw < 4) hw = s.to - u;
      const along = u + hw / 2;
      const sgn = s.nx + s.nz; // +1 / -1: which way is out
      // shop rows sit 0.3 m back so the protruding shopfront ends exactly at the buildable edge
      const across = (HALF - (shops ? 0.3 : 0) - depth / 2) * sgn;
      const at = (acr: number): [number, number] => [cx + (s.nx !== 0 ? acr : along), cz + (s.nz !== 0 ? acr : along)];
      const [x, z] = at(across);
      const w = s.nx !== 0 ? depth : hw;
      const d = s.nx !== 0 ? hw : depth;
      const h = floors * 3.2 + range(r, -0.2, 0.5);
      const color = r() < 0.7 ? rowColor : pick(r, PALETTE[kind]);
      out.groups++;
      out.bodies.push({ g: out.groups, kind, x, z, y: 0, w, d, h, color });
      const ry = Math.atan2(s.nx, s.nz); // local +z -> outward
      if (shops) {
        // shopfront: ground floor, from inside the body out to the buildable edge
        const [sfx, sfz] = at((HALF - depth / 2) * sgn);
        out.shopfronts.push({ g: out.groups,
          x: sfx,
          z: sfz,
          y: 0,
          w: s.nx !== 0 ? depth : hw - 0.3,
          d: s.nx !== 0 ? hw - 0.3 : depth,
          h: 3.4,
          color: pick(r, PALETTE.shopfront),
        });
        const [ax, az] = at((HALF + 0.75) * sgn);
        out.awnings.push({ g: out.groups, x: ax, z: az, y: 3.3, w: hw - 0.6, ry, color: pick(r, PALETTE.awning) });
        out.trims.push({ g: out.groups, x, z, y: h, w, d, h: 0.7, color: PALETTE.stone }); // parapet
        roofProps(out, r, x, z, w, d, h + 0.7, false);
      } else {
        const rh = range(r, 2.2, 3.2);
        // ridge runs along the street: local x along the row
        const along2 = Math.abs(s.nz) > 0 ? 0 : Math.PI / 2;
        out.roofs.push({ g: out.groups, x, z, y: h, w: hw, d: depth, h: rh, ry: along2, color: roofColor });
        if (r() < 0.85) {
          // chimney stack on the party wall
          const cxo = s.nx !== 0 ? x : x - hw / 2 + 0.6;
          const czo = s.nz !== 0 ? z : z - hw / 2 + 0.6;
          out.trims.push({ g: out.groups, x: cxo, z: czo, y: h, w: 1.1, d: 1.1, h: rh + 1.2, color: PALETTE.chimney });
        }
      }
      u += hw;
    }
  });
}

// ---------------------------------------------------------------- landmarks

function shardBlock(out: CityLayout, r: Rng, cx: number, cz: number) {
  const h = 128;
  out.groups++;
  out.landmarks.push({ g: out.groups, kind: "shard", x: cx, z: cz, h, r: 11 });
  out.lights.push({ g: out.groups, x: cx, z: cz, y: h + 0.5 });
  void r;
}

function gherkinBlock(out: CityLayout, r: Rng, cx: number, cz: number) {
  const h = 82;
  out.groups++;
  out.landmarks.push({ g: out.groups, kind: "gherkin", x: cx, z: cz, h, r: 11 });
  out.trims.push({ g: out.groups, x: cx, z: cz, y: 0, w: 2 * HALF, d: 2 * HALF, h: 0.2, color: PALETTE.stone }); // plaza
  out.lights.push({ g: out.groups, x: cx, z: cz, y: h + 0.6 });
  void r;
}

// ---------------------------------------------------------------- city

export function generateCity(seed = 20261010): CityLayout {
  const out = emptyLayout();
  const r = mulberry32(seed);
  const reserved = new Set(RESERVED.map(([x, z]) => `${x},${z}`));
  for (const cx of BLOCK_CENTRES)
    for (const cz of BLOCK_CENTRES) {
      if (reserved.has(`${cx},${cz}`)) continue;
      const is = (c: [number, number]) => c[0] === cx && c[1] === cz;
      if (is(SHARD_CELL)) shardBlock(out, r, cx, cz);
      else if (is(GHERKIN_CELL)) gherkinBlock(out, r, cx, cz);
      else if (is(HERO_CELL)) {
        // the tallest conventional tower: stepped glass with a mast
        tower(out, r, "glass", cx, cz, 18, 18, 96, 0, true);
      } else {
        const ring = Math.max(Math.abs(cx), Math.abs(cz));
        const v = r();
        if (ring <= 60) {
          if (v < 0.65) towerBlock(out, r, cx, cz, 45, 85);
          else officeBlock(out, r, cx, cz, 24, 48, 0.4);
        } else if (ring <= 100) {
          if (v < 0.5) officeBlock(out, r, cx, cz, 16, 38, 0.2);
          else if (v < 0.75) towerBlock(out, r, cx, cz, 32, 55);
          else terraceBlock(out, r, cx, cz);
        } else {
          if (v < 0.72) terraceBlock(out, r, cx, cz);
          else officeBlock(out, r, cx, cz, 10, 22, 0.05);
        }
      }
    }
  return out;
}
