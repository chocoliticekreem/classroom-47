// The airport's brain: air traffic, the incident director, emergency/crash lifecycles and the fire crews.
// No three.js and no React: side effects on the shared store/bus go through SimEffects, so it is testable.
import type { WorldEvent } from "../../bus";
import { edgeMidpoint, ROAD_EDGES } from "../../roads";
import type { DamageZone, Incident, IncidentStatus } from "../../store";
import {
  airsideBack,
  airsideOut,
  dispatch,
  makeCrew,
  roadBack,
  roadOut,
  stepCrew,
  type CrewUnit,
} from "./fireCrew";
import { Fleet, type FleetEvent, type Plane } from "./flight";
import { CrashTimeline, Director, EmergencyTimeline, type DirectorOpts, type PlaneIncident } from "./incidents";
import {
  crashEdge,
  DAMAGE_RADIUS,
  pickCrashSite,
  EMERGENCY_STOP_X,
  RUNWAY_ATTACK,
  RUNWAY_STANDBY,
  RWY,
  type CrashSite,
} from "./layout";
import { v3, type V3 } from "./path";

export interface SimEffects {
  addIncident(i: Incident): void;
  updateIncident(id: string, patch: Partial<Incident>): void;
  blockEdge(key: string, reason: string): void;
  unblockEdge(key: string): void;
  emit(e: WorldEvent): void;
  blocked(): ReadonlySet<string>;
  newId(): string;
  now(): number; // performance.now() ms
  addDamage(d: DamageZone): void;
  updateDamage(id: string, patch: Partial<DamageZone>): void;
  removeDamage(id: string): void;
  /** Current state of a damage zone, undefined once it has been removed. */
  damageState(id: string): DamageZone["state"] | undefined;
}

/** Road edges whose midpoint lies within `r` of (x, z). */
export function edgesWithin(x: number, z: number, r: number): string[] {
  const out: { k: string; d: number }[] = [];
  for (const e of ROAD_EDGES.values()) {
    const [mx, mz] = edgeMidpoint(e.key);
    const d = Math.hypot(mx - x, mz - z);
    if (d <= r) out.push({ k: e.key, d });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.k);
}

/** The scar a crash leaves: a crater while destroyed, then a construction pad while the city rebuilds. */
export interface Crater {
  damageId: string;
  x: number;
  z: number;
  radius: number;
  stage: "destroyed" | "rebuilding";
  /** seconds in the current stage */
  t: number;
}

export interface EmergencyRun {
  incidentId: string;
  plane: Plane;
  tl: EmergencyTimeline;
  towPending: boolean;
  /** seconds since the plane stopped (-1 before) */
  sinceStop: number;
}

export interface CrashRun {
  incidentId: string | null; // set at impact
  plane: Plane;
  site: CrashSite;
  /** Roads we closed at impact (and must reopen). */
  sealed: string[];
  tl: CrashTimeline | null;
}

const SEAL_REASON = "Plane crash: area sealed off";

/** Smoking engine (left, local +x) in plane-local coordinates. */
export const SICK_ENGINE: V3 = v3(5.2, 1.3, 2.4);

/** Plane-local point -> world, for a plane at pos with heading yaw (ignores pitch/roll; fine on the ground). */
export function planeLocalToWorld(p: Plane, l: V3, out: V3): V3 {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  out.x = p.pos.x + c * l.x + s * l.z;
  out.y = p.pos.y + l.y;
  out.z = p.pos.z - s * l.x + c * l.z;
  return out;
}

export class AirportSim {
  readonly fleet: Fleet;
  readonly director: Director;
  readonly crew: CrewUnit[] = makeCrew();
  emergency: EmergencyRun | null = null;
  crash: CrashRun | null = null;
  crater: Crater | null = null;
  /** Fleet events of the last step, for one-shot effects (tyre smoke, sparks, fireball). */
  fx: FleetEvent[] = [];
  /** Increments every step, so renderers consume `fx` exactly once. */
  stepId = 0;
  time = 0;

  constructor(
    private fxs: SimEffects,
    private rand: () => number = Math.random,
    opts: DirectorOpts = {},
  ) {
    this.fleet = new Fleet(rand);
    this.director = new Director(rand, opts);
  }

  get busy() {
    return !!this.emergency || !!this.crash || this.crew.some((u) => u.state !== "home");
  }

