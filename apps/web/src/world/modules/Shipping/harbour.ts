// Shipping: the port's sea-traffic state machine. Pure logic (no three.js, no React): vessels sail in from the
// horizon, anchor, get called with a pilot, are turned and pushed alongside by tugs, moored, worked by the crane
// modules (berths.ts contract), unmoored, pulled off, turned and sent back out to sea.
import { BERTHS, type BerthId, type BerthState, type DeckSlot, type ShipPhase } from "../../berths";
import { copyDeck, fillDeck } from "./deck";
import { CLASSES, CONTRACT_BAYS, CONTRACT_ROWS, CONTRACT_TIERS, FLEET, fits, shipLayout, type ShipLayout, type VesselClass, type VesselSpec } from "./fleet";
import {
  ANCHORAGE,
  ANCHOR_HEADING,
  HORIZON_X,
  MOORED_HEADING,
  OUTBOUND_HEADING,
  swingOffFor,
  TUG_BASE,
  accelerate,
  advance,
  approachLane,
  departureLane,
  inboundLane,
  laneAt,
  lerpAngle,
  smoother,
  swingPoint,
  wrapAngle,
  type Lane,
  type Motion,
  type Pose2,
} from "./lanes";
import { steer, tugSlot, toWorld, type Boat, type Slot, type TugStage } from "./tugs";

export type VState =
  | "offstage"
  | "inbound"
  | "anchored"
  | "called" // pilot on the way / boarding, still at anchor
  | "approach" // sailing in (may stop at the hold point until the berth is released)
  | "turnIn" // tugs swinging it to bow-north at the swing point
  | "push" // tugs pushing it sideways alongside
  | "mooring"
  | "working"
  | "unmooring"
  | "pulloff"
  | "turnOut"
  | "departing";

export const TIMING = {
  mooring: 6,
  unmoorLines: 6,
  push: 28,
  pulloff: 20,
  turnOutDur: 14,
  autoComplete: 150, // working seconds before we stop waiting for a crane module's craneDone
  callNextAfter: 30, // working seconds before the next ship is called from the anchorage
  releaseAt: 5, // departing metres before the berth is released for the next ship (it is turned and heading out)
  holdClear: 135, // the queued ship's bow waits this far short of the swing point (clear of the turning circle)
  tugsReturnAfter: 30, // working seconds before the tugs come back and stand off, ready to unmoor
  pilotTimeout: 70,
  pilotBoard: 3,
  tugWait: 35, // max wait for tugs before proceeding anyway
};

export const APPROACH = { vmax: 9, accel: 0.42, decel: 0.32 };
export const DEPART = { accel: 0.28 };
export const INBOUND = { accel: 0.3, decel: 0.14 };

export interface Vessel {
  i: number;
  spec: VesselSpec;
  cls: VesselClass;
  layout: ShipLayout;
  state: VState;
  t: number; // seconds in state
  x: number;
  z: number;
  heading: number;
  vx: number; // world velocity, m/s (wakes, tug feed-forward)
  vz: number;
  bob: number;
  roll: number;
  pitch: number;
  lane: Lane | null;
  m: Motion;
  holdS: number;
  h0: number; // heading at the start of a turn
  berth: BerthId | null; // berth it is assigned to (owner or queued)
  spot: number; // anchorage spot reserved/occupied, or -1
  deck: DeckSlot[]; // own cargo when not alongside
  seed: number;
  arrivedAt: number;
  offstageUntil: number;
  /** Mooring lines out, 0..1. */
  lines: number;
  /** Sim time of the last horn blast (renderer puffs steam when it changes). */
  hornAt: number;
  pilotAboard: boolean;
  phaseSeed: number;
  /** Distance off the quay line of this ship's swing point (room to turn its length clear of the quay). */
  swingOff: number;
  /** State time at which a tug-assisted manoeuvre started (-1 = still waiting for the tugs). */
  go: number;
}

