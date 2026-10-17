// The Old Town's landmarks, baked into merged geometry: a St Paul's-style domed cathedral (hero), a gothic
// abbey, a castle keep on its mound, the market hall with its clock turret, a university quad, parish
// churches with spires, the town walls with towers and gatehouses, and the canal (walls, lock, bridges, boats).
import { CLOSE, MARKET, OLD_TOWN, ovalPoint } from "../../districts/oldTown";
import { getNode } from "../../roads";
import { GeoBuilder, T, jitter, pick } from "./kit";
import { distToSeg, mulberry32, type OldTownLayout, type P, type Seg } from "./layout";

/** Heights of the flat surfaces: clear of the Ground module's cobbles (0.008) and, for squares, of the roads. */
export const FLAT = { water: 0.08, lawn: 0.09, pave: 0.1, path: 0.12, square: 0.15 } as const;

export interface LandmarkGeo {
  stone: GeoBuilder; // flood-lit at night
  glow: GeoBuilder; // stained glass, lanterns, clock faces: emissive at night
}

const PORTLAND = "#ebe5d6";
const PORTLAND2 = "#dcd4c0";
const LEAD = "#8c979e";
const GOLD = "#e3b84b";
const GOTHIC = "#b9ae98";
const GOTHIC2 = "#a59a85";
const KEEP = "#a8a090";
const HONEY = "#d5c398";
const SLATE = "#56606c";
const WALLSTONE = "#a99f8b";

const TAU = Math.PI * 2;
function ring(n: number, fn: (a: number, i: number) => void) {
  for (let i = 0; i < n; i++) fn((i / n) * TAU, i);
}

// ---- Cathedral ------------------------------------------------------------------------------------

