// Geometry layouts and canvas textures for the Hamyway fleet (no network assets).
import { CanvasTexture, Euler, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from "three";
import type { VanKind } from "./sim";

export const RIVET_ORANGE = "#ff6a1a";

export interface PartLayout {
  body: Matrix4; // livery box (cargo)
  cab: Matrix4;
  glass: Matrix4;
  bumper: Matrix4;
  wheels: Matrix4[]; // up to 6
  /** light positions, local: [frontL, frontR, rearL, rearR, brakeL, brakeR, headL, headR] */
  lights: Matrix4[];
  bonnet: Vector3; // where steam comes from
}

const q = new Quaternion();
const e = new Euler();
function box(x: number, y: number, z: number, w: number, h: number, l: number, rx = 0) {
  q.setFromEuler(e.set(rx, 0, 0));
  return new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(w, h, l));
}
function wheel(x: number, y: number, z: number, r: number, w: number) {
  q.setFromEuler(e.set(0, 0, Math.PI / 2));
  return new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(r, w, r));
}

// Unit geometries: box 1x1x1, wheel cylinder radius 1 height 1, light box 1x1x1.
export const LAYOUTS: Record<VanKind, PartLayout> = {
  van: {
    body: box(0, 1.32, -0.75, 2.1, 1.95, 3.7),
    cab: box(0, 0.88, 1.75, 2.04, 1.06, 1.7),
    glass: box(0, 1.66, 1.45, 1.96, 0.62, 1.05),
    bumper: box(0, 0.42, 0, 2.14, 0.28, 5.45),
    wheels: [
      wheel(-0.98, 0.4, 1.7, 0.4, 0.32), wheel(0.98, 0.4, 1.7, 0.4, 0.32),
      wheel(-0.98, 0.4, -1.6, 0.4, 0.32), wheel(0.98, 0.4, -1.6, 0.4, 0.32),
    ],
    lights: [
      box(0.85, 0.85, 2.62, 0.3, 0.16, 0.08), box(-0.85, 0.85, 2.62, 0.3, 0.16, 0.08),
      box(0.92, 1.95, -2.62, 0.18, 0.22, 0.08), box(-0.92, 1.95, -2.62, 0.18, 0.22, 0.08),
      box(0.92, 0.7, -2.62, 0.22, 0.32, 0.08), box(-0.92, 0.7, -2.62, 0.22, 0.32, 0.08),
      box(0.55, 0.85, 2.62, 0.3, 0.16, 0.08), box(-0.55, 0.85, 2.62, 0.3, 0.16, 0.08),
    ],
    bonnet: new Vector3(0, 1.5, 2.2),
  },
  truck: {
    body: box(0, 2.05, -1.0, 2.5, 2.9, 6.2),
    cab: box(0, 1.35, 3.15, 2.4, 1.7, 2.1),
    glass: box(0, 2.5, 3.2, 2.34, 0.75, 1.6),
    bumper: box(0, 0.5, 0.15, 2.52, 0.34, 8.65),
    wheels: [
      wheel(-1.12, 0.5, 3.2, 0.5, 0.4), wheel(1.12, 0.5, 3.2, 0.5, 0.4),
      wheel(-1.12, 0.5, -2.0, 0.5, 0.4), wheel(1.12, 0.5, -2.0, 0.5, 0.4),
      wheel(-1.12, 0.5, -3.2, 0.5, 0.4), wheel(1.12, 0.5, -3.2, 0.5, 0.4),
    ],
    lights: [
      box(1.0, 1.0, 4.22, 0.32, 0.18, 0.08), box(-1.0, 1.0, 4.22, 0.32, 0.18, 0.08),
      box(1.12, 3.3, -4.12, 0.2, 0.24, 0.08), box(-1.12, 3.3, -4.12, 0.2, 0.24, 0.08),
      box(1.05, 0.85, -4.12, 0.26, 0.36, 0.08), box(-1.05, 0.85, -4.12, 0.26, 0.36, 0.08),
      box(0.65, 1.0, 4.22, 0.32, 0.18, 0.08), box(-0.65, 1.0, 4.22, 0.32, 0.18, 0.08),
    ],
    bonnet: new Vector3(0, 2.4, 3.9),
  },
};

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White panel with a Hamyway orange stripe and the HAMYWAY wordmark. Every face of the cargo box shows it. */
export function makeLiveryTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#f6f5f1";
  g.fillRect(0, 0, 512, 256);
  // orange stripe with a forward chevron
  g.fillStyle = RIVET_ORANGE;
  g.fillRect(0, 168, 512, 34);
  g.beginPath();
  g.moveTo(400, 150);
  g.lineTo(470, 185);
  g.lineTo(400, 220);
  g.lineTo(420, 185);
  g.closePath();
  g.fill();
  g.fillStyle = "#2a2d34";
  g.fillRect(0, 232, 512, 24);
  // wordmark
  g.fillStyle = RIVET_ORANGE;
  g.font = "italic 900 112px system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("HAMYWAY", 256, 88);
  g.fillStyle = "#2a2d34";
  g.font = "700 26px system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  g.fillText("D E L I V E R Y", 256, 146);
  return tex(c);
}

/** Cardboard with orange Hamyway tape. */
export function makeParcelTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#c99a62";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#b8874f";
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  g.fillStyle = RIVET_ORANGE;
  g.fillRect(26, 0, 12, 64);
  return tex(c);
}

/** Green disc with a white tick, drawn as a path (no font). */
export function makeCheckTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#16a34a";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 6;
  g.stroke();
  g.lineWidth = 14;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(36, 66);
  g.lineTo(56, 86);
  g.lineTo(94, 44);
  g.stroke();
  return tex(c);
}