  /** Force the next crash site (tests, debugging). */
  nextCrashSite: CrashSite | null = null;

  request(kind: PlaneIncident) {
    this.director.request(kind);
  }

  step(dt: number) {
    this.time += dt;
    this.stepId++;
    this.fleet.step(dt);
    this.fx = this.fleet.events;

    const kind = this.director.step(dt, {
      emergency: !!this.emergency,
      crash: !!this.crash || !!this.crater,
      crews: this.crew.some((u) => u.state !== "home"),
    });
    if (kind && !(kind === "emergency_landing" ? this.startEmergency() : this.startCrash())) this.director.retry(kind);

    if (this.emergency) this.stepEmergency(dt, this.emergency);
    if (this.crash) this.stepCrash(dt, this.crash);
    if (this.crater) this.stepCrater(dt, this.crater);
    for (const u of this.crew) stepCrew(u, dt);
  }

  // --- Emergency landing ----------------------------------------------------------

  private startEmergency(): boolean {
    const plane = this.fleet.declareEmergency();
    if (!plane) return false;
    const id = this.fxs.newId();
    this.fxs.addIncident({
      id,
      kind: "emergency_landing",
      edgeKey: "runway_09",
      x: EMERGENCY_STOP_X,
      z: RWY.z,
      status: "active",
      createdAt: this.fxs.now(),
      note: `Emergency landing: ${plane.callsign} engine fire, runway 09 closed`,
    });
    this.fxs.emit({ type: "incident:created", incidentId: id });
    this.emergency = { incidentId: id, plane, tl: new EmergencyTimeline(), towPending: false, sinceStop: -1 };
    this.crew.forEach((u, i) => {
      dispatch(u, airsideOut(u, RUNWAY_STANDBY[i]), [], i * 1.2, 16, "out");
      u.target = v3(RUNWAY_STANDBY[i].x + 10, 0, RWY.z);
    });
    return true;
  }

  private stepEmergency(dt: number, e: EmergencyRun) {
    const p = e.plane;
    const stopped = p.phase === "stopped" || p.phase === "towed" || p.phase === "parked";
    if (e.sinceStop >= 0) e.sinceStop += dt;
    const offRunway = p.phase === "parked" || (p.phase === "towed" && p.pos.z > RWY.z + RWY.halfW + 2);
    const a = e.tl.update(dt, { stopped, offRunway });
    if (a.status) this.setStatus(e.incidentId, a.status);
    if (a.status === "responding") {
      e.sinceStop = 0;
      // move in: tenders either side of the burning engine, ambulance by the evacuees
      const engine = planeLocalToWorld(p, SICK_ENGINE, v3(0, 0, 0));
      if (!this.crash?.tl) this.crew.forEach((u, i) => {
        const dest = RUNWAY_ATTACK[i];
        // the far tender swings out round the back so it doesn't drive through its colleague
        const pts = i === 1 ? [v3(u.x, 0, u.z), v3(u.x + 8, 0, -437), v3(dest.x - 8, 0, -437), v3(dest.x, 0, dest.z)] : [v3(u.x, 0, u.z), v3(dest.x, 0, dest.z)];
        dispatch(u, pts, [], i * 0.4, 9, "out");
        u.target = u.kind === "fire" ? engine : v3(p.pos.x, 0, p.pos.z - 14);
      });
    }
    if (a.startTow) e.towPending = true;
    if (e.towPending && this.fleet.startTow(p)) e.towPending = false;
    if (!this.crash?.tl)
      for (const u of this.crew) u.spraying = u.kind === "fire" && u.state === "onscene" && e.tl.stage === "evacuating";
    if (a.clear) {
      this.fxs.emit({ type: "incident:cleared", incidentId: e.incidentId });
      this.fleet.reopenRunway();
      if (!this.crash?.tl)
        for (const u of this.crew) {
          u.spraying = false;
          dispatch(u, airsideBack(u), [], u.index * 1.5, 14, "returning");
        }
      this.emergency = null;
    }
  }

  // --- Plane crash -----------------------------------------------------------------

  private startCrash(): boolean {
    const site = this.nextCrashSite ?? pickCrashSite(this.rand);
    const plane = this.fleet.declareCrash(site);
    if (!plane) return false;
    this.nextCrashSite = null;
    this.crash = { incidentId: null, plane, site, sealed: [], tl: null };
    return true;
  }