function cathedral(g: LandmarkGeo) {
  const s = g.stone;
  const gl = g.glow;
  const C = OLD_TOWN.cathedral;
  s.setFrame(C.x, 0, C.z, C.ry);
  gl.setFrame(C.x, 0, C.z, C.ry);

  // plinth and west steps
  s.box(PORTLAND2, -3, 0, 0, 76, 1, 22);
  for (let i = 0; i < 3; i++) s.box(PORTLAND2, -38.5 + i * 0.8, 0, 0, 3.2 - i * 0.8, 0.35 * (i + 1), 20 - i);

  // nave + choir, clerestory, roof
  s.box(PORTLAND, -4, 1, 0, 62, 19, 18);
  s.box(PORTLAND2, -4, 20, 0, 62, 0.7, 18.6); // cornice
  s.box(PORTLAND, -4, 20.7, 0, 62, 5, 12);
  s.add(T.prism, LEAD, -4, 25.7, 0, 62, 3.4, 12.6);
  // pilasters and two tiers of windows along both sides
  for (let x = -33; x <= 25; x += 4.4)
    for (const side of [1, -1]) {
      s.box(PORTLAND2, x, 1, side * 9.1, 0.9, 19, 0.5);
      if (Math.abs(x + 4) > 1 && Math.abs(x - 2) > 9) {
        gl.add(T.plane, "#ffcf86", x + 2.2, 7, side * 9.06, 1.6, 4.2, 1, side > 0 ? 0 : Math.PI);
        gl.add(T.plane, "#ffd99c", x + 2.2, 14.5, side * 9.06, 1.4, 3, 1, side > 0 ? 0 : Math.PI);
      }
    }
  // apse
  s.add(T.cyl16, PORTLAND, 27, 10.5, 0, 17, 19, 17);
  s.add(T.dome, LEAD, 27, 20, 0, 17, 6, 17);

  // transepts with semicircular porches
  s.box(PORTLAND, 2, 1, 0, 18, 19, 50);
  s.box(PORTLAND2, 2, 20, 0, 18.6, 0.7, 50.6);
  s.box(PORTLAND, 2, 20.7, 0, 12, 5, 50);
  s.add(T.prism, LEAD, 2, 25.7, 0, 50, 3.4, 12.6, Math.PI / 2);
  for (const side of [1, -1]) {
    s.add(T.cyl16, PORTLAND2, 2, 6.5, side * 25, 11, 11, 11);
    s.add(T.dome, LEAD, 2, 12, side * 25, 11, 4.5, 11);
    ring(10, (a) => {
      const z = side * 25 + Math.sin(a) * 6;
      if ((z - side * 25) * side < 0) return;
      s.add(T.cyl8, PORTLAND, 2 + Math.cos(a) * 6, 6.5, z, 0.9, 11, 0.9);
    });
    // pediment on the transept front
    s.add(T.prism, PORTLAND, 2, 20.7, side * 25.3, 1.2, 4.5, 18.6, Math.PI / 2);
  }

  // the dome: base, peristyle drum, attic, dome, lantern, golden ball and cross
  const dx = 2;
  s.box(PORTLAND, dx, 1, 0, 26, 28, 26);
  s.add(T.cyl16, PORTLAND2, dx, 29.5, 0, 31.5, 1.2, 31.5);
  s.add(T.cyl16, PORTLAND, dx, 35.5, 0, 25, 12, 25);
  ring(28, (a) => s.add(T.cyl8, PORTLAND, dx + Math.cos(a) * 14.4, 35.6, Math.sin(a) * 14.4, 1.05, 11, 1.05));
  ring(14, (a) => gl.add(T.plane, "#ffd28e", dx + Math.cos(a) * 12.55, 35, Math.sin(a) * 12.55, 1.6, 5.5, 1, Math.PI / 2 - a));
  s.add(T.cyl16, PORTLAND2, dx, 41.8, 0, 31.5, 1.4, 31.5);
  s.add(T.cyl16, PORTLAND, dx, 43.3, 0, 29.5, 1.6, 29.5); // balustrade
  s.add(T.cyl16, PORTLAND, dx, 46.5, 0, 23.5, 5.2, 23.5); // attic
  ring(16, (a) => gl.add(T.plane, "#ffdca6", dx + Math.cos(a) * 11.8, 46.5, Math.sin(a) * 11.8, 1.2, 2.2, 1, Math.PI / 2 - a));
  s.add(T.cyl16, PORTLAND2, dx, 49.3, 0, 24.5, 0.6, 24.5);
  s.add(T.dome, LEAD, dx, 49.6, 0, 23.6, 16.5, 23.6);
  // ribs on the dome (thin vertical fins following the curve)
  ring(16, (a) => {
    for (let k = 0; k < 5; k++) {
      const t0 = (k / 5) * (Math.PI / 2);
      const t1 = ((k + 1) / 5) * (Math.PI / 2);
      const r0 = 11.85 * Math.cos(t0);
      const r1 = 11.85 * Math.cos(t1);
      const y0 = 49.6 + 16.5 * Math.sin(t0);
      const y1 = 49.6 + 16.5 * Math.sin(t1);
      const rm = ((r0 + r1) / 2) * 1.025;
      const len = Math.hypot(r1 - r0, y1 - y0);
      s.add(T.box, "#9da8ae", dx + Math.cos(a) * rm, (y0 + y1) / 2, Math.sin(a) * rm, 0.35, len, 0.35, -a, 0, Math.atan2(r0 - r1, y1 - y0) * 1);
    }
  });
  // lantern
  s.add(T.cyl8, PORTLAND, dx, 66.5, 0, 4.6, 0.8, 4.6);
  s.add(T.cyl8, PORTLAND, dx, 69.5, 0, 3.6, 5.5, 3.6);
  ring(8, (a) => s.add(T.cyl8, PORTLAND2, dx + Math.cos(a) * 2.4, 69.5, Math.sin(a) * 2.4, 0.45, 5.4, 0.45));
  ring(8, (a) => gl.add(T.plane, "#ffe2b0", dx + Math.cos(a) * 1.82, 69.5, Math.sin(a) * 1.82, 1, 3, 1, Math.PI / 2 - a));
  s.add(T.dome, LEAD, dx, 72.2, 0, 4, 2.6, 4);
  s.add(T.cyl8, LEAD, dx, 75.4, 0, 0.8, 1.6, 0.8);
  s.add(T.sphere, GOLD, dx, 76.8, 0, 1.6, 1.6, 1.6);
  s.box(GOLD, dx, 77.4, 0, 0.3, 2.6, 0.3);
  s.box(GOLD, dx, 78.5, 0, 0.3, 0.3, 1.5);

  // west front: twin baroque towers
  for (const side of [1, -1]) {
    const z = side * 12.5;
    const x = -30;
    s.box(PORTLAND, x, 1, z, 9, 23, 9);
    s.box(PORTLAND2, x, 24, z, 9.6, 0.8, 9.6);
    s.add(T.cyl16, PORTLAND, x, 28.8, z, 6.6, 9, 6.6);
    ring(8, (a) => s.add(T.cyl8, PORTLAND2, x + Math.cos(a) * 4.1, 28.8, z + Math.sin(a) * 4.1, 0.75, 9, 0.75));
    gl.add(T.plane, "#ffd28e", x - 3.35, 28.8, z, 1.2, 3.5, 1, -Math.PI / 2);
    s.add(T.cyl16, PORTLAND2, x, 33.6, z, 9.4, 0.7, 9.4);
    s.add(T.dome, LEAD, x, 34, z, 6.4, 5, 6.4);
    s.add(T.cyl8, PORTLAND, x, 40.2, z, 2.2, 3, 2.2);
    s.add(T.sphere, GOLD, x, 42.4, z, 1.4, 2, 1.4);
    // clock on the south-west tower face
    if (side > 0) gl.add(T.cyl16, "#fff2d2", x - 4.56, 18, z, 3.2, 0.1, 3.2, 0, 0, Math.PI / 2);
  }
  // two-tier portico with pediment
  for (let i = 0; i < 8; i++) {
    const z = -8.2 + (16.4 * i) / 7;
    s.add(T.cyl8, PORTLAND, -36.6, 6.2, z, 1.25, 10.4, 1.25);
    if (i > 0 && i < 7) s.add(T.cyl8, PORTLAND, -36.4, 15.6, z, 1.05, 7.8, 1.05);
  }
  s.box(PORTLAND2, -35.6, 11.4, 0, 3.6, 1.3, 19);
  s.box(PORTLAND2, -35.4, 19.5, 0, 3.2, 1.2, 15);
  s.add(T.prism, PORTLAND, -35.6, 20.7, 0, 3.4, 4.8, 15.6);
  s.box(PORTLAND, -33.6, 1, 0, 2, 20.7, 17); // front wall behind the columns
  gl.add(T.plane, "#ffcf86", -34.65, 5.2, 0, 3.4, 6, 1, -Math.PI / 2); // great west door glow
}

