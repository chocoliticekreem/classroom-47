// Pure scheduling logic for the Scenarios module: seeded coverage order, modifier picks, autoplay
// timing, run lifecycle (staged -> resolved -> expired). No three.js, no React; the component drives it.
import type { Modifier } from "../../scenarios";

/** Same values as bus scenario:resolved.outcome (widened in PRD J3). */
export type Outcome = import("../../bus").ScenarioOutcome;

export const ALL_MODIFIERS: readonly Modifier[] = [
  "conflicting_stories", "failed_action", "missing_context", "noise", "needs_human", "out_of_policy",
  "prompt_injection", "privacy_request", "repeat_complaint", "cascade", "time_pressure", "do_nothing",
];

export const MAX_ACTIVE = 3;
export const EXPIRE_AFTER_RESOLVED_S = 25;
export const EXPIRE_UNRESOLVED_S = 60;
export const AUTOPLAY_MIN_S = 20;
export const AUTOPLAY_MAX_S = 30;
export const FIRST_AUTOPLAY_S = 4;

/** mulberry32: tiny seeded PRNG returning [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle (copy) with a given random source. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface Pick {
  scenarioId: string;
  modifiers: Modifier[];
}

/**
 * Autoplay order: every scenario exactly once per cycle (shuffled, seeded), then a fresh shuffle.
 * Modifiers: 0-2 random distinct ones, and never three plain runs in a row.
 */
export class Autoplay {
  private order: string[] = [];
  private idx = 0;
  private plainStreak = 0;
  private readonly rand: () => number;

  constructor(private readonly ids: readonly string[], seed = 2026) {
    this.rand = rng(seed);
  }

  next(): Pick {
    if (this.idx >= this.order.length) {
      this.order = shuffled(this.ids, this.rand);
      this.idx = 0;
    }
    const scenarioId = this.order[this.idx++];
    const r = this.rand();
    let count = r < 0.4 ? 0 : r < 0.8 ? 1 : 2;
    if (count === 0 && this.plainStreak >= 2) count = 1;
    this.plainStreak = count === 0 ? this.plainStreak + 1 : 0;
    const modifiers = shuffled(ALL_MODIFIERS, this.rand).slice(0, count);
    return { scenarioId, modifiers };
  }
}

export interface RunState {
  runId: string;
  scenarioId: string;
  modifiers: Modifier[];
  stagedAt: number; // director clock, seconds
  resolvedAt: number | null;
  outcome: Outcome | null;
}

export function isExpired(r: RunState, now: number) {
  return r.resolvedAt !== null ? now - r.resolvedAt >= EXPIRE_AFTER_RESOLVED_S : now - r.stagedAt >= EXPIRE_UNRESOLVED_S;
}

export type DirectorAction =
  | { type: "stage"; pick: Pick; runId: string; source: "autoplay" | "request" }
  | { type: "expire"; runId: string };

/**
 * The director's clock only advances via tick(dt), so pausing the world pauses scenes too.
 * Actions are returned for the caller to carry out (build props, emit bus events).
 */
export class Director {
  now = 0;
  runs: RunState[] = [];
  private nextAutoAt = FIRST_AUTOPLAY_S;
  private seq = 0;
  private readonly rand: () => number;
  readonly autoplay: Autoplay;

  constructor(ids: readonly string[], seed = 2026, public autoplayOn = true) {
    this.autoplay = new Autoplay(ids, seed);
    this.rand = rng(seed ^ 0x9e3779b9);
  }

  private newRunId() {
    this.seq += 1;
    return `SC-${String(this.seq).padStart(3, "0")}`;
  }

  private stage(pick: Pick, source: "autoplay" | "request"): DirectorAction {
    const runId = this.newRunId();
    this.runs.push({ runId, scenarioId: pick.scenarioId, modifiers: pick.modifiers, stagedAt: this.now, resolvedAt: null, outcome: null });
    return { type: "stage", pick, runId, source };
  }

  /** A UI request: stage now, evicting the oldest scene if we're full. */
  request(pick: Pick): DirectorAction[] {
    const out: DirectorAction[] = [];
    while (this.runs.length >= MAX_ACTIVE) {
      const oldest = this.runs.shift()!;
      out.push({ type: "expire", runId: oldest.runId });
    }
    out.push(this.stage(pick, "request"));
    return out;
  }

  resolve(runId: string, outcome: Outcome) {
    const r = this.runs.find((x) => x.runId === runId);
    if (r && r.resolvedAt === null) {
      r.resolvedAt = this.now;
      r.outcome = outcome;
    }
    return r;
  }

  tick(dt: number): DirectorAction[] {
    this.now += dt;
    const out: DirectorAction[] = [];
    const keep: RunState[] = [];
    for (const r of this.runs) {
      if (isExpired(r, this.now)) out.push({ type: "expire", runId: r.runId });
      else keep.push(r);
    }
    this.runs = keep;
    if (this.autoplayOn && this.now >= this.nextAutoAt) {
      if (this.runs.length < MAX_ACTIVE) {
        out.push(this.stage(this.autoplay.next(), "autoplay"));
        this.nextAutoAt = this.now + AUTOPLAY_MIN_S + this.rand() * (AUTOPLAY_MAX_S - AUTOPLAY_MIN_S);
      } else {
        this.nextAutoAt = this.now + 3; // full: try again shortly
      }
    }
    return out;
  }

  remove(runId: string) {
    this.runs = this.runs.filter((r) => r.runId !== runId);
  }
}
