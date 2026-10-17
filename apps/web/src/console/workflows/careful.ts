// "How careful?" for a safety check: one 0..1 dial (Relaxed -> Strict) mapped onto the two risk
// thresholds the runtime reads from config. Strict = fewer things go out without a person.
//   careful 0 (relaxed): send below 0.50, stop at 0.95
//   careful 1 (strict):  send below 0.15, stop at 0.65
// The default 0.30 / 0.80 sits near the middle.
const ALLOW = { relaxed: 0.5, strict: 0.15 };
const BLOCK = { relaxed: 0.95, strict: 0.65 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function carefulToThresholds(careful: number): { allow_below: number; block_above: number } {
  const c = clamp01(careful);
  return {
    allow_below: round2(ALLOW.relaxed + (ALLOW.strict - ALLOW.relaxed) * c),
    block_above: round2(BLOCK.relaxed + (BLOCK.strict - BLOCK.relaxed) * c),
  };
}

/** Where a config sits on the dial (mean of both thresholds' positions). */
export function thresholdsToCareful(config: Record<string, unknown> | undefined): number {
  const a = typeof config?.allow_below === "number" ? config.allow_below : 0.3;
  const b = typeof config?.block_above === "number" ? config.block_above : 0.8;
  const ca = (a - ALLOW.relaxed) / (ALLOW.strict - ALLOW.relaxed);
  const cb = (b - BLOCK.relaxed) / (BLOCK.strict - BLOCK.relaxed);
  return round2(clamp01((ca + cb) / 2));
}

export function carefulWord(careful: number): string {
  return careful < 0.34 ? "Relaxed" : careful < 0.67 ? "Balanced" : "Strict";
}
