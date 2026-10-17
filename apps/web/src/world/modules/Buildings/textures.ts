// Procedural facade textures drawn on 2D canvases. Each facade kind has a colour map
// (white-ish so the per-instance colour tints it) and an emissive mask of lit windows.
import * as THREE from "three";
import { mulberry32 } from "./layout";

export type FacadeKind = "glass" | "office" | "brick" | "stucco" | "shopfront";

/** How one texture repeat maps to metres: NX columns of colW m, NY floors of floorH m. */
export interface FacadeGrid {
  colW: number;
  floorH: number;
  nx: number;
  ny: number;
}

export const GRIDS: Record<FacadeKind, FacadeGrid> = {
  glass: { colW: 3, floorH: 3.6, nx: 8, ny: 8 },
  office: { colW: 3.4, floorH: 3.6, nx: 8, ny: 8 },
  brick: { colW: 2.8, floorH: 3.2, nx: 8, ny: 8 },
  stucco: { colW: 2.8, floorH: 3.2, nx: 8, ny: 8 },
  shopfront: { colW: 2.6, floorH: 3.4, nx: 8, ny: 1 },
};

const CELL = 32; // px per window cell

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const WARM = ["#ffd27a", "#ffe2a3", "#fff0cf", "#ffc86a", "#ffe9b8"];
const COOL = ["#d8ecff", "#eef6ff", "#fff4dc", "#c9e2ff"];

/** Draws one cell (x, y in px, top-left) of the colour map. */
type CellPainter = (g: CanvasRenderingContext2D, x: number, y: number, col: number, row: number) => void;
/** Returns the lit-window rect inside a cell, in px relative to the cell. */
type WindowRect = [number, number, number, number];

interface FacadeDef {
  base: string;
  paint: CellPainter;
  window: WindowRect;
  lit: number; // chance a window is lit at night
  palette: string[];
}

