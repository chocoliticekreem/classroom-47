// CanvasTextures for the motorway: junction sign atlas, smart-motorway speed sign, fuel price totem, services sign.
import * as THREE from "three";
import type { Junction } from "../../districts/motorway";

const FONT = "Arial, Helvetica, sans-serif";
export const SIGN_BLUE = "#1c4fa0";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Atlas cells: 2 columns x 4 rows of 512 x 256. */
export const ATLAS_COLS = 2;
export const ATLAS_ROWS = 4;

/** UV rectangle [u0, v0, u1, v1] of atlas cell i (CanvasTexture flips Y, so canvas top = v 1). */
export function atlasCell(i: number): [number, number, number, number] {
  const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
  const u0 = col / ATLAS_COLS, v1 = 1 - row / ATLAS_ROWS;
  return [u0, v1 - 1 / ATLAS_ROWS, u0 + 1 / ATLAS_COLS, v1];
}

/** Big blue UK-style direction signs, one atlas cell per junction. */
export function junctionSignAtlas(junctions: Junction[]) {
  const W = 512, H = 256;
  const [c, g] = canvas(W * ATLAS_COLS, H * ATLAS_ROWS);
  junctions.forEach((j, i) => {
    const x = (i % ATLAS_COLS) * W, y = Math.floor(i / ATLAS_COLS) * H;
    g.fillStyle = SIGN_BLUE;
    g.fillRect(x, y, W, H);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 7;
    roundRect(g, x + 10, y + 10, W - 20, H - 20, 18);
    g.stroke();
    // route shield: "M25" + orbital arrow, and the black-on-white junction number
    g.fillStyle = "#ffffff";
    g.font = `bold 46px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText("M25 ⟳", x + 34, y + 54);
    g.fillStyle = "#ffffff";
    roundRect(g, x + W - 124, y + 28, 92, 52, 8);
    g.fill();
    g.fillStyle = "#111111";
    g.textAlign = "center";
    g.font = `bold 40px ${FONT}`;
    g.fillText(`J${j.num}`, x + W - 78, y + 55);
    // destinations
    g.fillStyle = "#ffffff";
    g.textAlign = "left";
    g.font = `bold 62px ${FONT}`;
    g.fillText(j.dest[0], x + 34, y + 132, W - 68);
    g.font = `bold 50px ${FONT}`;
    g.fillStyle = "#ffe14d";
    g.fillText(j.dest[1], x + 34, y + 200, W - 68);
  });
  return tex(c);
}

/** Smart motorway matrix sign: dark when idle, "40" in a red ring when there's an incident ahead. */
export function vmsTexture(active: boolean) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#0b0d10";
  g.fillRect(0, 0, 256, 256);
  if (!active) {
    g.fillStyle = "#23272d";
    for (let y = 16; y < 256; y += 16) for (let x = 16; x < 256; x += 16) g.fillRect(x - 2, y - 2, 4, 4);
    return tex(c);
  }
  g.strokeStyle = "#ff2a1a";
  g.lineWidth = 26;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = `bold 118px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("40", 128, 136);
  return tex(c);
}

/** Fuel price totem (both faces). */
export function totemTexture() {
  const [c, g] = canvas(256, 640);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 640);
  g.fillStyle = "#ff6a1a";
  g.fillRect(0, 0, 256, 190);
  g.fillStyle = "#ffffff";
  g.font = `bold 84px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("FUEL", 128, 96);
  const rows: [string, string, string][] = [
    ["UNLEADED", "149.9", "#2f9e44"],
    ["DIESEL", "154.9", "#111111"],
    ["SUPER", "162.9", "#c92a2a"],
  ];
  rows.forEach(([name, price, col], i) => {
    const y = 250 + i * 128;
    g.fillStyle = col;
    g.fillRect(16, y - 46, 224, 100);
    g.fillStyle = "#ffffff";
    g.font = `bold 30px ${FONT}`;
    g.fillText(name, 128, y - 18);
    g.font = `bold 46px ${FONT}`;
    g.fillStyle = "#ffe14d";
    g.fillText(price, 128, y + 24);
  });
  return tex(c);
}

/** Long fascia sign for the food court. */
export function servicesSignTexture(text: string, bg = SIGN_BLUE) {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = "#ffffff";
  g.font = `bold 72px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 68, 980);
  return tex(c);
}
