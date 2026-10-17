// Docks: CanvasTextures (no network assets). Client only.
import * as THREE from "three";
import { CRANE_LEG_X, CONTAINER, STRADDLE, STRADDLE_SPOTS, yardSlots } from "./layout";
import { BLOCK_COLS, BLOCK_Z, LANE_X } from "./portOps";
import { ZONES, WATER_X } from "../../config";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}
function tex(c: HTMLCanvasElement, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export interface Brand {
  name: string;
  base: string;
  text: string;
  sub?: string;
}
export const BRANDS: Brand[] = [
  { name: "HAMYWAY", base: "#ff6a1a", text: "#ffffff", sub: "DELIVERY · LONDON" },
  { name: "HAMSTER LINE", base: "#1f8a7a", text: "#f3f0e6" },
  { name: "NORTHWIND", base: "#24427f", text: "#ffffff", sub: "GLOBAL SHIPPING" },
  { name: "KESTREL", base: "#f1c232", text: "#2a2a2a" },
];

/**
 * Container atlas (1024x512):
 *  side  = canvas (0,0)-(1024,256)   -> uv u 0..1,    v 0.5..1
 *  top   = canvas (0,256)-(768,512)  -> uv u 0..0.75, v 0..0.5
 *  end   = canvas (768,256)-(1024,512) -> uv u 0.75..1, v 0..0.5
 * Generic boxes are drawn near-white and tinted per instance.
 */
export function containerTexture(brand?: Brand) {
  const [c, g] = canvas(1024, 512);
  const base = brand?.base ?? "#f4f4f4";
  g.fillStyle = base;
  g.fillRect(0, 0, 1024, 512);

  // side: corrugation
  for (let x = 20; x < 1004; x += 15) {
    g.fillStyle = "rgba(0,0,0,0.13)";
    g.fillRect(x, 14, 7, 228);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(x + 8, 14, 3, 228);
  }
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(0, 0, 1024, 14);
  g.fillRect(0, 242, 1024, 14);
  g.fillStyle = "rgba(0,0,0,0.38)";
  g.fillRect(0, 0, 18, 256);
  g.fillRect(1006, 0, 18, 256);
  if (brand) {
    g.fillStyle = base;
    g.globalAlpha = 0.85;
    g.fillRect(120, 58, 784, 140);
    g.globalAlpha = 1;
    g.fillStyle = brand.text;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${brand.name.length > 8 ? 92 : 118}px "Arial Black", Impact, sans-serif`;
    g.fillText(brand.name, 512, brand.sub ? 112 : 128);
    if (brand.sub) {
      g.font = "bold 34px Arial, sans-serif";
      g.fillText(brand.sub, 512, 182);
    }
  } else {
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.font = "bold 24px monospace";
    g.fillText("RVTU 482113 4", 40, 46);
    g.fillText("45G1", 40, 74);
  }

  // top
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(0, 256, 768, 256);
  for (let x = 16; x < 760; x += 22) {
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(x, 270, 8, 228);
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 12;
  g.strokeRect(6, 262, 756, 244);
  if (brand) {
    g.fillStyle = brand.text;
    g.globalAlpha = 0.7;
    g.font = `900 120px "Arial Black", Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(brand.name.split(" ")[0], 384, 384);
    g.globalAlpha = 1;
  }

  // end (doors)
  g.fillStyle = "rgba(0,0,0,0.08)";
  g.fillRect(768, 256, 256, 256);
  g.fillStyle = "rgba(0,0,0,0.42)";
  g.fillRect(768, 256, 256, 14);
  g.fillRect(768, 498, 256, 14);
  g.fillRect(768, 256, 12, 256);
  g.fillRect(1012, 256, 12, 256);
  g.fillRect(894, 270, 4, 228);
  for (const x of [800, 852, 940, 990]) g.fillRect(x, 270, 5, 228);
  for (const x of [796, 848, 936, 986]) {
    g.fillRect(x, 360, 13, 6);
  }
  return tex(c);
}

/** Re-map a BoxGeometry(w, h, l) (long axis z) onto the container atlas. */
export function atlasBoxGeometry(w = CONTAINER.w, h = CONTAINER.h, l = CONTAINER.l) {
  const geo = new THREE.BoxGeometry(w, h, l);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // face order: px, nx, py, ny, pz, nz (4 verts each)
  const regions: [number, number, number, number, boolean][] = [
    [0, 1, 0.5, 1, false], // px side
    [0, 1, 0.5, 1, false], // nx side
    [0, 0.75, 0, 0.5, true], // py top (swap so the long axis runs along the canvas)
    [0, 0.75, 0, 0.5, true], // ny bottom
    [0.75, 1, 0, 0.5, false], // pz end
    [0.75, 1, 0, 0.5, false], // nz end
  ];
  regions.forEach(([u0, u1, v0, v1, swap], f) => {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i), v = uv.getY(i);
      if (swap) [u, v] = [1 - v, u];
      uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
    }
  });
  uv.needsUpdate = true;
  return geo;
}

