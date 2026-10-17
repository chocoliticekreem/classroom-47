// The events director's clockwork: a seeded schedule (one event every ~3-5 min, fireworks only at night,
// at most one big road-closing event at a time) and the planned -> live -> ended lifecycle. Pure.
import type { CityEvent } from "../../store";

export type EventKind = CityEvent["kind"];

/** Events that close roads. Only one of these runs at a time. */
export const CLOSURE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>(["motorcade", "state_visit", "marathon", "protest", "parade", "concert"]);

export const isClosureKind = (k: EventKind) => CLOSURE_KINDS.has(k);

export function isNightHour(h: number) {
  return h >= 20 || h < 5;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCHEDULE = {
  firstMs: 45_000, // the headline motorcade shortly after load
  minGapMs: 180_000,
  maxGapMs: 300_000,
  retryMs: 20_000, // a closure event is still live: try again soon
  plannedLeadMs: 20_000, // scheduled events are announced ("planned") this long before going live
  requestLeadMs: 3_000, // requested events go live almost at once
};

const WEIGHTS: [EventKind, number][] = [
  ["motorcade", 3],
  ["marathon", 2],
  ["protest", 2],
  ["parade", 2],
  ["concert", 2],
  ["fireworks", 3],
];

/** Seeded schedule. poll() says which event to start now, if any. */
export class Scheduler {
  next: number;
  private rand: () => number;
  private first = true;
  private last: EventKind | null = null;

  constructor(seed: number, now: number) {
    this.rand = mulberry32(seed);
    this.next = now + SCHEDULE.firstMs;
  }

  private gap() {
    return SCHEDULE.minGapMs + this.rand() * (SCHEDULE.maxGapMs - SCHEDULE.minGapMs);
  }

  /** Weighted pick, never fireworks by day, never the same kind twice in a row. */
  pick(night: boolean): EventKind {
    const pool = WEIGHTS.filter(([k]) => (night || k !== "fireworks") && k !== this.last);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = this.rand() * total;
    for (const [k, w] of pool) {
      r -= w;
      if (r <= 0) return k;
    }
    return pool[pool.length - 1][0];
  }

  /**
   * Call every tick. `closureLive`: a road-closing event is planned or live; `fireworksLive` likewise.
   * Returns the kind to start now, or null.
   */
  poll(now: number, hour: number, closureLive: boolean, fireworksLive = false): EventKind | null {
    if (now < this.next) return null;
    const night = isNightHour(hour);
    let kind: EventKind = this.first ? "motorcade" : this.pick(night);
    // fireworks are the only overlap allowed: at night, during a closure event, show fireworks instead
    if (isClosureKind(kind) && closureLive) {
      if (night && !fireworksLive && this.last !== "fireworks") kind = "fireworks";
      else {
        this.next = now + SCHEDULE.retryMs;
        return null;
      }
    }
    if (kind === "fireworks" && (fireworksLive || !night)) {
      this.next = now + SCHEDULE.retryMs;
      return null;
    }
    this.first = false;
    this.last = kind;
    this.next = now + this.gap();
    return kind;
  }

  /** A requested event pushes the next scheduled one back so they don't pile up. */
  noteRequested(now: number, kind: EventKind) {
    this.first = false;
    this.last = kind;
    this.next = Math.max(this.next, now + SCHEDULE.minGapMs);
  }
}

// ---------- lifecycle ----------

export type Phase = CityEvent["status"];

export interface Life {
  phase: Phase;
  liveAt: number; // when it goes live
  maxEndAt: number; // hard stop (every closure reopens by then)
  endedAt: number | null;
}

export function newLife(now: number, leadMs: number, maxDurationMs: number): Life {
  return { phase: "planned", liveAt: now + leadMs, maxEndAt: now + leadMs + maxDurationMs, endedAt: null };
}

export type LifeAction = "go_live" | "end" | null;

/** Advance the lifecycle. `done`: the show finished on its own (motorcade arrived, march dispersed). */
export function stepLife(life: Life, now: number, done: boolean): LifeAction {
  if (life.phase === "planned" && now >= life.liveAt) {
    life.phase = "live";
    return "go_live";
  }
  if (life.phase === "live" && (done || now >= life.maxEndAt)) {
    life.phase = "ended";
    life.endedAt = now;
    return "end";
  }
  return null;
}

/** End now (a new requested closure event replaces it, or the module unmounts). */
export function forceEnd(life: Life, now: number): boolean {
  if (life.phase === "ended") return false;
  life.phase = "ended";
  life.endedAt = now;
  return true;
}
