// Procedural canvas textures for Southbank: facades (colour map + lit-window emissive mask),
// shopfronts, the striped awning mask, the football pitch and market paving.
import * as THREE from "three";
import type { FacadeKind } from "./layout";
import { mulberry32 } from "./night";

export interface FacadeGrid {
  colW: number; // metres per window column
  floorH: number; // metres per floor
  nx: number; // columns per texture repeat
  ny: number; // floors per texture repeat
}
export type TexKind = FacadeKind | "shop";

export const GRIDS: Record<TexKind, FacadeGrid> = {
  brick: { colW: 3, floorH: 3.2, nx: 8, ny: 8 },
  render: { colW: 3, floorH: 3.2, nx: 8, ny: 8 },
  georgian: { colW: 3.2, floorH: 3.4, nx: 8, ny: 8 },
  modern: { colW: 3.6, floorH: 3.2, nx: 8, ny: 8 },
  glass: { colW: 3, floorH: 3.8, nx: 8, ny: 8 },
  concrete: { colW: 4, floorH: 3.6, nx: 8, ny: 8 },
  shop: { colW: 3, floorH: 4, nx: 8, ny: 1 },
};

const CELL = 32;
const WARM = ["#ffd27a", "#ffe2a3", "#fff0cf", "#ffc86a", "#ffe9b8", "#ffd9a0"];
const COOL = ["#d8ecff", "#eef6ff", "#fff4dc", "#c9e2ff"];

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

export function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/** [x, y, w, h] of the window inside a 32 px cell, plus wall painter. */
const WIN: Record<TexKind, [number, number, number, number]> = {
  brick: [9, 6, 14, 20],
  render: [9, 6, 14, 20],
  georgian: [10, 3, 12, 25],
  modern: [3, 5, 26, 20],
  glass: [1, 1, 30, 28],
  concrete: [0, 10, 32, 12],
  shop: [2, 6, 28, 26],
};
const LIT: Record<TexKind, number> = { brick: 0.5, render: 0.5, georgian: 0.55, modern: 0.45, glass: 0.4, concrete: 0.6, shop: 0.95 };