// ---- Abbey (gothic) -------------------------------------------------------------------------------

function abbey(g: LandmarkGeo) {
  const s = g.stone;
  const gl = g.glow;
  const A = OLD_TOWN.abbey;
  s.setFrame(A.x, 0, A.z, 0);
  gl.setFrame(A.x, 0, A.z, 0);
  const GLASS = ["#5f8cff", "#ff5a5a", "#ffc65a", "#9b6bff"];
  s.box(GOTHIC, 0, 0, 0, 40, 16, 12);
  s.add(T.prism, SLATE, 0, 16, 0, 40, 8.5, 13);
  for (const side of [1, -1]) {
    s.box(GOTHIC2, 0, 0, side * 8.6, 36, 8.5, 5.2);
    s.add(T.box, SLATE, 0, 9.2, side * 8.4, 36, 0.5, 6, 0, side * 0.32, 0);
    for (let x = -16; x <= 16; x += 4) {
      s.box(GOTHIC2, x, 0, side * 11.4, 1, 10.5, 1.4);
      s.add(T.cone4, GOTHIC, x, 11.7, side * 11.4, 1.1, 2.4, 1.1, Math.PI / 4);
      if (x < 16) {
        gl.add(T.plane, pick(GLASS, ((x + 16) / 4 + (side > 0 ? 0 : 1)) % 4 / 4), x + 2, 4.5, side * 11.24, 1.3, 4.5, 1, side > 0 ? 0 : Math.PI);
        gl.add(T.plane, pick(GLASS, ((x + 17) / 4) % 4 / 4), x + 2, 12.4, side * 6.04, 1.1, 3.4, 1, side > 0 ? 0 : Math.PI);
      }
    }
  }
  // transept + crossing tower with spire
  s.box(GOTHIC, 6, 0, 0, 10, 16, 30);
  s.add(T.prism, SLATE, 6, 16, 0, 30, 8.5, 11, Math.PI / 2);
  for (const side of [1, -1]) gl.add(T.cyl16, "#ff9d5a", 6, 10, side * 15.05, 4.5, 0.1, 4.5, 0, Math.PI / 2, 0);
  s.box(GOTHIC, 6, 0, 0, 10, 31, 10);
  for (const [px, pz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    s.box(GOTHIC2, 6 + px * 4.6, 0, pz * 4.6, 1.6, 33, 1.6);
    s.add(T.cone4, GOTHIC, 6 + px * 4.6, 35, pz * 4.6, 1.8, 4, 1.8, Math.PI / 4);
  }
  for (const side of [1, -1]) {
    gl.add(T.plane, "#ffd28e", 6, 25, side * 5.04, 1.4, 4.5, 1, side > 0 ? 0 : Math.PI);
    gl.add(T.plane, "#ffd28e", 6 + side * 5.04, 25, 0, 1.4, 4.5, 1, side * Math.PI / 2);
  }
  s.add(T.cone8, "#7d8590", 6, 43, 0, 8.5, 24, 8.5);
  s.box(GOLD, 6, 55, 0, 0.25, 2, 0.25);
  // twin west towers with spires, rose window between
  for (const side of [1, -1]) {
    const z = side * 5.6;
    s.box(GOTHIC, -21, 0, z, 7, 25, 7);
    for (const px of [-1, 1]) for (const pz of [-1, 1]) s.add(T.cone4, GOTHIC2, -21 + px * 3, 26.5, z + pz * 3, 1.3, 3.2, 1.3, Math.PI / 4);
    s.add(T.cone8, "#7d8590", -21, 34, z, 6, 18, 6);
    gl.add(T.plane, "#ffd28e", -24.55, 18, z, 1.2, 4, 1, -Math.PI / 2);
  }
  s.box(GOTHIC, -21, 0, 0, 3, 18, 5);
  s.add(T.prism, GOTHIC2, -21, 18, 0, 3, 4, 5.4);
  gl.add(T.cyl16, "#ff7a6b", -22.56, 11.5, 0, 4.2, 0.1, 4.2, 0, 0, Math.PI / 2);
  gl.add(T.plane, "#ffcf86", -22.56, 3, 0, 2.2, 4.4, 1, -Math.PI / 2);
  // graveyard
  const r = mulberry32(77);
  for (let i = 0; i < 26; i++) {
    const x = -18 + r() * 36;
    const z = (r() < 0.5 ? -1 : 1) * (13.4 + r() * 3);
    s.box(r() < 0.2 ? "#8f9590" : "#a7a69c", x, 0, z, 0.7, 0.9 + r() * 0.5, 0.2, (r() - 0.5) * 0.2);
  }
}

// ---- Castle keep on its mound ---------------------------------------------------------------------

export const CASTLE_FLAG = { x: OLD_TOWN.castle.x + 6.1, y: 34.4, z: OLD_TOWN.castle.z - 6 };

function castle(g: LandmarkGeo) {
  const s = g.stone;
  const K = OLD_TOWN.castle;
  s.setFrame(K.x, 0, K.z, 0);
  g.glow.setFrame(K.x, 0, K.z, 0);
  s.add(T.frustum12, "#6f8d4b", 0, 4.75, 0, K.r * 2, 10.5, K.r * 2);
  s.add(T.cyl16, "#5e7b3f", 0, 0, 0, K.r * 2 + 1, 0.6, K.r * 2 + 1);
  // shell wall on the summit
  ring(18, (a) => {
    s.add(T.box, WALLSTONE, Math.cos(a) * 10.5, 11.6, Math.sin(a) * 10.5, 1.4, 3.4, 3.8, -a);
    s.add(T.box, WALLSTONE, Math.cos(a + 0.1) * 10.5, 13.8, Math.sin(a + 0.1) * 10.5, 1.3, 1, 1.1, -a);
  });
  // the keep
  s.box(KEEP, 0, 10, 0, 12, 17, 12);
  for (const [px, pz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    s.add(T.cyl8, KEEP, px * 6, 19.75, pz * 6, 3.8, 19.5, 3.8);
    ring(6, (a) => s.add(T.box, KEEP, px * 6 + Math.cos(a) * 1.6, 30, pz * 6 + Math.sin(a) * 1.6, 0.8, 1, 0.8, -a));
  }
  for (let i = -2; i <= 2; i++)
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = ax ? ax * 6 : i * 2;
      const z = az ? az * 6 : i * 2;
      s.box(KEEP, x, 27, z, 1, 1.1, 1);
    }
  for (const side of [1, -1])
    for (const y of [15, 20]) {
      g.glow.add(T.plane, "#ffcf86", -2, y, side * 6.03, 0.7, 1.6, 1, side > 0 ? 0 : Math.PI);
      g.glow.add(T.plane, "#ffcf86", 2, y + 2, side * 6.03, 0.7, 1.6, 1, side > 0 ? 0 : Math.PI);
    }
  // forebuilding stair up the mound on the south
  s.add(T.box, "#9b927f", 0, 5.2, 13.6, 3.2, 0.8, 15.5, 0, 0.62, 0);
  s.box(KEEP, 0, 10, 7.6, 5, 9, 3.4);
  // flag pole on the NE turret
  s.box("#3b3b3b", 6, 30, -6, 0.2, 5.5, 0.2);
}

// ---- Market hall + stalls -------------------------------------------------------------------------

export const CLOCK = { x: MARKET.x, y: 17.4, z: MARKET.z, half: 1.64 };

function marketHall(g: LandmarkGeo, L: OldTownLayout) {
  const s = g.stone;
  s.setFrame(MARKET.x, 0, MARKET.z, 0);
  g.glow.setFrame(MARKET.x, 0, MARKET.z, 0);
  s.box("#9d9585", 0, 0, 0, 19, 0.4, 10);
  for (let i = 0; i < 6; i++)
    for (const z of [-4, 4]) s.add(T.cyl8, "#b4a68a", -7.5 + i * 3, 2.2, z, 0.75, 3.6, 0.75);
  s.box("#efe4cb", 0, 4, 0, 18, 4.6, 9.6);
  for (let x = -8.5; x <= 8.5; x += 1.7) for (const z of [4.82, -4.82]) s.add(T.plane, "#3a2a1f", x, 6.3, z, 0.22, 4.6, 1, z > 0 ? 0 : Math.PI);
  for (const z of [4.82, -4.82]) s.add(T.plane, "#3a2a1f", 0, 4.1, z, 18, 0.25, 1, z > 0 ? 0 : Math.PI);
  for (let x = -6; x <= 6; x += 3) for (const z of [4.84, -4.84]) g.glow.add(T.plane, "#ffcf86", x, 6.6, z, 1.3, 1.6, 1, z > 0 ? 0 : Math.PI);
  s.add(T.hip, "#94503a", 0, 8.6, 0, 19.6, 4.6, 11);
  // clock turret + cupola + weathervane
  s.box("#efe4cb", 0, 11.5, 0, 3.6, 7.4, 3.6);
  s.box("#3a2a1f", 0, 18.9, 0, 4, 0.4, 4);
  s.add(T.cyl8, "#efe4cb", 0, 20.2, 0, 2.6, 2.2, 2.6);
  s.add(T.dome, "#6f9a8c", 0, 21.3, 0, 3, 3, 3);
  s.box(GOLD, 0, 22.8, 0, 0.12, 2.4, 0.12);
  s.box(GOLD, 0.4, 24.6, 0, 1.2, 0.5, 0.06);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    g.glow.add(T.cyl16, "#fff5dc", Math.sin(a) * 1.84, CLOCK.y, Math.cos(a) * 1.84, 2.6, 0.08, 2.6, a, Math.PI / 2, 0);
  }
  // stalls round the square: striped canopies
  const CANOPY = ["#c0392b", "#2e86c1", "#27ae60", "#f39c12", "#8e44ad", "#16a085"];
  for (const st of L.stalls) {
    s.setFrame(st.x, 0, st.z, st.ry);
    const c = pick(CANOPY, st.seed);
    for (const [px, pz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) s.box("#5b4636", px, 0, pz, 0.1, 2.3, 0.1);
    s.box("#8b6b4a", 0, 0.8, 0.2, 2.6, 0.12, 1.4);
    s.box(jitter("#e8b04a", st.seed * 7 % 1, 0.4), 0, 0.92, 0.2, 2.3, 0.25, 1.1); // produce
    for (let i = 0; i < 4; i++) s.add(T.box, i % 2 ? "#f4efe4" : c, -1.05 + i * 0.7, 2.45, 0, 0.7, 0.12, 2.3, 0, 0.18, 0);
  }
}

// ---- University quad ------------------------------------------------------------------------------

function university(g: LandmarkGeo) {
  const s = g.stone;
  const gl = g.glow;
  const U = OLD_TOWN.university;
  s.setFrame(U.x, 0, U.z, 0);
  gl.setFrame(U.x, 0, U.z, 0);
  const hw = U.w / 2;
  const depth = 7;
  const ranges: [number, number, number, number, number][] = [
    [0, -hw + depth / 2, U.w, depth, 0], // north
    [0, hw - depth / 2, U.w, depth, 0], // south
    [-hw + depth / 2, 0, U.w - depth * 2, depth, Math.PI / 2], // west
    [hw - depth / 2, 0, U.w - depth * 2, depth, Math.PI / 2], // east (chapel: taller)
  ];
  ranges.forEach(([x, z, len, d, ry], i) => {
    const h = i === 3 ? 15 : 11;
    s.box(HONEY, x, 0, z, ry ? d : len, h, ry ? len : d);
    s.add(T.prism, SLATE, x, h, z, len + 0.4, i === 3 ? 6 : 4, d + 0.4, ry);
    // battlements + windows on both faces
    const n = Math.floor(len / 2.6);
    for (let k = 0; k < n; k++) {
      const t = -len / 2 + (len / n) * (k + 0.5);
      for (const side of [1, -1]) {
        const lx = ry ? x + side * (d / 2 + 0.03) : x + t;
        const lz = ry ? z + t : z + side * (d / 2 + 0.03);
        const fr = ry ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? 0 : Math.PI;
        if (i === 3) gl.add(T.plane, k % 2 ? "#ffc65a" : "#ff8a5a", lx, 8, lz, 1.3, 7, 1, fr);
        else for (const y of [3, 7.2]) gl.add(T.plane, "#ffd28e", lx, y, lz, 0.9, 1.7, 1, fr);
      }
    }
    if (i === 3)
      for (let k = 0; k <= 4; k++) s.add(T.cone4, HONEY, x + d / 2, 17, z - len / 2 + (len * k) / 4, 1, 4, 1, Math.PI / 4);
  });
  // gate tower on the north range, with corner turrets
  s.box(HONEY, 0, 0, -hw + depth / 2, 8, 19, 8.6);
  for (const px of [-1, 1]) for (const pz of [-1, 1]) {
    s.add(T.cyl8, HONEY, px * 4, 11, -hw + depth / 2 + pz * 4.3, 2, 22, 2);
    s.add(T.cone8, "#7d8590", px * 4, 23.2, -hw + depth / 2 + pz * 4.3, 2.4, 2.6, 2.4);
  }
  gl.add(T.plane, "#ffcf86", 0, 12, -hw - 0.85, 1.6, 3, 1, Math.PI);
  s.box("#3a2a1f", 0, 0, -hw - 0.75, 3.2, 4.4, 0.2);
}

// ---- Parish churches ------------------------------------------------------------------------------

function churches(g: LandmarkGeo) {
  const s = g.stone;
  OLD_TOWN.churches.forEach((ch, i) => {
    const r = mulberry32(400 + i);
    const stone = jitter(i === 1 ? "#c9b48e" : GOTHIC, r(), 0.08);
    s.setFrame(ch.x, 0, ch.z, ch.ry);
    g.glow.setFrame(ch.x, 0, ch.z, ch.ry);
    s.box(stone, 3, 0, 0, 22, 10, 10);
    s.add(T.prism, SLATE, 3, 10, 0, 22, 6, 10.6);
    s.box(stone, 12, 0, 0, 6, 8, 7); // chancel
    s.add(T.prism, SLATE, 12, 8, 0, 6, 4, 7.4);
    s.box(stone, -11, 0, 0, 6.4, 20, 6.4); // tower
    for (const px of [-1, 1]) for (const pz of [-1, 1]) s.add(T.cone4, stone, -11 + px * 2.8, 21.2, pz * 2.8, 0.9, 2.4, 0.9, Math.PI / 4);
    s.add(T.cone8, "#6e7680", -11, 30, 0, 5, 20, 5);
    s.box(GOLD, -11, 40, 0, 0.2, 1.6, 0.2);
    for (let x = -5; x <= 11; x += 4)
      for (const side of [1, -1]) g.glow.add(T.plane, x % 8 ? "#ffc65a" : "#7fa3ff", x, 5, side * 5.03, 1.1, 3.8, 1, side > 0 ? 0 : Math.PI);
    g.glow.add(T.cyl16, "#fff2d2", -14.25, 15, 0, 2, 0.08, 2, 0, 0, Math.PI / 2);
  });
}

// ---- Town walls, towers and gatehouses ------------------------------------------------------------

function walls(g: LandmarkGeo, L: OldTownLayout) {
  const s = g.stone;
  s.setFrame();
  for (const w of L.walls) {
    const [ax, az] = w.a;
    const [bx, bz] = w.b;
    const len = Math.hypot(bx - ax, bz - az) + 0.4;
    const ry = -Math.atan2(bz - az, bx - ax);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    s.add(T.box, WALLSTONE, mx, 3.25, mz, len, 7.5, 2.6, ry);
    // merlons on the outer edge
    const nx = Math.sin(-ry);
    const ux = Math.cos(ry);
    const uz = -Math.sin(ry);
    const ox = -uz; // a perpendicular
    const oz = ux;
    const out = Math.sign((mx - -655) * ox + (mz - -20) * oz) || 1;
    for (let t = -len / 2 + 0.6; t < len / 2; t += 1.7)
      s.add(T.box, WALLSTONE, mx + ux * t + ox * out * 1.0, 7.5, mz + uz * t + oz * out * 1.0, 0.9, 1, 0.6, ry);
    void nx;
  }
  for (const [x, z] of L.wallTowers) {
    s.add(T.cyl16, "#9e9480", x, 4.75, z, 7, 10.5, 7);
    ring(8, (a) => s.add(T.box, "#9e9480", x + Math.cos(a) * 3.2, 10.5, z + Math.sin(a) * 3.2, 1, 1, 1, -a));
  }
}

function gatehouse(g: LandmarkGeo, at: P, dir: P, grand: boolean) {
  const s = g.stone;
  const ry = Math.atan2(dir[0], dir[1]); // local +z along the road
  s.setFrame(at[0], 0, at[1], ry);
  g.glow.setFrame(at[0], 0, at[1], ry);
  const half = 9; // tower edges stay clear of the 8 m carriageway
  for (const side of [-1, 1]) {
    if (grand) {
      s.add(T.cyl16, WALLSTONE, side * half, 7.75, 0, 8, 16.5, 8);
      ring(10, (a) => s.add(T.box, WALLSTONE, side * half + Math.cos(a) * 3.6, 16.5, Math.sin(a) * 3.6, 1.1, 1.1, 1, -a));
      s.add(T.cone8, "#5c6570", side * half, 19.5, 0, 8.6, 5.5, 8.6);
      g.glow.add(T.plane, "#ffcf86", side * half, 11, 4.03, 0.8, 1.6, 1, 0);
    } else s.box(WALLSTONE, side * (half - 1), 0, 0, 3.4, 14, 7);
  }
  // the arch block over the road (traffic passes beneath: 8 m clearance)
  s.box(WALLSTONE, 0, 8, 0, half * 2, grand ? 6.5 : 6, grand ? 7 : 6.4);
  for (let x = -half; x <= half; x += 1.8) for (const z of [-3.2, 3.2]) s.box(WALLSTONE, x, grand ? 14.5 : 14, z, 0.9, 1.1, 0.6);
  s.box("#2e2620", 0, 7.7, 0, 8.2, 0.5, grand ? 7.2 : 6.6); // shadowed arch soffit
  if (grand) {
    s.add(T.prism, "#5c6570", 0, 14.5, 0, half * 2 - 4, 3.5, 6);
    g.glow.add(T.plane, "#ffcf86", 0, 11, 3.53, 1, 1.8, 1, 0);
    g.glow.add(T.plane, "#ffcf86", 0, 11, -3.53, 1, 1.8, 1, Math.PI);
  }
}

// ---- Canal: water ribbon, walls, towpath, lock, bridges, moored boats -------------------------------

export function canalFrame(dist: number): { x: number; z: number; dx: number; dz: number } {
  const pts = OLD_TOWN.canal.points;
  let d = dist;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (d <= len || i === pts.length - 2) {
      const t = Math.min(1, d / len);
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
    }
    d -= len;
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
}

export const CANAL_LENGTH = OLD_TOWN.canal.points.reduce(
  (acc, p, i, a) => (i ? acc + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0),
  0,
);

/** Where roads cross the canal (bridge sites): position and road direction. */
export function canalCrossings(segs: readonly Seg[]): { x: number; z: number; ux: number; uz: number }[] {
  const pts = OLD_TOWN.canal.points;
  const out: { x: number; z: number; ux: number; uz: number }[] = [];
  for (const s of segs)
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const d1x = s.bx - s.ax;
      const d1z = s.bz - s.az;
      const d2x = bx - ax;
      const d2z = bz - az;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-6) continue;
      const t = ((ax - s.ax) * d2z - (az - s.az) * d2x) / den;
      const u = ((ax - s.ax) * d1z - (az - s.az) * d1x) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const len = Math.hypot(d1x, d1z);
      out.push({ x: s.ax + d1x * t, z: s.az + d1z * t, ux: d1x / len, uz: d1z / len });
    }
  return out;
}

