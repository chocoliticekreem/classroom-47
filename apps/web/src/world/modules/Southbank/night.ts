// How lit the windows are (0 = day, 1 = full night) for an hour of the day.
export function nightLevel(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 19.25 || h < 5.75) return 1;
  if (h >= 17.75) return (h - 17.75) / 1.5;
  if (h < 7.25) return 1 - (h - 5.75) / 1.5;
  return 0;
}

/** Quantise the hour so materials are only touched when this bucket changes (4 times an hour). */
export function hourBucket(hour: number): number {
  return Math.floor(hour * 4) / 4;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
