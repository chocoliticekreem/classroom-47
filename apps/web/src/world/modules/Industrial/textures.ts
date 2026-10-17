// Industrial: procedural CanvasTextures (no network assets).
import * as THREE from "three";
import { rng } from "./layout";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}
function tex(c: HTMLCanvasElement, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Soft, lumpy smoke puff: a radial gradient with a few overlapping blobs. White, alpha carries the shape. */
export function smokeTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const r = rng(99);
  g.clearRect(0, 0, S, S);
  const blob = (x: number, y: number, rad: number, a: number) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.5, `rgba(255,255,255,${a * 0.55})`);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  };
  blob(S / 2, S / 2, S * 0.48, 0.55);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * S * 0.18;
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.16 + r() * 0.16), 0.32);
  }
  return tex(c, false, false);
}

/** Chain-link fence: diamond mesh with a top rail line. Alpha-tested. */
export function chainLinkTexture() {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(190,196,200,1)";
  g.lineWidth = 2;
  for (let k = -64; k <= 64; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0);
    g.lineTo(k, 64);
    g.stroke();
  }
  g.fillStyle = "rgba(150,156,160,1)";
  g.fillRect(0, 0, 64, 4);
  const t = tex(c, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Yellow/black hazard chevrons. */
export function hazardTexture() {
  const [c, g] = canvas(128, 32);
  g.fillStyle = "#f2c230";
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = "#151515";
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  return tex(c, true);
}

/** Rubber conveyor belt with cleats and ore lumps (scrolled along v). */
export function beltTexture() {
  const [c, g] = canvas(32, 128);
  const r = rng(5);
  g.fillStyle = "#2a2a2c";
  g.fillRect(0, 0, 32, 128);
  g.fillStyle = "#3d3d40";
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 32, 3);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = r() < 0.5 ? "#7a4a32" : "#5b3a2a";
    g.beginPath();
    g.arc(4 + r() * 24, r() * 128, 2 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true);
}

/** Gritty tarmac / gravel ground, tiled. */
export function gritTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(17);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.floor(r() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
  }
  // oil stains
  for (let i = 0; i < 7; i++) {
    const x = r() * S;
    const y = r() * S;
    const grd = g.createRadialGradient(x, y, 0, x, y, 10 + r() * 22);
    grd.addColorStop(0, "rgba(40,40,40,0.35)");
    grd.addColorStop(1, "rgba(40,40,40,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  return tex(c, true);
}

/** A painted sign on a dark panel. */
export function signTexture(text: string, bg: string, fg: string, w = 1024, h = 128) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.52)}px Helvetica, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c);
}