export function boatParts(b: GeoBuilder, len: number, cabin: string, trim: string) {
  b.box("#1d2420", 0, 0, 0, 2.1, 0.7, len); // hull
  b.add(T.prism, "#1d2420", 0, 0, len / 2 + 0.6, 2.1, 0.7, 1.2, Math.PI / 2, 0, 0); // bow
  b.box(cabin, 0, 0.7, -0.6, 1.9, 1.15, len - 3.4);
  b.box(trim, 0, 1.2, -0.6, 1.94, 0.18, len - 3.3);
  b.box("#3a3a3a", 0, 1.85, -0.6, 1.7, 0.08, len - 3.6);
  b.add(T.cyl8, "#141414", 0.4, 2.3, len / 2 - 3.6, 0.22, 0.9, 0.22); // stove chimney
  b.box("#2f6b2f", -0.3, 1.9, -len / 2 + 4, 0.5, 0.35, 1.6); // roof plants
}

function canal(g: LandmarkGeo, L: OldTownLayout, pave: GeoBuilder, water: GeoBuilder) {
  const s = g.stone;
  s.setFrame();
  const C = OLD_TOWN.canal;
  const pts = C.points;
  const crossingsAll = canalCrossings(L.segs);
  const nearRoad = (x: number, z: number, pad: number) => L.segs.some((sg) => distToSeg(x, z, sg) < pad);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = -Math.atan2(bz - az, bx - ax);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const nx = -uz;
    const nz = ux;
    const tside = nz < 0 ? 1 : -1; // towpath on the north bank (-z side)
    const n = Math.ceil(len / 3);
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * len;
      const x = ax + ux * t;
      const z = az + uz * t;
      const pl = len / n + 0.05;
      const bridged = crossingsAll.some((c) => Math.hypot(c.x - x, c.z - z) < 9) && nearRoad(x, z, 5.2);
      if (!bridged) water.add(T.box, "#2f5f6e", x, FLAT.water, z, pl, 0.004, C.width, ry);
      const tx = x + nx * tside * (C.width / 2 + 2.2);
      const tz = z + nz * tside * (C.width / 2 + 2.2);
      if (!nearRoad(tx, tz, 5.6)) pave.add(T.box, "#a39886", tx, FLAT.pave, tz, pl, 0.004, 3.2, ry);
      for (const side of [-1, 1]) {
        const cx = x + nx * side * (C.width / 2 + 0.3);
        const cz = z + nz * side * (C.width / 2 + 0.3);
        if (!nearRoad(cx, cz, 4.4)) s.add(T.box, "#8d8577", cx, 0.1, cz, pl, 0.6, 0.7, ry);
      }
    }
  }
  // lock: chamber walls, two pairs of mitre gates with black-and-white balance beams
  const [lx, lz] = C.lock;
  s.setFrame(lx, 0, lz, 0);
  s.box("#8d8577", 0, 0, -3.6, 18, 0.6, 1.2);
  s.box("#8d8577", 0, 0, 3.6, 18, 0.6, 1.2);
  for (const gx of [-8, 8]) {
    for (const side of [-1, 1]) {
      s.add(T.box, "#3b2b1e", gx, 0.6, side * 1.55, 0.5, 1.6, 3.4, side * 0.35);
      s.add(T.box, "#f2f2ee", gx - Math.sign(gx) * 2.2, 1.25, side * 5.2, 4.6, 0.3, 0.3, side * 0.25);
      s.add(T.box, "#1b1b1b", gx - Math.sign(gx) * 4.2, 1.25, side * 5.7, 0.8, 0.32, 0.32, side * 0.25);
    }
  }
  s.box("#5a3d28", 0, 0.6, -5.4, 1.8, 0.5, 0.5); // lock-keeper's bench
  // bridges: stone parapets where lanes cross
  s.setFrame();
  for (const c of canalCrossings(L.segs)) {
    const ry = -Math.atan2(c.uz, c.ux);
    for (const side of [-1, 1]) {
      const ox = -c.uz * side * 4.6;
      const oz = c.ux * side * 4.6;
      s.add(T.box, "#b3a68f", c.x + ox, 0.65, c.z + oz, 19, 1.3, 0.7, ry);
      for (const e of [-1, 1]) s.add(T.box, "#a3967f", c.x + ox + c.ux * e * 9.5, 0.8, c.z + oz + c.uz * e * 9.5, 1.2, 1.6, 1.2, ry);
    }
  }
  // moored narrowboats along the south bank
  const r = mulberry32(31);
  const crossings = canalCrossings(L.segs);
  const CABIN = ["#8b1e24", "#1f5a3a", "#1f3a6b", "#5a2a5a", "#8a5a1e"];
  const TRIMS = ["#f0c84a", "#f2ece0", "#e6a03a"];
  for (let d = 30; d < CANAL_LENGTH - 20; d += 24 + r() * 14) {
    const f = canalFrame(d);
    if (Math.hypot(f.x - lx, f.z - lz) < 22) continue;
    if (crossings.some((c) => Math.hypot(c.x - f.x, c.z - f.z) < 16)) continue;
    const side = 1;
    const x = f.x - f.dz * side * 3.6;
    const z = f.z + f.dx * side * 3.6;
    const len = 14 + r() * 5;
    s.setFrame(x, 0, z, Math.atan2(f.dx, f.dz) + (r() < 0.5 ? Math.PI : 0));
    boatParts(s, len, pick(CABIN, r()), pick(TRIMS, r()));
  }
}

