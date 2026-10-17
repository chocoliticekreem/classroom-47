// Builds the government quarter's static geometry: a handful of merged, vertex-coloured meshes (one draw call per
// material) plus the flag cloth, the signs, the fountain jets and the police / helicopter part geometries.
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute } from "three";
import { GOV_CIRCUS } from "../../districts/government";
import { GeoBuilder, QuadBuilder, T, jitter } from "./kit";
import {
  BOLLARDS,
  CLOCK_TOWER,
  DOME,
  DS_GATE,
  EMBASSY,
  EMBASSY_H,
  FLAGS,
  FLAG_DIR,
  FOUNTAIN,
  GATE_PIERS,
  HELIPAD,
  HUTS,
  LAMPS,
  LAWN_RECTS,
  MINISTRY,
  MINISTRY_H,
  MONUMENT,
  NO10_DOOR,
  PARLIAMENT,
  PARLIAMENT_H,
  PAVE_RECT,
  POLICE,
  RES,
  TERRACE_E,
  TERRACE_H,
  TERRACE_W,
  TREES,
  mulberry32,
  type Rect,
} from "./layout";
import { SIGN, flagUV, signUV } from "./textures";

const WHITE = "#f4f1ea";
const WHITE2 = "#e6e0d2";
const PORTLAND = "#ddd5c2";
const SAND = "#d9c79a";
const LEAD = "#6f777d";
const SLATE = "#4b525a";
const IRON = "#1d1e21";
const GOLD = "#d4ad4c";
const COPPER = "#6fa592";
const GLASS = "#2e3d4c";
const BRICK_BLACK = "#2a2624";
const BRICK = "#74382a";
const LAWN = "#5e9c45";
const PAVE = "#cfc7b6";
const CONCRETE = "#9b9a95";

export const CLOCK_FACE_Y = 23.4;
export const CLOCK_CENTRE = {
  x: (CLOCK_TOWER.minX + CLOCK_TOWER.maxX) / 2,
  z: (CLOCK_TOWER.minZ + CLOCK_TOWER.maxZ) / 2,
  r: 2.92 + 0.08,
};

type Side = "n" | "s" | "e" | "w";

