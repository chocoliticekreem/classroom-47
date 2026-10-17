// Pure time helpers for the landmarks (clock hands, night lighting).
const TAU = Math.PI * 2;

const wrap = (v: number, m: number) => ((v % m) + m) % m;

/** Clockwise angles (radians from 12 o'clock) for the hour and minute hands. */
export function clockHandAngles(hours: number): { hour: number; minute: number } {
  const h = wrap(hours, 24);
  return { hour: (wrap(h, 12) / 12) * TAU, minute: wrap(h, 1) * TAU };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 in daylight, 1 at night; eases in 18:00-20:00 and out 05:00-07:00. */
export function nightFactor(hours: number): number {
  const h = wrap(hours, 24);
  return h >= 12 ? smooth(18, 20, h) : 1 - smooth(5, 7, h);
}