// ---- Ground: paving, plazas, lawns ----------------------------------------------------------------

function grounds(pave: GeoBuilder, lawn: GeoBuilder, segs: readonly Seg[]) {
  pave.setFrame();
  lawn.setFrame();
  const F = FLAT;
  // churchyard lawn (kept inside the loop road's inner kerb) + paved forecourt before the west front
  lawn.add(T.cyl16, "#6f9a4f", CLOSE.x, F.lawn, CLOSE.z, (CLOSE.rx - 6.5) * 2, 0.004, (CLOSE.rz - 6.5) * 2);
  pave.add(T.box, "#c9bfa9", CLOSE.x - 38, F.square, CLOSE.z, 6, 0.004, 22);
  // market square cobbles (inside the octagon's inner kerb)
  const mr = MARKET.r * Math.cos(Math.PI / 8) - 5;
  pave.add(T.cyl16, "#b2a48c", MARKET.x, F.square, MARKET.z, mr * 2, 0.004, mr * 2);
  // abbey close, castle green, university quad
  const A = OLD_TOWN.abbey;
  lawn.add(T.box, "#6a9449", A.x, F.lawn, A.z, A.len + 3, 0.004, A.wid + 3);
  const U = OLD_TOWN.university;
  lawn.add(T.box, "#78a650", U.x, F.lawn, U.z, U.w - 14, 0.004, U.d - 14);
  pave.add(T.box, "#d3c8af", U.x, F.path, U.z, 1.6, 0.004, U.d - 14);
  pave.add(T.box, "#d3c8af", U.x, F.path, U.z, U.w - 14, 0.004, 1.6);
  // garden square: lawn with diagonal paths and a fountain circle
  const G = OLD_TOWN.gardenSquare;
  const gw = G.hw * 2 - 12;
  const gd = G.hd * 2 - 12;
  lawn.add(T.box, "#6f9a4f", G.x, F.lawn, G.z, gw, 0.004, gd);
  const diag = Math.hypot(gw, gd) - 1;
  const ang = Math.atan2(gd, gw);
  pave.add(T.box, "#d3c8af", G.x, F.path, G.z, diag, 0.004, 1.6, ang);
  pave.add(T.box, "#d3c8af", G.x, F.path, G.z, diag, 0.004, 1.6, -ang);
  pave.add(T.cyl16, "#d3c8af", G.x, F.path + 0.01, G.z, 7, 0.004, 7);
  // crescent lawn (a fan of thin wedges inside the arc)
  const C = OLD_TOWN.crescent;
  for (let a = C.from; a < C.to; a += 5) {
    const t = ((a + 2.5) * Math.PI) / 180;
    const rr = C.r - 6.5;
    lawn.add(T.box, "#74a04f", C.x + Math.cos(t) * rr * 0.5, F.lawn, C.z + Math.sin(t) * rr * 0.5, rr, 0.004, (rr * 5.6 * Math.PI) / 180, -t);
  }
  // wall-walk green strip just outside the boulevard, broken where lanes leave through the gates
  for (let a = 0; a < 360; a += 3) {
    const [ax, az] = ovalPoint(a, 10);
    const [bx, bz] = ovalPoint(a + 3, 10);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (segs.some((sg) => distToSeg(mx, mz, sg) < 8.5)) continue;
    lawn.add(T.box, "#6c8f48", mx, F.lawn, mz, Math.hypot(bx - ax, bz - az) + 0.6, 0.004, 7, -Math.atan2(bz - az, bx - ax));
  }
}