export interface Tug extends Boat {
  kind: "tug" | "pilot";
  team: BerthId;
  role: 0 | 1;
  home: { x: number; z: number; heading: number };
  stage: TugStage | "board";
  vessel: number; // -1 when not working a ship
  effort: number;
  /** Towline end point (ship-local) on `vessel`, or null. */
  line: [number, number] | null;
  /** Pilot boat: seconds alongside the ship it is boarding. */
  boardT: number;
}

const BERTH_IDS: BerthId[] = ["docks", "terminal"];
const _pose: Pose2 = { x: 0, z: 0, heading: 0 };
const _slot: Slot = { x: 0, z: 0, heading: 0, line: null, effort: 0 };
const _w = { x: 0, z: 0 };

function newDeck(): DeckSlot[] {
  return Array.from({ length: CONTRACT_ROWS * CONTRACT_BAYS * CONTRACT_TIERS }, () => ({ color: null }));
}

export class Harbour {
  time = 0;
  vessels: Vessel[];
  boats: Tug[];
  owner: Record<BerthId, number> = { docks: -1, terminal: -1 };
  berths: Record<BerthId, BerthState>;
  private seedCounter: number;

  constructor(seed = 7, nowMs = 0, berths: Record<BerthId, BerthState> = BERTHS, initial = true) {
    this.berths = berths;
    this.seedCounter = seed * 1000;
    this.vessels = FLEET.map((spec, i) => {
      const cls = CLASSES[spec.cls];
      return {
        i, spec, cls, layout: shipLayout(cls), state: "offstage", t: 0, x: HORIZON_X, z: 0, heading: ANCHOR_HEADING,
        vx: 0, vz: 0, bob: 0, roll: 0, pitch: 0, lane: null, m: { s: 0, v: 0 }, holdS: 0, h0: 0, berth: null, spot: -1,
        deck: newDeck(), seed: 0, arrivedAt: 0, offstageUntil: 0, lines: 0, hornAt: -100, pilotAboard: false, phaseSeed: i * 1.7,
        swingOff: swingOffFor(cls.length / 2, BERTHS.docks.quayX), go: -1,
      } satisfies Vessel;
    });
    this.boats = [];
    for (const team of BERTH_IDS) {
      const [bx, bz] = TUG_BASE[team];
      for (const role of [0, 1] as const) {
        const home = { x: bx + 11, z: bz - 16 + role * 30, heading: Math.PI };
        this.boats.push({ kind: "tug", team, role, home, ...home, speed: 0, locked: true, stage: "home", vessel: -1, effort: 0, line: null, boardT: 0 });
      }
      const ph = { x: bx - 10, z: bz + 4, heading: Math.PI };
      this.boats.push({ kind: "pilot", team, role: 0, home: ph, ...ph, speed: 0, locked: true, stage: "home", vessel: -1, effort: 0, line: null, boardT: 0 });
    }
    for (const b of BERTH_IDS) {
      const B = this.berths[b];
      B.phase = "empty";
      B.shipName = null;
      B.craneDone = false;
      B.x = B.quayX + 400;
    }
    if (initial) this.setupInitial(nowMs);
  }

  // ---------- setup ----------

  private nextSeed() {
    return ++this.seedCounter;
  }

  private fill(v: Vessel) {
    v.seed = this.nextSeed();
    const d = fillDeck(v.seed, { rows: CONTRACT_ROWS, bays: CONTRACT_BAYS, tiers: CONTRACT_TIERS, maxTier: v.cls.maxTier, homeBrand: v.spec.homeBrand });
    copyDeck(d, v.deck);
  }

