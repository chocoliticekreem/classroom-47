// Canvas textures for the depot (no network fonts: system sans only).
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

export const RIVET_ORANGE = "#ff6a1a";
const FONT = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function finish(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Hamyway logo mark: an orange disc with a white rivet head and motion lines. */
function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, bg: string, fg: string) {
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fg;
  g.beginPath();
  g.arc(cx, cy, r * 0.48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  g.fill();
}

/** Big "HAMYWAY DELIVERY" fascia / billboard sign. */
export function makeSignTexture(sub = "LONDON DEPOT") {
  const [c, g] = canvas(2048, 320);
  g.fillStyle = RIVET_ORANGE;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, 14);
  g.fillRect(0, c.height - 14, c.width, 14);
  drawMark(g, 170, 160, 110, "#ffffff", RIVET_ORANGE);
  g.fillStyle = RIVET_ORANGE;
  g.beginPath();
  g.arc(170, 160, 52, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(170, 160, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.textBaseline = "middle";
  g.font = `900 190px ${FONT}`;
  g.fillText("HAMYWAY", 320, 150);
  const rw = g.measureText("HAMYWAY ").width;
  g.font = `300 190px ${FONT}`;
  g.fillText("DELIVERY", 320 + rw, 150);
  g.font = `700 44px ${FONT}`;
  g.textAlign = "right";
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillText(sub, c.width - 60, 268);
  return finish(c);
}

/** Roof: corrugated panels with a huge logo readable from the sky. */
export function makeRoofTexture() {
  const [c, g] = canvas(2048, 288);
  g.fillStyle = "#5d6470";
  g.fillRect(0, 0, c.width, c.height);
  for (let x = 0; x < c.width; x += 16) {
    g.fillStyle = x % 32 === 0 ? "#68707c" : "#545a65";
    g.fillRect(x, 0, 8, c.height);
  }
  // skylights
  g.fillStyle = "#9fc3d9";
  for (let x = 80; x < c.width; x += 240) {
    if (x > 560 && x < 1500) continue;
    g.fillRect(x, 40, 90, 40);
    g.fillRect(x, 208, 90, 40);
  }
  // logo panel
  g.fillStyle = RIVET_ORANGE;
  g.fillRect(600, 30, 860, 228);
  drawMark(g, 700, 144, 80, "#ffffff", RIVET_ORANGE);
  g.fillStyle = "#ffffff";
  g.textBaseline = "middle";
  g.font = `900 170px ${FONT}`;
  g.fillText("HAMYWAY", 810, 150);
  return finish(c);
}

/** Trailer side livery. */
export function makeTrailerTexture() {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = "#f4f4f2";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = RIVET_ORANGE;
  g.beginPath();
  g.moveTo(0, 190);
  g.lineTo(c.width, 120);
  g.lineTo(c.width, 256);
  g.lineTo(0, 256);
  g.fill();
  drawMark(g, 110, 100, 62, RIVET_ORANGE, "#ffffff");
  g.fillStyle = "#1d1f24";
  g.textBaseline = "middle";
  g.font = `900 110px ${FONT}`;
  g.fillText("HAMYWAY", 200, 96);
  g.font = `600 34px ${FONT}`;
  g.fillStyle = "#ffffff";
  g.fillText("next-day, every day", 600, 210);
  return finish(c);
}

/** Red/white striped barrier arm. */
export function makeStripeTexture() {
  const [c, g] = canvas(256, 16);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#e0262b";
    g.fillRect(i * 32, 0, 32, 16);
  }
  const t = finish(c);
  t.wrapS = RepeatWrapping;
  return t;
}

/** Roller door: horizontal slats. */
export function makeRollerTexture() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = "#cfd3d8";
  g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 8) {
    g.fillStyle = "#a9afb7";
    g.fillRect(0, y, 64, 2);
  }
  g.fillStyle = "#ffc21a";
  g.fillRect(0, 120, 64, 8);
  return finish(c);
}