// ---- Railings ---------------------------------------------------------------------------------------

function railings(s: GeoBuilder) {
  s.setFrame();
  const IRON = "#1d2320";
  const G = OLD_TOWN.gardenSquare;
  const hw = G.hw - 5.3;
  const hd = G.hd - 5.3;
  for (const [x, z, sx, sz] of [
    [G.x, G.z - hd, hw * 2, 0.08], [G.x, G.z + hd, hw * 2, 0.08], [G.x - hw, G.z, 0.08, hd * 2], [G.x + hw, G.z, 0.08, hd * 2],
  ]) {
    s.box(IRON, x, 0, z, sx, 1.15, sz);
    s.box(IRON, x, 1.15, z, sx + 0.1, 0.06, sz + 0.1);
  }
  const C = OLD_TOWN.crescent;
  for (let a = C.from + 3; a < C.to - 3; a += 4) {
    const t0 = (a * Math.PI) / 180;
    const t1 = ((a + 4) * Math.PI) / 180;
    const rr = C.r - 5;
    const ax = C.x + Math.cos(t0) * rr;
    const az = C.z + Math.sin(t0) * rr;
    const bx = C.x + Math.cos(t1) * rr;
    const bz = C.z + Math.sin(t1) * rr;
    s.add(T.box, IRON, (ax + bx) / 2, 0.55, (az + bz) / 2, Math.hypot(bx - ax, bz - az) + 0.05, 1.1, 0.08, -Math.atan2(bz - az, bx - ax));
  }
}