const S = 10; // px per metre for the apron
/** Concrete apron with painted markings, mapped onto a plane covering the docks zone. */
export function apronTexture() {
  const z = ZONES.docks;
  const W = (WATER_X - z.minX) * S, H = (z.maxZ - z.minZ) * S;
  const [c, g] = canvas(W, H);
  const px = (x: number) => (x - z.minX) * S;
  const pz = (zz: number) => (zz - z.minZ) * S;
  g.fillStyle = "#a3a5a6";
  g.fillRect(0, 0, W, H);
  // mottling
  const r = mulberry(7);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.035)";
    g.fillRect(r() * W, r() * H, 20 + r() * 80, 20 + r() * 80);
  }
  // slab joints
  g.strokeStyle = "rgba(0,0,0,0.09)";
  g.lineWidth = 2;
  for (let x = 0; x < W; x += 6 * S) line(g, x, 0, x, H);
  for (let y = 0; y < H; y += 6 * S) line(g, 0, y, W, y);
  // yard bays
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 3;
  for (const s of yardSlots()) {
    const hl = (s.short ? CONTAINER.l / 2 : CONTAINER.l) / 2 + 0.3;
    g.strokeRect(px(s.x - CONTAINER.w / 2 - 0.3), pz(s.z - hl), (CONTAINER.w + 0.6) * S, hl * 2 * S);
  }
  // straddle lane (dashed yellow loop)
  g.strokeStyle = "rgba(245,196,40,0.9)";
  g.lineWidth = 4;
  g.setLineDash([30, 22]);
  const { cx, cz, hx, hz, rc } = STRADDLE;
  for (const off of [-3, 3]) {
    roundRect(g, px(cx - hx - off), pz(cz - hz - off), (hx + off) * 2 * S, (hz + off) * 2 * S, (rc + off) * S);
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = "rgba(255,255,255,0.8)";
  for (const [x, zz] of [STRADDLE_SPOTS.A, STRADDLE_SPOTS.B]) g.strokeRect(px(x - 1.8), pz(zz - 7), 3.6 * S, 14 * S);
  // crane rails
  g.fillStyle = "#4b4d50";
  for (const x of CRANE_LEG_X) {
    g.fillRect(px(x - 0.5), 0, 3, H);
    g.fillRect(px(x + 0.5) - 3, 0, 3, H);
  }
  // quay carrier lane (between the crane rails) + buffer block bays at both ends
  g.strokeStyle = "rgba(245,196,40,0.85)";
  g.lineWidth = 4;
  g.setLineDash([40, 26]);
  for (const x of [LANE_X - 3, LANE_X + 3]) line(g, px(x), pz(-66), px(x), pz(66));
  g.setLineDash([]);
  g.strokeStyle = "rgba(255,255,255,0.75)";
  for (const side of [-1, 1])
    for (const x of BLOCK_COLS) g.strokeRect(px(x - 1.5), pz(side * BLOCK_Z - 6.5), 3 * S, 13 * S);
  // quay edge safety line + painted text
  g.fillStyle = "#f5c428";
  g.fillRect(px(WATER_X - 1.4), 0, 0.5 * S, H);
  g.save();
  g.translate(px(WATER_X - 4.5), pz(60));
  g.rotate(-Math.PI / 2);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "bold 46px Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("BERTH 3", 0, 0);
  g.restore();
  return tex(c, 8);
}

/** Sign board: text on a coloured panel. */
export function signTexture(text: string, bg: string, fg: string, w = 1024, h = 160, sub?: string) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${Math.round(h * (sub ? 0.46 : 0.58))}px "Arial Black", Impact, sans-serif`;
  g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) {
    g.font = `bold ${Math.round(h * 0.2)}px Arial, sans-serif`;
    g.fillText(sub, w / 2, h * 0.78);
  }
  return tex(c);
}

/** Ship name, white on transparent. */
export function hullNameTexture() {
  const [c, g] = canvas(2048, 160);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 120px "Arial Black", Impact, sans-serif`;
  g.fillText("HAMYWAY  STAR", 1024, 84);
  return tex(c);
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
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
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
