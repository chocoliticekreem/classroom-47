// Excavator dig cycle and dump-truck shuttle (pure, unit-tested). Headings follow the vehicle
// convention: rotation.y = h, forward = (sin h, cos h).
import { wrapPi } from "./geom2d";

const smooth = (u: number) => u * u * (3 - 2 * u);

// --- Excavator --------------------------------------------------------------------------------

export interface ExcavatorPose {
  yaw: number; // upper body heading
  boom: number; // boom elevation above horizontal (rad)
  stick: number; // stick bend down from the boom (rad)
  bucket: number; // bucket curl (rad, bigger = closed)
}

/** [time s, swing 0 = facing the pit, 1 = facing the truck, boom, stick, bucket] */
const EXC_KEYS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, -0.1, 1.9, 0.2],
  [1.6, 0, -0.55, 1.2, 1.9], // dig: boom down, stick in, bucket curls
  [2.8, 0, 0.35, 1.1, 1.9], // lift
  [4.6, 1, 0.35, 1.3, 1.9], // swing to the truck
  [5.6, 1, 0.3, 1.5, -0.5], // dump
  [7.4, 0, -0.1, 1.9, 0.2], // swing back, reach out
];
export const EXCAVATOR_CYCLE = EXC_KEYS[EXC_KEYS.length - 1][0];

export function excavatorAt(digYaw: number, dumpYaw: number, t: number, out: ExcavatorPose): ExcavatorPose {
  const u = ((t % EXCAVATOR_CYCLE) + EXCAVATOR_CYCLE) % EXCAVATOR_CYCLE;
  let i = 0;
  while (i < EXC_KEYS.length - 2 && u >= EXC_KEYS[i + 1][0]) i++;
  const a = EXC_KEYS[i];
  const b = EXC_KEYS[i + 1];
  const e = smooth(Math.min(1, (u - a[0]) / (b[0] - a[0])));
  const swing = a[1] + (b[1] - a[1]) * e;
  out.yaw = digYaw + wrapPi(dumpYaw - digYaw) * swing;
  out.boom = a[2] + (b[2] - a[2]) * e;
  out.stick = a[3] + (b[3] - a[3]) * e;
  out.bucket = a[4] + (b[4] - a[4]) * e;
  return out;
}

// --- Dump truck shuttle -------------------------------------------------------------------------

export interface DumpRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface DumpPose {
  x: number;
  z: number;
  h: number;
  tip: number; // bed tilt, 0..1
  moving: boolean;
}

export const DUMP = { loadS: 8, tipS: 5, speed: 3 } as const;

export function dumpCycle(r: DumpRun) {
  const travel = Math.max(1.5, Math.hypot(r.bx - r.ax, r.bz - r.az) / DUMP.speed);
  return { travel, cycle: DUMP.loadS + travel + DUMP.tipS + travel * 1.3 };
}

/** Load at A, drive forward to B, tip, reverse back to A. */
export function dumpAt(r: DumpRun, t: number, out: DumpPose): DumpPose {
  const { travel, cycle } = dumpCycle(r);
  let u = ((t % cycle) + cycle) % cycle;
  out.h = Math.atan2(r.bx - r.ax, r.bz - r.az);
  out.tip = 0;
  out.moving = false;
  let k = 0; // 0 at A, 1 at B
  if (u < DUMP.loadS) k = 0;
  else if ((u -= DUMP.loadS) < travel) {
    k = smooth(u / travel);
    out.moving = true;
  } else if ((u -= travel) < DUMP.tipS) {
    k = 1;
    out.tip = Math.sin((u / DUMP.tipS) * Math.PI);
  } else {
    u -= DUMP.tipS;
    k = 1 - smooth(Math.min(1, u / (travel * 1.3)));
    out.moving = true;
  }
  out.x = r.ax + (r.bx - r.ax) * k;
  out.z = r.az + (r.bz - r.az) * k;
  return out;
}

// --- Construction hoist (the lift on the side of the tower) ---------------------------------------

/** Cage height: rides up and down the mast with pauses at the bottom and top. */
export function hoistY(top: number, t: number, period = 30) {
  const u = ((t % period) + period) % period / period; // 0..1
  if (u < 0.2) return 0;
  if (u < 0.5) return top * smooth((u - 0.2) / 0.3);
  if (u < 0.7) return top;
  return top * (1 - smooth((u - 0.7) / 0.3));
}
