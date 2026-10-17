// Runway lock: at most one plane on the runway at a time (landing roll or line-up/take-off roll).
// Arrivals grab it at their decision point or go around; departures wait at the holding point.

/** Departures need this many seconds of gap before the next arrival reaches its decision point. */
export const DEPARTURE_GAP_S = 24;

export class RunwayLock {
  holder: number | null = null;
  /** Closed for an emergency: nobody but a forced holder may use it. */
  closed = false;

  tryArrival(id: number): boolean {
    if (this.holder === id) return true;
    if (this.closed || this.holder !== null) return false;
    this.holder = id;
    return true;
  }

  /** `inboundS`: seconds until the nearest arrival needs the runway (Infinity if none). */
  tryDeparture(id: number, inboundS: number): boolean {
    if (this.holder === id) return true;
    if (this.closed || this.holder !== null || inboundS < DEPARTURE_GAP_S) return false;
    this.holder = id;
    return true;
  }

  /** Emergency traffic takes the runway regardless. */
  force(id: number) {
    this.holder = id;
  }

  release(id: number) {
    if (this.holder === id) this.holder = null;
  }
}
