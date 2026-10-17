// Reusable baked props: emergency vehicles, trees, benches, lamps, windows.
import { IcosahedronGeometry } from "three";
import { type Kits, atAll, allKits } from "./kit";

const TYRE = "#1d1f22";
const HUB = "#9aa0a6";

function wheels(k: Kits, halfTrack: number, r: number, zs: number[]) {
  for (const z of zs)
    for (const s of [-1, 1]) {
      k.solid.cyl(r, r, 0.3, 10, [s * halfTrack, r, z], TYRE, [0, 0, Math.PI / 2]);
      k.solid.cyl(r * 0.45, r * 0.45, 0.32, 6, [s * halfTrack, r, z], HUB, [0, 0, Math.PI / 2]);
    }
}

/** Alternating squares along a vehicle side (Battenburg livery). */
function battenburg(k: Kits, halfW: number, y0: number, y1: number, z0: number, z1: number, n: number, a: string, b: string) {
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++)
    for (const s of [-1, 1]) {
      const za = z0 + i * step;
      k.solid.slab(s * halfW - 0.03, s * halfW + 0.03, y0, y1, za, za + step, (i + (s > 0 ? 0 : 1)) % 2 ? a : b);
    }
}

/** UK police car, nose towards +z, centred on the local origin. */
export function policeCar(k: Kits, x: number, z: number, ry: number) {
  atAll(allKits(k), x, 0, z, ry, () => {
    k.solid.slab(-0.9, 0.9, 0.32, 1.05, -2.2, 2.2, "#f4f5f7");
    k.solid.slab(-0.92, 0.92, 0.3, 0.45, -2.25, 2.25, "#2a2d33");
    k.glass.slab(-0.8, 0.8, 1.05, 1.58, -1.1, 0.9, "#1c2a3c");
    k.solid.slab(-0.82, 0.82, 1.58, 1.66, -1.0, 0.75, "#f4f5f7");
    battenburg(k, 0.9, 0.55, 0.88, -2.0, 2.0, 6, "#1b3fa0", "#f6d10b");
    k.glow.slab(-0.6, -0.05, 1.66, 1.82, -0.25, 0.05, "#2f6bff");
    k.glow.slab(0.05, 0.6, 1.66, 1.82, -0.25, 0.05, "#2f6bff");
    k.glow.slab(-0.8, -0.45, 0.7, 0.88, 2.19, 2.24, "#fff6d8");
    k.glow.slab(0.45, 0.8, 0.7, 0.88, 2.19, 2.24, "#fff6d8");
    k.glow.slab(-0.8, -0.5, 0.7, 0.88, -2.24, -2.19, "#ff2a2a");
    k.glow.slab(0.5, 0.8, 0.7, 0.88, -2.24, -2.19, "#ff2a2a");
    wheels(k, 0.8, 0.35, [-1.4, 1.4]);
  });
}

/** UK ambulance (box body, Battenburg yellow/green), nose towards +z. */
export function ambulance(k: Kits, x: number, z: number, ry: number) {
  atAll(allKits(k), x, 0, z, ry, () => {
    k.solid.slab(-1.1, 1.1, 0.5, 2.95, -3.0, 1.2, "#f7f7f2");
    k.solid.slab(-1.05, 1.05, 0.5, 2.15, 1.2, 2.9, "#f7f7f2");
    k.solid.slab(-1.12, 1.12, 0.35, 0.6, -3.05, 2.95, "#2a2d33");
    k.glass.slab(-0.95, 0.95, 1.35, 2.05, 2.86, 2.96, "#1c2a3c");
    k.glass.slab(-1.08, 1.08, 1.4, 2.0, 1.5, 2.6, "#1c2a3c");
    battenburg(k, 1.1, 0.95, 1.65, -2.9, 2.85, 8, "#1e9a46", "#f5d90a");
    k.solid.slab(-1.13, 1.13, 1.65, 1.8, -2.9, 1.2, "#1e9a46");
    k.glow.slab(-0.8, 0.8, 2.15, 2.3, 1.6, 1.95, "#2f6bff");
    k.glow.slab(-1.05, -0.8, 2.75, 2.98, -3.02, -2.95, "#2f6bff");
    k.glow.slab(0.8, 1.05, 2.75, 2.98, -3.02, -2.95, "#2f6bff");
    k.glow.slab(-0.95, -0.6, 0.85, 1.05, 2.9, 2.95, "#fff6d8");
    k.glow.slab(0.6, 0.95, 0.85, 1.05, 2.9, 2.95, "#fff6d8");
    // green cross on the roof, for the aerial view
    k.solid.slab(-0.25, 0.25, 2.95, 2.98, -2.0, -0.2, "#1e9a46");
    k.solid.slab(-0.9, 0.9, 2.95, 2.98, -1.35, -0.85, "#1e9a46");
    wheels(k, 0.95, 0.45, [-2.0, 1.9]);
  });
}