/** Windows on the faces of an axis-aligned block. Rows are window-bottom heights. Surrounds go to `trim`. */
function windowsOn(
  win: GeoBuilder,
  r: Rect,
  sides: Side[],
  rows: number[],
  ww: number,
  wh: number,
  spacing: number,
  rand: () => number,
  trim?: { b: GeoBuilder; color: string },
  skip?: (side: Side, along: number) => boolean,
) {
  for (const side of sides) {
    const alongX = side === "n" || side === "s";
    const a0 = alongX ? r.minX : r.minZ;
    const a1 = alongX ? r.maxX : r.maxZ;
    const n = Math.max(1, Math.floor((a1 - a0 - 1) / spacing));
    const pad = (a1 - a0 - (n - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + pad + i * spacing;
      if (skip?.(side, a)) continue;
      for (const y of rows) {
        const lit = rand();
        win.litValue = lit < 0.62 ? 0.45 + rand() * 0.55 : 0.04;
        const col = jitter(GLASS, rand(), 0.1);
        const o = 0.06;
        if (side === "s") win.add(T.box, col, a, y + wh / 2, r.maxZ + o, ww, wh, 0.14);
        else if (side === "n") win.add(T.box, col, a, y + wh / 2, r.minZ - o, ww, wh, 0.14);
        else if (side === "e") win.add(T.box, col, r.maxX + o, y + wh / 2, a, 0.14, wh, ww);
        else win.add(T.box, col, r.minX - o, y + wh / 2, a, 0.14, wh, ww);
        if (trim) {
          // a cornice cap above, and a sill below
          const tb = trim.b;
          const d = 0.22;
          if (side === "s") {
            tb.add(T.box, trim.color, a, y + wh + 0.18, r.maxZ + d / 2, ww + 0.5, 0.26, d);
            tb.add(T.box, trim.color, a, y - 0.08, r.maxZ + d / 2, ww + 0.3, 0.14, d);
          } else if (side === "n") {
            tb.add(T.box, trim.color, a, y + wh + 0.18, r.minZ - d / 2, ww + 0.5, 0.26, d);
            tb.add(T.box, trim.color, a, y - 0.08, r.minZ - d / 2, ww + 0.3, 0.14, d);
          } else if (side === "e") {
            tb.add(T.box, trim.color, r.maxX + d / 2, y + wh + 0.18, a, d, 0.26, ww + 0.5);
            tb.add(T.box, trim.color, r.maxX + d / 2, y - 0.08, a, d, 0.14, ww + 0.3);
          } else {
            tb.add(T.box, trim.color, r.minX - d / 2, y + wh + 0.18, a, d, 0.26, ww + 0.5);
            tb.add(T.box, trim.color, r.minX - d / 2, y - 0.08, a, d, 0.14, ww + 0.3);
          }
        }
      }
    }
  }
}

const block = (b: GeoBuilder, color: string, r: Rect, y0: number, y1: number, grow = 0) =>
  b.boxMinMax(color, r.minX - grow, y0, r.minZ - grow, r.maxX + grow, y1, r.maxZ + grow);

/** A column: base, shaft, capital. */
function column(b: GeoBuilder, x: number, z: number, y0: number, h: number, r: number, color = WHITE) {
  b.add(T.box, WHITE2, x, y0 + 0.2, z, r * 2.6, 0.4, r * 2.6);
  b.add(T.cyl12, color, x, y0 + 0.4 + (h - 0.8) / 2, z, r * 2, h - 0.8, r * 2);
  b.add(T.box, WHITE2, x, y0 + h - 0.2, z, r * 2.8, 0.4, r * 2.8);
}

export interface GovScene {
  facade: BufferGeometry | null;
  solid: BufferGeometry | null;
  windows: BufferGeometry | null;
  glow: BufferGeometry | null;
  ground: BufferGeometry | null;
  water: BufferGeometry | null;
  signs: BufferGeometry | null;
  flags: BufferGeometry;
  jets: BufferGeometry;
}

export function buildGovernment(): GovScene {
  const F = new GeoBuilder(); // floodlit white stone
  const S = new GeoBuilder(); // everything else solid
  const W = new GeoBuilder(true); // windows
  const G = new GeoBuilder(); // glowing lamps
  const GR = new GeoBuilder(); // ground surfaces
  const WA = new GeoBuilder(); // water
  const SG = new QuadBuilder(); // signs
  const rand = mulberry32(1600);

  // ---- Ground -----------------------------------------------------------------------------------------------
  GR.add(T.box, PAVE, (PAVE_RECT.minX + PAVE_RECT.maxX) / 2, 0.006, (PAVE_RECT.minZ + PAVE_RECT.maxZ) / 2, PAVE_RECT.maxX - PAVE_RECT.minX, 0.002, PAVE_RECT.maxZ - PAVE_RECT.minZ);
  for (const r of LAWN_RECTS) GR.add(T.box, LAWN, (r.minX + r.maxX) / 2, 0.011, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, 0.002, r.maxZ - r.minZ);
  // lawn stripes (mowing pattern) on the South Lawn
  for (let z = RES.fence.maxZ - 3; z > -186; z -= 6) GR.add(T.box, "#68a84d", 299, 0.016, z, 46, 0.002, 3);
  // the Circus island
  GR.add(T.cyl24, LAWN, GOV_CIRCUS.x, 0.016, GOV_CIRCUS.z, 10.4, 0.002, 10.4);
  // gravel forecourt under the north portico and the mailroom path
  GR.add(T.box, "#ddd2b8", 299, 0.016, -203.5, 18, 0.002, 4.5);
  GR.add(T.box, "#ddd2b8", 286, 0.016, -205.5, 9, 0.002, 2);

  // ---- The Residence -------------------------------------------------------------------------------------------
  const m = RES.main;
  block(F, WHITE2, m, 0, 1.2, 0.3); // rusticated base
  block(F, WHITE, m, 1.2, 12.4);
  block(F, WHITE2, m, 12.4, 13.0, 0.35); // cornice
  block(F, WHITE, m, 13.0, 14.0, 0.05); // balustrade band
  for (let x = m.minX + 0.6; x < m.maxX; x += 1.1) {
    F.add(T.box, WHITE2, x, 14.25, m.minZ + 0.1, 0.35, 0.5, 0.35);
    F.add(T.box, WHITE2, x, 14.25, m.maxZ - 0.1, 0.35, 0.5, 0.35);
  }
  S.add(T.hip, LEAD, (m.minX + m.maxX) / 2, 13.0, (m.minZ + m.maxZ) / 2, m.maxX - m.minX - 2, 2.6, m.maxZ - m.minZ - 2);
  for (const x of [289.5, 295.5, 302.5, 308.5]) F.add(T.box, WHITE2, x, 15.6, (m.minZ + m.maxZ) / 2, 0.9, 1.6, 2.2);
  windowsOn(W, m, ["s", "n"], [2.4, 6.4, 10.0], 1.15, 2.1, 2.6, rand, { b: F, color: WHITE2 }, (_side, a) => Math.abs(a - 299) < 4);
  windowsOn(W, m, ["e", "w"], [2.4, 6.4, 10.0], 1.15, 2.1, 2.6, rand, { b: F, color: WHITE2 });
  // south portico: bowed wall, a half-ring of columns, a curved entablature and balustrade
  const ps = RES.porticoS;
  F.add(T.halfCyl, WHITE2, ps.x, 0.6, ps.z, (ps.r + 0.8) * 2, 1.2, (ps.r + 0.8) * 2);
  F.add(T.halfCyl, WHITE, ps.x, 6.8, ps.z, 7, 11.2, 7);
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI * (k + 0.5)) / 6;
    column(F, ps.x + Math.cos(a) * (ps.r - 0.4), ps.z + Math.sin(a) * (ps.r - 0.4), 1.2, 10.6, 0.36);
  }
  F.add(T.halfCyl, WHITE2, ps.x, 12.4, ps.z, ps.r * 2 + 0.8, 1.2, ps.r * 2 + 0.8);
  F.add(T.halfCyl, WHITE, ps.x, 13.4, ps.z, ps.r * 2 + 0.2, 0.8, ps.r * 2 + 0.2);
  for (let k = 0; k < 3; k++) {
    const y = 2.6 + k * 3.6;
    W.litValue = 0.9;
    W.add(T.box, GLASS, ps.x, y + 1.0, ps.z + 3.45, 1.2, 2.0, 0.12);
  }
  // north portico: six columns and a pediment
  const pn = RES.porticoN;
  block(F, WHITE2, pn, 0, 1.2);
  for (let i = 0; i < 6; i++) column(F, pn.minX + 0.9 + i * 2.44, pn.minZ + 0.5, 1.2, 10.6, 0.4);
  column(F, pn.minX + 0.9, pn.maxZ - 0.9, 1.2, 10.6, 0.4);
  column(F, pn.maxX - 0.9, pn.maxZ - 0.9, 1.2, 10.6, 0.4);
  block(F, WHITE2, pn, 11.8, 13.0, 0.2);
  F.add(T.pediment, WHITE, 299, 13.0, (pn.minZ + pn.maxZ) / 2, pn.maxX - pn.minX + 0.4, 2.6, pn.maxZ - pn.minZ + 0.4);
  G.add(T.box, "#ffe2a0", 299, 7.2, pn.minZ + 1.6, 0.5, 0.7, 0.5); // the great lantern
  S.add(T.box, IRON, 299, 2.6, m.minZ - 0.08, 1.6, 2.8, 0.14); // north door
  S.add(T.box, IRON, 299, 2.6, m.maxZ + 3.46, 1.6, 2.8, 0.14); // south door (in the bow)
  // wings: colonnades along the lawn side
  for (const wg of [RES.wingW, RES.wingE]) {
    const body = { ...wg, maxZ: wg.maxZ - 1.4 };
    block(F, WHITE, body, 0, 6.2);
    block(F, WHITE2, wg, 6.2, 6.8, 0.15);
    block(F, WHITE, wg, 6.8, 7.3);
    for (let x = wg.minX + 0.6; x <= wg.maxX - 0.5; x += 1.6) column(F, x, wg.maxZ - 0.5, 0, 6.2, 0.26);
    windowsOn(W, body, ["s", "n"], [1.6], 1.0, 2.6, 1.6, rand);
  }
  // mailroom (secure post room at the north gate)
  block(F, WHITE2, RES.mailroom, 0, 3.6);
  block(S, LEAD, RES.mailroom, 3.6, 4.0, 0.15);
  S.add(T.box, "#3a4552", 281.5, 1.3, RES.mailroom.minZ - 0.06, 2.6, 2.4, 0.12); // roller shutter
  SG.quad(281.5, 3.0, RES.mailroom.minZ - 0.1, 3.6, 0.9, Math.PI, ...signUV(SIGN.mailroom));
  // gate lodges: little classical pavilions with pediments
  for (const lg of [RES.lodgeW, RES.lodgeE]) {
    block(F, WHITE2, lg, 0, 0.6, 0.2);
    block(F, WHITE, lg, 0.6, 4.0);
    block(F, WHITE2, lg, 4.0, 4.5, 0.25);
    F.add(T.pediment, WHITE, (lg.minX + lg.maxX) / 2, 4.5, lg.maxZ - 0.6, lg.maxX - lg.minX, 1.3, 1.4);
    S.add(T.box, LEAD, (lg.minX + lg.maxX) / 2, 4.65, (lg.minZ + lg.maxZ) / 2, lg.maxX - lg.minX - 0.4, 0.3, lg.maxZ - lg.minZ - 1.4);
    windowsOn(W, lg, ["s", "e", "w"], [1.4], 1.2, 1.6, 2.6, rand);
    G.add(T.box, "#ffe2a0", (lg.minX + lg.maxX) / 2, 3.2, lg.maxZ + 0.25, 0.3, 0.45, 0.3);
  }
  // barrier arms (raised) and red/white rising kerb plates at the south gate
  for (const [x, dir] of [[294.5, 1], [303.5, -1]] as const) {
    S.add(T.box, "#c9c9c9", x, 0.6, -121.6, 0.5, 1.2, 0.5);
    S.add(T.box, "#d12a2a", x + dir * 0.6, 3.4, -121.6, 0.14, 4.6, 0.14, 0, 0, dir * 0.25);
  }
  for (let i = 0; i < 4; i++) S.add(T.box, i % 2 ? "#ffffff" : "#d12a2a", 296.6 + i * 1.6, 0.06, -118.3, 1.6, 0.06, 0.8);
  // the flag on the roof is a FLAGS entry (pole drawn with the others)

  // ---- Security fence round the grounds -------------------------------------------------------------------------
  const fe = RES.fence;
  const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const sx = alongX ? len : 0.45;
    const sz = alongX ? 0.45 : len;
    F.add(T.box, WHITE2, cx, 0.3, cz, sx, 0.6, sz); // stone plinth wall
    S.add(T.box, IRON, cx, 0.95, cz, alongX ? len : 0.08, 0.08, alongX ? 0.08 : len);
    S.add(T.box, IRON, cx, 2.35, cz, alongX ? len : 0.08, 0.08, alongX ? 0.08 : len);
    const n = Math.max(1, Math.round(len / 0.55));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      S.add(T.box, IRON, x, 1.55, z, 0.06, 1.9, 0.06);
      if (i % 2 === 0) S.add(T.cone4, GOLD, x, 2.62, z, 0.12, 0.3, 0.12);
    }
  };
  fenceRun(fe.minX, fe.maxZ, RES.southGate[0], fe.maxZ);
  fenceRun(RES.southGate[1], fe.maxZ, fe.maxX, fe.maxZ);
  fenceRun(fe.minX, fe.minZ, RES.northGate[0], fe.minZ);
  fenceRun(RES.northGate[1], fe.minZ, fe.maxX, fe.minZ);
  fenceRun(fe.minX, fe.minZ, fe.minX, fe.maxZ);
  fenceRun(fe.maxX, fe.minZ, fe.maxX, fe.maxZ);
  for (const p of GATE_PIERS) {
    F.add(T.box, WHITE, p.x, 1.7, p.z, 1.0, 3.4, 1.0);
    F.add(T.box, WHITE2, p.x, 3.5, p.z, 1.2, 0.25, 1.2);
    S.add(T.box, IRON, p.x, 3.75, p.z, 0.12, 0.3, 0.12);
    G.add(T.sphere, "#ffe2a0", p.x, 4.1, p.z, 0.55, 0.65, 0.55);
  }

  // ---- South Lawn: fountain, flower beds, helipad ------------------------------------------------------------------
  const fo = FOUNTAIN;
  S.add(T.cyl24, "#c0392b", fo.x, 0.12, fo.z, (fo.r + 1.3) * 2, 0.24, (fo.r + 1.3) * 2); // red tulip ring
  S.add(T.cyl24, "#f2c94c", fo.x, 0.14, fo.z, (fo.r + 0.55) * 2, 0.28, (fo.r + 0.55) * 2);
  F.add(T.cyl24, WHITE2, fo.x, 0.35, fo.z, fo.r * 2, 0.7, fo.r * 2);
  WA.add(T.cyl24, "#5fa8c8", fo.x, 0.62, fo.z, fo.r * 2 - 0.6, 0.1, fo.r * 2 - 0.6);
  F.add(T.cyl12, WHITE, fo.x, 1.2, fo.z, 0.8, 1.6, 0.8);
  F.add(T.cyl24, WHITE2, fo.x, 2.05, fo.z, 2.6, 0.2, 2.6);
  WA.add(T.cyl24, "#7cc0dc", fo.x, 2.17, fo.z, 2.2, 0.06, 2.2);
  const hp = HELIPAD;
  S.add(T.cyl24, CONCRETE, hp.x, 0.04, hp.z, hp.r * 2, 0.08, hp.r * 2);
  S.add(T.cyl24, "#f2c94c", hp.x, 0.09, hp.z, hp.r * 2 - 1.2, 0.04, hp.r * 2 - 1.2);
  S.add(T.cyl24, CONCRETE, hp.x, 0.12, hp.z, hp.r * 2 - 2.0, 0.04, hp.r * 2 - 2.0);
  S.add(T.box, "#ffffff", hp.x - 1.4, 0.15, hp.z, 0.6, 0.03, 4.2);
  S.add(T.box, "#ffffff", hp.x + 1.4, 0.15, hp.z, 0.6, 0.03, 4.2);
  S.add(T.box, "#ffffff", hp.x, 0.15, hp.z, 2.4, 0.03, 0.6);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    G.add(T.sphere, k % 3 === 0 ? "#ff4040" : "#9fd0ff", hp.x + Math.cos(a) * (hp.r - 0.3), 0.15, hp.z + Math.sin(a) * (hp.r - 0.3), 0.3, 0.2, 0.3);
  }
  // windsock
  S.add(T.cyl8, "#dddddd", 322.5, 2.5, -128, 0.1, 5, 0.1);
  S.add(T.cone8, "#ff6a1a", 322.5 + FLAG_DIR.x * 0.9, 4.8, -128 + FLAG_DIR.z * 0.9, 0.5, 1.8, 0.5, Math.atan2(FLAG_DIR.x, FLAG_DIR.z), Math.PI / 2);

  // ---- The Ministry (Portland stone, engaged columns on Whitehall) ------------------------------------------------
  const mi = MINISTRY;
  block(F, "#c9c0ac", mi, 0, 4.2, 0.15); // rusticated ground floor
  block(F, PORTLAND, mi, 4.2, MINISTRY_H - 1.4);
  block(F, "#c9c0ac", mi, MINISTRY_H - 1.4, MINISTRY_H - 0.8, 0.35);
  block(F, PORTLAND, { minX: mi.minX + 1, maxX: mi.maxX - 1, minZ: mi.minZ + 1, maxZ: mi.maxZ - 1 }, MINISTRY_H - 0.8, MINISTRY_H + 1.2);
  S.add(T.box, LEAD, (mi.minX + mi.maxX) / 2, MINISTRY_H + 1.4, (mi.minZ + mi.maxZ) / 2, mi.maxX - mi.minX - 4, 0.4, mi.maxZ - mi.minZ - 4);
  for (let z = -190; z <= -178; z += 2) column(F, mi.minX + 0.15, z, 4.2, 10.4, 0.42, PORTLAND);
  F.add(T.pediment, PORTLAND, mi.minX + 0.4, MINISTRY_H - 0.8, -184, 15, 2.2, 1.2, Math.PI / 2);
  windowsOn(W, mi, ["e", "w", "n", "s"], [1.4, 5.2, 8.6, 12.0], 1.1, 2.0, 2.7, rand, { b: F, color: "#c9c0ac" }, (side, a) => side === "w" && ((a > -191 && a < -177) || Math.abs(a + 176) < 2.2 || Math.abs(a + 167) < 2));
  SG.quad(mi.minX - 0.3, 3.4, -184, 7.5, 1.0, -Math.PI / 2, ...signUV(SIGN.ministry));
  S.add(T.box, "#3a4552", mi.minX - 0.07, 1.4, -176, 0.12, 2.8, 2.6); // mailroom shutter, facing gov_min_mail
  SG.quad(mi.minX - 0.14, 3.3, -176, 3.4, 0.85, -Math.PI / 2, ...signUV(SIGN.mailroom));
  G.add(T.box, "#ffe2a0", mi.minX - 0.3, 3.0, -178.2, 0.25, 0.4, 0.25);
  S.add(T.box, IRON, mi.minX - 0.07, 1.6, -184, 0.12, 3.2, 2.2); // main door

  // ---- Parliament: gothic hall, green copper dome, clock tower ------------------------------------------------------
  const pa = PARLIAMENT;
  block(F, SAND, pa, 0, PARLIAMENT_H);
  block(F, "#cdb987", pa, PARLIAMENT_H - 0.6, PARLIAMENT_H, 0.25);
  S.add(T.prism, SLATE, (pa.minX + pa.maxX) / 2, PARLIAMENT_H, (pa.minZ + pa.maxZ) / 2, pa.maxZ - pa.minZ, 3.4, pa.maxX - pa.minX, Math.PI / 2);
  // buttresses with pinnacles
  for (let z = pa.minZ + 0.5; z <= pa.maxZ - 0.4; z += 3.6)
    for (const x of [pa.minX, pa.maxX]) {
      F.add(T.box, "#cdb987", x, PARLIAMENT_H / 2 + 0.3, z, 0.9, PARLIAMENT_H + 0.6, 0.7);
      F.add(T.cone4, "#cdb987", x, PARLIAMENT_H + 1.6, z, 0.7, 2, 0.7, Math.PI / 4);
    }
  for (let x = pa.minX + 0.5; x <= pa.maxX - 0.4; x += 3.75)
    for (const z of [pa.minZ, pa.maxZ]) {
      F.add(T.box, "#cdb987", x, PARLIAMENT_H / 2 + 0.3, z, 0.7, PARLIAMENT_H + 0.6, 0.9);
      F.add(T.cone4, "#cdb987", x, PARLIAMENT_H + 1.6, z, 0.7, 2, 0.7, Math.PI / 4);
    }
  windowsOn(W, pa, ["e", "w", "n", "s"], [1.6, 5.8], 1.0, 3.2, 3.6, rand, undefined, (side, a) => side === "w" && Math.abs(a + 136) < 2.5);
  // great door + sign on Whitehall
  S.add(T.box, "#3b2a1c", pa.minX - 0.07, 2.0, -136, 0.12, 4.0, 2.6);
  F.add(T.pediment, SAND, pa.minX - 0.3, 4.2, -136, 3.4, 1.6, 0.6, Math.PI / 2);
  SG.quad(pa.minX - 0.4, 6.8, -136, 7.0, 0.95, -Math.PI / 2, ...signUV(SIGN.parliament));
  // dome on a drum
  F.add(T.cyl24, SAND, DOME.x, PARLIAMENT_H + 2.6, DOME.z, DOME.r * 2, 5.2, DOME.r * 2);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    W.litValue = 0.8;
    W.add(T.box, GLASS, DOME.x + Math.cos(a) * DOME.r, PARLIAMENT_H + 2.8, DOME.z + Math.sin(a) * DOME.r, 0.25, 2.2, 0.9, -a + Math.PI / 2);
  }
  F.add(T.cyl24, "#cdb987", DOME.x, PARLIAMENT_H + 5.4, DOME.z, DOME.r * 2 + 0.6, 0.4, DOME.r * 2 + 0.6);
  S.add(T.dome, COPPER, DOME.x, PARLIAMENT_H + 5.6, DOME.z, DOME.r * 2, 5.4, DOME.r * 2);
  F.add(T.cyl8, SAND, DOME.x, PARLIAMENT_H + 11.6, DOME.z, 1.3, 1.6, 1.3);
  S.add(T.cone8, GOLD, DOME.x, PARLIAMENT_H + 13.4, DOME.z, 0.9, 2.0, 0.9);
  // clock tower
  const ct = CLOCK_TOWER;
  const ctx = (ct.minX + ct.maxX) / 2;
  const ctz = (ct.minZ + ct.maxZ) / 2;
  block(F, SAND, ct, 0, 21.5);
  for (const y of [5, 10, 15]) block(F, "#cdb987", ct, y, y + 0.35, 0.12);
  F.add(T.box, "#cdb987", ctx, 23.2, ctz, 5.8, 3.6, 5.8);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    G.add(T.cyl24, "#fff2cc", ctx + Math.sin(a) * 2.92, CLOCK_FACE_Y, ctz + Math.cos(a) * 2.92, 3.0, 0.1, 3.0, a, Math.PI / 2);
  }
  F.add(T.box, "#cdb987", ctx, 25.6, ctz, 5.2, 1.2, 5.2);
  S.add(T.box, "#3c3a36", ctx, 26.9, ctz, 4.4, 1.4, 4.4);
  S.add(T.cone4, LEAD, ctx, 27.6 + 3.6, ctz, 6.2, 7.2, 6.2, Math.PI / 4);
  S.add(T.cyl8, GOLD, ctx, 35.6, ctz, 0.2, 1.6, 0.2);

  // ---- Downing Street terraces ---------------------------------------------------------------------------------
  const terrace = (r: Rect, h: number, brick: string, doorX: number, doorFace: number, doorColors: string[]) => {
    const houses = 3;
    const len = (r.maxZ - r.minZ) / houses;
    for (let i = 0; i < houses; i++) {
      const hr = { minX: r.minX, maxX: r.maxX, minZ: r.minZ + i * len, maxZ: r.minZ + (i + 1) * len };
      const hh = h - (i === 1 ? 0 : 0.6 * rand());
      block(S, jitter(brick, rand(), 0.08).getStyle(), hr, 0, hh);
      block(S, "#e9e4d8", hr, 0, 0.9, 0.08); // stucco plinth
      block(S, "#e9e4d8", hr, hh - 0.6, hh, 0.15); // parapet coping
      S.add(T.prism, SLATE, (hr.minX + hr.maxX) / 2, hh - 0.3, (hr.minZ + hr.maxZ) / 2, hr.maxX - hr.minX - 1.4, 2.6, len - 0.2);
      for (const zz of [hr.minZ + 0.6, hr.maxZ - 0.6]) {
        S.add(T.box, brick, (hr.minX + hr.maxX) / 2, hh + 1.6, zz, 2.6, 2.2, 0.8);
        for (let c = 0; c < 4; c++) S.add(T.cyl8, "#b5653f", (hr.minX + hr.maxX) / 2 - 0.9 + c * 0.6, hh + 2.9, zz, 0.28, 0.5, 0.28);
      }
      windowsOn(W, hr, ["e", "w"], [3.6, 7.0, 10.2], 1.1, 2.2, 1.65, rand, { b: S, color: "#f2efe6" }, (side, a) => (side === (doorFace > 0 ? "e" : "w") ? Math.abs(a - (hr.minZ + hr.maxZ) / 2) < 0.5 : false));
      // ground floor: door with a white surround, fanlight and a lantern
      const dz = (hr.minZ + hr.maxZ) / 2;
      const ox = doorFace * 0.08;
      S.add(T.box, "#f2efe6", doorX + ox * 0.5, 1.6, dz, 0.12, 3.2, 2.0);
      S.add(T.box, doorColors[i % doorColors.length], doorX + ox, 1.35, dz, 0.12, 2.4, 1.2);
      G.add(T.box, "#ffd890", doorX + ox, 2.85, dz, 0.1, 0.45, 1.1);
      G.add(T.box, "#ffe6a8", doorX + doorFace * 0.7, 3.4, dz, 0.35, 0.5, 0.35);
      S.add(T.box, IRON, doorX + doorFace * 0.35, 3.75, dz, 0.7, 0.06, 0.06);
      S.add(T.box, "#f2efe6", doorX + doorFace * 0.6, 0.15, dz, 1.2, 0.3, 1.8); // doorstep
    }
  };
  terrace(TERRACE_W, TERRACE_H, BRICK_BLACK, TERRACE_W.maxX, 1, ["#0d0d0d"]);
  terrace(TERRACE_E, TERRACE_H - 1, BRICK, TERRACE_E.minX, -1, ["#14382a", "#1d2b4a", "#0d0d0d"]);
  SG.quad(NO10_DOOR.x + 0.16, 1.95, NO10_DOOR.z, 0.5, 0.125, Math.PI / 2, ...signUV(SIGN.no10));
  SG.quad(254.5, 3.2, TERRACE_W.maxZ + 0.08, 4.0, 1.0, 0, ...signUV(SIGN.downing));
  // gates and railings across the mouth of Downing Street
  for (const x of DS_GATE.posts) {
    S.add(T.box, IRON, x, 1.6, DS_GATE.z, 0.5, 3.2, 0.5);
    S.add(T.cone4, GOLD, x, 3.45, DS_GATE.z, 0.4, 0.5, 0.4);
    G.add(T.sphere, "#ffe2a0", x, 3.95, DS_GATE.z, 0.45, 0.55, 0.45);
  }
  for (const [x0, x1] of [[TERRACE_W.minX, DS_GATE.posts[0] - 0.3], [DS_GATE.posts[1] + 0.3, TERRACE_E.maxX]] as const) {
    const len = x1 - x0;
    S.add(T.box, IRON, (x0 + x1) / 2, 0.15, DS_GATE.z - 0.4, len, 0.3, 0.3);
    S.add(T.box, IRON, (x0 + x1) / 2, 2.4, DS_GATE.z - 0.4, len, 0.08, 0.08);
    for (let x = x0; x <= x1; x += 0.5) S.add(T.box, IRON, x, 1.3, DS_GATE.z - 0.4, 0.06, 2.2, 0.06);
  }
  // the gate leaves stand open, swung back against the pavements
  S.add(T.box, IRON, DS_GATE.posts[0] + 0.3, 1.4, DS_GATE.z - 1.7, 0.1, 2.6, 2.4);
  S.add(T.box, IRON, DS_GATE.posts[1] - 0.3, 1.4, DS_GATE.z - 1.7, 0.1, 2.6, 2.4);
  SG.quad(DS_GATE.posts[0] - 0.27, 2.0, DS_GATE.z + 0.26, 1.6, 0.4, 0, ...signUV(SIGN.police));

  // ---- The Embassy -------------------------------------------------------------------------------------------------
  const em = EMBASSY;
  block(F, "#e8e3d8", em, 0, EMBASSY_H);
  block(F, "#d8d1c2", em, EMBASSY_H, EMBASSY_H + 0.6, 0.2);
  for (let y = 1; y < EMBASSY_H - 1; y += 3.4) {
    W.litValue = rand() < 0.6 ? 0.8 : 0.1;
    W.add(T.box, GLASS, (em.minX + em.maxX) / 2, y + 1.2, em.maxZ + 0.06, em.maxX - em.minX - 2, 1.9, 0.12);
    W.add(T.box, GLASS, em.minX - 0.06, y + 1.2, (em.minZ + em.maxZ) / 2, 0.12, 1.9, em.maxZ - em.minZ - 2);
    W.add(T.box, GLASS, em.maxX + 0.06, y + 1.2, (em.minZ + em.maxZ) / 2, 0.12, 1.9, em.maxZ - em.minZ - 2);
  }
  for (let x = em.minX + 1; x <= em.maxX - 1; x += 2) F.add(T.box, "#e8e3d8", x, EMBASSY_H / 2, em.maxZ + 0.15, 0.35, EMBASSY_H, 0.3); // fins
  S.add(T.box, "#2a3440", 302, 3.9, em.maxZ + 1.0, 8, 0.3, 2.0); // entrance canopy
  W.litValue = 1;
  W.add(T.box, "#4a6a85", 302, 1.8, em.maxZ + 0.1, 5, 3.6, 0.2);
  SG.quad(302, 4.6, em.maxZ + 2.05, 5.6, 0.75, 0, ...signUV(SIGN.embassy));
  S.add(T.box, "#c9c2b4", (em.minX + em.maxX) / 2, EMBASSY_H + 1.2, (em.minZ + em.maxZ) / 2, 6, 1.2, 4); // plant room

  // ---- Guard huts --------------------------------------------------------------------------------------------------
  for (const h of HUTS) {
    block(S, "#e9e9e6", h, 0, h.h - 0.3);
    block(S, "#20262d", h, h.h - 0.3, h.h, 0.2);
    W.litValue = 1;
    windowsOn(W, h, ["n", "s", "e", "w"], [1.1], Math.min(1.4, h.maxX - h.minX - 0.6), 1.0, 9, rand);
    G.add(T.box, "#9fd0ff", (h.minX + h.maxX) / 2, h.h + 0.15, (h.minZ + h.maxZ) / 2, 0.3, 0.3, 0.3);
  }

  // ---- Victory column in the Circus ---------------------------------------------------------------------------------
  const mo = MONUMENT;
  F.add(T.box, WHITE2, mo.x, 0.4, mo.z, mo.plinth + 0.8, 0.8, mo.plinth + 0.8);
  F.add(T.box, WHITE, mo.x, 1.9, mo.z, mo.plinth, 2.2, mo.plinth);
  F.add(T.cyl12, WHITE, mo.x, 3 + 7.5, mo.z, 1.3, 15, 1.3);
  F.add(T.box, WHITE2, mo.x, 18.2, mo.z, 1.9, 0.6, 1.9);
  S.add(T.blob, GOLD, mo.x, 19.3, mo.z, 0.9, 1.6, 0.9);
  S.add(T.cone8, GOLD, mo.x, 20.4, mo.z, 0.5, 0.9, 0.5);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    G.add(T.box, "#fff0c8", mo.x + Math.cos(a) * 3.6, 0.2, mo.z + Math.sin(a) * 3.6, 0.5, 0.3, 0.5); // ground uplights
  }

  // ---- Trees, lamps, bollards, flag poles ---------------------------------------------------------------------------
  for (const t of TREES) {
    const s = t.s;
    S.add(T.cyl8, "#5b4632", t.x, 1.5 * s, t.z, 0.4 * s, 3 * s, 0.4 * s);
    S.add(T.blob, jitter("#3f7a3a", rand(), 0.18), t.x, 4.4 * s, t.z, 4.2 * s, 4.0 * s, 4.2 * s, rand() * 6);
    S.add(T.blob, jitter("#4c8a40", rand(), 0.18), t.x + 0.6, 5.6 * s, t.z - 0.3, 2.8 * s, 2.6 * s, 2.8 * s, rand() * 6);
  }
  for (const l of LAMPS) {
    S.add(T.cyl8, IRON, l.x, 0.25, l.z, 0.45, 0.5, 0.45);
    S.add(T.cyl8, IRON, l.x, 2.6, l.z, 0.16, 5.2, 0.16);
    G.add(T.box, "#ffe2a0", l.x, 5.45, l.z, 0.42, 0.6, 0.42);
    S.add(T.cone4, IRON, l.x, 5.95, l.z, 0.6, 0.4, 0.6, Math.PI / 4);
  }
  for (const b of BOLLARDS) {
    S.add(T.cyl8, "#24262a", b.x, 0.48, b.z, 0.3, 0.96, 0.3);
    S.add(T.cyl8, GOLD, b.x, 0.9, b.z, 0.32, 0.08, 0.32);
  }
  for (const f of FLAGS) {
    S.add(T.cyl8, "#f0f0ee", f.x, (f.base + f.pole) / 2, f.z, 0.14, f.pole - f.base, 0.14);
    S.add(T.sphere, GOLD, f.x, f.pole + 0.12, f.z, 0.26, 0.26, 0.26);
  }

  return {
    facade: F.build(),
    solid: S.build(),
    windows: W.build(),
    glow: G.build(),
    ground: GR.build(),
    water: WA.build(),
    signs: SG.build(),
    flags: buildFlagCloth(),
    jets: buildJets(),
  };
}

