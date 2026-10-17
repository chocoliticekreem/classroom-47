// Canvas textures for Shoreditch: a procedural street-art mural atlas and a neon-sign atlas.
// Browser only (needs document); called from the component inside useMemo.
import * as THREE from "three";
import { mulberry32 } from "./geom2d";
import type { Sign } from "./layout";

const FONT = `"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;

// ------------------------------------------------------------------------------------------- murals

export const MURAL_COLS = 4;
export const MURAL_ROWS = 2;
const TILE = 512;

const PALETTES = [
  ["#ff3fa4", "#ffe14d", "#39e6ff", "#1b1b3a", "#ffffff"],
  ["#ff6a1a", "#2a9d8f", "#264653", "#e9c46a", "#f1faee"],
  ["#8338ec", "#ff006e", "#fb5607", "#ffbe0b", "#3a86ff"],
  ["#06d6a0", "#118ab2", "#ef476f", "#ffd166", "#073b4c"],
  ["#f72585", "#7209b7", "#4cc9f0", "#b5e48c", "#14213d"],
  ["#e63946", "#f1faee", "#a8dadc", "#457b9d", "#1d3557"],
  ["#9dff3f", "#121212", "#ff3fa4", "#ffffff", "#5e60ce"],
  ["#ff9f1c", "#2ec4b6", "#e71d36", "#fdfffc", "#011627"],
];
const WORDS = ["HAMYWAY", "E2", "DREAM", "LDN", "HYPE", "WILD", "BOOM", "ZAP!", "LOVE", "ART", "GO!", "FREE"];

function drawMural(ctx: CanvasRenderingContext2D, ox: number, oy: number, design: number) {
  const r = mulberry32(9001 + design * 77);
  const pal = PALETTES[design % PALETTES.length];
  const col = (i: number) => pal[i % pal.length];
  const R = (a: number, b: number) => a + r() * (b - a);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, TILE, TILE);
  ctx.clip();
  ctx.translate(ox, oy);

  // background: diagonal gradient
  const g = ctx.createLinearGradient(0, 0, TILE, TILE);
  g.addColorStop(0, col(0));
  g.addColorStop(1, col(2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TILE, TILE);

  // big shapes
  const style = design % 4;
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = col(i + 1);
    ctx.globalAlpha = R(0.55, 0.95);
    if (style === 0) {
      ctx.beginPath();
      ctx.arc(R(0, TILE), R(0, TILE), R(30, 170), 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 1) {
      ctx.save();
      ctx.translate(TILE / 2, TILE / 2);
      ctx.rotate(R(-1, 1));
      ctx.fillRect(-TILE, R(-TILE / 2, TILE / 2), TILE * 2, R(18, 70));
      ctx.restore();
    } else if (style === 2) {
      ctx.beginPath();
      ctx.moveTo(R(0, TILE), R(0, TILE));
      ctx.lineTo(R(0, TILE), R(0, TILE));
      ctx.lineTo(R(0, TILE), R(0, TILE));
      ctx.closePath();
      ctx.fill();
    } else {
      // concentric rings
      ctx.lineWidth = R(14, 34);
      ctx.strokeStyle = col(i + 2);
      ctx.beginPath();
      ctx.arc(TILE * 0.5, TILE * 0.55, 40 + i * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // a character face on half the designs
  if (design % 2 === 0) {
    const cx = R(150, 360), cy = R(150, 260), s = R(90, 130);
    ctx.fillStyle = col(4);
    ctx.beginPath();
    ctx.ellipse(cx, cy, s, s * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    for (const ex of [-0.38, 0.38]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cx + ex * s, cy - 0.15 * s, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(cx + ex * s + 6, cy - 0.12 * s, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + 0.28 * s, s * 0.38, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // graffiti word: chunky letters, black outline, drop shadow, highlight, drips
  const word = WORDS[(design * 5 + 3) % WORDS.length];
  ctx.save();
  ctx.translate(TILE / 2, TILE * (design % 2 === 0 ? 0.78 : 0.55));
  ctx.rotate(R(-0.22, 0.22));
  let size = 190;
  ctx.font = `900 ${size}px ${FONT}`;
  const wMeasured = ctx.measureText(word).width;
  if (wMeasured > TILE * 0.9) size = Math.floor((size * TILE * 0.9) / wMeasured);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#111";
  ctx.fillText(word, 10, 12);
  ctx.lineWidth = 22;
  ctx.strokeStyle = "#111";
  ctx.strokeText(word, 0, 0);
  const lg = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  lg.addColorStop(0, col(3));
  lg.addColorStop(1, col(1));
  ctx.fillStyle = lg;
  ctx.fillText(word, 0, 0);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.strokeText(word, -4, -5);
  ctx.restore();
  ctx.fillStyle = col(1);
  for (let i = 0; i < 14; i++) {
    const x = R(60, TILE - 60);
    const y = R(TILE * 0.5, TILE * 0.85);
    ctx.fillRect(x, y, R(4, 9), R(20, 90));
  }

  // spray speckle + tags
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = col(Math.floor(r() * 5));
    ctx.globalAlpha = 0.6;
    ctx.fillRect(R(0, TILE), R(0, TILE), 3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.font = `bold 34px ${FONT}`;
  ctx.fillStyle = "#111";
  ctx.fillText(["kx!", "zed", "omo", "r1v"][design % 4], R(20, 380), R(470, 500));
  ctx.restore();
}

export function muralAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE * MURAL_COLS;
  canvas.height = TILE * MURAL_ROWS;
  const ctx = canvas.getContext("2d");
  if (ctx) for (let d = 0; d < MURAL_COLS * MURAL_ROWS; d++) drawMural(ctx, (d % MURAL_COLS) * TILE, Math.floor(d / MURAL_COLS) * TILE, d);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** UV rectangle [u0, v0, u1, v1] of a mural design in the atlas. */
export function muralUv(design: number): [number, number, number, number] {
  const c = design % MURAL_COLS;
  const r = Math.floor(design / MURAL_COLS) % MURAL_ROWS;
  const u0 = c / MURAL_COLS;
  const v1 = 1 - r / MURAL_ROWS;
  return [u0 + 0.002, v1 - 1 / MURAL_ROWS + 0.002, u0 + 1 / MURAL_COLS - 0.002, v1 - 0.002];
}

// ------------------------------------------------------------------------------------------- neon

const CELL_W = 256;
const CELL_H = 48;
const COLS = 4;

export interface NeonAtlas {
  texture: THREE.CanvasTexture;
  /** UV rect per sign index. */
  uvs: [number, number, number, number][];
}

/** One cell per distinct (text, colour, aspect); each sign maps to its cell. */
export function neonAtlas(signs: Sign[]): NeonAtlas {
  const keyOf = (s: Sign) => `${s.text}|${s.color}|${Math.min(6, Math.max(1, Math.round(s.w / s.h)))}`;
  const keys = [...new Set(signs.map(keyOf))];
  const rows = Math.ceil(keys.length / COLS);
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * COLS;
  canvas.height = Math.max(CELL_H, rows * CELL_H);
  const ctx = canvas.getContext("2d");
  const rect = new Map<string, [number, number, number, number]>();
  keys.forEach((k, i) => {
    const [text, color, aspStr] = k.split("|");
    const asp = Number(aspStr);
    const cw = Math.min(CELL_W, Math.round(CELL_H * asp));
    const x0 = (i % COLS) * CELL_W;
    const y0 = Math.floor(i / COLS) * CELL_H;
    if (ctx) {
      ctx.fillStyle = "#0d0d12";
      ctx.fillRect(x0, y0, cw, CELL_H);
      ctx.strokeStyle = "#2a2a33";
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 2, y0 + 2, cw - 4, CELL_H - 4);
      let size = 32;
      ctx.font = `bold ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      if (tw > cw - 20) size = Math.floor((size * (cw - 20)) / tw);
      ctx.font = `bold ${size}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.strokeText(text, x0 + cw / 2, y0 + CELL_H / 2 + 2);
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.fillText(text, x0 + cw / 2, y0 + CELL_H / 2 + 2);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    rect.set(k, [x0 / canvas.width, 1 - (y0 + CELL_H) / canvas.height, (x0 + cw) / canvas.width, 1 - y0 / canvas.height]);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, uvs: signs.map((s) => rect.get(keyOf(s))!) };
}
