// Shoreditch layout: pure, seeded data (no three.js), so it can be unit tested.
// Produces building "facades" (boxes shaded by the facade shader), instanced prop "parts", walking people,
// neon signs, murals, the railway viaduct path and the marina, all inside ZONES.shoreditch (+ the seafront).
import { ZONES } from "../../config";
import { SH_ROUNDABOUT, shoreditch } from "../../districts/shoreditch";
import { ROAD_EDGES, ROAD_NODES } from "../../roads";
import { mulberry32, obbOverlap, obbSegDist, pointInObb, toWorld, type OBB, type Seg } from "./geom2d";

export const ZONE = ZONES.shoreditch;
export const WATER_Y = -0.25; // sea level (Ground module)
export const ROAD_CLEAR = 7.3; // (Streetscape puts lamps/neon at 6.6-6.85 m) // building faces stay this far from any road centre line
/** Seafront promenade: a timber boardwalk on piles over the sea, east of the coast road (x = 336, Motorway's). */
export const PROM = { minX: 341, maxX: 352.5, minZ: -532, maxZ: -380, y: 0.45 };
export const VIADUCT = {
  points: [[82, -507], [130, -508], [180, -506], [228, -503], [262, -501]] as [number, number][],
  width: 9,
  deckY: 7.6, // top of the deck slab
  bay: 8,
};
export const STATION = { x: 270, z: -501, w: 12, d: 13, h: 9 };

// ---- Facade kinds (must match the shader in materials.ts)
export const KIND = { warehouse: 0, glass: 1, flats: 2, container: 3, archShop: 4 } as const;

export interface Facade {
  x: number;
  y: number; // base
  z: number;
  w: number; // local x
  h: number;
  d: number; // local z (front face is local +z)
  ry: number;
  color: string;
  kind: number;
  seed: number; // 0..1
  floorH: number;
  bayW: number;
}

export type PoolName =
  | "box" | "prism" | "cyl" | "cone" | "rock" | "tree" | "lamp" | "lampHead" | "crane" | "car" | "bulb"
  | "sailboat" | "motorboat" | "arch" | "glow";

/** One primitive instance. Every geometry has its base at y = 0 and unit size, scaled by sx/sy/sz. */
export interface Part {
  pool: PoolName;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  color: string;
}

export interface Person {
  x: number;
  y: number;
  z: number;
  ry: number; // walking direction = local +z
  range: number; // walks back and forth +-range metres (0 = stands and sways)
  speed: number;
  phase: number;
  color: string;
}

export interface Sign {
  text: string;
  color: string;
  x: number;
  y: number; // centre
  z: number;
  w: number;
  h: number;
  ry: number; // plane faces local +z
  flicker: boolean;
}

export interface Mural {
  design: number;
  x: number;
  y: number; // centre
  z: number;
  w: number;
  h: number;
  ry: number;
}

export interface Building extends OBB {
  facade: Facade;
}

export interface Layout {
  facades: Facade[];
  parts: Part[];
  people: Person[];
  signs: Sign[];
  murals: Mural[];
  buildings: Building[]; // footprints of every facade on the ground (tests, debugging)
  rooftopBars: number;
}

export const MURAL_DESIGNS = 8;

type Rng = () => number;
const pick = <T,>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];
const range = (r: Rng, a: number, b: number) => a + r() * (b - a);

const BRICKS = ["#8e3b2a", "#a14a32", "#7a3324", "#b5643f", "#c9a26b", "#9c5a3c", "#6e2f25", "#b3523a", "#a8583b", "#d0b07a"];
const FLATS = ["#e8e2d6", "#d9c7a7", "#c9cfd4", "#b5643f", "#f0ece4", "#8a8f96", "#2f3540", "#a8b5a0"];
const GLASS = ["#5f8fa8", "#4f7c96", "#6aa0b0", "#3d6a85", "#7fa7b8"];
const CONTAINERS = ["#c0392b", "#1f6fb2", "#2e8b57", "#f39c12", "#7d3c98", "#16a085", "#e67e22", "#34495e", "#d35400", "#ff6a1a", "#f4d03f"];
const CLOTHES = ["#e63946", "#1d3557", "#2a9d8f", "#f4a261", "#264653", "#e9c46a", "#8338ec", "#ff006e", "#3a86ff", "#222222", "#f1faee", "#606c38", "#ff6a1a"];
const UMBRELLAS = ["#ff3fa4", "#39e6ff", "#ffe14d", "#ff6a1a", "#f1faee", "#2a9d8f"];
export const NEON = ["#ff3fa4", "#39e6ff", "#9dff3f", "#ff6a1a", "#b06bff", "#ffe14d", "#ff3b3b"];
const SHOP_TEXTS = [
  "OPEN", "BAR", "VINYL", "TATTOO", "COFFEE", "PIZZA", "TACOS", "RAMEN", "GIN", "DISCO", "ARCADE", "BAGELS",
  "CRAFT BEER", "GALLERY", "STUDIO", "HACKSPACE", "LIVE MUSIC", "VINTAGE", "COCKTAILS", "NOODLES", "RECORDS", "BIKES",
];
const ARCH_TEXTS = ["ARCH BAR", "CLUB", "BREWERY", "CLIMBING", "KARAOKE", "BAKERY", "WINE", "DJ", "GYM", "COMEDY"];

/** Bay layout shared with the facade shader: number of bays and the side margin on a face of width W. */
export function bays(W: number, bayW: number) {
  const nb = Math.max(1, Math.floor((W - 1.2) / bayW));
  return { nb, margin: (W - nb * bayW) / 2 };
}

// ---------------------------------------------------------------------------------------------

function segOf(a: string, b: string): Seg | null {
  const na = ROAD_NODES.get(a);
  const nb = ROAD_NODES.get(b);
  if (!na || !nb) return null;
  return { ax: na.x, az: na.z, bx: nb.x, bz: nb.z };
}

