// Canvas-drawn liveries (no network assets). Each texture is built once and shared.
import { CanvasTexture, SRGBColorSpace } from "three";

const cache = new Map<string, CanvasTexture>();

function make(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Two-row Battenburg chequer filling rows [y0, y0 + rowH * 2). */
function chequer(c: CanvasRenderingContext2D, w: number, y0: number, rowH: number, cols: number, c1: string, c2: string) {
  const cw = w / cols;
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < cols; i++) {
      c.fillStyle = (i + r) % 2 === 0 ? c1 : c2;
      c.fillRect(i * cw, y0 + r * rowH, cw + 1, rowH + 1);
    }
}

const HI_VIS_YELLOW = "#e6f01e";
const POLICE_BLUE = "#173a9e";
const NHS_GREEN = "#18a048";

/** Police car side: full-height blue/yellow Battenburg. */
export function policeSide() {
  return make("police-side", 512, 128, (c) => {
    chequer(c, 512, 0, 64, 10, POLICE_BLUE, HI_VIS_YELLOW);
  });
}

/** Ambulance box side: yellow upper with AMBULANCE, green/yellow Battenburg lower. */
export function ambulanceSide() {
  return make("ambulance-side", 512, 256, (c) => {
    c.fillStyle = HI_VIS_YELLOW;
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = NHS_GREEN;
    c.fillRect(0, 96, 512, 10);
    c.font = "bold 54px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("AMBULANCE", 256, 52);
    chequer(c, 512, 112, 72, 9, NHS_GREEN, HI_VIS_YELLOW);
  });
}

/** Fire engine body side: red with a yellow/red chequer band. */
export function fireSide() {
  return make("fire-side", 512, 256, (c) => {
    c.fillStyle = "#c8141c";
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = "#f2f2ea";
    c.fillRect(0, 36, 512, 8);
    chequer(c, 512, 150, 26, 16, HI_VIS_YELLOW, "#c8141c");
    c.fillStyle = "#ffffff";
    c.font = "bold 44px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("FIRE & RESCUE", 256, 96);
  });
}

/** Recovery truck cab side: yellow/black chequer band, RECOVERY text. */
export function towSide() {
  return make("tow-side", 256, 256, (c) => {
    c.fillStyle = "#f2b01a";
    c.fillRect(0, 0, 256, 256);
    chequer(c, 256, 150, 40, 6, "#1d1d1f", "#f2b01a");
    c.fillStyle = "#1d1d1f";
    c.font = "bold 36px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("RECOVERY", 128, 80);
  });
}

/** Roof ID marking (UK police/ambulance carry big call signs on the roof for helicopters). */
export function roofMark(text: string, bg: string, fg: string) {
  return make(`roof-${text}-${bg}`, 128, 256, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 128, 256);
    c.save();
    c.translate(64, 128);
    c.rotate(Math.PI / 2);
    c.fillStyle = fg;
    c.font = "bold 96px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 0, 4);
    c.restore();
  });
}
