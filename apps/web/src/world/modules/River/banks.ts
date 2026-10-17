// Embankments: stone river walls with coping and iron railings, the riverside promenade (paving, plane
// trees, Victorian lamps), steps down to the water, pontoon piers and moored barges. Pure geometry
// builders; everything static is merged into one vertex-coloured mesh.
import * as THREE from "three";
import { GeoBuilder, rng, tf } from "./builder";
import { inGap } from "./gaps";
import { BANK_X0, BANK_X1, HALF_W, PATH } from "./path";

export const WALL_H = 1.3;
export const WALL_T = 1.4;
export const PROM_W = 13; // promenade width behind the wall
export const PAVING_Y = 0.016;

/** True when x is inside a bridge's landing (no wall, trees, lamps there). */
export const inBridgeGap = inGap;

/** Path sample indices covered by the embankments. */
export function bankIndices(): number[] {
  const out: number[] = [];
  for (let i = 0; i < PATH.count; i++) if (PATH.x[i] >= BANK_X0 && PATH.x[i] <= BANK_X1) out.push(i);
  return out;
}

const STONE = ["#a89e8c", "#a29884", "#ada492", "#9d9480"];
const COPING = "#d6cfbf";
const PAVING = "#c8bfae";
const PAVING_EDGE = "#a9a08f";
const IRON = "#263034";

export interface Placement {
  x: number;
  z: number;
  yaw: number;
  s: number; // scale / variant
}

export interface BankBuild {
  geometry: THREE.BufferGeometry;
  trees: Placement[];
  lamps: Placement[];
  posts: Placement[];
}

/** Point at lateral offset `lat` from the centre (+ = south bank) at sample i. */
function at(i: number, lat: number): [number, number] {
  return [PATH.x[i] - PATH.tz[i] * lat, PATH.z[i] + PATH.tx[i] * lat];
}

