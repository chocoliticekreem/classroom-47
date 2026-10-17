// Railway simulation state that isn't three.js: which train is where, level crossing calls, signal aspects.
// Every train is a pure function of sim time (its line's schedule shifted by its phase).
import { spanCovers, CROSSING } from "./crossing";
import { newTrainState, sampleSchedule, type TrainState } from "./motion";
import { LINES, consistLength, type CarSpec, type LevelCrossing, type Line, type SignalSite } from "./network";

export interface Train {
  id: string;
  line: Line;
  index: number;
  consist: CarSpec[];
  len: number;
  phase: number;
  st: TrainState;
}

export function createTrains(): Train[] {
  const out: Train[] = [];
  for (const line of LINES)
    line.consists.forEach((consist, i) =>
      out.push({ id: `${line.id}-${i + 1}`, line, index: i, consist, len: consistLength(consist), phase: line.phase[i], st: newTrainState() }),
    );
  return out;
}

export function sampleTrain(tr: Train, time: number, out: TrainState = tr.st): TrainState {
  return sampleSchedule(tr.line.schedule, time + tr.phase, out);
}

const _look = newTrainState();

/** A crossing is called if any train on its line is on it now or will be within the warning time. */
export function crossingCalled(lc: LevelCrossing, trains: readonly Train[], time: number): boolean {
  for (const tr of trains) {
    if (tr.line.id !== lc.line) continue;
    for (let k = 0; k <= CROSSING.warn; k += 0.5) {
      sampleTrain(tr, time + k, _look);
      if (spanCovers(_look.s - tr.len / 2, _look.s + tr.len / 2, lc.s)) return true;
    }
  }
  return false;
}

export const ASPECT = { red: 0, yellow: 1, green: 2 } as const;

/**
 * Signal aspect from the trains currently in its block (red), in the next block (yellow), else green.
 * A train belongs to the track of the way it's facing.
 */
export function signalAspect(site: SignalSite, next: SignalSite | undefined, trains: readonly Train[]): number {
  const lo = Math.min(site.s, site.blockEnd);
  const hi = Math.max(site.s, site.blockEnd);
  let aspect: number = ASPECT.green;
  for (const tr of trains) {
    if (tr.line.id !== site.line || tr.st.dir !== site.dir) continue;
    const a = tr.st.s - tr.len / 2;
    const b = tr.st.s + tr.len / 2;
    if (b >= lo && a <= hi) return ASPECT.red;
    if (next) {
      const nlo = Math.min(next.s, next.blockEnd);
      const nhi = Math.max(next.s, next.blockEnd);
      if (b >= nlo && a <= nhi) aspect = ASPECT.yellow;
    }
  }
  return aspect;
}
