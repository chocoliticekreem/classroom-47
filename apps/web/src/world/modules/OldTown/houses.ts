// Bakes every house into merged geometry: walls/roofs/chimneys (low + tall sets), and windows with aLit.
import { GeoBuilder, T, jitter, pick } from "./kit";
import { mulberry32, type House } from "./layout";

const WALL: Record<House["style"], string[]> = {
  tudor: ["#efe6d0", "#eadcbc", "#f3ecdc", "#e6d6b4"],
  stone: ["#cbbb9b", "#bfae8c", "#d6c7a5", "#b9a88a"],
  brick: ["#9c4e36", "#a65d3f", "#8a4632", "#b06a4b", "#94533b"],
  georgian: ["#c6a470", "#b98d5e", "#ccab78", "#a8784e"],
  bath: ["#e3cd98"],
  stucco: ["#f2eee4", "#ebe4d4", "#e9dcc7", "#dfe6e2", "#efe1d1", "#e6d9e0"],
};
const ROOF_CLAY = ["#9c4f36", "#8c4632", "#a65a3c", "#7e3f2d"];
const ROOF_SLATE = ["#4f5866", "#5a6270", "#47505d", "#606874"];
const TIMBER = "#3a2a1f";
const SHOPFRONT = ["#1f4d3a", "#6b1e23", "#1f2f4d", "#1b1b1b", "#2f6f6a", "#7a5a1e", "#4a2a52"];
const DOOR = ["#1f3b5c", "#7a1f2b", "#1c1c1c", "#2e5a3a", "#5c3b1f"];
const SIGN = ["#7a1f2b", "#1f4d3a", "#1f2f4d", "#2b2b2b"];
const CHIMNEY = "#8a4a36";
const POT = "#c0683f";
const TRIM = "#f1ede4";

export interface HouseGeo {
  low: GeoBuilder;
  tall: GeoBuilder;
  windows: GeoBuilder;
}

export function newHouseGeo(): HouseGeo {
  return { low: new GeoBuilder(), tall: new GeoBuilder(), windows: new GeoBuilder(true) };
}