  private stepCrash(dt: number, c: CrashRun) {
    if (!c.tl) {
      if (c.plane.phase !== "crashed") return;
      this.impact(c);
      return;
    }
    const onScene = this.crew.some((u) => u.kind === "fire" && u.state === "onscene");
    const a = c.tl.update(dt, onScene);
    if (a.status && c.incidentId) this.setStatus(c.incidentId, a.status);
    for (const u of this.crew) u.spraying = u.kind === "fire" && u.state === "onscene" && c.tl.foaming;
    if (a.clear && c.incidentId) {
      for (const k of c.sealed) this.fxs.unblockEdge(k);
      this.fxs.emit({ type: "incident:cleared", incidentId: c.incidentId });
      for (const k of c.sealed) this.fxs.emit({ type: "road:reopened", edgeKey: k });
      this.fleet.releaseCrashed(c.plane);
      if (this.crater) {
        this.crater.stage = "rebuilding";
        this.crater.t = 0;
        this.fxs.updateDamage(this.crater.damageId, { state: "rebuilding" });
      }
      const blocked = this.fxs.blocked();
      for (const u of this.crew) {
        u.spraying = false;
        const r = roadBack(u, c.site, blocked);
        if (r) dispatch(u, r.pts, r.segs, u.index * 1.5, 18, "returning");
        else dispatch(u, [v3(u.x, 0, u.z), v3(u.home.x, 0, u.home.z)], [], u.index * 1.5, 14, "returning");
      }
      this.crash = null;
    }
  }

  private impact(c: CrashRun) {
    const id = this.fxs.newId();
    c.incidentId = id;
    c.tl = new CrashTimeline();
    const what = c.plane.spec.cargo ? "Cargo jet" : "Jet";
    const cause = `${what} ${c.plane.callsign} crashed`;
    const { x, z } = c.site;

    // the damage zone: Buildings collapses everything inside it; we draw the crater
    const damageId = `DMG-${id}`;
    this.fxs.addDamage({ id: damageId, x, z, radius: DAMAGE_RADIUS, state: "destroyed", cause, createdAt: this.fxs.now() });
    this.crater = { damageId, x, z, radius: DAMAGE_RADIUS, stage: "destroyed", t: 0 };

    // seal off the area (skip roads someone else has already closed: they own those)
    const already = this.fxs.blocked();
    const cand = edgesWithin(x, z, DAMAGE_RADIUS + 10);
    const own = crashEdge(c.site);
    if (own && ROAD_EDGES.has(own) && !cand.includes(own)) cand.unshift(own);
    c.sealed = cand.filter((k) => !already.has(k));
    for (const k of c.sealed) this.fxs.blockEdge(k, SEAL_REASON);

    this.fxs.addIncident({
      id,
      kind: "plane_crash",
      edgeKey: c.sealed[0] ?? cand[0] ?? "",
      x,
      z,
      status: "active",
      createdAt: this.fxs.now(),
      note:
        c.site.kind === "city"
          ? `${cause} ${c.site.where}, area sealed off`
          : `${what} ${c.plane.callsign} down ${c.site.where}, road closed`,
    });
    this.fxs.emit({ type: "incident:created", incidentId: id });
    for (const k of c.sealed) this.fxs.emit({ type: "road:blocked", edgeKey: k, reason: SEAL_REASON });

    const blocked = this.fxs.blocked();
    for (const u of this.crew) {
      const r = roadOut(u, c.site, blocked, DAMAGE_RADIUS * 0.75);
      if (r) dispatch(u, r.pts, r.segs, u.index * 1.4, 22, "out");
      else dispatch(u, [v3(u.x, 0, u.z), v3(x + 24, 0, z + u.index * 8)], [], u.index * 1.4, 18, "out");
      u.target = v3(x, 0, z);
    }
  }

  private stepCrater(dt: number, k: Crater) {
    k.t += dt;
    if (k.stage !== "rebuilding") return;
    const st = this.fxs.damageState(k.damageId);
    if (!st || st === "restored") this.crater = null;
    else if (k.t > 150) {
      // nobody finished the rebuild (Buildings not mounted?): tidy up ourselves
      this.fxs.removeDamage(k.damageId);
      this.crater = null;
    }
  }

  private setStatus(id: string, status: IncidentStatus) {
    this.fxs.updateIncident(id, { status });
  }
}