  private setupInitial(nowMs: number) {
    const [rivet, maerlin, everglow, koska, titan, sudwind] = this.vessels;
    // HAMYWAY STAR alongside at the docks, already being worked
    this.fill(rivet);
    this.placeMoored(rivet, "docks");
    this.takeBerth(rivet, "docks", nowMs);
    this.enter(rivet, "working", nowMs);
    rivet.t = 40;
    this.berths.docks.phaseStartedAt = nowMs - 40000;
    // MAERLIN ENDURANCE on the final approach to the terminal
    this.fill(maerlin);
    const ap = approachLane("terminal", [ANCHORAGE[1].x, ANCHORAGE[1].z], ANCHOR_HEADING, maerlin.swingOff);
    maerlin.lane = ap.lane;
    maerlin.holdS = Math.max(0, ap.lane.length - maerlin.layout.half - TIMING.holdClear);
    maerlin.m.s = ap.lane.length - 230;
    maerlin.m.v = Math.min(APPROACH.vmax, Math.sqrt(2 * APPROACH.decel * 230));
    maerlin.pilotAboard = true;
    this.takeBerth(maerlin, "terminal", nowMs);
    this.enter(maerlin, "approach", nowMs);
    this.poseOnLane(maerlin);
    // two ships at anchor, the giant coming in from the horizon
    this.anchorAt(everglow, 0);
    everglow.arrivedAt = -60;
    this.anchorAt(koska, 2);
    koska.arrivedAt = -30;
    this.fill(titan);
    titan.spot = 1;
    titan.lane = inboundLane(1);
    titan.m.s = titan.lane.length - 820;
    titan.m.v = titan.cls.cruise;
    this.enter(titan, "inbound", nowMs);
    this.poseOnLane(titan);
    sudwind.offstageUntil = 25;
    // tugs for the terminal approach are already with MAERLIN
    for (const b of this.boats) if (b.kind === "tug" && b.team === "terminal") this.snapTug(b, maerlin, "escort");
  }

  private anchorAt(v: Vessel, spot: number) {
    this.fill(v);
    v.spot = spot;
    v.x = ANCHORAGE[spot].x;
    v.z = ANCHORAGE[spot].z;
    v.heading = ANCHOR_HEADING;
    v.state = "anchored";
    v.t = 0;
    v.arrivedAt = this.time;
  }

  private placeMoored(v: Vessel, b: BerthId) {
    const B = this.berths[b];
    v.x = B.quayX;
    v.z = (B.zMin + B.zMax) / 2;
    v.heading = MOORED_HEADING;
    v.lines = 1;
  }

  private snapTug(b: Tug, v: Vessel, stage: TugStage) {
    tugSlot(b.role, stage, this.shipPose(v), -1, _slot);
    b.x = _slot.x;
    b.z = _slot.z;
    b.heading = _slot.heading;
    b.locked = true;
    b.vessel = v.i;
    b.stage = stage;
  }

  // ---------- berth contract ----------

  private takeBerth(v: Vessel, b: BerthId, nowMs: number) {
    const B = this.berths[b];
    this.owner[b] = v.i;
    v.berth = b;
    B.shipName = v.spec.name;
    B.craneDone = false;
    B.discharged = 0;
    B.loaded = 0;
    copyDeck(v.deck, B.deck);
    this.setPhase(b, "approaching", nowMs);
    this.writePose(v);
  }

  private releaseBerth(b: BerthId, nowMs: number) {
    const i = this.owner[b];
    const B = this.berths[b];
    if (i >= 0) {
      copyDeck(B.deck, this.vessels[i].deck);
      this.vessels[i].berth = null;
    }
    this.owner[b] = -1;
    B.shipName = null;
    B.craneDone = false;
    B.x = B.quayX + 400;
    this.setPhase(b, "empty", nowMs);
    // a queued ship takes over at once
    const q = this.queued(b);
    if (q) this.takeBerth(q, b, nowMs);
  }

  private setPhase(b: BerthId, p: ShipPhase, nowMs: number) {
    const B = this.berths[b];
    if (B.phase !== p) {
      B.phase = p;
      B.phaseStartedAt = nowMs;
    }
  }

  private writePose(v: Vessel) {
    if (!v.berth || this.owner[v.berth] !== v.i) return;
    const B = this.berths[v.berth];
    B.x = v.x;
    B.z = v.z;
    B.heading = v.heading;
    B.bob = v.bob;
  }

