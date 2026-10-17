// 0 by day, 1 at night, smooth ramps at dawn (5-7h) and dusk (17.5-20h).
export function nightness(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (h < 12) return 1 - ramp(5, 7, h);
  return ramp(17.5, 20, h);
}
