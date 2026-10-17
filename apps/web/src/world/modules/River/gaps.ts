// Where roads cross the river: our bridges plus anything else drawn over the water (the motorway's own
// west viaduct at x ~ -880). Embankment walls, trees and lamps leave gaps there and boats hide "under" them.
import { BRIDGES } from "../../districts/bridges";
import { motorway } from "../../districts/motorway";
import { HALF_W, centreZ } from "./path";

/** [x0, x1] ranges of x where something crosses the river. */
function computeGaps(): [number, number][] {
  const out: [number, number][] = BRIDGES.map((b) => [b.x - b.halfWidth, b.x + b.halfWidth]);
  const pos = new Map(motorway.nodes.map((n) => [n.id, n] as const));
  for (const e of motorway.edges) {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= Math.ceil(L / 2); k++) {
      const t = Math.min(1, (k * 2) / L);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (Math.abs(z - centreZ(x)) < HALF_W + 18) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    // skip our own bridges' links (they're br_*), and edges that merely run along a bank far from the water
    if (lo <= hi && !e.a.startsWith("br_") && !e.b.startsWith("br_")) out.push([lo - 8, hi + 8]);
  }
  // merge overlapping ranges
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const g of out) {
    const last = merged[merged.length - 1];
    if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
    else merged.push([g[0], g[1]]);
  }
  return merged;
}

export const GAPS: readonly [number, number][] = computeGaps();

export function inGap(x: number, pad = 1.5) {
  for (const [a, b] of GAPS) if (x > a - pad && x < b + pad) return true;
  return false;
}
