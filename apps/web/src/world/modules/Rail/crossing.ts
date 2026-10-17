// Level crossing timing. A crossing is "called" while any train occupies it now or will within the warning
// time. Calling it starts the red lights at once (and closes the road), the barriers come down after a
// short delay; once the train has cleared they rise, and the road reopens when they are fully up.

export const CROSSING = {
  warn: 5, // s of look-ahead: lights start this long before the train reaches the crossing
  margin: 6, // m either side of the road that counts as "on the crossing"
  lowerDelay: 1.5, // s from lights to barriers moving
  lowerTime: 2.5, // s for the barriers to come down
  raiseTime: 2.5, // s for the barriers to go up
  flashHz: 1.4, // alternating red lamps (wig-wag) per second
};

export interface CrossingTimes {
  calledAt: number; // sim time the crossing was last called (-Infinity: never)
  clearedAt: number; // sim time it was last cleared (-Infinity: never; > calledAt when clear)
}

export function newCrossingTimes(): CrossingTimes {
  return { calledAt: -Infinity, clearedAt: -Infinity };
}

/** Feed the occupancy each frame. Returns true when the call state changed. */
export function updateCrossing(c: CrossingTimes, called: boolean, now: number): boolean {
  const isCalled = c.calledAt > c.clearedAt;
  if (called === isCalled) return false;
  if (called) c.calledAt = now;
  else c.clearedAt = now;
  return true;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Barrier position 0 = up, 1 = down. */
export function barrierDown(c: CrossingTimes, now: number): number {
  const lowered = (at: number) => clamp01((at - c.calledAt - CROSSING.lowerDelay) / CROSSING.lowerTime);
  if (c.calledAt > c.clearedAt) return lowered(now);
  if (!Number.isFinite(c.calledAt)) return 0;
  const atClear = lowered(c.clearedAt);
  return atClear * (1 - clamp01((now - c.clearedAt) / CROSSING.raiseTime));
}

/** Red lamps flashing (they stop when the barriers start to rise). */
export function lightsOn(c: CrossingTimes): boolean {
  return c.calledAt > c.clearedAt;
}

/** Which lamp of the pair is lit (0 or 1). */
export function flashPhase(now: number): number {
  return Math.floor(now * CROSSING.flashHz * 2) % 2;
}

/** The road is closed from the call until the barriers are fully up again. */
export function roadClosed(c: CrossingTimes, now: number): boolean {
  if (c.calledAt > c.clearedAt) return true;
  return Number.isFinite(c.clearedAt) && now - c.clearedAt < CROSSING.raiseTime && barrierDown(c, now) > 0;
}

/** True when a train whose body spans [lo, hi] (arc lengths) is on the crossing at s, with the margin. */
export function spanCovers(lo: number, hi: number, s: number, margin = CROSSING.margin): boolean {
  return hi >= s - margin && lo <= s + margin;
}