// ---- All of it --------------------------------------------------------------------------------------

export function buildLandmarks(L: OldTownLayout) {
  const g: LandmarkGeo = { stone: new GeoBuilder(), glow: new GeoBuilder() };
  const pave = new GeoBuilder();
  const lawn = new GeoBuilder();
  const water = new GeoBuilder();
  const low = new GeoBuilder();
  cathedral(g);
  abbey(g);
  castle(g);
  marketHall(g, L);
  university(g);
  churches(g);
  walls(g, L);
  // the grand East Gate on the road to the farms, a simpler West Bar on the motorway road
  const gE = getNode("old_gate_E");
  const eOut = getNode("old_e_out");
  const dE: P = [eOut.x - gE.x, eOut.z - gE.z];
  const lE = Math.hypot(dE[0], dE[1]);
  const wallE = ovalPoint(OLD_TOWN.gates.E, 10);
  gatehouse(g, wallE, [dE[0] / lE, dE[1] / lE], true);
  const gW = getNode("old_gate_W");
  const wallW = ovalPoint(OLD_TOWN.gates.W, 10);
  const dW: P = [wallW[0] - gW.x, wallW[1] - gW.z];
  const lW = Math.hypot(dW[0], dW[1]);
  gatehouse(g, wallW, [dW[0] / lW, dW[1] / lW], false);
  canal(g, L, pave, water);
  grounds(pave, lawn, L.segs);
  railings(low);
  return { stone: g.stone, glow: g.glow, pave, lawn, water, low };
}
