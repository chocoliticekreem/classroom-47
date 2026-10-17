// Crowd counts at bus stops and platforms: people trickle in, vehicles drain them.

/** One step of arrivals: with probability rate*dt one more person turns up (capped). */
export function growWaiting(waiting: number, dt: number, ratePerSec: number, cap: number, rand: () => number): number {
  if (waiting >= cap) return cap;
  return rand() < ratePerSec * dt ? waiting + 1 : waiting;
}

export interface Visit {
  alight: number;
  board: number;
}

/** Who gets off and on when a vehicle stops: 1..maxAlight off (if anyone is aboard), then everyone who fits gets on. */
export function planVisit(waiting: number, onboard: number, capacity: number, rand: () => number, maxAlight = 4): Visit {
  const alight = onboard > 0 ? Math.min(onboard, 1 + Math.floor(rand() * maxAlight)) : 0;
  const room = Math.max(0, capacity - (onboard - alight));
  return { alight, board: Math.min(waiting, room) };
}