/** Road gritter lorry: orange cab, salt hopper, spinner, snow plough. Nose towards +z. */
export function gritter(k: Kits, x: number, z: number, ry: number) {
  const O = "#ff7a1a";
  atAll(allKits(k), x, 0, z, ry, () => {
    k.solid.slab(-1.1, 1.1, 0.55, 0.9, -3.8, 4.0, "#2a2d33");
    k.solid.slab(-1.25, 1.25, 0.9, 3.0, 2.2, 4.0, O);
    k.solid.slab(-1.27, 1.27, 2.55, 2.75, 2.2, 4.0, "#ffffff");
    k.glass.slab(-1.1, 1.1, 1.9, 2.6, 3.95, 4.05, "#1c2a3c");
    k.glass.slab(-1.28, 1.28, 1.9, 2.5, 2.9, 3.8, "#1c2a3c");
    // hopper: tapered box, salt on top
    k.solid.frustum(1.25, 0.7, 2.1, [0, 2.05, -0.8], O, [1, 1, 2.25]);
    k.solid.slab(-1.05, 1.05, 3.05, 3.12, -3.4, 1.8, "#e9e6df");
    k.solid.slab(-1.27, 1.27, 2.4, 2.6, -3.6, 2.0, "#2a2d33");
    // chevrons on the back
    for (let i = 0; i < 4; i++)
      k.solid.box(0.35, 1.0, 0.05, -0.9 + i * 0.6, 1.9, -3.67, i % 2 ? "#f2d21a" : "#e0261f", 0);
    k.solid.cyl(0.55, 0.55, 0.08, 10, [0, 0.75, -4.1], "#1b1b1b");
    // plough blade, angled
    k.solid.at(0, 0, 4.55, 0.22, () => {
      k.solid.box(3.0, 1.0, 0.25, 0, 0.75, 0, O);
      for (let i = 0; i < 5; i++) k.solid.box(0.3, 0.98, 0.05, -1.2 + i * 0.6, 0.75, 0.14, "#1b1b1b");
    });
    // amber beacons
    for (const bx of [-0.9, 0.9]) k.glow.cyl(0.16, 0.18, 0.3, 8, [bx, 3.15, 3.4], "#ffae00");
    for (const bx of [-0.9, 0.9]) k.glow.cyl(0.16, 0.18, 0.3, 8, [bx, 3.3, -3.3], "#ffae00");
    wheels(k, 1.05, 0.55, [3.0, -1.5, -2.7]);
  });
}

const GREENS = ["#4e9a3d", "#5eae45", "#3f8a3a", "#6dbb4f", "#478f45"];

export function tree(k: Kits, x: number, z: number, s: number, i: number, base = 0) {
  const g = GREENS[i % GREENS.length];
  k.solid.cyl(0.18 * s, 0.26 * s, 2.2 * s, 6, [x, base + 1.1 * s, z], "#7a5434");
  if (i % 3 === 2) {
    k.solid.cone(1.6 * s, 3.8 * s, 7, [x, base + 3.6 * s, z], "#3c7d3f");
  } else {
    k.solid.add(newIco(1.7 * s), g, [x, base + 3.2 * s, z], [0, i, 0]);
    k.solid.add(newIco(1.15 * s), GREENS[(i + 2) % GREENS.length], [x + 0.4 * s, base + 4.3 * s, z - 0.2 * s], [i, 0, 0]);
  }
}

const newIco = (r: number) => new IcosahedronGeometry(r, 0);

/** Park bench facing +z. */
export function bench(k: Kits, x: number, z: number, ry: number, base = 0) {
  k.solid.at(x, base, z, ry, () => {
    k.solid.slab(-0.9, 0.9, 0.42, 0.5, -0.25, 0.25, "#8a5a32");
    k.solid.slab(-0.9, 0.9, 0.55, 0.95, -0.3, -0.22, "#8a5a32");
    for (const sx of [-0.75, 0.75]) k.solid.slab(sx - 0.05, sx + 0.05, 0, 0.95, -0.28, 0.22, "#26292c");
  });
}

/** Victorian street lamp. */
export function lamp(k: Kits, x: number, z: number, base = 0, h = 3.4) {
  k.solid.cyl(0.07, 0.11, h, 6, [x, base + h / 2, z], "#1f2326");
  k.solid.cyl(0.18, 0.18, 0.15, 6, [x, base + 0.08, z], "#1f2326");
  k.glow.frustum(0.2, 0.13, 0.45, [x, base + h + 0.2, z], "#ffe2a3");
  k.solid.cone(0.3, 0.3, 4, [x, base + h + 0.57, z], "#1f2326", [0, Math.PI / 4, 0]);
}

/**
 * Windows on a facade. axis "x": the facade runs along x and faces +z (dir=1) or -z (dir=-1) at plane `p`.
 * axis "z": runs along z, faces +x/-x at plane `p`.
 */
export function windows(
  k: Kits,
  axis: "x" | "z",
  p: number,
  dir: 1 | -1,
  from: number,
  to: number,
  spacing: number,
  ys: number[],
  w: number,
  h: number,
  color: string,
  skip?: (u: number, y: number) => boolean,
) {
  const n = Math.max(1, Math.floor((to - from) / spacing + 1e-6) + 1);
  const span = (n - 1) * spacing;
  const start = (from + to) / 2 - span / 2;
  const o = p + dir * 0.05;
  for (const y of ys)
    for (let i = 0; i < n; i++) {
      const u = start + i * spacing;
      if (skip?.(u, y)) continue;
      if (axis === "x") k.glass.slab(u - w / 2, u + w / 2, y - h / 2, y + h / 2, o - 0.08, o + 0.08, color);
      else k.glass.slab(o - 0.08, o + 0.08, y - h / 2, y + h / 2, u - w / 2, u + w / 2, color);
    }
}