  /** The deck the renderer should draw for a vessel (the berth's live grid while it owns a berth). */
  deckOf(v: Vessel): DeckSlot[] {
    return v.berth && this.owner[v.berth] === v.i ? this.berths[v.berth].deck : v.deck;
  }

  isOwner(v: Vessel) {
    return !!v.berth && this.owner[v.berth] === v.i;
  }

  queued(b: BerthId): Vessel | undefined {
    return this.vessels.find((v) => v.berth === b && this.owner[b] !== v.i);
  }

  shipPose(v: Vessel) {
    return { x: v.x, z: v.z, heading: v.heading, half: v.layout.half, beam: v.layout.beam };
  }

  // ---------- transitions ----------

  private enter(v: Vessel, s: VState, nowMs: number) {
    v.state = s;
    v.t = 0;
    v.go = -1;
    if (!v.berth || this.owner[v.berth] !== v.i) return;
    const map: Partial<Record<VState, ShipPhase>> = {
      called: "approaching", approach: "approaching", turnIn: "approaching", push: "approaching", mooring: "mooring",
      working: "working", unmooring: "unmooring", pulloff: "departing", turnOut: "departing", departing: "departing",
    };
    const p = map[s];
    if (p) this.setPhase(v.berth, p, nowMs);
  }

  private poseOnLane(v: Vessel) {
    if (!v.lane) return;
    laneAt(v.lane, v.m.s, _pose);
    v.x = _pose.x;
    v.z = _pose.z;
    v.heading = _pose.heading;
  }

  private spotFree(k: number) {
    return !this.vessels.some((v) => v.spot === k);
  }

  /** Call the next anchored ship for a berth (pilot goes out). */
  private call(b: BerthId, nowMs: number, skipPilot = false): Vessel | null {
    if (this.queued(b)) return null;
    const candidates = this.vessels
      .filter((v) => v.state === "anchored" && v.spot >= 0 && ANCHORAGE[v.spot].berth === b && fits(v.spec, b))
      .sort((a, c) => a.arrivedAt - c.arrivedAt);
    const v = candidates[0];
    if (!v) return null;
    v.berth = b;
    v.pilotAboard = skipPilot;
    if (this.owner[b] < 0) this.takeBerth(v, b, nowMs);
    this.enter(v, "called", nowMs);
    return v;
  }

  private startApproach(v: Vessel, nowMs: number) {
    const ap = approachLane(v.berth!, [v.x, v.z], v.heading, v.swingOff);
    v.lane = ap.lane;
    v.holdS = Math.max(0, ap.lane.length - v.layout.half - TIMING.holdClear);
    v.m.s = 0;
    v.m.v = 0;
    v.spot = -1; // anchorage spot is free once the anchor is up
    this.enter(v, "approach", nowMs);
  }

  // ---------- per-frame ----------

  step(dt: number, nowMs: number) {
    if (dt <= 0) return;
    this.time += dt;
    for (const v of this.vessels) this.stepVessel(v, dt, nowMs);
    for (const b of BERTH_IDS) {
      const o = this.owner[b];
      const ov = o >= 0 ? this.vessels[o] : null;
      const B = this.berths[b];
      const wantNext = !ov || (ov.state === "working" && (ov.t >= TIMING.callNextAfter || B.craneDone)) ||
        ov.state === "unmooring" || ov.state === "pulloff" || ov.state === "turnOut" || ov.state === "departing";
      if (wantNext) this.call(b, nowMs);
    }
    this.spawn(nowMs);
    for (const t of this.boats) this.stepBoat(t, dt);
  }