/** Road centre lines near the district (for clearance checks). */
export function nearbyRoads(): Seg[] {
  const out: Seg[] = [];
  for (const e of ROAD_EDGES.values()) {
    const s = segOf(e.a, e.b);
    if (!s) continue;
    const near = (x: number, z: number) => x > ZONE.minX - 60 && x < ZONE.maxX + 60 && z > ZONE.minZ - 60 && z < ZONE.maxZ + 60;
    if (near(s.ax, s.az) || near(s.bx, s.bz)) out.push(s);
  }
  return out;
}

/** The district's own street segments (props line these). */
function districtSegments(): (Seg & { a: string; b: string })[] {
  const out: (Seg & { a: string; b: string })[] = [];
  for (const e of shoreditch.edges) {
    const s = segOf(e.a, e.b);
    if (s) out.push({ ...s, a: e.a, b: e.b });
  }
  return out;
}


export function buildLayout(seed = 2026): Layout {
  const rng = mulberry32(seed);
  const roads = nearbyRoads();
  const dsegs = districtSegments();
  const facades: Facade[] = [];
  const parts: Part[] = [];
  const people: Person[] = [];
  const signs: Sign[] = [];
  const murals: Mural[] = [];
  const buildings: Building[] = [];
  const reserved: OBB[] = [];
  let rooftopBars = 0;
  const muralCandidates: (Mural & { probe: [number, number]; owner: Facade })[] = [];

  const P = (pool: PoolName, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, color: string) =>
    parts.push({ pool, x, y, z, sx, sy, sz, ry, color });
  const roadDist = (b: OBB) => {
    let m = Infinity;
    for (const s of roads) m = Math.min(m, obbSegDist(b, s));
    return m;
  };
  const pointRoadDist = (x: number, z: number) => roadDist({ x, z, hw: 0, hd: 0, ry: 0 });
  const inZone = (b: OBB, pad = 0) => {
    const c = [toWorld(b, -b.hw, -b.hd), toWorld(b, b.hw, -b.hd), toWorld(b, b.hw, b.hd), toWorld(b, -b.hw, b.hd)];
    return c.every(([x, z]) => x >= ZONE.minX + pad && x <= ZONE.maxX - pad && z >= ZONE.minZ + pad && z <= ZONE.maxZ - pad);
  };
  const free = (b: OBB, gap = 0.4) => !buildings.some((o) => obbOverlap(o, b, gap)) && !reserved.some((o) => obbOverlap(o, b, 0));
  const occupied = (x: number, z: number, pad = 0) =>
    buildings.some((o) => pointInObb(o, x, z, pad)) || reserved.some((o) => pointInObb(o, x, z, pad));

  function addFacade(f: Facade, keepOut = true) {
    facades.push(f);
    if (keepOut) buildings.push({ x: f.x, z: f.z, hw: f.w / 2, hd: f.d / 2, ry: f.ry, facade: f });
  }

  // ---- Reserved: roundabout, viaduct, station, campus, market, promenade
  reserved.push({ x: SH_ROUNDABOUT.x, z: SH_ROUNDABOUT.z, hw: 27, hd: 27, ry: 0 });
  const vp = VIADUCT.points;
  for (let i = 0; i < vp.length - 1; i++) {
    const [ax, az] = vp[i];
    const [bx, bz] = vp[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    reserved.push({ x: (ax + bx) / 2, z: (az + bz) / 2, hw: len / 2 + 1, hd: VIADUCT.width / 2 + 2, ry: Math.atan2(-(bz - az), bx - ax) });
  }
  reserved.push({ x: STATION.x, z: STATION.z, hw: STATION.w / 2 + 1, hd: STATION.d / 2 + 1, ry: 0 });
  const CAMPUS: OBB = { x: 258, z: -350, hw: 42, hd: 26, ry: 0 };
  const MARKET: OBB = { x: 240, z: -281, hw: 30, hd: 15, ry: 0 };

  // ================================================================================ hand-placed features
  // ---- Tech campus: glass towers, a pavilion, a steel canopy, a lawn and a logo sign
  const campusBlocks = [
    { x: 262, z: -345, w: 22, d: 17, h: 44, ry: 0, c: GLASS[0] },
    { x: 288, z: -356, w: 11, d: 28, h: 28, ry: 0, c: GLASS[3] },
    { x: 232, z: -337, w: 15, d: 14, h: 32, ry: 0.22, c: GLASS[2] },
    { x: 252, z: -369, w: 20, d: 7, h: 8, ry: 0.12, c: GLASS[4] },
  ];
  for (const b of campusBlocks) {
    const box: OBB = { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, ry: b.ry };
    if (roadDist(box) < ROAD_CLEAR) continue;
    addFacade({ x: b.x, y: 0, z: b.z, w: b.w, h: b.h, d: b.d, ry: b.ry, color: b.c, kind: KIND.glass, seed: rng(), floorH: 3.8, bayW: 1.6 });
    // roof plant and a crown
    P("box", b.x, b.h, b.z, b.w * 0.5, 1.8, b.d * 0.4, b.ry, "#9aa3ab");
    P("box", b.x, b.h, b.z, b.w + 0.3, 0.6, b.d + 0.3, b.ry, "#cfd6dc");
  }
  // campus lawn + plaza paving + trees
  P("box", 248, -0.2, -352, 30, 0.32, 14, 0.12, "#7fb069"); // lawn, top at y 0.12
  for (let i = 0; i < 9; i++) {
    const [x, z] = [236 + i * 3.4, -352 + Math.sin(i) * 4];
    if (!occupied(x, z, 1.5) && pointRoadDist(x, z) > 6) P("tree", x, 0, z, 1.1, range(rng, 0.9, 1.3), 1.1, rng() * 6, "#ffffff");
  }
  // steel canopy between the tower and the long block
  for (let zz = -353; zz <= -337; zz += 5.3) P("cyl", 275.5, 0, zz, 0.35, 9, 0.35, 0, "#6c7a86");
  P("box", 276, 9, -345, 3.4, 0.35, 18, 0, "#8fa3b3");
  for (let i = 0; i < 6; i++) P("box", 276, 9.35, -353 + i * 3.2, 3.4, 0.25, 0.2, 0, "#55626e");
  signs.push({ text: "HAMYWAY LABS", color: "#ff6a1a", x: 262, y: 41, z: -345 + 8.5 + 0.12, w: 16, h: 3, ry: 0, flicker: false });
  signs.push({ text: "HAMYWAY LABS", color: "#ff6a1a", x: 262, y: 41, z: -345 - 8.5 - 0.12, w: 16, h: 3, ry: Math.PI, flicker: false });
  for (let i = 0; i < 26; i++) {
    const x = range(rng, 236, 282);
    const z = range(rng, -366, -322);
    if (occupied(x, z, 0.6) || pointRoadDist(x, z) < 5) continue;
    people.push({ x, y: 0, z, ry: rng() * Math.PI * 2, range: range(rng, 0, 6), speed: range(rng, 0.9, 1.5), phase: rng() * 6.28, color: pick(rng, CLOTHES) });
  }
  reserved.push(CAMPUS);

  // ---- Container market: two rows of stacked containers around a courtyard with string lights
  const C_LEN = 12.2, C_W = 2.44, C_H = 2.6;
  const rows = [
    { z: -268.5, ry: Math.PI }, // south row, shops face north (into the yard)
    { z: -293.5, ry: 0 },
  ];
  rows.forEach((row) => {
    for (let k = 0; k < 4; k++) {
      const x = 216 + k * (C_LEN + 0.6);
      for (let lvl = 0; lvl < 2; lvl++) {
        const off = lvl === 1 ? range(rng, -1.2, 1.2) : 0;
        const box: OBB = { x: x + off, z: row.z, hw: C_LEN / 2, hd: C_W / 2, ry: row.ry };
        if (roadDist(box) < 5 || !inZone(box)) continue;
        if (lvl === 1 && rng() < 0.2) continue;
        addFacade({ x: x + off, y: lvl * C_H, z: row.z, w: C_LEN, h: C_H, d: C_W, ry: row.ry, color: pick(rng, CONTAINERS), kind: KIND.container, seed: rng(), floorH: C_H, bayW: C_LEN - 1.6 }, lvl === 0);
        if (lvl === 1) {
          // walkway rail on the upper level
          const [rx, rz] = toWorld({ x: x + off, z: row.z, ry: row.ry }, 0, C_W / 2 + 0.6);
          P("box", rx, C_H, rz, C_LEN, 0.08, 1.2, row.ry, "#3b3f45");
          P("box", rx, C_H + 1.0, rz + (row.ry === 0 ? 0.55 : -0.55), C_LEN, 0.06, 0.06, row.ry, "#20242a");
        }
      }
      if (rng() < 0.6) {
        const [sx, sz] = toWorld({ x, z: row.z, ry: row.ry }, 0, C_W / 2 + 0.05);
        signs.push({ text: pick(rng, SHOP_TEXTS), color: pick(rng, NEON), x: sx, y: C_H - 0.45, z: sz, w: 4, h: 0.7, ry: row.ry, flicker: rng() < 0.12 });
      }
    }
  });
  signs.push({ text: "BOX MARKET", color: "#9dff3f", x: 234.5, y: 2 * C_H + 1.2, z: -293.5 + 0.05, w: 12, h: 2, ry: 0, flicker: false });
  P("box", 234.5, 2 * C_H, -293.5, 0.2, 0.7, 0.2, 0, "#222");
  // yard: picnic tables, festoon lights, people
  for (let i = 0; i < 8; i++) {
    const x = 214 + i * 6.4;
    P("box", x, 0.7, -281, 2.4, 0.1, 0.9, 0, "#8b5a2b");
    P("box", x, 0.0, -281, 0.15, 0.7, 0.8, 0, "#5b3a1b");
    P("box", x, 0.42, -280.1, 2.4, 0.08, 0.35, 0, "#8b5a2b");
    P("box", x, 0.42, -281.9, 2.4, 0.08, 0.35, 0, "#8b5a2b");
  }
  for (let k = 0; k < 6; k++) {
    const x0 = 212 + k * 9;
    festoon(x0, -270.4, 6.5, x0 + 9, -291.8, 6.5, 2.0);
    P("cyl", x0, 0, -270.4, 0.12, 6.6, 0.12, 0, "#333");
    P("cyl", x0 + 9, 0, -291.8, 0.12, 6.6, 0.12, 0, "#333");
  }
  for (let i = 0; i < 40; i++) {
    people.push({ x: range(rng, 211, 262), y: 0, z: range(rng, -287, -275), ry: rng() * 6.28, range: rng() < 0.5 ? 0 : range(rng, 1, 5), speed: range(rng, 0.8, 1.3), phase: rng() * 6.28, color: pick(rng, CLOTHES) });
  }
  reserved.push(MARKET);

  // ---- Silicon Roundabout island + plinth sign (the sculpture itself is its own component)
  const RB = SH_ROUNDABOUT;
  P("cyl", RB.x, 0, RB.z, 23, 0.22, 23, 0, "#d6d2c8");
  P("cyl", RB.x, 0.22, RB.z, 21.5, 0.06, 21.5, 0, "#6fa35a");
  P("box", RB.x, 0, RB.z + 8, 9, 1.3, 0.8, 0, "#2b2d33");
  signs.push({ text: "SILICON ROUNDABOUT", color: "#39e6ff", x: RB.x, y: 0.75, z: RB.z + 8.42, w: 8.6, h: 0.9, ry: 0, flicker: false });
  signs.push({ text: "SILICON ROUNDABOUT", color: "#39e6ff", x: RB.x, y: 0.75, z: RB.z + 7.58, w: 8.6, h: 0.9, ry: Math.PI, flicker: false });

  // ---- Railway viaduct: brick arch bays (shops and bars inside), open steel spans over roads, deck, rails
  for (let i = 0; i < vp.length - 1; i++) {
    const [ax, az] = vp[i];
    const [bx, bz] = vp[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const ry = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / VIADUCT.bay));
    const bl = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * bl;
      const x = ax + dx * t;
      const z = az + dz * t;
      const bay: OBB = { x, z, hw: bl / 2, hd: VIADUCT.width / 2, ry };
      const overRoad = roadDist(bay) < 4.6;
      if (overRoad) {
        // open span: deck slab with steel girders
        P("box", x, VIADUCT.deckY - 1.0, z, bl + 0.05, 1.0, VIADUCT.width - 1, ry, "#7e8288");
        for (const side of [-1, 1]) {
          const [gx, gz] = toWorld({ x, z, ry }, 0, side * (VIADUCT.width / 2 - 0.25));
          P("box", gx, VIADUCT.deckY - 1.6, gz, bl + 0.05, 2.4, 0.5, ry, "#2f4f3f");
        }
      } else {
        P("arch", x, -0.3, z, bl / VIADUCT.bay, (VIADUCT.deckY + 0.3) / 7.6, VIADUCT.width / 9, ry, pick(rng, ["#8e3b2a", "#7a3324", "#9c5a3c", "#6e2f25"]));
        const r = rng();
        if (r < 0.75) {
          // shop/bar in the arch: a glazed box filling the arch tunnel (brick hides the corners)
          addFacade(
            { x, y: 0, z, w: bl * 0.74, h: 7, d: VIADUCT.width - 1, ry, color: pick(rng, ["#1b4d3e", "#222831", "#7a1f1f", "#1f3a5f", "#3d2b1f", "#ff6a1a"]), kind: KIND.archShop, seed: rng(), floorH: 7, bayW: bl * 0.74 },
            false,
          );
          for (const side of [1, -1]) {
            if (rng() < 0.7) {
              const [sx, sz] = toWorld({ x, z, ry }, 0, side * (VIADUCT.width / 2 + 0.06));
              signs.push({ text: pick(rng, ARCH_TEXTS), color: pick(rng, NEON), x: sx, y: 6.0, z: sz, w: 3.4, h: 0.8, ry: side > 0 ? ry : ry + Math.PI, flicker: rng() < 0.15 });
            }
            // a few people at the arch bars
            for (let p = 0; p < 2; p++) {
              if (rng() < 0.5) continue;
              const [px, pz] = toWorld({ x, z, ry }, range(rng, -2.5, 2.5), side * (VIADUCT.width / 2 + range(rng, 1.2, 2.5)));
              if (pointRoadDist(px, pz) > 4.6) people.push({ x: px, y: 0, z: pz, ry: rng() * 6.28, range: 0, speed: 1, phase: rng() * 6.28, color: pick(rng, CLOTHES) });
            }
          }
        }
      }
    }
    // deck: ballast bed, rails, parapets
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    P("box", mx, VIADUCT.deckY, mz, len + 0.6, 0.3, 3.6, ry, "#5c5650");
    for (const side of [-1, 1]) {
      const [rx, rz] = toWorld({ x: mx, z: mz, ry }, 0, side * 0.72);
      P("box", rx, VIADUCT.deckY + 0.3, rz, len + 0.6, 0.16, 0.12, ry, "#9aa1a8");
      const [px, pz] = toWorld({ x: mx, z: mz, ry }, 0, side * (VIADUCT.width / 2 - 0.2));
      P("box", px, VIADUCT.deckY - 0.1, pz, len + 0.6, 1.2, 0.4, ry, "#7a3324");
      // overhead-line masts every ~16 m
      for (let t = 6; t < len; t += 16) {
        const [mx2, mz2] = toWorld({ x: ax + dx * t, z: az + dz * t, ry }, 0, side * 2.6);
        P("cyl", mx2, VIADUCT.deckY, mz2, 0.18, 5.2, 0.18, 0, "#4a4f55");
      }
    }
  }
  // west abutment
  {
    const [ax, az] = vp[0];
    P("box", ax + 1.5, 0, az, 3, VIADUCT.deckY, VIADUCT.width + 0.4, 0, "#6e2f25");
  }
  // station: brick terminus building at the east end, platforms and an orange canopy on the last span
  {
    const S = STATION;
    addFacade({ x: S.x, y: 0, z: S.z, w: S.w, h: S.h, d: S.d, ry: 0, color: "#8e3b2a", kind: KIND.warehouse, seed: 0.42, floorH: 4.5, bayW: 3.2 });
    P("box", S.x, S.h, S.z, S.w + 0.6, 0.6, S.d + 0.6, 0, "#3a3d42");
    const [ax, az] = vp[vp.length - 2];
    const [bx, bz] = vp[vp.length - 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(-(bz - az), bx - ax);
    const mid = { x: (ax + bx) / 2, z: (az + bz) / 2, ry };
    const top = VIADUCT.deckY + 0.3;
    for (const side of [-1, 1]) {
      const [px, pz] = toWorld(mid, 0, side * 2.9);
      P("box", px, VIADUCT.deckY, pz, len - 2, 1.0, 2.3, ry, "#bdb8ad");
      for (let t = -len / 2 + 3; t < len / 2 - 2; t += 5.5) {
        const [cx, cz] = toWorld(mid, t, side * 3.7);
        P("cyl", cx, top + 0.7, cz, 0.2, 3.6, 0.2, 0, "#2d3a4a");
      }
    }
    P("box", mid.x, top + 4.3, mid.z, len - 2, 0.3, 8.6, ry, "#ff6a1a");
    for (let i = 0; i < 6; i++) {
      const [px, pz] = toWorld(mid, range(rng, -len / 2 + 3, len / 2 - 3), (rng() < 0.5 ? -1 : 1) * 3);
      people.push({ x: px, y: VIADUCT.deckY + 1.0, z: pz, ry, range: range(rng, 0, 3), speed: 1, phase: rng() * 6.28, color: pick(rng, CLOTHES) });
    }
    signs.push({ text: "SHOREDITCH HIGH ST", color: "#ffffff", x: S.x + S.w / 2 + 0.06, y: S.h - 1.6, z: S.z, w: 10, h: 1.4, ry: Math.PI / 2, flicker: false });
    signs.push({ text: "OVERGROUND", color: "#ff6a1a", x: S.x, y: S.h - 1.6, z: S.z + S.d / 2 + 0.06, w: 8, h: 1.2, ry: 0, flicker: false });
  }

  // ---- Seafront promenade: boardwalk on piles, railings, lamps, benches, planters, kiosks, people
  {
    const cx = (PROM.minX + PROM.maxX) / 2;
    const cz = (PROM.minZ + PROM.maxZ) / 2;
    const L = PROM.maxZ - PROM.minZ;
    const W = PROM.maxX - PROM.minX;
    P("box", cx, PROM.y - 0.3, cz, W, 0.3, L, 0, "#b08a5e"); // deck
    P("box", PROM.minX + 0.6, PROM.y - 0.29, cz, 1.2, 0.3, L, 0, "#8a6a48"); // darker edge boards
    for (let z = PROM.minZ + 2; z < PROM.maxZ; z += 6)
      for (const x of [PROM.minX + 0.5, cx, PROM.maxX - 0.5]) P("cyl", x, WATER_Y - 1.5, z, 0.45, PROM.y + 1.6, 0.45, 0, "#5e4630"); // piles
    P("box", PROM.maxX - 0.15, PROM.y + 1.0, cz, 0.1, 0.1, L, 0, "#e9ecef"); // railing top
    P("box", PROM.maxX - 0.15, PROM.y + 0.5, cz, 0.05, 0.05, L, 0, "#e9ecef");
    for (let z = PROM.minZ + 1; z < PROM.maxZ; z += 2.5) P("box", PROM.maxX - 0.15, PROM.y, z, 0.08, 1.05, 0.08, 0, "#e9ecef");
    // south end: a round pier head looking out to the lighthouse
    P("cyl", cx, PROM.y - 0.3, PROM.maxZ, W, 0.3, W, 0, "#b08a5e");
    for (let z = PROM.minZ + 6; z < PROM.maxZ - 4; z += 14) {
      lamp(PROM.maxX - 1.0, PROM.y, z, -Math.PI / 2, 4.5);
      P("box", PROM.minX + 2.0, PROM.y, z + 7, 2.0, 0.45, 0.6, 0, "#7a5230"); // bench
      P("cyl", PROM.minX + 2.0, PROM.y, z + 3, 1.4, 0.5, 1.4, 0, "#9a8f80"); // planter
      P("tree", PROM.minX + 2.0, PROM.y + 0.5, z + 3, 0.6, range(rng, 0.7, 0.9), 0.6, rng() * 6, "#d8ffd0");
    }
    for (let i = 0; i < 4; i++) {
      const z = PROM.minZ + 18 + i * 38;
      const col = pick(rng, ["#ff3fa4", "#39e6ff", "#ffe14d", "#9dff3f", "#ff6a1a", "#f1faee"]);
      P("box", cx + 1, PROM.y, z, 2.8, 2.5, 3.2, 0, col);
      P("prism", cx + 1, PROM.y + 2.5, z, 3.4, 1.0, 3.6, Math.PI / 2, "#f1faee");
      signs.push({ text: pick(rng, ["ICE CREAM", "COFFEE", "FISH", "OYSTERS", "SURF"]), color: pick(rng, NEON), x: cx - 0.45, y: PROM.y + 2.0, z, w: 2.8, h: 0.6, ry: -Math.PI / 2, flicker: false });
    }
    for (let i = 0; i < 60; i++) {
      const z = range(rng, PROM.minZ + 3, PROM.maxZ - 3);
      people.push({ x: range(rng, PROM.minX + 1, PROM.maxX - 1.2), y: PROM.y, z, ry: rng() < 0.5 ? 0 : Math.PI, range: range(rng, 3, 12), speed: range(rng, 0.9, 1.6), phase: rng() * 6.28, color: pick(rng, CLOTHES) });
    }
  }

  // ---- Marina: pontoons, gangways, breakwater, moored yachts
  {
    const spineX = 357;
    const z0 = -530, z1 = -398;
    const deckY = WATER_Y + 0.2;
    P("box", spineX, deckY, (z0 + z1) / 2, 2.4, 0.3, z1 - z0, 0, "#9c7a54");
    for (const gz of [-412, -470, -520]) P("box", (PROM.maxX + spineX) / 2, deckY + 0.1, gz, spineX - PROM.maxX, 0.25, 1.8, 0, "#8a6a48");
    for (let z = z0 + 4; z < z1; z += 11) {
      P("box", spineX + 8.4, deckY, z, 14, 0.25, 1.3, 0, "#9c7a54");
      for (const off of [-3.6, 3.6]) {
        if (rng() < 0.18) continue;
        const sail = rng() < 0.6;
        P(sail ? "sailboat" : "motorboat", spineX + 9 + range(rng, -0.8, 0.8), WATER_Y, z + off, 1, 1, range(rng, 0.85, 1.25), Math.PI / 2 + (rng() < 0.5 ? 0 : Math.PI), sail ? "#ffffff" : pick(rng, ["#ffffff", "#f1faee", "#dfe7ee"]));
      }
      lamp(spineX + 15.2, deckY + 0.25, z, 0, 3.2);
    }
    // bigger yachts on the outer berths
    for (let z = z0 + 10; z < z1 - 6; z += 26) P("motorboat", spineX + 24, WATER_Y, z, 1.5, 1.5, 1.6, Math.PI / 2, "#f6f6f6");
    // breakwater rocks (east and north)
    const ROCK = ["#7d7a73", "#8e8a80", "#6b6862"];
    for (let z = -540; z < -392; z += 3.2) P("rock", 392 + range(rng, -1, 1), WATER_Y - 1.2, z, range(rng, 2.4, 3.6), range(rng, 1.6, 2.6), range(rng, 2.4, 3.6), rng() * 6, pick(rng, ROCK));
    for (let x = 344; x < 392; x += 3.2) P("rock", x, WATER_Y - 1.2, -542 + range(rng, -1, 1), range(rng, 2.4, 3.6), range(rng, 1.6, 2.6), range(rng, 2.4, 3.6), rng() * 6, pick(rng, ROCK));
    P("cyl", 392, WATER_Y, -390, 1.4, 5, 1.4, 0, "#c0392b"); // harbour-mouth beacon
    P("glow", 392, WATER_Y + 5, -390, 0.9, 0.9, 0.9, 0, "#ff4040");
    for (let i = 0; i < 16; i++) {
      people.push({ x: spineX + range(rng, -0.5, 0.5), y: deckY + 0.3, z: range(rng, z0, z1), ry: 0, range: range(rng, 3, 20), speed: range(rng, 0.8, 1.3), phase: rng() * 6.28, color: pick(rng, CLOTHES) });
    }
  }

  // ================================================================================ buildings
  function chooseKind(x: number, z: number) {
    const dRb = Math.hypot(x - RB.x, z - RB.z);
    if (dRb < 75 && rng() < 0.3) return "tower";
    if (x > 268 && rng() < 0.75) return "flats";
    if (rng() < 0.12) return "flats";
    return "warehouse";
  }

  function decorate(f: Facade, b: OBB, kindName: string) {
    const H = f.h;
    const frame = { x: f.x, z: f.z, ry: f.ry };
    if (f.kind === KIND.warehouse) {
      const r = rng();
      const floors = Math.round(H / f.floorH);
      if (r < 0.3) {
        P("prism", f.x, H, f.z, f.w, range(rng, 2.6, 4), f.d, f.ry, pick(rng, ["#4a4f57", "#5b4a42", "#3f454d"]));
      } else if (r < 0.48 && f.w >= 12) {
        const n = Math.max(3, Math.round(f.w / 4.5));
        for (let i = 0; i < n; i++) {
          const [sx, sz] = toWorld(frame, -f.w / 2 + (i + 0.5) * (f.w / n), 0);
          P("prism", sx, H, sz, f.d, 2.4, f.w / n, f.ry + Math.PI / 2, "#4d535b");
        }
      } else {
        parapet(f, "#5a2a20");
        const bar = rooftopBars < 10 && H <= 26 && f.w >= 11 && f.d >= 11 && rng() < 0.75;
        if (bar) rooftopBar(f);
        else {
          if (rng() < 0.45) {
            const [tx, tz] = toWorld(frame, range(rng, -f.w / 4, f.w / 4), range(rng, -f.d / 4, f.d / 4));
            waterTower(tx, H, tz);
          }
          if (rng() < 0.6) {
            const [kx, kz] = toWorld(frame, range(rng, -f.w / 3, f.w / 3), range(rng, -f.d / 3, f.d / 3));
            P("box", kx, H, kz, 2.4, 1.4, 1.6, f.ry, "#a0a4a8");
            P("box", kx, H, kz + 2.2, 1.2, 0.6, 2.4, f.ry, "#cfd6dc"); // skylight
          }
        }
      }
      if (rng() < 0.16) {
        const [cx, cz] = toWorld(frame, f.w / 2 - 1.2, -f.d / 2 + 1.2);
        P("cyl", cx, 0, cz, 1.6, H + range(rng, 8, 16), 1.6, 0, "#7a3324"); // mill chimney
        P("cyl", cx, 0, cz, 1.9, H + 0.6, 1.9, 0, "#7a3324");
      }
      // iron wall crane at the top loophole door (the shader draws the doors in the centre bay)
      if (floors >= 3 && f.w >= 9 && rng() < 0.65) {
        const { nb, margin } = bays(f.w, f.bayW);
        const lx = margin + (Math.floor(nb / 2) + 0.5) * f.bayW - f.w / 2;
        const [cx, cz] = toWorld(frame, lx, f.d / 2);
        P("crane", cx, (floors - 1) * f.floorH + f.floorH * 0.88, cz, 1, 1, 1, f.ry, "#24282c");
      }
      // ground-floor neon
      if (rng() < 0.5) {
        const { nb, margin } = bays(f.w, f.bayW);
        const bi = Math.floor(rng() * nb);
        const lx = margin + (bi + 0.5) * f.bayW - f.w / 2;
        const [sx, sz] = toWorld(frame, lx, f.d / 2 + 0.07);
        signs.push({ text: pick(rng, SHOP_TEXTS), color: pick(rng, NEON), x: sx, y: f.floorH * 0.93, z: sz, w: Math.min(f.bayW * 1.6, 5), h: 0.75, ry: f.ry, flicker: rng() < 0.12 });
      }
      if (rng() < 0.18) {
        // vertical blade sign at a corner
        const [sx, sz] = toWorld(frame, f.w / 2 - 0.4, f.d / 2 + 0.9);
        signs.push({ text: pick(rng, ["HOTEL", "BAR", "CLUB", "LOFTS", "STUDIOS"]), color: pick(rng, NEON), x: sx, y: f.floorH * 1.8, z: sz, w: 1.6, h: 0.55, ry: f.ry + Math.PI / 2, flicker: rng() < 0.2 });
      }
      // murals on the gable ends that face open ground
      for (const side of [1, -1]) {
        if (f.d < 9 || H < 9 || rng() < 0.4) continue;
        const [ox, oz] = toWorld(frame, side * (f.w / 2 + 3), 0);
        const [mx, mz] = toWorld(frame, side * (f.w / 2 + 0.06), 0);
        const mh = Math.min(H - 1.2, f.d * 0.9);
        muralCandidates.push({ probe: [ox, oz], owner: f, design: Math.floor(rng() * MURAL_DESIGNS), x: mx, y: 0.6 + mh / 2, z: mz, w: f.d * 0.88, h: mh, ry: f.ry + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
      }
    } else if (f.kind === KIND.flats || f.kind === KIND.glass) {
      parapet(f, f.kind === KIND.glass ? "#c9d1d8" : "#7b7f86");
      const bar = kindName === "flats" && rooftopBars < 9 && H <= 30 && f.w >= 12 && f.d >= 12 && rng() < 0.3;
      if (bar) rooftopBar(f);
      else P("box", f.x, H, f.z, f.w * 0.4, 2, f.d * 0.35, f.ry, "#9aa3ab");
      if (f.kind === KIND.flats && rng() < 0.6) {
        // balconies on the front face
        const { nb, margin } = bays(f.w, f.bayW);
        const floors = Math.round(H / f.floorH);
        for (let fl = 1; fl < floors; fl++)
          for (let bi = 0; bi < nb; bi += 2) {
            const lx = margin + (bi + 0.5) * f.bayW - f.w / 2;
            const [bx, bz] = toWorld(frame, lx, f.d / 2 + 0.55);
            P("box", bx, fl * f.floorH, bz, f.bayW * 0.85, 0.95, 1.1, f.ry, "#bcd3dd");
          }
      }
      if (kindName === "tower" && rng() < 0.5) {
        const [sx, sz] = toWorld(frame, 0, f.d / 2 + 0.1);
        signs.push({ text: pick(rng, ["HACKSPACE", "STARTUP HQ", "CO-WORK", "DATA", "AI LAB", "STUDIOS"]), color: pick(rng, NEON), x: sx, y: H - 1.6, z: sz, w: Math.min(f.w * 0.7, 10), h: 1.6, ry: f.ry, flicker: false });
      }
    }
    void b;
  }

  function parapet(f: Facade, color: string) {
    const frame = { x: f.x, z: f.z, ry: f.ry };
    for (const [lx, lz, w, d] of [[0, f.d / 2 - 0.15, f.w, 0.3], [0, -f.d / 2 + 0.15, f.w, 0.3], [f.w / 2 - 0.15, 0, 0.3, f.d], [-f.w / 2 + 0.15, 0, 0.3, f.d]] as const) {
      const [x, z] = toWorld(frame, lx, lz);
      P("box", x, f.h, z, w, 0.8, d, f.ry, color);
    }
  }

  function waterTower(x: number, y: number, z: number) {
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) P("cyl", x + ox, y, z + oz, 0.18, 2.4, 0.18, 0, "#3a3a3a");
    P("cyl", x, y + 2.4, z, 2.6, 2.6, 2.6, 0, "#8a6a4a");
    P("cone", x, y + 5.0, z, 2.8, 1.0, 2.8, 0, "#4a4f57");
  }

  function festoon(x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, sag: number) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(3, Math.round(len / 0.9));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
      P("bulb", x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.22, 0.22, 0.22, 0, pick(rng, ["#ffd27a", "#ffd27a", "#ffb347", "#fff1c1", "#ff8fb1"]));
    }
  }

  function lamp(x: number, y: number, z: number, ry: number, h = 6) {
    P("lamp", x, y, z, 1, h / 6, 1, ry, "#2b2f36");
    const [hx, hz] = toWorld({ x, z, ry }, 0, 1.1);
    P("lampHead", hx, y + h - 0.35, hz, 0.7, 0.25, 0.4, ry, "#ffe2a8");
  }

  function rooftopBar(f: Facade) {
    rooftopBars++;
    const frame = { x: f.x, z: f.z, ry: f.ry };
    const H = f.h;
    const iw = f.w - 1.4;
    const id = f.d - 1.4;
    P("box", f.x, H, f.z, iw, 0.18, id, f.ry, "#a0764e"); // timber deck
    parapetGlass(f);
    const [bx, bz] = toWorld(frame, 0, -id / 2 + 1.0);
    P("box", bx, H + 0.18, bz, iw * 0.55, 1.1, 0.9, f.ry, "#2b2d33"); // bar counter
    P("box", bx, H + 1.28, bz, iw * 0.55 + 0.2, 0.08, 1.1, f.ry, "#c49a6c");
    const nt = Math.max(3, Math.floor((iw * id) / 22));
    for (let i = 0; i < nt; i++) {
      const [tx, tz] = toWorld(frame, range(rng, -iw / 2 + 1.5, iw / 2 - 1.5), range(rng, -id / 2 + 3, id / 2 - 1.5));
      P("cyl", tx, H + 0.18, tz, 0.9, 0.75, 0.9, 0, "#e9e4da");
      if (rng() < 0.55) {
        P("cyl", tx, H + 0.18, tz, 0.08, 2.4, 0.08, 0, "#555");
        P("cone", tx, H + 2.1, tz, 2.6, 0.7, 2.6, 0, pick(rng, UMBRELLAS));
      }
      for (let p = 0; p < 2; p++) {
        if (rng() < 0.35) continue;
        const a = rng() * 6.28;
        people.push({ x: tx + Math.cos(a) * 0.9, y: H + 0.18, z: tz + Math.sin(a) * 0.9, ry: a, range: 0, speed: 1, phase: rng() * 6.28, color: pick(rng, CLOTHES) });
      }
    }
    // planters along the edge
    for (let i = 0; i < 4; i++) {
      const [px, pz] = toWorld(frame, -iw / 2 + 0.6 + (i * (iw - 1.2)) / 3, id / 2 - 0.6);
      P("box", px, H + 0.18, pz, 0.9, 0.5, 0.9, f.ry, "#6b6f74");
      P("tree", px, H + 0.5, pz, 0.45, 0.4, 0.45, rng() * 6, "#d8ffd0");
    }
    // string-light posts at the corners, catenaries round the edge and across
    const cs = [toWorld(frame, -iw / 2 + 0.3, -id / 2 + 0.3), toWorld(frame, iw / 2 - 0.3, -id / 2 + 0.3), toWorld(frame, iw / 2 - 0.3, id / 2 - 0.3), toWorld(frame, -iw / 2 + 0.3, id / 2 - 0.3)];
    const top = H + 0.18 + 3.0;
    for (const [x, z] of cs) P("cyl", x, H + 0.18, z, 0.12, 3.0, 0.12, 0, "#333");
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = cs[i];
      const [x1, z1] = cs[(i + 1) % 4];
      festoon(x0, z0, top, x1, z1, top, 0.55);
    }
    festoon(cs[0][0], cs[0][1], top, cs[2][0], cs[2][1], top, 0.9);
    festoon(cs[1][0], cs[1][1], top, cs[3][0], cs[3][1], top, 0.9);
    const [sx, sz] = toWorld(frame, 0, f.d / 2 + 0.08);
    signs.push({ text: pick(rng, ["ROOFTOP", "SKY BAR", "ROOF GARDEN", "SUNSET CLUB", "HIGH LINE"]), color: pick(rng, NEON), x: sx, y: H + 0.4, z: sz, w: Math.min(7, f.w * 0.6), h: 1.0, ry: f.ry, flicker: false });
  }

  function parapetGlass(f: Facade) {
    const frame = { x: f.x, z: f.z, ry: f.ry };
    for (const [lx, lz, w, d] of [[0, f.d / 2 - 0.2, f.w, 0.12], [0, -f.d / 2 + 0.2, f.w, 0.12], [f.w / 2 - 0.2, 0, 0.12, f.d], [-f.w / 2 + 0.2, 0, 0.12, f.d]] as const) {
      const [x, z] = toWorld(frame, lx, lz);
      P("box", x, f.h, z, w, 1.1, d, f.ry, "#a9d6e5");
    }
  }

  function makeFacade(x: number, z: number, w: number, d: number, ry: number, kindName: string): Facade {
    if (kindName === "tower") {
      const glass = rng() < 0.55;
      const fh = glass ? 3.8 : 3.2;
      const floors = Math.round(range(rng, 9, 19));
      return { x, y: 0, z, w, h: floors * fh, d, ry, color: glass ? pick(rng, GLASS) : pick(rng, FLATS), kind: glass ? KIND.glass : KIND.flats, seed: rng(), floorH: fh, bayW: glass ? 1.6 : 2.6 };
    }
    if (kindName === "flats") {
      const floors = Math.round(range(rng, 4, x > 268 ? 10 : 7));
      return { x, y: 0, z, w, h: floors * 3.2, d, ry, color: pick(rng, FLATS), kind: KIND.flats, seed: rng(), floorH: 3.2, bayW: range(rng, 2.4, 3.2) };
    }
    const floors = Math.round(range(rng, 2.6, 6.4));
    const fh = range(rng, 3.9, 4.5);
    return { x, y: 0, z, w, h: floors * fh, d, ry, color: pick(rng, BRICKS), kind: KIND.warehouse, seed: rng(), floorH: fh, bayW: range(rng, 3.0, 3.8) };
  }

  function tryBuilding(x: number, z: number, w: number, d: number, ry: number, clear = ROAD_CLEAR): boolean {
    const b: OBB = { x, z, hw: w / 2, hd: d / 2, ry };
    if (!inZone(b, 0.5) || !free(b) || roadDist(b) < clear) return false;
    const kindName = chooseKind(x, z);
    const f = makeFacade(x, z, w, d, ry, kindName);
    addFacade(f);
    decorate(f, b, kindName);
    return true;
  }

  // ---- Frontage: walk both sides of every district street and line it with buildings facing the road
  for (const s of dsegs) {
    if (s.a.startsWith("sh_rb") && s.b.startsWith("sh_rb")) continue;
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const dx = (s.bx - s.ax) / len;
    const dz = (s.bz - s.az) / len;
    for (const side of [1, -1]) {
      const nx = -dz * side;
      const nz = dx * side;
      let t = 2;
      while (t < len - 4) {
        const w = range(rng, 9, 20);
        const d = range(rng, 11, 22);
        const tc = t + w / 2;
        const setback = ROAD_CLEAR + 0.3 + d / 2;
        const x = s.ax + dx * tc + nx * setback;
        const z = s.az + dz * tc + nz * setback;
        const ry = Math.atan2(-nx, -nz); // local +z faces the road
        let ok = tryBuilding(x, z, w, d, ry);
        let used = w;
        for (const [w2, d2] of [[w, 10], [w * 0.65, 9], [7.5, 7.5]]) {
          if (ok) break;
          const tc2 = t + w2 / 2;
          const sb = ROAD_CLEAR + 0.3 + d2 / 2;
          ok = tryBuilding(s.ax + dx * tc2 + nx * sb, s.az + dz * tc2 + nz * sb, w2, d2, ry);
          used = w2;
        }
        t += ok ? used + range(rng, 0, 0.6) : 2;
      }
    }
  }

  // ---- Infill: fill block interiors with yards, sheds and back-street warehouses
  for (let gx = ZONE.minX + 5; gx < ZONE.maxX - 4; gx += 5)
    for (let gz = ZONE.minZ + 5; gz < ZONE.maxZ - 4; gz += 5) {
      const x = gx + range(rng, -2, 2);
      const z = gz + range(rng, -2, 2);
      if (occupied(x, z, 2.5)) continue;
      // align with the nearest road
      let best = Infinity, ry = 0;
      for (const sg of roads) {
        const dd = obbSegDist({ x, z, hw: 0, hd: 0, ry: 0 }, sg);
        if (dd < best) {
          best = dd;
          ry = Math.atan2(-(sg.bz - sg.az), sg.bx - sg.ax);
        }
      }
      for (const [w, d] of [[range(rng, 12, 20), range(rng, 10, 16)], [range(rng, 9, 12), range(rng, 8, 10)], [7, 7], [5.5, 5.5]])
        if (tryBuilding(x, z, w, d, ry)) break;
    }

  // ================================================================================ street furniture
  // murals: keep the gable walls that still face open ground now every building is placed
  for (const m of muralCandidates) {
    if (murals.length >= 24) break;
    if (occupied(m.probe[0], m.probe[1], 0.5) || pointRoadDist(m.probe[0], m.probe[1]) < 2) continue;
    murals.push({ design: m.design, x: m.x, y: m.y, z: m.z, w: m.w, h: m.h, ry: m.ry });
  }

  return { facades, parts, people, signs, murals, buildings, rooftopBars };
}

/** 0 = day, 1 = full night (lights fade in 17:45-19:15, out 05:45-07:15). */
export function nightLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19.25 || h < 5.75) return 1;
  if (h >= 17.75) return (h - 17.75) / 1.5;
  if (h < 7.25) return 1 - (h - 5.75) / 1.5;
  return 0;
}

/** Position and heading along the viaduct polyline at distance s (clamped). */
export function viaductPoint(s: number, out: { x: number; z: number; heading: number }) {
  const pts = VIADUCT.points;
  let rem = Math.max(0, s);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (rem <= len || i === pts.length - 2) {
      const t = Math.min(1, rem / len);
      out.x = ax + (bx - ax) * t;
      out.z = az + (bz - az) * t;
      out.heading = Math.atan2(bx - ax, bz - az);
      return out;
    }
    rem -= len;
  }
  return out;
}

export function viaductLength() {
  const pts = VIADUCT.points;
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}
