// Airport incident logic: when emergencies happen (Director), and how each one plays out over time
// (EmergencyTimeline, CrashTimeline). Pure: the module turns the returned actions into store/bus calls.
import type { IncidentStatus } from "../../store";

export type PlaneIncident = "emergency_landing" | "plane_crash";

export interface DirectorOpts {
  firstEmergency?: number; // s
  firstCrash?: number; // s
}

const EMERGENCY_EVERY: [number, number] = [180, 240];
const CRASH_EVERY: [number, number] = [420, 600]; // auto crashes: rare, never closer than 6 min

export class Director {
  private emergencyIn: number;
  private crashIn: number;
  private pending: PlaneIncident[] = [];

  constructor(
    private rand: () => number = Math.random,
    opts: DirectorOpts = {},
  ) {
    this.emergencyIn = opts.firstEmergency ?? 100;
    this.crashIn = opts.firstCrash ?? 420 + rand() * 240;
  }

  request(kind: PlaneIncident) {
    if (!this.pending.includes(kind)) this.pending.push(kind);
  }

  /** Put a kind back at the front (it could not start yet, e.g. no plane available). */
  retry(kind: PlaneIncident) {
    this.pending = [kind, ...this.pending.filter((k) => k !== kind)];
  }

  /**
   * Advance timers; returns the incident to start now, if any. Requests (HUD buttons) start straight away unless
   * an incident of the same kind is still running; automatic ones wait until the airport is completely quiet.
   */
  step(dt: number, busy: { emergency: boolean; crash: boolean; crews: boolean }): PlaneIncident | null {
    this.emergencyIn -= dt;
    this.crashIn -= dt;
    const quiet = !busy.emergency && !busy.crash && !busy.crews;
    if (!quiet) {
      // don't let an automatic one fire the instant the current one ends
      this.emergencyIn = Math.max(this.emergencyIn, 25);
      this.crashIn = Math.max(this.crashIn, 25);
    }
    let kind: PlaneIncident | null = null;
    const i = this.pending.findIndex((k) => (k === "emergency_landing" ? !busy.emergency : !busy.crash));
    if (i >= 0) kind = this.pending.splice(i, 1)[0];
    else if (quiet && this.emergencyIn <= 0) kind = "emergency_landing";
    else if (quiet && this.crashIn <= 0) kind = "plane_crash";
    if (kind === "emergency_landing") this.emergencyIn = this.span(EMERGENCY_EVERY);
    if (kind === "plane_crash") this.crashIn = this.span(CRASH_EVERY);
    return kind;
  }

  private span([a, b]: [number, number]) {
    return a + this.rand() * (b - a);
  }
}

export interface TimelineAction {
  status?: IncidentStatus;
  startTow?: boolean;
  clear?: boolean;
}

/** Emergency landing, from the moment it's declared. */
export class EmergencyTimeline {
  t = 0;
  stage: "inbound" | "evacuating" | "towing" | "done" = "inbound";
  sinceStop = 0;
  get done() {
    return this.stage === "done";
  }

  update(dt: number, s: { stopped: boolean; offRunway: boolean }): TimelineAction {
    this.t += dt;
    const out: TimelineAction = {};
    if (this.stage === "done") return out;
    if (this.t > 240) {
      this.stage = "done";
      return { status: "cleared", clear: true };
    }
    if (this.stage === "inbound" && s.stopped) {
      this.stage = "evacuating";
      this.sinceStop = 0;
      out.status = "responding";
    } else if (this.stage === "evacuating") {
      this.sinceStop += dt;
      if (this.sinceStop >= 18) {
        this.stage = "towing";
        out.status = "clearing";
        out.startTow = true;
      }
    } else if (this.stage === "towing" && s.offRunway && this.t >= 45) {
      this.stage = "done";
      out.status = "cleared";
      out.clear = true;
    }
    return out;
  }
}

/** Plane crash, from the moment of impact. */
export class CrashTimeline {
  t = 0;
  fire = 1;
  foamAt = -1;
  stage: "burning" | "foam" | "clearing" | "done" = "burning";
  get done() {
    return this.stage === "done";
  }
  get foaming() {
    return this.stage === "foam" || this.stage === "clearing";
  }

  update(dt: number, crewOnScene: boolean): TimelineAction {
    this.t += dt;
    const out: TimelineAction = {};
    if (this.stage === "burning" && (crewOnScene || this.t >= CREW_GIVE_UP_S)) {
      this.stage = "foam";
      this.foamAt = this.t;
      out.status = "responding";
    }
    // crews fight it for FIGHT_S: the fire dies down over most of that, then they damp down and clear
    if (this.foamAt >= 0) this.fire = Math.max(0, 1 - (this.t - this.foamAt) / (FIGHT_S * 0.75));
    if (this.stage === "foam" && this.t >= Math.max(60, this.foamAt + FIGHT_S - 15)) {
      this.stage = "clearing";
      out.status = "clearing";
    }
    if (this.stage === "clearing" && this.t >= Math.max(90, this.foamAt + FIGHT_S)) {
      this.stage = "done";
      this.fire = 0;
      out.status = "cleared";
      out.clear = true;
    }
    return out;
  }
}

/** Seconds the crews spend fighting the fire once on scene; the fire starts dying anyway after CREW_GIVE_UP_S. */
export const FIGHT_S = 65;
export const CREW_GIVE_UP_S = 60;

// --- Evacuation: passengers slide down the left-hand (local +x, north when landing east) slides ------

export const PASSENGERS = 24;
export const SLIDE_START = 1.5; // s after stopping: slides are inflated
/** Door sill and slide foot, plane-local (plane faces +z, left side is +x). */
export const DOORS = [
  { door: { x: 1.7, y: 2.7, z: 6.2 }, foot: { x: 7.2, y: 0.1, z: 6.2 } },
  { door: { x: 1.7, y: 2.7, z: -4.6 }, foot: { x: 7.2, y: 0.1, z: -4.6 } },
] as const;

export function evacPose(i: number, t: number, out: { x: number; y: number; z: number; visible: boolean }) {
  const d = DOORS[i % 2];
  const start = SLIDE_START + Math.floor(i / 2) * 0.75;
  if (t < start) {
    out.visible = false;
    return out;
  }
  out.visible = true;
  const slideT = 1.1;
  const u = t - start;
  if (u < slideT) {
    const k = u / slideT;
    out.x = d.door.x + (d.foot.x - d.door.x) * k;
    out.y = d.door.y + (d.foot.y - d.door.y) * k;
    out.z = d.door.z + (d.foot.z - d.door.z) * k;
    return out;
  }
  // walk out to a loose crowd
  const gx = 12 + (i % 4) * 1.3 + (Math.floor(i / 8) % 2) * 0.6;
  const gz = 4 - (Math.floor(i / 4) % 6) * 1.4;
  const dx = gx - d.foot.x;
  const dz = gz - d.foot.z;
  const len = Math.hypot(dx, dz);
  const k = Math.min(1, ((u - slideT) * 2.6) / len);
  out.x = d.foot.x + dx * k;
  out.y = 0;
  out.z = d.foot.z + dz * k;
  return out;
}