  private spawn(nowMs: number) {
    for (let k = 0; k < ANCHORAGE.length; k++) {
      if (!this.spotFree(k)) continue;
      const v = this.vessels.find((x) => x.state === "offstage" && this.time >= x.offstageUntil && fits(x.spec, ANCHORAGE[k].berth));
      if (!v) continue;
      this.fill(v);
      v.spot = k;
      v.lane = inboundLane(k);
      v.m.s = 0;
      v.m.v = v.cls.cruise;
      v.lines = 0;
      this.enter(v, "inbound", nowMs);
      this.poseOnLane(v);
    }
  }

  private stepVessel(v: Vessel, dt: number, nowMs: number) {
    v.t += dt;
    const px = v.x, pz = v.z;
    const T = this.time + v.phaseSeed * 10;
    const alongside = v.state === "mooring" || v.state === "working" || v.state === "unmooring";
    // sea state: more motion at sea, almost none alongside
    const amp = alongside ? 0.13 : v.state === "anchored" || v.state === "called" ? 0.25 : 0.32;
    v.bob = Math.sin(T * 0.5 + 0.8) * amp + Math.sin(T * 0.21 + 2.1) * amp * 0.4;
    v.roll = Math.sin(T * 0.37 + 0.2) * (alongside ? 0.004 : 0.018);
    v.pitch = Math.sin(T * 0.29 + 1.1) * (alongside ? 0.0008 : 0.004);
    const B = v.berth ? this.berths[v.berth] : null;
    const owner = this.isOwner(v);

    switch (v.state) {
      case "offstage":
        break;
      case "inbound": {
        const done = advance(v.m, dt, v.cls.cruise, INBOUND.accel, INBOUND.decel, v.lane!.length);
        this.poseOnLane(v);
        if (done) {
          v.state = "anchored";
          v.t = 0;
          v.arrivedAt = this.time;
        }
        break;
      }
      case "anchored":
      case "called": {
        // swinging gently to the anchor
        v.heading = ANCHOR_HEADING + Math.sin(this.time * 0.045 + v.phaseSeed) * 0.07 * Math.min(1, v.t / 30);
        if (v.state === "called" && (v.pilotAboard || v.t > TIMING.pilotTimeout)) {
          v.pilotAboard = true;
          this.startApproach(v, nowMs);
        }
        break;
      }
      case "approach": {
        const stopAt = owner ? v.lane!.length : Math.max(v.holdS, v.m.s);
        const done = advance(v.m, dt, APPROACH.vmax, APPROACH.accel, APPROACH.decel, stopAt);
        this.poseOnLane(v);
        if (done && owner) {
          v.h0 = v.heading;
          this.enter(v, "turnIn", nowMs);
        }
        break;
      }
      case "turnIn": {
        const d = Math.abs(wrapAngle(MOORED_HEADING - v.h0));
        const dur = 4 + d * 4.5;
        // wait for the tugs to be on station before swinging (or give up waiting); once started, never pause
        if (!this.started(v)) break;
        const tt = v.t - v.go;
        const k = smoother(tt / dur);
        v.heading = lerpAngle(v.h0, MOORED_HEADING, k);
        if (tt >= dur) {
          v.heading = MOORED_HEADING;
          this.enter(v, "push", nowMs);
        }
        break;
      }
      case "push": {
        const F = swingPoint(v.berth!, v.swingOff);
        if (!this.started(v)) {
          v.x = F[0];
        } else {
          const k = smoother((v.t - v.go) / TIMING.push);
          v.x = F[0] - v.swingOff * k;
          if (k >= 1) {
            v.x = B!.quayX;
            v.hornAt = this.time;
            this.enter(v, "mooring", nowMs);
          }
        }
        v.z = F[1];
        v.heading = MOORED_HEADING;
        break;
      }
      case "mooring":
        v.lines = Math.min(1, v.t / TIMING.mooring);
        if (v.t >= TIMING.mooring) {
          v.lines = 1;
          this.enter(v, "working", nowMs);
        }
        break;
      case "working":
        if (B && !B.craneDone && v.t >= TIMING.autoComplete) B.craneDone = true;
        if (B && B.craneDone) this.enter(v, "unmooring", nowMs);
        break;
      case "unmooring": {
        const tugsOn = v.lines < 1 || this.started(v);
        if (!tugsOn) v.lines = 1;
        else v.lines = Math.max(0, v.lines - dt / TIMING.unmoorLines);
        if (v.lines <= 0) {
          v.hornAt = this.time;
          this.enter(v, "pulloff", nowMs);
        }
        break;
      }
      case "pulloff": {
        const k = smoother(v.t / TIMING.pulloff);
        v.x = B!.quayX + v.swingOff * k;
        if (k >= 1) {
          v.h0 = v.heading;
          this.enter(v, "turnOut", nowMs);
        }
        break;
      }
      case "turnOut": {
        const k = smoother(v.t / TIMING.turnOutDur);
        v.heading = lerpAngle(v.h0, OUTBOUND_HEADING, k);
        if (k >= 1) {
          v.heading = OUTBOUND_HEADING;
          v.lane = departureLane(v.berth!, v.swingOff);
          v.m.s = 0;
          v.m.v = 0;
          this.enter(v, "departing", nowMs);
        }
        break;
      }
      case "departing": {
        const done = accelerate(v.m, dt, v.cls.cruise, DEPART.accel, v.lane!.length);
        this.poseOnLane(v);
        if (owner && v.m.s > TIMING.releaseAt) this.releaseBerth(v.berth!, nowMs);
        if (done || v.x > HORIZON_X) {
          if (this.isOwner(v)) this.releaseBerth(v.berth!, nowMs);
          v.berth = null;
          v.lines = 0;
          v.state = "offstage";
          v.t = 0;
          v.lane = null;
          v.offstageUntil = this.time + 15 + ((v.i * 37 + Math.floor(this.time)) % 30);
        }
        break;
      }
    }
    v.vx = (v.x - px) / dt;
    v.vz = (v.z - pz) / dt;
    if (this.isOwner(v)) this.writePose(v);
  }

