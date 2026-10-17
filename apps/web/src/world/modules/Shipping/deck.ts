// Shipping: seeded deck cargo. Stacks are physical (no floating boxes): each (bay,row) gets a stack height and
// every tier below it is filled. Colours come in brand clusters, like a real stowage plan.
import type { DeckSlot } from "../../berths";
import { BRANDS, PLAIN_COLORS } from "./fleet";

export function rng(seed: number) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FillOptions {
  rows: number;
  bays: number;
  tiers: number;
  /** Highest tier used (<= tiers). */
  maxTier?: number;
  /** Fill ratio range (of rows*bays*maxTier). */
  min?: number;
  max?: number;
  /** Brand that dominates the stow (the ship's own line). */
  homeBrand?: string;
}

const idx = (o: { rows: number; tiers: number }, bay: number, row: number, tier: number) => (bay * o.rows + row) * o.tiers + tier;

/** Pick a box for a cluster: brand boxes use the brand colour, plain boxes a leasing colour. */
function pickBox(r: () => number, home: string | undefined): DeckSlot {
  const p = r();
  if (home && p < 0.38) {
    const b = BRANDS.find((x) => x.name === home);
    if (b) return { color: b.color, brand: b.name };
  }
  if (p < 0.78) {
    const b = BRANDS[1 + Math.floor(r() * (BRANDS.length - 1))];
    return { color: b.color, brand: b.name };
  }
  return { color: PLAIN_COLORS[Math.floor(r() * PLAIN_COLORS.length)] };
}

/** A seeded, 70-90% full, physically stacked deck. Returns a fresh array (index = (bay*rows+row)*tiers+tier). */
export function fillDeck(seed: number, o: FillOptions): DeckSlot[] {
  const r = rng(seed);
  const maxTier = Math.max(1, Math.min(o.tiers, o.maxTier ?? o.tiers));
  const lo = o.min ?? 0.7;
  const hi = o.max ?? 0.9;
  const target = lo + r() * (hi - lo);
  const cap = o.rows * o.bays * maxTier;
  const want = Math.round(target * cap);
  const deck: DeckSlot[] = Array.from({ length: o.rows * o.bays * o.tiers }, () => ({ color: null }));
  // stack heights: start full, then knock tiers off (outer rows and the ends first) until we hit the target
  const h: number[] = new Array(o.rows * o.bays).fill(maxTier);
  let count = cap;
  let guard = 0;
  while (count > want && guard++ < 10000) {
    const bay = Math.floor(r() * o.bays);
    // bias towards outer rows: square of a uniform number, mirrored
    const u = r();
    const side = r() < 0.5 ? -1 : 1;
    const mid = (o.rows - 1) / 2;
    const row = Math.round(mid + side * (1 - u * u) * mid);
    const k = bay * o.rows + row;
    if (h[k] > 0) {
      h[k]--;
      count--;
    }
  }
  // brand clusters: each bay is split into 1-3 runs of rows, each run one box "type" with a little noise
  for (let bay = 0; bay < o.bays; bay++) {
    let row = 0;
    while (row < o.rows) {
      const run = 2 + Math.floor(r() * 4);
      const box = pickBox(r, o.homeBrand);
      for (let i = 0; i < run && row < o.rows; i++, row++) {
        for (let t = 0; t < h[bay * o.rows + row]; t++) {
          deck[idx(o, bay, row, t)] = r() < 0.15 ? pickBox(r, o.homeBrand) : { ...box };
        }
      }
    }
  }
  return deck;
}

export function countBoxes(deck: DeckSlot[]) {
  let n = 0;
  for (const s of deck) if (s.color) n++;
  return n;
}

/** True when no box floats over an empty slot. */
export function isStacked(deck: DeckSlot[], rows: number, bays: number, tiers: number) {
  for (let bay = 0; bay < bays; bay++)
    for (let row = 0; row < rows; row++) {
      let gap = false;
      for (let t = 0; t < tiers; t++) {
        const has = !!deck[(bay * rows + row) * tiers + t].color;
        if (has && gap) return false;
        if (!has) gap = true;
      }
    }
  return true;
}

/** Copy slot values into dst (fresh slot objects, so no slot is ever shared between two grids). */
export function copyDeck(src: DeckSlot[], dst: DeckSlot[]) {
  for (let i = 0; i < src.length && i < dst.length; i++) {
    dst[i] = src[i].brand ? { color: src[i].color, brand: src[i].brand } : { color: src[i].color };
  }
}
