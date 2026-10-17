// Train motion: smooth trapezoidal speed profile between stations and an out-and-back shuttle
// schedule that's a pure function of time (no state to drift).

/** Seconds to cover `d` metres from rest to rest with top speed `v` and accel/brake `a`. */
export function legDuration(d: number, v: number, a: number): number {
  if (d <= 0) return 0;
  const dAcc = (v * v) / a; // accelerate + brake distance at full speed
  if (d >= dAcc) return d / v + v / a;
  return 2 * Math.sqrt(d / a);
}

/** Distance travelled `t` seconds into a rest-to-rest leg of `d` metres. */
export function legPosition(d: number, v: number, a: number, t: number): number {
  if (d <= 0 || t <= 0) return 0;
  const T = legDuration(d, v, a);
  if (t >= T) return d;
  const vPeak = Math.min(v, Math.sqrt(a * d));
  const tAcc = vPeak / a;
  if (t < tAcc) return 0.5 * a * t * t;
  const sAcc = 0.5 * a * tAcc * tAcc;
  const tCruiseEnd = T - tAcc;
  if (t < tCruiseEnd) return sAcc + vPeak * (t - tAcc);
  const r = T - t;
  return d - 0.5 * a * r * r;
}

export interface ShuttleParams {
  vmax: number;
  accel: number;
  dwell: number;
}

export interface Phase {
  moving: boolean;
  t0: number;
  dur: number;
  s0: number;
  s1: number;
  station: number; // dwell: station index; move: destination index
}

export interface Shuttle {
  phases: Phase[];
  cycle: number;
  params: ShuttleParams;
}

/** Out along the stations and back again; dwells at every stop (each terminus once per cycle). */
export function buildShuttle(stationS: readonly number[], params: ShuttleParams): Shuttle {
  const n = stationS.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 2; i > 0; i--) order.push(i);
  const phases: Phase[] = [];
  let t = 0;
  for (let k = 0; k < order.length; k++) {
    const a = order[k];
    const b = order[(k + 1) % order.length];
    phases.push({ moving: false, t0: t, dur: params.dwell, s0: stationS[a], s1: stationS[a], station: a });
    t += params.dwell;
    const dur = legDuration(Math.abs(stationS[b] - stationS[a]), params.vmax, params.accel);
    phases.push({ moving: true, t0: t, dur, s0: stationS[a], s1: stationS[b], station: b });
    t += dur;
  }
  return { phases, cycle: t, params };
}

export interface TrainSample {
  s: number;
  station: number; // station index while dwelling, -1 when moving
  dwellT: number; // seconds into the dwell, -1 when moving
  moving: boolean;
}

export function sampleShuttle(sh: Shuttle, time: number, out: TrainSample): TrainSample {
  const t = ((time % sh.cycle) + sh.cycle) % sh.cycle;
  let ph = sh.phases[sh.phases.length - 1];
  for (let i = 0; i < sh.phases.length; i++) {
    const p = sh.phases[i];
    if (t < p.t0 + p.dur) {
      ph = p;
      break;
    }
  }
  const local = t - ph.t0;
  if (!ph.moving) {
    out.s = ph.s0;
    out.station = ph.station;
    out.dwellT = local;
    out.moving = false;
  } else {
    const d = Math.abs(ph.s1 - ph.s0);
    const p = legPosition(d, sh.params.vmax, sh.params.accel, local);
    out.s = ph.s0 + Math.sign(ph.s1 - ph.s0) * p;
    out.station = -1;
    out.dwellT = -1;
    out.moving = true;
  }
  return out;
}

/** 0 = shut, 1 = fully open. Doors slide open after `delay`, close before the dwell ends. */
export function doorOpenAmount(dwellT: number, dwell: number, anim = 0.8, delay = 0.3): number {
  if (dwellT < 0) return 0;
  const opening = (dwellT - delay) / anim;
  const closing = (dwell - delay - dwellT) / anim;
  return Math.max(0, Math.min(1, opening, closing));
}