export function makeFacade(kind: TexKind, seed: number): FacadeTextures {
  const g = GRIDS[kind];
  const W = g.nx * CELL, H = g.ny * CELL;
  const [c, x] = canvas(W, H);
  const [ce, e] = canvas(W, H);
  const rand = mulberry32(seed);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, W, H);
  e.fillStyle = "#000000";
  e.fillRect(0, 0, W, H);
  // wall texture
  if (kind === "brick") {
    for (let yy = 0; yy < H; yy += 3) {
      x.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.06})`;
      x.fillRect(0, yy, W, 1);
    }
  } else if (kind === "concrete") {
    for (let yy = 0; yy < H; yy += 8) {
      x.fillStyle = "rgba(0,0,0,0.08)";
      x.fillRect(0, yy, W, 1);
    }
    for (let i = 0; i < 400; i++) {
      x.fillStyle = `rgba(0,0,0,${rand() * 0.06})`;
      x.fillRect(rand() * W, rand() * H, 2, 2);
    }
  } else if (kind === "glass") {
    x.fillStyle = "#cfe0ea";
    x.fillRect(0, 0, W, H);
  }
  const [wx, wy, ww, wh] = WIN[kind];
  for (let row = 0; row < g.ny; row++)
    for (let col = 0; col < g.nx; col++) {
      const px = col * CELL, py = row * CELL;
      if (kind === "shop") {
        x.fillStyle = "#3a4048";
        x.fillRect(px, py, CELL, CELL);
        x.fillStyle = `hsl(${Math.floor(rand() * 360)},55%,${45 + rand() * 20}%)`;
        x.fillRect(px, py, CELL, 5); // sign band
        x.fillStyle = "#6f8796";
        x.fillRect(px + wx, py + wy, ww, wh);
        x.fillStyle = "#2a2d31";
        x.fillRect(px + 15, py + wy, 2, wh);
        e.fillStyle = WARM[Math.floor(rand() * WARM.length)];
        e.fillRect(px + wx, py + wy, ww, wh);
        e.fillStyle = `hsl(${Math.floor(rand() * 360)},90%,65%)`;
        e.fillRect(px + 2, py, CELL - 4, 5);
        continue;
      }
      if (kind === "glass") {
        x.fillStyle = rand() < 0.5 ? "#7fa3bd" : "#8fb4cc";
        x.fillRect(px + wx, py + wy, ww, wh);
        x.fillStyle = "#e9f2f7";
        x.fillRect(px, py + 29, CELL, 3);
      } else if (kind === "concrete") {
        x.fillStyle = "#3d454d";
        x.fillRect(px + wx, py + wy, ww, wh);
      } else {
        // sill + frame + pane
        x.fillStyle = "rgba(0,0,0,0.18)";
        x.fillRect(px + wx - 1, py + wy + wh, ww + 2, 2);
        x.fillStyle = kind === "modern" ? "#4c5966" : "#f1ede4";
        x.fillRect(px + wx - 1, py + wy - 1, ww + 2, wh + 2);
        x.fillStyle = kind === "modern" ? "#5d7385" : "#3b4652";
        x.fillRect(px + wx, py + wy, ww, wh);
        if (kind !== "modern") {
          x.fillStyle = "#f1ede4";
          x.fillRect(px + wx, py + wy + wh / 2, ww, 1); // sash bar
        } else if (row % 2 === 0) {
          x.fillStyle = "rgba(40,40,40,0.55)"; // balcony rail
          x.fillRect(px + 1, py + wy + wh - 6, CELL - 2, 2);
        }
      }
      if (rand() < LIT[kind]) {
        e.fillStyle = (kind === "glass" || kind === "modern" ? COOL : WARM)[Math.floor(rand() * 4)];
        e.fillRect(px + wx + 1, py + wy + 1, ww - 2, wh - 2);
      }
    }
  return { map: toTexture(c, true), emissive: toTexture(ce, true) };
}

/** Red-channel stripe mask for awnings and stall canopies. */
export function makeStripes(): THREE.CanvasTexture {
  const [c, x] = canvas(64, 8);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? "#000000" : "#ffffff";
    x.fillRect(i * 8, 0, 8, 8);
  }
  return toTexture(c, false);
}

/** Mown football pitch with markings, 1 texture over the whole pitch. */
export function makePitch(): THREE.CanvasTexture {
  const W = 1024, H = 640;
  const [c, x] = canvas(W, H);
  for (let i = 0; i < 16; i++) {
    x.fillStyle = i % 2 ? "#3f9b3a" : "#4aad43";
    x.fillRect((i * W) / 16, 0, W / 16 + 1, H);
  }
  x.strokeStyle = "#ffffff";
  x.lineWidth = 5;
  const m = 30;
  x.strokeRect(m, m, W - 2 * m, H - 2 * m);
  x.beginPath();
  x.moveTo(W / 2, m);
  x.lineTo(W / 2, H - m);
  x.stroke();
  x.beginPath();
  x.arc(W / 2, H / 2, 80, 0, Math.PI * 2);
  x.stroke();
  for (const side of [0, 1]) {
    const bx = side ? W - m - 150 : m;
    x.strokeRect(bx, H / 2 - 180, 150, 360);
    const sx = side ? W - m - 55 : m;
    x.strokeRect(sx, H / 2 - 80, 55, 160);
  }
  return toTexture(c, true, false);
}

/** Herringbone-ish paving for the market street and plazas (tiles 4 m). */
export function makePaving(): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  x.fillStyle = "#c9bfae";
  x.fillRect(0, 0, 128, 128);
  const rand = mulberry32(99);
  for (let yy = 0; yy < 128; yy += 16)
    for (let xx = 0; xx < 128; xx += 32) {
      const o = (yy / 16) % 2 ? 16 : 0;
      x.fillStyle = `hsl(32,${14 + rand() * 10}%,${66 + rand() * 10}%)`;
      x.fillRect(xx + o + 1, yy + 1, 30, 14);
    }
  return toTexture(c, true);
}
