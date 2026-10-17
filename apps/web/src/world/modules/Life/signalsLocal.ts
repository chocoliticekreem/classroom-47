// Signal + road lookups by grid index, without building strings every frame.
import { GRID_HALF } from "../../config";
import { edgeKey } from "../../roads";
import { signalFor } from "../../signals";
import { useWorld } from "../../store";

const SIZE = GRID_HALF * 2 + 1;
const IDS: string[] = [];
for (let i = -GRID_HALF; i <= GRID_HALF; i++) for (let j = -GRID_HALF; j <= GRID_HALF; j++) IDS.push(`g_${i}_${j}`);

export function gridId(i: number, j: number) {
  return IDS[(i + GRID_HALF) * SIZE + (j + GRID_HALF)];
}

/** Is it green for traffic approaching (ti,tj) from (fi,fj)? */
export function isGreen(ti: number, tj: number, fi: number, fj: number) {
  return signalFor(gridId(ti, tj), gridId(fi, fj), performance.now()) === "green";
}

/**
 * Safe for a pedestrian to cross next to junction (jx,jz) along `axis`?
 * Crossing along x means crossing the north-south road, so its (z-axis) traffic must be on red.
 */
export function pedCanCross(jx: number, jz: number, axis: 0 | 1) {
  const now = performance.now();
  if (axis === 0) {
    const fj = jz > -GRID_HALF ? jz - 1 : jz + 1;
    return signalFor(gridId(jx, jz), gridId(jx, fj), now) === "red";
  }
  const fi = jx > -GRID_HALF ? jx - 1 : jx + 1;
  return signalFor(gridId(jx, jz), gridId(fi, jz), now) === "red";
}

export function isBlocked(ai: number, aj: number, bi: number, bj: number) {
  return edgeKey(gridId(ai, aj), gridId(bi, bj)) in useWorld.getState().blocked;
}