  /** Tugs on station (or we gave up waiting): latch the start time of the manoeuvre in v.go. */
  private started(v: Vessel) {
    if (v.go >= 0) return true;
    if (this.tugsLocked(v) || v.t > TIMING.tugWait) v.go = v.t;
    return v.go >= 0;
  }

  private tugsLocked(v: Vessel) {
    let n = 0;
    for (const b of this.boats) if (b.kind === "tug" && b.vessel === v.i && b.locked) n++;
    return n >= 2;
  }

  /** What a boat should be doing right now. */
  private boatJob(b: Tug): { v: Vessel | null; stage: TugStage | "board" } {
    if (b.kind === "pilot") {
      const v = this.vessels.find((x) => x.state === "called" && x.berth === b.team && !x.pilotAboard);
      return v ? { v, stage: "board" } : { v: null, stage: "home" };
    }
    const o = this.owner[b.team];
    const v = o >= 0 ? this.vessels[o] : null;
    if (!v) return { v: null, stage: "home" };
    switch (v.state) {
      case "approach": {
        const remain = v.lane!.length - v.m.s;
        return { v, stage: remain > 130 ? "escort" : "standby" };
      }
      case "turnIn":
      case "turnOut": {
        // both tugs on the ship's local -x side (seaward once she is bow-north): one pushes, one pulls on a
        // line, making a couple that swings her. Which end pushes depends on the turn direction.
        const d = wrapAngle((v.state === "turnIn" ? MOORED_HEADING : OUTBOUND_HEADING) - v.h0);
        return { v, stage: (b.role === 0) === d > 0 ? "push" : "pull" };
      }
      case "push":
        return { v, stage: "push" };
      case "mooring":
        return { v, stage: "push" };
      case "working":
        return v.t > TIMING.tugsReturnAfter || this.berths[b.team].craneDone ? { v, stage: "standoff" } : { v: null, stage: "home" };
      case "unmooring":
        return { v, stage: "pull" };
      case "pulloff":
        return { v, stage: "pull" };
      default:
        return { v: null, stage: "home" };
    }
  }