export function bakeHouse(G: HouseGeo, h: House) {
  const r = mulberry32(Math.floor(h.seed * 1e9));
  const b = h.h >= 12 ? G.tall : G.low;
  const W = G.windows;
  b.setFrame(h.x, 0, h.z, h.ry);
  W.setFrame(h.x, 0, h.z, h.ry);
  const { w, d } = h;
  const wall = jitter(pick(WALL[h.style], r()), r(), 0.08);
  const clay = h.style === "tudor" || (h.style === "stone" && r() < 0.5) || (h.style === "brick" && r() < 0.35);
  const roofCol = jitter(pick(clay ? ROOF_CLAY : ROOF_SLATE, r()), r(), 0.06);
  const fd = d / 2;

  // Body (tudor: jettied upper floors overhang the street)
  if (h.style === "tudor" && h.floors > 1) {
    b.box(wall, 0, 0, -0.2, w, 3.1, d - 0.4);
    b.box(wall, 0, 3.1, 0.15, w + 0.1, h.h - 3.1, d + 0.3);
  } else b.box(wall, 0, 0, 0, w, h.h, d);
  const jetty = h.style === "tudor" && h.floors > 1;
  const front = jetty ? fd + 0.3 : fd; // upper floors
  const front0 = jetty ? fd - 0.4 : fd; // ground floor

  // Roof
  const ov = 0.35;
  let ridge = h.h;
  if (h.roof === "gable") {
    const rh = d * (h.style === "tudor" ? 0.62 : 0.4);
    b.add(T.prism, roofCol, 0, h.h, 0, w + ov, rh, d + ov * 2);
    ridge = h.h + rh;
  } else if (h.roof === "hip") {
    const rh = d * 0.36;
    b.add(T.hip, roofCol, 0, h.h, 0, w + ov * 2, rh, d + ov * 2);
    ridge = h.h + rh;
  } else if (h.roof === "mansard") {
    const rh = 2.6;
    b.box(TRIM, 0, h.h, 0, w + 0.15, 0.25, d + 0.15); // cornice
    b.add(T.mansard, roofCol, 0, h.h + 0.25, 0, w, rh, d - 0.2);
    ridge = h.h + 0.25 + rh;
    // dormers on the front slope
    const n = Math.max(1, Math.floor(w / 2.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.box(roofCol, x, h.h + 0.6, fd - 0.75, 1.1, 1.5, 1.0);
      W.litValue = r() < 0.4 ? 0.55 + r() * 0.45 : 0;
      W.add(T.plane, "#2b3644", x, h.h + 1.3, fd - 0.24, 0.7, 0.8, 1);
    }
  } else {
    // flat: parapet + leads
    b.box(h.style === "bath" || h.style === "stucco" ? TRIM : wall, 0, h.h, 0, w + 0.1, 0.8, d + 0.1);
    b.box("#6d7178", 0, h.h + 0.3, 0, w - 0.6, 0.55, d - 0.6);
    ridge = h.h + 0.8;
  }

  // Chimney stacks on the party walls, with pots
  const stacks = h.roof === "hip" ? 1 : r() < 0.25 ? 1 : 2;
  for (let i = 0; i < stacks; i++) {
    const sx = stacks === 1 ? (r() - 0.5) * w * 0.5 : i === 0 ? -w / 2 + 0.45 : w / 2 - 0.45;
    const sz = (r() - 0.5) * d * 0.3;
    const top = ridge + 0.9 + r() * 0.6;
    const ch = h.style === "stucco" || h.style === "bath" ? wall : jitter(CHIMNEY, r(), 0.1);
    b.box(ch, sx, h.h - 0.5, sz, 0.9, top - h.h + 0.5, 0.7);
    b.box(POT, sx, top, sz, 0.55, 0.45, 0.3);
  }

  // Ground floor: shopfront or front door
  const floor0 = h.shop ? 1 : 0;
  if (h.shop) {
    const sc = pick(SHOPFRONT, r());
    b.box(sc, 0, 0, front0, w - 0.1, 3.3, 0.22);
    b.box(h.pub ? "#c9a24a" : jitter("#efe6d2", r()), 0, 2.55, front0 + 0.13, w - 0.4, 0.55, 0.08); // fascia
    W.litValue = 0.85 + r() * 0.15;
    W.add(T.plane, "#3a4a58", 0, 1.35, front0 + 0.13, w - 1.6, 1.9, 1);
  } else {
    W.litValue = 0;
    const door = pick(DOOR, r());
    b.box(door, (r() - 0.5) * (w - 2.2), 0, front0, 1.05, 2.2, 0.12);
  }
  if (h.pub) {
    // hanging sign on an iron bracket, perpendicular to the facade
    const sx = w / 2 - 0.5;
    b.box("#1b1b1b", sx, 3.95, front + 0.55, 0.08, 0.08, 1.2);
    b.box(pick(SIGN, r()), sx, 3.0, front + 0.95, 0.08, 0.9, 0.75);
    b.box("#c9a24a", sx, 3.12, front + 0.95, 0.1, 0.64, 0.55);
  }

  // Tudor half-timbering on the front and back faces
  if (h.style === "tudor") {
    for (const side of [1, -1]) {
      const z = side > 0 ? front + 0.02 : -fd - 0.02;
      const ry = side > 0 ? 0 : Math.PI;
      for (let f = 1; f <= h.floors; f++) b.add(T.plane, TIMBER, 0, Math.min(f * 3.1, h.h - 0.12), z, w, 0.22, 1, ry);
      const posts = Math.max(2, Math.round(w / 1.6));
      for (let i = 0; i <= posts; i++) {
        const x = -w / 2 + 0.1 + ((w - 0.2) * i) / posts;
        b.add(T.plane, TIMBER, x, 3.1 + (h.h - 3.1) / 2, z, 0.2, h.h - 3.1, 1, ry);
      }
      // a pair of diagonal braces on the upper storey
      const bh = Math.min(3.1, h.h - 3.1);
      b.add(T.plane, TIMBER, -w / 4, 3.1 + bh / 2, z, 0.18, bh * 1.2, 1, ry, 0, 0.6);
      b.add(T.plane, TIMBER, w / 4, 3.1 + bh / 2, z, 0.18, bh * 1.2, 1, ry, 0, -0.6);
    }
  }

  // Sash windows on the front and back
  const cols = Math.max(1, Math.floor((w - 0.6) / 2.1));
  const tall = h.style === "georgian" || h.style === "bath" || h.style === "stucco";
  for (const side of [1, -1]) {
    const ry = side > 0 ? 0 : Math.PI;
    for (let f = floor0; f < h.floors; f++) {
      const z = side > 0 ? (f === 0 ? front0 : front) + 0.03 : -fd - 0.03;
      const wh = tall ? (f === 1 ? 2.0 : 1.6) : 1.3;
      const y = f * 3.1 + 0.9 + wh / 2 + (h.shop ? 0.6 : 0);
      if (y + wh / 2 > h.h - 0.2) continue;
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + (w / cols) * (c + 0.5);
        if (f === 0 && side > 0 && Math.abs(x) < 0.9 && cols > 1) continue; // door
        W.litValue = r() < 0.55 ? 0.45 + r() * 0.55 : 0;
        W.add(T.plane, "#2b3644", x, y, z, tall ? 0.95 : 0.85, wh, 1, ry);
      }
    }
  }
}
