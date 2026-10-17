// An overturned container lorry: the rig rolls onto its side and skids to a stop, the box flies off the
// trailer, lands, bursts open and sheds its cargo across the road. Pure, deterministic given `rand`.
import { CONTAINER } from "./layout";

export const CARGO_PER_WRECK = 30;
const G = 9.8;

export interface CargoBox {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  wx: number;
  wy: number;
  s: number; // edge size
  color: number; // palette index
  rest: boolean;
}

export interface WreckState {
  t: number;
  side: 1 | -1; // +1 rolls over to the right
  // rig
  x: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  roll: number; // about the forward axis, + = toward the right
  // the box
  attached: boolean;
  bx: number;
  by: number; // centre height
  bz: number;
  bh: number;
  broll: number;
  bvx: number;
  bvy: number;
  bvz: number;
  bwr: number; // roll rate
  bwh: number; // yaw rate
  burst: boolean;
  cargo: CargoBox[];
  settled: boolean;
}

/** Right-hand unit vector for heading h (three.js: facing +z at h = 0, right is -x). */
function right(h: number): [number, number] {
  return [-Math.cos(h), Math.sin(h)];
}

export function startWreck(
  x: number, z: number, h: number, speed: number, side: 1 | -1, trailer: { x: number; z: number; h: number }, bedY: number,
): WreckState {
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const [rx, rz] = right(h);
  const v = Math.max(6, speed);
  return {
    t: 0,
    side,
    x,
    z,
    h,
    vx: fx * v * 0.85 + rx * side * v * 0.18,
    vz: fz * v * 0.85 + rz * side * v * 0.18,
    roll: 0,
    attached: true,
    bx: trailer.x,
    by: bedY + CONTAINER.h / 2,
    bz: trailer.z,
    bh: trailer.h,
    broll: 0,
    bvx: 0,
    bvy: 0,
    bvz: 0,
    bwr: 0,
    bwh: 0,
    burst: false,
    cargo: [],
    settled: false,
  };
}

/** Centre height of a box of width w / height hgt resting on the ground at roll angle r. */
function restHeight(r: number, w: number, hgt: number) {
  return (Math.abs(Math.cos(r)) * hgt + Math.abs(Math.sin(r)) * w) / 2;
}

export const ROLL_OVER = 1.48;
const DETACH_T = 0.32;