/** All flags in one geometry: each a subdivided quad streaming downwind from its pole top. */
function buildFlagCloth(): BufferGeometry {
  const SEG_U = 10;
  const SEG_V = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const wave: number[] = [];
  const idx: number[] = [];
  const nx = -FLAG_DIR.z;
  const nz = FLAG_DIR.x;
  const nor: number[] = [];
  for (const f of FLAGS) {
    const base = pos.length / 3;
    const [u0, v0, u1, v1] = flagUV(f.design);
    for (let j = 0; j <= SEG_V; j++)
      for (let i = 0; i <= SEG_U; i++) {
        const u = i / SEG_U;
        const v = j / SEG_V;
        pos.push(f.x + FLAG_DIR.x * (0.08 + u * f.w), f.pole - 0.15 - f.h + v * f.h, f.z + FLAG_DIR.z * (0.08 + u * f.w));
        nor.push(nx, 0, nz);
        uv.push(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
        wave.push(u, f.phase, f.w);
      }
    for (let j = 0; j < SEG_V; j++)
      for (let i = 0; i < SEG_U; i++) {
        const a = base + j * (SEG_U + 1) + i;
        const b = a + 1;
        const c = a + SEG_U + 1;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("aWave", new Float32BufferAttribute(wave, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 2;
  return g;
}

/** Fountain jets: a tall central plume and a ring of arching spouts (cones), pulsed by the shader. */
function buildJets(): BufferGeometry {
  const parts: { x: number; y: number; z: number; h: number; r: number; tilt: number; ry: number; phase: number }[] = [
    { x: FOUNTAIN.x, y: 2.2, z: FOUNTAIN.z, h: 4.2, r: 0.35, tilt: 0, ry: 0, phase: 0 },
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push({ x: FOUNTAIN.x + Math.cos(a) * 3.4, y: 0.65, z: FOUNTAIN.z + Math.sin(a) * 3.4, h: 2.0, r: 0.16, tilt: 0.45, ry: Math.atan2(-Math.cos(a), -Math.sin(a)), phase: k * 0.8 });
  }
  const B = new GeoBuilder();
  const jetAttr: number[] = [];
  for (const p of parts) {
    const before = B.vertexCount;
    B.add(T.cone8, "#ffffff", p.x, p.y + p.h / 2, p.z, p.r * 2, p.h, p.r * 2, p.ry, p.tilt);
    const added = B.vertexCount - before;
    for (let i = 0; i < added; i++) jetAttr.push(p.y, p.phase);
  }
  const g = B.build()!;
  g.setAttribute("aJet", new Float32BufferAttribute(jetAttr, 2));
  return g;
}

// ---- Police officer and helicopter part geometries ----------------------------------------------------------------

/** One armed police officer (feet at y = 0, facing +z), vertex-coloured, with per-instance patrol attributes. */
export function policeGeometry(): BufferGeometry {
  const B = new GeoBuilder();
  const DARK = "#1c2230";
  B.add(T.box, DARK, -0.14, 0.45, 0, 0.2, 0.9, 0.24);
  B.add(T.box, DARK, 0.14, 0.45, 0, 0.2, 0.9, 0.24);
  B.add(T.box, "#111111", -0.14, 0.05, 0.04, 0.22, 0.1, 0.32);
  B.add(T.box, "#111111", 0.14, 0.05, 0.04, 0.22, 0.1, 0.32);
  B.add(T.box, DARK, 0, 1.22, 0, 0.52, 0.66, 0.3);
  B.add(T.box, "#2f3540", 0, 1.22, 0.02, 0.56, 0.5, 0.34); // body armour
  B.add(T.box, "#d6e02a", 0, 1.32, 0.02, 0.58, 0.1, 0.36); // hi-vis band
  B.add(T.box, DARK, -0.33, 1.2, 0.06, 0.13, 0.6, 0.14, 0, -0.5);
  B.add(T.box, DARK, 0.33, 1.2, 0.06, 0.13, 0.6, 0.14, 0, -0.5);
  B.add(T.sphere, "#e0b48f", 0, 1.68, 0, 0.26, 0.3, 0.26);
  B.add(T.box, "#111111", 0, 1.83, 0.02, 0.3, 0.1, 0.32); // cap
  B.add(T.box, "#f0f0f0", 0, 1.79, 0.02, 0.31, 0.03, 0.33); // chequered band (white)
  B.add(T.box, "#111111", 0, 1.79, 0.2, 0.26, 0.02, 0.12); // peak
  B.add(T.box, "#0b0b0b", 0.02, 1.18, 0.28, 0.08, 0.1, 0.72, 0.5, 0.25); // carbine across the chest
  const g = B.build()!;
  const n = POLICE.length;
  const seg = new Float32Array(n * 4);
  const meta = new Float32Array(n * 3);
  POLICE.forEach((o, i) => {
    seg.set([o.a.x, o.a.z, o.b.x, o.b.z], i * 4);
    meta.set([1.1, (i * 0.137) % 1, o.face], i * 3);
  });
  g.setAttribute("aSeg", new InstancedBufferAttribute(seg, 4));
  g.setAttribute("aMeta", new InstancedBufferAttribute(meta, 3));
  return g;
}

/** Helicopter body (nose +z, skids at y = 0): white top, dark green body. */
export function heliBodyGeometry(): BufferGeometry {
  const B = new GeoBuilder();
  const GREEN = "#1f3b2b";
  const TOP = "#f2f2ee";
  B.add(T.box, GREEN, 0, 1.75, 0, 2.3, 1.9, 5.6);
  B.add(T.box, TOP, 0, 2.95, -0.2, 2.1, 0.6, 5.0);
  B.add(T.blob, GREEN, 0, 1.75, 2.8, 2.3, 1.9, 2.4);
  B.add(T.box, "#1b2633", 0, 2.25, 3.2, 1.9, 0.8, 1.4, 0, -0.35); // windscreen
  B.add(T.box, "#1b2633", 1.17, 2.2, 1.0, 0.04, 0.6, 2.4);
  B.add(T.box, "#1b2633", -1.17, 2.2, 1.0, 0.04, 0.6, 2.4);
  B.add(T.box, TOP, 0, 3.45, -0.6, 1.4, 0.6, 2.6); // engine housing
  B.add(T.cyl8, "#555555", 0, 3.95, 0.2, 0.25, 0.6, 0.25); // mast
  B.add(T.box, GREEN, 0, 2.4, -5.4, 0.55, 0.6, 5.6); // tail boom
  B.add(T.box, GREEN, 0, 3.2, -8.0, 0.15, 1.9, 1.2); // fin
  B.add(T.box, GREEN, 0, 2.4, -7.2, 2.2, 0.08, 0.6); // stabiliser
  B.add(T.box, "#f2f2ee", 0, 1.0, 0, 2.32, 0.12, 5.62); // white stripe
  for (const x of [-1.15, 1.15]) {
    B.add(T.box, "#2a2a2a", x, 0.08, 0.2, 0.14, 0.14, 5.0);
    B.add(T.box, "#2a2a2a", x * 0.85, 0.45, 1.4, 0.1, 0.8, 0.1, 0, 0, x > 0 ? -0.3 : 0.3);
    B.add(T.box, "#2a2a2a", x * 0.85, 0.45, -1.2, 0.1, 0.8, 0.1, 0, 0, x > 0 ? -0.3 : 0.3);
  }
  B.add(T.sphere, "#ff2020", 0, 0.65, 0.4, 0.25, 0.18, 0.25); // belly beacon
  return B.build()!;
}

/** Main rotor (spins about y, hub at the origin). */
export function heliRotorGeometry(): BufferGeometry {
  const B = new GeoBuilder();
  for (let k = 0; k < 2; k++) B.add(T.box, "#2b2b2b", 0, 0, 0, 0.32, 0.05, 11.5, (k * Math.PI) / 2);
  B.add(T.cyl8, "#444444", 0, 0, 0, 0.5, 0.3, 0.5);
  return B.build()!;
}

/** Tail rotor (spins about x, hub at the origin). */
export function heliTailRotorGeometry(): BufferGeometry {
  const B = new GeoBuilder();
  B.add(T.box, "#2b2b2b", 0, 0, 0, 0.05, 1.8, 0.18);
  B.add(T.box, "#2b2b2b", 0, 0, 0, 0.05, 0.18, 1.8);
  return B.build()!;
}

/** Clock hands: unit box with its pivot at the bottom (scaled per instance). */
export function handGeometry(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}
