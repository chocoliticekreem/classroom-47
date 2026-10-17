// Pure incident lifecycle: decides when an incident moves responding -> clearing -> cleared and
// when the units go home. Times are sim seconds (paused time doesn't count).

export type Phase = "enroute" | "responding" | "clearing" | "cleared" | "done";

export type LifeAction = "set_responding" | "set_clearing" | "release_tow" | "set_cleared" | "release_units";

export interface Life {
  phase: Phase;
  dispatchedAt: number;
  towArrivedAt: number | null;
  clearingAt: number | null;
  clearedAt: number | null;
  towReleased: boolean;
  towsRequired: number; // tows that must all be on scene
  towWorkS: number; // seconds the last required tow must have worked
}

export interface LifeInput {
  anyArrived: boolean; // at least one unit is parked at the scene
  towsArrived: number; // tow trucks parked at the scene right now
  externallyCleared: boolean; // someone else cleared/removed the incident
  /** Scene work that must finish before clearing (cyclist hit: the ambulance has left with the rider). Default true. */
  workDone?: boolean;
}

export const TIMING = {
  towWorkS: 8, // default: tow on scene this long -> "clearing" (pileups override per Life)
  towDepartS: 1.6, // after "clearing", the tow hooks the wreck and drives off
  clearAfterS: 5, // after "clearing" -> "cleared"
  returnDelayS: 1.8, // after "cleared", the rest pack up and go
  giveUpS: 150, // tow never made it: clear anyway
};

const reached = (now: number, due: number) => now + 1e-6 >= due;

export function newLife(now: number, opts: { towsRequired?: number; towWorkS?: number } = {}): Life {
  return {
    phase: "enroute",
    dispatchedAt: now,
    towArrivedAt: null,
    clearingAt: null,
    clearedAt: null,
    towReleased: false,
    towsRequired: Math.max(0, opts.towsRequired ?? 1), // 0: no tow (a cyclist hit), clearing waits for workDone
    towWorkS: opts.towWorkS ?? TIMING.towWorkS,
  };
}

/** Advance the lifecycle to `now`. Mutates `life`; returns actions to apply, each emitted once. */
export function stepLife(life: Life, input: LifeInput, now: number): LifeAction[] {
  const out: LifeAction[] = [];
  if (life.phase === "done") return out;

  if (input.externallyCleared && (life.phase === "enroute" || life.phase === "responding" || life.phase === "clearing")) {
    life.phase = "cleared";
    life.clearedAt = now;
  }

  if (life.phase === "enroute" && input.anyArrived) {
    life.phase = "responding";
    out.push("set_responding");
  }

  // the clock starts once ALL required tows are on scene (and any other scene work is done)
  if (input.towsArrived >= life.towsRequired && (input.workDone ?? true) && life.towArrivedAt === null) life.towArrivedAt = now;

  if (life.phase === "enroute" || life.phase === "responding") {
    // Stage times are scheduled from when the previous stage was due, so a long frame catches up.
    const due = Math.min(
      life.towArrivedAt !== null ? life.towArrivedAt + life.towWorkS : Infinity,
      life.dispatchedAt + TIMING.giveUpS,
    );
    if (reached(now, due)) {
      life.phase = "clearing";
      life.clearingAt = due;
      out.push("set_clearing");
    }
  }

  if (life.phase === "clearing" && life.clearingAt !== null) {
    if (!life.towReleased && reached(now, life.clearingAt + TIMING.towDepartS)) {
      life.towReleased = true;
      out.push("release_tow");
    }
    if (reached(now, life.clearingAt + TIMING.clearAfterS)) {
      life.phase = "cleared";
      life.clearedAt = life.clearingAt + TIMING.clearAfterS;
      out.push("set_cleared");
    }
  }

  if (life.phase === "cleared" && life.clearedAt !== null && reached(now, life.clearedAt + TIMING.returnDelayS)) {
    if (!life.towReleased) {
      life.towReleased = true;
      out.push("release_tow");
    }
    life.phase = "done";
    out.push("release_units");
  }
  return out;
}
