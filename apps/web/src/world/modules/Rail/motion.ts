// Train motion: a jerk-limited (S-curve) speed profile between stops and an out-and-back schedule that
// is a pure function of time, so trains never drift and several trains on one line can share the
// schedule shifted in time (they then never meet on the same track).

/**
 * Rest-to-rest leg of `d` metres, top speed `v`, average acceleration `a`. Speed ramps with a smoothstep
 * (peak acceleration 1.5 a, no jerk spikes), cruises, then brakes symmetrically.
 */
export function legDuration(d: number, v: number, a: number): number {
  if (d <= 0) return 0;
  const vp = Math.min(v, Math.sqrt(a * d));
  const ta = vp / a;
  return 2 * ta + (d - vp * ta) / vp;
}

function rampDist(vp: number, ta: number, t: number) {
  // integral of vp * smoothstep(t / ta)
  const u = t / ta;
  return vp * ta * (u * u * u - 0.5 * u * u * u * u);
}

/** Distance covered `t` seconds into the leg. */
export function legPosition(d: number, v: number, a: number, t: number): number {
  if (d <= 0 || t <= 0) return 0;
  const vp = Math.min(v, Math.sqrt(a * d));
  const ta = vp / a;
  const T = 2 * ta + (d - vp * ta) / vp;
  if (t >= T) return d;
  if (t < ta) return rampDist(vp, ta, t);
  if (t < T - ta) return 0.5 * vp * ta + vp * (t - ta);
  return d - rampDist(vp, ta, T - t);
}

/** Speed `t` seconds into the leg. */
export function legSpeed(d: number, v: number, a: number, t: number): number {
  if (d <= 0 || t <= 0) return 0;
  const vp = Math.min(v, Math.sqrt(a * d));
  const ta = vp / a;
  const T = 2 * ta + (d - vp * ta) / vp;
  if (t >= T) return 0;
  const sm = (u: number) => u * u * (3 - 2 * u);
  if (t < ta) return vp * sm(t / ta);
  if (t < T - ta) return vp;
  return vp * sm((T - t) / ta);
}

export interface Stop {
  s: number; // where the train's CENTRE stands
  dwell: number; // seconds
}

export interface Phase {
  moving: boolean;
  t0: number;
  dur: number;
  s0: number;
  s1: number;
  stop: number; // dwelling: this stop; moving: destination stop
  dirIn: number; // direction of travel arriving here (dwell) / of this leg (move)
  dirOut: number; // direction of the next leg (dwell) / of this leg (move)
}

export interface Schedule {
  phases: Phase[];
  cycle: number;
  vmax: number;
  accel: number;
}

/** Out along the stops and back again; every stop is served in both directions, each end once. */
export function buildSchedule(stops: readonly Stop[], vmax: number, accel: number): Schedule {
  const n = stops.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 2; i > 0; i--) order.push(i);
  const phases: Phase[] = [];
  let t = 0;
  for (let k = 0; k < order.length; k++) {
    const a = order[k];
    const b = order[(k + 1) % order.length];
    const prev = order[(k - 1 + order.length) % order.length];
    const dirIn = Math.sign(stops[a].s - stops[prev].s) || 1;
    const dirOut = Math.sign(stops[b].s - stops[a].s) || 1;
    phases.push({ moving: false, t0: t, dur: stops[a].dwell, s0: stops[a].s, s1: stops[a].s, stop: a, dirIn, dirOut });
    t += stops[a].dwell;
    const dur = legDuration(Math.abs(stops[b].s - stops[a].s), vmax, accel);
    phases.push({ moving: true, t0: t, dur, s0: stops[a].s, s1: stops[b].s, stop: b, dirIn: dirOut, dirOut });
    t += dur;
  }
  return { phases, cycle: t, vmax, accel };
}

export interface TrainState {
  s: number; // centre
  v: number; // speed, m/s (always >= 0)
  dir: number; // +1 toward increasing s, -1 back (the cab in use; flips halfway through a reversal dwell)
  moving: boolean;
  stop: number; // stop index while dwelling, -1 moving
  dwellT: number; // seconds into the dwell, -1 moving
}

export function newTrainState(): TrainState {
  return { s: 0, v: 0, dir: 1, moving: false, stop: -1, dwellT: -1 };
}

export function sampleSchedule(sc: Schedule, time: number, out: TrainState): TrainState {
  const t = ((time % sc.cycle) + sc.cycle) % sc.cycle;
  let ph = sc.phases[sc.phases.length - 1];
  for (let i = 0; i < sc.phases.length; i++) {
    const p = sc.phases[i];
    if (t < p.t0 + p.dur) {
      ph = p;
      break;
    }
  }
  const local = t - ph.t0;
  if (!ph.moving) {
    out.s = ph.s0;
    out.v = 0;
    out.dir = local < ph.dur / 2 ? ph.dirIn : ph.dirOut;
    out.moving = false;
    out.stop = ph.stop;
    out.dwellT = local;
  } else {
    const d = Math.abs(ph.s1 - ph.s0);
    out.s = ph.s0 + ph.dirOut * legPosition(d, sc.vmax, sc.accel, local);
    out.v = legSpeed(d, sc.vmax, sc.accel, local);
    out.dir = ph.dirOut;
    out.moving = true;
    out.stop = -1;
    out.dwellT = -1;
  }
  return out;
}