export function stepWreck(w: WreckState, dt: number, rand: () => number) {
  w.t += dt;
  // ---- rig: skid with heavy friction, roll onto its side with a little bounce
  const sp = Math.hypot(w.vx, w.vz);
  if (sp > 0.01) {
    const k = Math.max(0, sp - 7.5 * dt) / sp;
    w.vx *= k;
    w.vz *= k;
    w.x += w.vx * dt;
    w.z += w.vz * dt;
    w.h += w.side * 0.35 * dt * Math.min(1, sp / 8); // the skid slews the rig a bit
  }
  const u = Math.min(1, w.t / 0.95);
  const ease = u * u * (3 - 2 * u);
  const bounce = u >= 1 ? Math.exp(-(w.t - 0.95) * 6) * Math.sin((w.t - 0.95) * 18) * 0.06 : 0;
  w.roll = w.side * (ROLL_OVER * ease - bounce);

  // ---- the box
  if (w.attached && w.t >= DETACH_T) {
    w.attached = false;
    const [rx, rz] = right(w.h);
    w.bvx = w.vx * 1.05 + rx * w.side * 4.8;
    w.bvz = w.vz * 1.05 + rz * w.side * 4.8;
    w.bvy = 2.2;
    w.bwr = w.side * (2.6 + rand() * 1.4);
    w.bwh = (rand() - 0.5) * 1.6;
  }
  if (w.attached) {
    // rides along on the tilting trailer
    w.bx += w.vx * dt;
    w.bz += w.vz * dt;
    w.broll = w.roll * 0.9;
  } else {
    w.bvy -= G * dt;
    w.bx += w.bvx * dt;
    w.by += w.bvy * dt;
    w.bz += w.bvz * dt;
    w.broll += w.bwr * dt;
    w.bh += w.bwh * dt;
    const rest = restHeight(w.broll, CONTAINER.w, CONTAINER.h);
    if (w.by <= rest) {
      w.by = rest;
      if (!w.burst) burst(w, rand);
      if (w.bvy < 0) w.bvy = -w.bvy * 0.18;
      const bs = Math.hypot(w.bvx, w.bvz);
      if (bs > 0.01) {
        const k = Math.max(0, bs - 6.5 * dt) / bs;
        w.bvx *= k;
        w.bvz *= k;
      }
      w.bwh *= Math.exp(-dt * 3);
      // settle on its side (nearest quarter turn)
      const target = Math.round(w.broll / (Math.PI / 2)) * (Math.PI / 2);
      w.bwr = (target - w.broll) * 5;
    }
  }

  // ---- cargo
  let moving = !w.burst || Math.hypot(w.bvx, w.bvz) > 0.05;
  for (const c of w.cargo) {
    if (c.rest) continue;
    moving = true;
    c.vy -= G * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.rx += c.wx * dt;
    c.ry += c.wy * dt;
    const floor = c.s / 2;
    if (c.y <= floor) {
      c.y = floor;
      c.vy = Math.abs(c.vy) > 1.2 ? -c.vy * 0.28 : 0;
      c.vx *= 0.72;
      c.vz *= 0.72;
      c.wx *= 0.6;
      c.wy *= 0.6;
      if (Math.hypot(c.vx, c.vz) < 0.15 && c.vy === 0) {
        c.rest = true;
        // lie flat-ish
        c.rx = Math.round(c.rx / (Math.PI / 2)) * (Math.PI / 2);
      }
    }
  }
  if (w.t > 1.5 && !moving && Math.hypot(w.vx, w.vz) < 0.05) w.settled = true;
}

function burst(w: WreckState, rand: () => number) {
  w.burst = true;
  // doors at the box's rear end (-forward along its own heading)
  const fx = Math.sin(w.bh);
  const fz = Math.cos(w.bh);
  const ex = w.bx - fx * (CONTAINER.l / 2 - 0.4);
  const ez = w.bz - fz * (CONTAINER.l / 2 - 0.4);
  for (let i = 0; i < CARGO_PER_WRECK; i++) {
    const out = 1.5 + rand() * 5.5;
    const lat = (rand() - 0.5) * 4.5;
    const along = rand() < 0.3 ? rand() * CONTAINER.l * 0.8 : 0; // some burst out of the torn side
    const [rx, rz] = right(w.bh);
    w.cargo.push({
      x: ex + fx * along + rx * lat * 0.2,
      y: w.by + (rand() - 0.5) * 1.2,
      z: ez + fz * along + rz * lat * 0.2,
      vx: -fx * out + rx * lat + w.bvx * 0.6,
      vy: 1 + rand() * 3.5,
      vz: -fz * out + rz * lat + w.bvz * 0.6,
      rx: rand() * 3,
      ry: rand() * 3,
      wx: (rand() - 0.5) * 9,
      wy: (rand() - 0.5) * 9,
      s: 0.45 + rand() * 0.7,
      color: Math.floor(rand() * 6),
      rest: false,
    });
  }
}

/**
 * Local offset (x, y) of the rig origin when it rolls by `roll` about its forward axis, pivoting on the
 * lower edge of the side it falls toward (half width `hw`). Right is local -x.
 */
export function rollPivotOffset(roll: number, hw: number): [number, number] {
  if (roll === 0) return [0, 0];
  const px = roll > 0 ? -hw : hw; // pivot on the side it falls toward
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  // rotation about +z (forward) by roll: (x, y) -> (x c - y s, x s + y c); offset = P - R P
  return [px - px * c, -px * s];
}