export function buildBanks(): BankBuild {
  const B = new GeoBuilder();
  const R = rng(7);
  const ids = bankIndices();
  const trees: Placement[] = [];
  const lamps: Placement[] = [];
  const posts: Placement[] = [];

  for (const side of [-1, 1]) {
    const inner = HALF_W * side;
    const outer = (HALF_W + WALL_T) * side;
    const promOuter = (HALF_W + WALL_T + PROM_W) * side;
    for (let r = 0; r + 1 < ids.length; r++) {
      const i = ids[r];
      const j = ids[r + 1];
      const mx = (PATH.x[i] + PATH.x[j]) / 2;
      if (inBridgeGap(mx)) continue;
      const [ix0, iz0] = at(i, inner);
      const [ix1, iz1] = at(j, inner);
      const [ox0, oz0] = at(i, outer);
      const [ox1, oz1] = at(j, outer);
      const [px0, pz0] = at(i, promOuter);
      const [px1, pz1] = at(j, promOuter);
      const stone = STONE[Math.floor(R() * STONE.length)];
      // Faces are wound so the front faces the viewer: for the north side (-1) the inner face looks +lat.
      const f = side > 0;
      const quad = (a: number[], b: number[], c: number[], d: number[], col: string) =>
        f ? B.quad(a, b, c, d, col) : B.quad(d, c, b, a, col);
      // inner face (towards the water), from below the water line to the top
      quad([ix1, -0.2, iz1], [ix0, -0.2, iz0], [ix0, WALL_H, iz0], [ix1, WALL_H, iz1], stone);
      // coping (top)
      quad([ix1, WALL_H, iz1], [ix0, WALL_H, iz0], [ox0, WALL_H, oz0], [ox1, WALL_H, oz1], COPING);
      // outer face (promenade side)
      quad([ox1, WALL_H, oz1], [ox0, WALL_H, oz0], [ox0, 0, oz0], [ox1, 0, oz1], stone);
      // promenade paving, with a darker kerb band at the back
      const [kx0, kz0] = at(i, (HALF_W + WALL_T + PROM_W - 1.2) * side);
      const [kx1, kz1] = at(j, (HALF_W + WALL_T + PROM_W - 1.2) * side);
      quad([ox1, PAVING_Y, oz1], [ox0, PAVING_Y, oz0], [kx0, PAVING_Y, kz0], [kx1, PAVING_Y, kz1], PAVING);
      quad([kx1, PAVING_Y, kz1], [kx0, PAVING_Y, kz0], [px0, PAVING_Y, pz0], [px1, PAVING_Y, pz1], PAVING_EDGE);
      // railing: two thin iron bars on top of the wall (top rail + mid rail)
      const [rx0, rz0] = at(i, (HALF_W + 0.35) * side);
      const [rx1, rz1] = at(j, (HALF_W + 0.35) * side);
      B.beam(rx0, WALL_H + 1.0, rz0, rx1, WALL_H + 1.0, rz1, 0.09, 0.09, IRON);
      B.beam(rx0, WALL_H + 0.5, rz0, rx1, WALL_H + 0.5, rz1, 0.05, 0.05, IRON);
      posts.push({ x: rx0, z: rz0, yaw: 0, s: 1 });
    }
  }

  // Trees, lamps along both promenades, skipping bridge landings.
  for (const side of [-1, 1]) {
    for (let r = 0; r < ids.length; r += 3) {
      const i = ids[r];
      if (inBridgeGap(PATH.x[i], 8)) continue;
      const yaw = Math.atan2(PATH.tx[i], PATH.tz[i]);
      if (r % 6 === 0) {
        const [x, z] = at(i, (HALF_W + WALL_T + 0.9) * side);
        lamps.push({ x, z, yaw, s: 1 });
      }
      if (R() < 0.85) {
        const lat = (HALF_W + WALL_T + PROM_W - 3.5 + R() * 1.5) * side;
        const [x, z] = at(i, lat);
        trees.push({ x, z, yaw: R() * Math.PI * 2, s: 0.8 + R() * 0.55 });
      }
    }
  }

  // Steps down to the water every ~190 m on alternating banks: a flight along the inner wall face.
  let k = 0;
  for (let r = 20; r < ids.length - 10; r += 47) {
    const i = ids[r];
    if (inBridgeGap(PATH.x[i], 14)) continue;
    const side = k++ % 2 ? 1 : -1;
    const yaw = Math.atan2(PATH.tx[i], PATH.tz[i]); // local +z along the flow
    for (let st = 0; st < 7; st++) {
      const h = WALL_H - (st + 1) * (WALL_H / 7.5);
      const [x, z] = at(i, (HALF_W - 1.1) * side);
      const along = (st - 3) * 0.9;
      B.box(x + PATH.tx[i] * along, h / 2 - 0.1, z + PATH.tz[i] * along, 2.2, h + 0.2, 0.9, st % 2 ? "#9a917e" : "#a59c89", yaw);
    }
  }

  // Pontoon piers (Westminster / Tower / Embankment style): float + gangway + ticket kiosk.
  const pierXs: [number, number][] = [[-380, 1], [-160, -1], [20, 1], [190, -1], [-620, -1]];
  for (const [px, side] of pierXs) {
    let i = 0;
    while (i < PATH.count - 1 && PATH.x[i] < px) i++;
    const yaw = Math.atan2(PATH.tx[i], PATH.tz[i]);
    const [x, z] = at(i, (HALF_W - 5) * side);
    B.box(x, 0.35, z, 5, 0.7, 28, "#e9e5db", yaw);
    B.box(x, 0.72, z, 5.2, 0.06, 28.2, "#2f5d8a", yaw);
    // kiosk
    const [kx, kz] = at(i + 1, (HALF_W - 5) * side);
    B.box(kx, 1.8, kz, 3.2, 2.2, 4, "#1d4f7a", yaw);
    B.box(kx, 3.0, kz, 3.8, 0.25, 4.6, "#e9e5db", yaw);
    // gangway from the wall top down to the float
    const [gx0, gz0] = at(i - 2, (HALF_W + 0.2) * side);
    const [gx1, gz1] = at(i - 1, (HALF_W - 3) * side);
    B.beam(gx0, WALL_H, gz0, gx1, 0.75, gz1, 1.6, 0.15, "#8c949a");
    // mooring piles
    for (const d of [-14, 14]) {
      const [mx, mz] = at(i, (HALF_W - 8.5) * side);
      B.cyl(mx + PATH.tx[i] * d, 1.2, mz + PATH.tz[i] * d, 0.35, 0.35, 3.2, "#3b3f44", 6);
    }
  }

  // Moored barges: black hulls with red gunwales, tarped holds; a couple of houseboats upstream.
  const bargeXs: [number, number, number][] = [[-560, -1, 0], [-520, -1, 1], [-820, 1, 2], [-300, 1, 0], [-990, -1, 3], [-950, -1, 3], [120, 1, 1]];
  for (const [bx, side, kind] of bargeXs) {
    let i = 0;
    while (i < PATH.count - 1 && PATH.x[i] < bx) i++;
    const yaw = Math.atan2(PATH.tx[i], PATH.tz[i]);
    const [x, z] = at(i, (HALF_W - 4.2) * side);
    const m = (lx: number, y: number, lz: number) => {
      const v = new THREE.Vector3(lx, y, lz).applyMatrix4(tf(x, 0, z, yaw));
      return v;
    };
    const L = kind === 3 ? 18 : 30;
    B.box(x, 0.55, z, 5.6, 1.1, L, "#1d1f22", yaw);
    B.box(x, 1.15, z, 5.8, 0.15, L + 0.2, kind === 3 ? "#2e6a4f" : "#9b2a22", yaw);
    if (kind === 3) {
      const c = m(0, 1.9, -1);
      B.box(c.x, c.y, c.z, 4.2, 1.6, 12, R() < 0.5 ? "#e8d9b0" : "#c96a3a", yaw);
      const rf = m(0, 2.8, -1);
      B.box(rf.x, rf.y, rf.z, 4.6, 0.2, 12.6, "#3a3d42", yaw);
    } else {
      for (let h = -1; h <= 1; h++) {
        const c = m(0, 1.6, h * 8.5);
        B.box(c.x, c.y, c.z, 4.6, 0.9 + (kind === 1 ? 0.5 : 0), 7.5, kind === 2 ? "#6b7b3c" : kind === 1 ? "#7a6a52" : "#3d5a6b", yaw);
      }
      const w = m(0, 1.9, L / 2 - 2);
      B.box(w.x, w.y, w.z, 3.2, 1.6, 2.6, "#e3e1da", yaw);
    }
  }

  return { geometry: B.build(), trees, lamps, posts };
}
