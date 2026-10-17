// Canvas textures: runway markings and the airport's signs. No fonts are fetched: system-ui only.
import * as THREE from "three";
import { RWY, RWY_LEN } from "./layout";

const FONT = "system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function texture(c: HTMLCanvasElement, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Runway surface: canvas x = world x (west -> east), canvas y = world z (north at the top). Includes shoulders. */
export const RUNWAY_TEX_W = RWY_LEN + 8; // metres covered (4 m overrun each end)
export const RUNWAY_TEX_H = RWY.halfW * 2 + 6; // metres covered (3 m shoulders)

export function runwayTexture() {
  const PX = 12; // px per metre
  const W = Math.round(RUNWAY_TEX_W * PX);
  const H = Math.round(RUNWAY_TEX_H * PX);
  const { c, g } = canvas(W, H);
  const mx = (x: number) => (x - (RWY.x0 - 4)) * PX; // world x -> px
  const my = (dz: number) => (dz + RUNWAY_TEX_H / 2) * PX; // offset from centreline -> px
  // shoulders and asphalt with subtle grain
  g.fillStyle = "#5b5e58";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#3b3e43";
  g.fillRect(mx(RWY.x0), my(-RWY.halfW), RWY_LEN * PX, RWY.halfW * 2 * PX);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    g.fillRect(Math.random() * W, my(-RWY.halfW) + Math.random() * RWY.halfW * 2 * PX, 3 + Math.random() * 6, 2);
  }
  // tyre rubber at the touchdown zones
  const rubber = (x0: number, x1: number) => {
    const grd = g.createLinearGradient(mx(x0), 0, mx(x1), 0);
    grd.addColorStop(0, "rgba(10,10,12,0)");
    grd.addColorStop(0.3, "rgba(10,10,12,0.35)");
    grd.addColorStop(1, "rgba(10,10,12,0)");
    g.fillStyle = grd;
    g.fillRect(mx(x0), my(-4), (x1 - x0) * PX, 8 * PX);
  };
  rubber(RWY.x0 + 14, RWY.x0 + 60);
  rubber(RWY.x1 - 60, RWY.x1 - 14);

  g.fillStyle = "#f4f4ef";
  // side stripes
  g.fillRect(mx(RWY.x0), my(-RWY.halfW + 0.6), RWY_LEN * PX, 0.4 * PX);
  g.fillRect(mx(RWY.x0), my(RWY.halfW - 1.0), RWY_LEN * PX, 0.4 * PX);
  // threshold piano keys at both ends
  for (const [x0, dir] of [
    [RWY.x0 + 1.5, 1],
    [RWY.x1 - 1.5, -1],
  ] as const) {
    for (let k = 0; k < 8; k++) {
      const z = -RWY.halfW + 1.8 + k * 2.55 + (k >= 4 ? 0.9 : 0);
      const xs = dir > 0 ? x0 : x0 - 10;
      g.fillRect(mx(xs), my(z), 10 * PX, 1.4 * PX);
    }
    // threshold bar
    g.fillRect(mx(dir > 0 ? x0 - 1 : x0 + 0.4), my(-RWY.halfW + 1), 0.6 * PX, (RWY.halfW * 2 - 2) * PX);
  }
  // centreline dashes
  for (let x = RWY.x0 + 32; x < RWY.x1 - 32; x += 9) g.fillRect(mx(x), my(-0.25), 5 * PX, 0.5 * PX);
  // aiming point blocks and touchdown zone bars
  for (const [x, dir] of [
    [RWY.x0 + 30, 1],
    [RWY.x1 - 30, -1],
  ] as const) {
    for (const s of [-1, 1]) {
      g.fillRect(mx(dir > 0 ? x : x - 9), my(s * 4.2 - 0.9), 9 * PX, 1.8 * PX);
      for (const off of [14, 22])
        for (let k = 0; k < 2; k++) {
          const xx = dir > 0 ? x + off : x - off - 4;
          g.fillRect(mx(xx), my(s * (6.4 + k * 1.2) - 0.35), 4 * PX, 0.7 * PX);
        }
    }
  }
  // runway designators, readable by a pilot landing on them
  const digits = (text: string, cx: number, rot: number) => {
    g.save();
    g.translate(mx(cx), my(0));
    g.rotate(rot);
    g.font = `800 ${Math.round(7.5 * PX)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 0, 0);
    g.restore();
  };
  digits("09", RWY.x0 + 19, Math.PI / 2);
  digits("27", RWY.x1 - 19, -Math.PI / 2);
  return texture(c, 16);
}

/** A big rooftop sign. `bg` null = transparent background (letters only). */
export function signTexture(text: string, opts: { fg: string; bg: string | null; accent?: string; w?: number; h?: number }) {
  const W = opts.w ?? 1024;
  const H = opts.h ?? 128;
  const { c, g } = canvas(W, H);
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, H * 0.18);
    g.fill();
  }
  let x = W / 2;
  if (opts.accent) {
    // Hamyway mark: an orange rounded square with a white "R"
    const s = H * 0.66;
    const left = 22;
    g.fillStyle = opts.accent;
    g.beginPath();
    g.roundRect(left, (H - s) / 2, s, s, s * 0.22);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `900 ${Math.round(s * 0.78)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("R", left + s / 2, H / 2 + 2);
    x = left + s + (W - left - s) / 2;
  }
  g.fillStyle = opts.fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = Math.round(H * 0.62);
  g.font = `900 ${size}px ${FONT}`;
  const maxW = W - (opts.accent ? H * 0.66 + 70 : 50);
  while (g.measureText(text).width > maxW && size > 10) {
    size -= 2;
    g.font = `900 ${size}px ${FONT}`;
  }
  g.fillText(text, x, H / 2 + 3);
  return texture(c);
}
