// Container yard allocation: stacks of boxes in blocks, 1..MAX_TIER high. Pure (no three.js): the RMG
// cranes pick from and place into it, the renderer mirrors it into one InstancedMesh (one instance slot
// per stack tier, so index = stack.id * MAX_TIER + tier).

export const MAX_TIER = 5;

export interface Box {
  brand: number; // atlas row (0 = plain, tinted per instance)
  tint: number; // index into the tint palette (used when brand = 0)
  short?: boolean; // 20 ft box
  color?: string; // explicit CSS colour (boxes that came off a ship), overrides the tint
}

export interface StackSpec {
  block: number;
  bay: number; // along the block's long axis (x)
  row: number; // across the block (z)
  x: number;
  z: number;
  short?: boolean;
  reefer?: boolean;
  initial: number; // starting height
}

export interface Stack extends StackSpec {
  id: number;
  tiers: Box[];
}

export class Yard {
  readonly stacks: Stack[];
  /** Stack ids whose contents changed since the renderer last looked. */
  readonly dirty = new Set<number>();
  /** Stacks the generic pick/place/housekeeping helpers leave alone (quay transfer points). */
  readonly reserved = new Set<number>();
  private readonly byBlock = new Map<number, Stack[]>();

  constructor(specs: StackSpec[], makeBox: (s: StackSpec, tier: number) => Box) {
    this.stacks = specs.map((s, id) => {
      const tiers: Box[] = [];
      for (let t = 0; t < Math.min(MAX_TIER, s.initial); t++) tiers.push(makeBox(s, t));
      return { ...s, id, tiers };
    });
    for (const s of this.stacks) {
      const list = this.byBlock.get(s.block) ?? [];
      list.push(s);
      this.byBlock.set(s.block, list);
    }
  }

  block(b: number): readonly Stack[] {
    return this.byBlock.get(b) ?? [];
  }

  height(id: number) {
    return this.stacks[id].tiers.length;
  }

  /** Fill ratio of a block, 0..1. */
  fill(b: number) {
    const list = this.block(b);
    if (!list.length) return 0;
    let n = 0;
    for (const s of list) n += s.tiers.length;
    return n / (list.length * MAX_TIER);
  }

  count() {
    let n = 0;
    for (const s of this.stacks) n += s.tiers.length;
    return n;
  }

  /** Remove and return the top box of a stack (null if empty). */
  pick(id: number): Box | null {
    const s = this.stacks[id];
    const b = s.tiers.pop() ?? null;
    if (b) this.dirty.add(id);
    return b;
  }

  /** Put a box on top of a stack. False if the stack is full. */
  place(id: number, box: Box): boolean {
    const s = this.stacks[id];
    if (s.tiers.length >= MAX_TIER) return false;
    s.tiers.push(box);
    this.dirty.add(id);
    return true;
  }

  /** Non-empty stack in block nearest to x (ties: taller first). */
  pickNear(b: number, x: number, exclude = -1): number | null {
    let best: Stack | null = null;
    let bestScore = Infinity;
    for (const s of this.block(b)) {
      if (!s.tiers.length || s.id === exclude || this.reserved.has(s.id)) continue;
      const score = Math.abs(s.x - x) + s.row * 0.4 - s.tiers.length * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best ? best.id : null;
  }

  /** Stack with room in block nearest to x (ties: lower first). */
  placeNear(b: number, x: number, exclude = -1): number | null {
    let best: Stack | null = null;
    let bestScore = Infinity;
    for (const s of this.block(b)) {
      if (s.tiers.length >= MAX_TIER || s.id === exclude || this.reserved.has(s.id)) continue;
      const score = Math.abs(s.x - x) + s.row * 0.4 + s.tiers.length * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best ? best.id : null;
  }

  /** A housekeeping move inside a block: from a tall stack to a low one. Null if the block is level. */
  housekeep(b: number, rand: () => number): { from: number; to: number } | null {
    const list = this.block(b).filter((s) => !this.reserved.has(s.id));
    if (list.length < 2) return null;
    // Sample a few random candidates so cranes wander around the block instead of repeating one move.
    let from: Stack | null = null;
    let to: Stack | null = null;
    for (let k = 0; k < 8; k++) {
      const s = list[Math.floor(rand() * list.length)];
      if (s.tiers.length >= 2 && (!from || s.tiers.length > from.tiers.length)) from = s;
      const d = list[Math.floor(rand() * list.length)];
      if (d.tiers.length < MAX_TIER - 1 && (!to || d.tiers.length < to.tiers.length)) to = d;
    }
    if (!from || !to || from.id === to.id || from.tiers.length - to.tiers.length < 1) return null;
    return { from: from.id, to: to.id };
  }
}

/** Instance slot of a stack tier in the yard InstancedMesh. */
export function instanceIndex(stackId: number, tier: number) {
  return stackId * MAX_TIER + tier;
}

/** Deterministic PRNG (mulberry32). */
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