  private stepBoat(b: Tug, dt: number) {
    const job = this.boatJob(b);
    if ((job.v ? job.v.i : -1) !== b.vessel || job.stage !== b.stage) {
      b.locked = false;
      b.vessel = job.v ? job.v.i : -1;
      b.stage = job.stage;
    }
    b.line = null;
    let tx = b.home.x, tz = b.home.z, th = b.home.heading, tvx = 0, tvz = 0;
    b.effort = 0.1;
    const v = job.v;
    if (v && job.stage === "board") {
      toWorld(this.shipPose(v), v.layout.beam / 2 + 6, -12, _w);
      tx = _w.x;
      tz = _w.z;
      th = v.heading;
      b.effort = 0.4;
      if (b.locked) {
        b.boardT += dt;
        if (b.boardT > TIMING.pilotBoard) {
          v.pilotAboard = true;
          b.boardT = 0;
        }
      } else b.boardT = 0;
    } else if (v) {
      tugSlot(b.role, job.stage as TugStage, this.shipPose(v), -1, _slot);
      tx = _slot.x;
      tz = _slot.z;
      th = _slot.heading;
      tvx = v.vx;
      tvz = v.vz;
      b.line = _slot.line;
      b.effort = _slot.effort;
    }
    steer(b, tx, tz, th, dt, tvx, tvz, b.kind === "pilot" ? 16 : 12);
    if (!b.locked && b.speed > 2) b.effort = Math.max(b.effort, Math.min(1, b.speed / 12));
  }


  /** Shift the berth phase timestamps onto a new clock origin (built at t=0, mounted at performance.now()). */
  rebaseClock(nowMs: number) {
    if (this.rebased) return;
    this.rebased = true;
    for (const b of BERTH_IDS) this.berths[b].phaseStartedAt += nowMs;
  }
  private rebased = false;

  // ---------- testing hooks ----------

  /** Bring the next ship in to a berth now (skips the pilot wait). Returns a short status. */
  forceArrival(b: BerthId, nowMs: number): string {
    if (this.owner[b] >= 0) return `berth busy (${this.berths[b].shipName}, ${this.berths[b].phase})`;
    let q = this.queued(b);
    if (!q) {
      let v = this.vessels.find((x) => x.state === "anchored" && x.spot >= 0 && ANCHORAGE[x.spot].berth === b);
      if (!v) {
        const k = ANCHORAGE.findIndex((s, i) => s.berth === b && (this.spotFree(i) || this.vessels.some((x) => x.spot === i && x.state === "inbound")));
        if (k < 0) return "no ship available";
        const inbound = this.vessels.find((x) => x.spot === k && x.state === "inbound");
        v = inbound ?? this.vessels.find((x) => x.state === "offstage" && fits(x.spec, b));
        if (!v) return "no ship available";
        const deck = inbound ? v.deck.map((d) => ({ ...d })) : null;
        this.anchorAt(v, k);
        if (deck) copyDeck(deck, v.deck);
      }
      q = this.call(b, nowMs, true) ?? undefined;
    }
    if (!q) return "no ship available";
    q.pilotAboard = true;
    if (q.state === "called") this.startApproach(q, nowMs);
    return `${q.spec.name} approaching ${b}`;
  }

  /** Finish the current call at a berth now (cranes done) so the ship unmoors and sails. */
  forceDeparture(b: BerthId, nowMs: number): string {
    const o = this.owner[b];
    if (o < 0) return "berth empty";
    const v = this.vessels[o];
    if (v.state === "approach" || v.state === "turnIn" || v.state === "push" || v.state === "mooring" || v.state === "called") {
      v.spot = -1;
      this.placeMoored(v, b);
      this.enter(v, "working", nowMs);
    }
    if (v.state !== "working") return `already ${v.state}`;
    this.berths[b].craneDone = true;
    return `${v.spec.name} departing ${b}`;
  }
}