const DEFS: Record<FacadeKind, FacadeDef> = {
  glass: {
    base: "#e9f0f4",
    lit: 0.5,
    palette: COOL,
    window: [2, 7, 28, 24],
    paint: (g, x, y) => {
      g.fillStyle = "#71879a"; // spandrel band
      g.fillRect(x, y + 1, CELL, 5);
      const grd = g.createLinearGradient(x, y + 7, x + CELL, y + CELL);
      grd.addColorStop(0, "#c8dbe6");
      grd.addColorStop(0.55, "#9db5c6");
      grd.addColorStop(1, "#b9cfdc");
      g.fillStyle = grd;
      g.fillRect(x + 2, y + 7, CELL - 3, CELL - 8);
    },
  },
  office: {
    base: "#f3efe7",
    lit: 0.45,
    palette: WARM,
    window: [6, 8, 20, 18],
    paint: (g, x, y) => {
      g.fillStyle = "#4f5f6e";
      g.fillRect(x + 6, y + 8, 20, 18);
      g.fillStyle = "#6d8193";
      g.fillRect(x + 6, y + 8, 20, 5);
      g.fillStyle = "#d9d3c7"; // sill
      g.fillRect(x + 4, y + 26, 24, 2);
    },
  },
  brick: {
    base: "#f0ddd2",
    lit: 0.4,
    palette: WARM,
    window: [10, 8, 12, 18],
    paint: (g, x, y) => {
      g.fillStyle = "#d9bfb1"; // mortar courses
      for (let k = 2; k < CELL; k += 4) g.fillRect(x, y + k, CELL, 1);
      g.fillStyle = "#fbf6ee"; // stone lintel + sash frame
      g.fillRect(x + 8, y + 4, 16, 3);
      g.fillRect(x + 9, y + 7, 14, 20);
      g.fillStyle = "#2f3944";
      g.fillRect(x + 10, y + 8, 12, 8);
      g.fillRect(x + 10, y + 17, 12, 9);
      g.fillStyle = "#fbf6ee";
      g.fillRect(x + 8, y + 27, 16, 2);
    },
  },
  stucco: {
    base: "#ffffff",
    lit: 0.4,
    palette: WARM,
    window: [10, 8, 12, 18],
    paint: (g, x, y) => {
      g.fillStyle = "#e7e3dc"; // string course per floor
      g.fillRect(x, y + CELL - 2, CELL, 2);
      g.fillStyle = "#d8d3ca"; // window surround
      g.fillRect(x + 8, y + 5, 16, 24);
      g.fillStyle = "#33404d";
      g.fillRect(x + 10, y + 8, 12, 8);
      g.fillRect(x + 10, y + 17, 12, 9);
      g.fillStyle = "#cfc8bd"; // pediment
      g.fillRect(x + 7, y + 3, 18, 2);
    },
  },
  shopfront: {
    base: "#ffffff",
    lit: 0.95,
    palette: ["#fff1c9", "#ffe7a8", "#fff8e6"],
    window: [3, 8, 26, 22],
    paint: (g, x, y) => {
      g.fillStyle = "#e6e6e6"; // fascia
      g.fillRect(x, y, CELL, 6);
      const grd = g.createLinearGradient(x, y + 8, x, y + CELL);
      grd.addColorStop(0, "#556a78");
      grd.addColorStop(1, "#30404c");
      g.fillStyle = grd;
      g.fillRect(x + 3, y + 8, CELL - 6, CELL - 10);
      g.fillStyle = "#e6e6e6"; // glazing bar
      g.fillRect(x + 15, y + 8, 2, CELL - 10);
    },
  },
};

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/** Corner pixel (0,0) is always the plain wall colour, used for roofs. */
export function makeFacade(kind: FacadeKind, seed: number): FacadeTextures {
  const def = DEFS[kind];
  const grid = GRIDS[kind];
  const W = grid.nx * CELL;
  const H = grid.ny * CELL;
  const r = mulberry32(seed);
  const [mc, mg] = canvas(W, H);
  const [ec, eg] = canvas(W, H);
  mg.fillStyle = def.base;
  mg.fillRect(0, 0, W, H);
  eg.fillStyle = "#000";
  eg.fillRect(0, 0, W, H);
  // Canvas y grows down, but UV v grows up: row 0 drawn at the bottom so floor 0 is at ground level.
  for (let row = 0; row < grid.ny; row++)
    for (let col = 0; col < grid.nx; col++) {
      const x = col * CELL;
      const y = H - (row + 1) * CELL;
      def.paint(mg, x, y, col, row);
      if (r() < def.lit) {
        const [wx, wy, ww, wh] = def.window;
        eg.fillStyle = def.palette[Math.floor(r() * def.palette.length)];
        eg.globalAlpha = 0.65 + 0.35 * r();
        eg.fillRect(x + wx, y + wy, ww, wh);
        eg.globalAlpha = 1;
      }
    }
  // keep the wrap seam / corner texel plain so roofs (uv 0,0) never catch a window
  // (canvas bottom-left is uv 0,0 because textures are flipped on upload)
  mg.fillStyle = def.base;
  mg.fillRect(0, H - 1, W, 1);
  mg.fillRect(0, 0, 1, H);
  eg.fillStyle = "#000";
  eg.fillRect(0, H - 1, W, 1);
  eg.fillRect(0, 0, 1, H);
  return { map: toTexture(mc, true), emissive: toTexture(ec, true) };
}

/** Diagonal spiral bands for the Gherkin (tile-able in both directions). */
export function makeGherkin(seed: number): FacadeTextures {
  const S = 256;
  const r = mulberry32(seed);
  const [mc, mg] = canvas(S, S);
  const [ec, eg] = canvas(S, S);
  mg.fillStyle = "#cfe0e8";
  mg.fillRect(0, 0, S, S);
  eg.fillStyle = "#000";
  eg.fillRect(0, 0, S, S);
  // diamond lattice
  mg.strokeStyle = "#e9f2f6";
  mg.lineWidth = 2;
  for (let k = -S; k <= 2 * S; k += 32) {
    mg.beginPath();
    mg.moveTo(k, 0);
    mg.lineTo(k + S, S);
    mg.moveTo(k, 0);
    mg.lineTo(k - S, S);
    mg.stroke();
  }
  // dark spiral bands
  mg.strokeStyle = "#2c4a5e";
  mg.lineWidth = 22;
  for (let k = -S; k <= 2 * S; k += 128) {
    mg.beginPath();
    mg.moveTo(k, 0);
    mg.lineTo(k + S, S);
    mg.stroke();
  }
  // floor lines that light up at night
  for (let y = 4; y < S; y += 16) {
    for (let x = 0; x < S; x += 16) {
      if (r() < 0.45) {
        eg.fillStyle = COOL[Math.floor(r() * COOL.length)];
        eg.fillRect(x, y, 14, 6);
      }
    }
  }
  return { map: toTexture(mc, true), emissive: toTexture(ec, true) };
}

/** Awning stripe mask: white = instance colour, black = cream (mixed in the awning shader). */
export function makeAwning(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 8);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#000000" : "#ffffff";
    g.fillRect(i * 8, 0, 8, 8);
  }
  const t = toTexture(c, false);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
