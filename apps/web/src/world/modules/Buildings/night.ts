// How lit the windows are (0 = day, 1 = full night) for an hour of the day.
// Lights fade on from ~17:45 to ~19:15 and off from ~05:45 to ~07:15.
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
