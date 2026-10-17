// Air traffic: a small fleet flying the arrive -> taxi -> park -> push back -> depart -> leave loop,
// sharing one runway through RunwayLock. Pure logic (no three.js): the renderer reads plane poses.
import { HOLD, RWY, STANDS, TAXI, type CrashSite, type Stand } from "./layout";
import { Path, v3, type V3 } from "./path";
import {
  approachEntry,
  approachPath,
  climbPath,
  doomedPath,
  decisionDistance,
  emergencyApproachPath,
  emergencyRolloutPath,
  goAroundPath,
  lineupPath,
  pushbackPath,
  rolloutPath,
  takeoffRollPath,
  taxiInPath,
  taxiOutPath,
  towPath,
} from "./routes";
import { RunwayLock } from "./runway";

export type Phase =
  | "gone"
  | "approach"
  | "goaround"
  | "rollout"
  | "taxiIn"
  | "parked"
  | "pushback"
  | "taxiOut"
  | "hold"
  | "lineup"
  | "takeoff"
  | "climb"
  | "emergencyRollout"
  | "stopped"
  | "towed"
  | "crashing"
  | "crashed";

export const ON_RUNWAY: ReadonlySet<Phase> = new Set<Phase>(["rollout", "lineup", "takeoff", "emergencyRollout", "stopped"]);
export const AIRBORNE: ReadonlySet<Phase> = new Set<Phase>(["approach", "goaround", "climb", "crashing"]);
const TAXIING: ReadonlySet<Phase> = new Set<Phase>(["taxiIn", "taxiOut"]);
const GROUND_TRAFFIC: ReadonlySet<Phase> = new Set<Phase>(["taxiIn", "taxiOut", "hold", "pushback", "lineup", "towed"]);

export interface FleetEvent {
  type: "touchdown" | "hardTouchdown" | "stopped" | "impact" | "goaround" | "liftoff" | "parked" | "spawn";
  plane: Plane;
}

export interface PlaneSpec {
  callsign: string;
  tail: string;
  body: string;
  cargo: boolean;
}

export const PLANE_SPECS: readonly PlaneSpec[] = [
  { callsign: "RV101", tail: "#1d4ed8", body: "#f6f7f9", cargo: false },
  { callsign: "RV214", tail: "#dc2626", body: "#f6f7f9", cargo: false },
  { callsign: "RV330", tail: "#0f9488", body: "#f6f7f9", cargo: false },
  { callsign: "RV457", tail: "#7c3aed", body: "#f6f7f9", cargo: false },
  { callsign: "RV770", tail: "#ffffff", body: "#ff6a1a", cargo: true },
];

/** A spare airframe kept off the schedule, so a requested crash or emergency always has a plane right away. */
export const SPARE_SPEC: PlaneSpec = { callsign: "RV880", tail: "#13233f", body: "#ff6a1a", cargo: true };

export interface Plane {
  id: number;
  /** Off-schedule airframe used only for incidents. */
  spare: boolean;
  spec: PlaneSpec;
  callsign: string;
  phase: Phase;
  path: Path | null;
  d: number;
  v0: number;
  v1: number;
  reverse: boolean;
  speed: number;
  wait: number;
  stand: Stand | null;
  hasLock: boolean;
  decisionD: number;
  emergency: boolean;
  crashSite: CrashSite | null;
  climbVariant: number;
  pos: V3;
  dir: V3;
  yaw: number;
  pitch: number;
  roll: number;
  /** seconds since the current phase started */
  phaseT: number;
}

const SPAWN_SPACING_S = 30;
const tmpRel = v3(0, 0, 0);

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Fleet {
  readonly planes: Plane[] = [];
  readonly lock = new RunwayLock();
  /** Events raised during the last step(). */
  events: FleetEvent[] = [];
  private time = 0;
  private lastSpawn = -Infinity;

  constructor(
    private rand: () => number = Math.random,
    opts: { count?: number; initial?: boolean } = {},
  ) {
    const count = opts.count ?? PLANE_SPECS.length;
    for (let i = 0; i <= count; i++) {
      const spare = i === count;
      const spec = spare ? SPARE_SPEC : PLANE_SPECS[i % PLANE_SPECS.length];
      this.planes.push({
        id: i,
        spare,
        spec,
        callsign: spec.callsign,
        phase: "gone",
        path: null,
        d: 0,
        v0: 0,
        v1: 0,
        reverse: false,
        speed: 0,
        wait: i * 6,
        stand: null,
        hasLock: false,
        decisionD: 0,
        emergency: false,
        crashSite: null,
        climbVariant: 0,
        pos: v3(0, -50, 0),
        dir: v3(0, 0, 1),
        yaw: 0,
        pitch: 0,
        roll: 0,
        phaseT: 0,
      });
    }
    if (opts.initial ?? true) this.seed();
  }

  /** A lively opening: some planes at the gates, one on approach. */
  private seed() {
    const [a, b, c, d, cargo] = this.planes;
    const park = (p: Plane | undefined, standId: string, wait: number) => {
      if (!p) return;
      const s = STANDS.find((x) => x.id === standId)!;
      if ((s.cargo && !p.spec.cargo) || this.standTaken(s)) return;
      p.stand = s;
      this.setLeg(p, "parked", null, 0, 0);
      p.pos = v3(s.x, 0, -348);
      p.dir = v3(0, 0, 1);
      p.yaw = 0;
      p.wait = wait;
    };
    park(a, "A1", 6);
    park(c, "A3", 24);
    park(cargo, "C1", 40);
    if (b) {
      this.spawnArrival(b);
      b.d = b.path!.length * 0.35;
    }
    if (d) d.wait = 22;
  }

  private standTaken(s: Stand) {
    return this.planes.some((p) => p.stand === s);
  }

  private freeStand(p: Plane, any = false): Stand | null {
    const pool = STANDS.filter((s) => (any || s.cargo === p.spec.cargo) && !this.standTaken(s));
    if (!pool.length) return null;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  private setLeg(p: Plane, phase: Phase, path: Path | null, v0: number, v1: number, reverse = false) {
    p.phase = phase;
    p.path = path;
    p.d = 0;
    p.v0 = v0;
    p.v1 = v1;
    p.reverse = reverse;
    p.phaseT = 0;
    if (path) p.speed = Math.max(v0, 0);
  }

  private emit(type: FleetEvent["type"], plane: Plane) {
    this.events.push({ type, plane });
  }

  private spawnArrival(p: Plane, emergency = false): boolean {
    // an emergency lands regardless; it gets a stand when it is towed off
    const stand = this.freeStand(p);
    if (!stand && !emergency) return false;
    p.stand = stand;
    p.emergency = emergency;
    p.crashSite = null;
    p.hasLock = false;
    p.callsign = emergency ? "RV212" : p.spec.cargo ? p.spec.callsign : `RV${100 + Math.floor(this.rand() * 880)}`;
    const entry = approachEntry(this.rand);
    const path = emergency ? emergencyApproachPath(v3(-1500, 120, RWY.z + 160)) : approachPath(entry);
    this.setLeg(p, "approach", path, emergency ? 58 : 64, emergency ? 42 : 34);
    p.decisionD = decisionDistance(path);
    p.climbVariant = Math.floor(this.rand() * 3);
    this.lastSpawn = this.time;
    this.emit("spawn", p);
    return true;
  }

  /** Seconds until the nearest arrival reaches its decision point (Infinity if none). */
  private inboundSeconds() {
    let best = Infinity;
    for (const p of this.planes) {
      if (p.phase !== "approach" || p.hasLock) continue;
      best = Math.min(best, (p.decisionD - p.d) / Math.max(p.speed, 1));
    }
    return best;
  }

  /** Is another ground plane sitting on the next stretch of this plane's own route? */
  private blockedAhead(p: Plane) {
    const path = p.path!;
    for (const q of this.planes) {
      if (q === p || !GROUND_TRAFFIC.has(q.phase)) continue;
      if (Math.abs(q.pos.x - p.pos.x) > 50 || Math.abs(q.pos.z - p.pos.z) > 50) continue;
      // only what is in front of us (two planes that overlap never block each other both ways)
      if ((q.pos.x - p.pos.x) * p.dir.x + (q.pos.z - p.pos.z) * p.dir.z <= 0) continue;
      for (let k = 6; k <= 30; k += 6) {
        if (p.d + k > path.length + 6) break;
        path.sample(p.d + k, tmpRel);
        if (Math.hypot(q.pos.x - tmpRel.x, q.pos.z - tmpRel.z) < 15) return true;
      }
    }
    return false;
  }

  /** Is the taxiway clear enough to push back from this stand? */
  private canPushBack(p: Plane) {
    const sx = p.stand!.x;
    if (this.lock.closed) return false;
    let queued = 0;
    for (const q of this.planes) if (q.phase === "taxiOut" || q.phase === "hold") queued++;
    if (queued >= 2) return false;
    for (const q of this.planes) {
      if (q === p) continue;
      if (q.phase === "pushback") return false;
      if (!GROUND_TRAFFIC.has(q.phase)) continue;
      // traffic coming west along the taxiway, or still close by
      if (Math.abs(q.pos.z - TAXI.z) < 14 && q.pos.x > sx - 35 && q.pos.x < sx + 110) return false;
    }
    return true;
  }

  step(dt: number) {
    this.events = [];
    this.time += dt;
    for (const p of this.planes) this.stepPlane(p, dt);
  }

  private stepPlane(p: Plane, dt: number) {
    p.phaseT += dt;
    switch (p.phase) {
      case "gone":
        if (p.spare) return;
        p.wait -= dt;
        if (p.wait <= 0) {
          if (this.lock.closed || this.time - this.lastSpawn < SPAWN_SPACING_S || !this.spawnArrival(p)) p.wait = 3;
        }
        return;
      case "parked":
        p.wait -= dt;
        if (p.wait <= 0 && this.canPushBack(p)) {
          p.emergency = false;
          this.setLeg(p, "pushback", pushbackPath(p.stand!), 1.8, 1.8, true);
        }
        return;
      case "hold":
        if (this.lock.tryDeparture(p.id, this.inboundSeconds())) {
          p.hasLock = true;
          this.setLeg(p, "lineup", lineupPath(), 3, 4);
        }
        return;
      case "stopped":
      case "crashed":
        return;
    }
    this.advance(p, dt);
  }

  private advance(p: Plane, dt: number) {
    const path = p.path!;
    const f = Math.min(1, p.d / path.length);
    const target = Math.max(Math.sqrt(Math.max(0, p.v0 * p.v0 + (p.v1 * p.v1 - p.v0 * p.v0) * f)), 1.2);
    if (TAXIING.has(p.phase)) {
      if (this.blockedAhead(p)) p.speed = Math.max(0, p.speed - 9 * dt);
      else p.speed = Math.min(target, p.speed + 3 * dt);
    } else p.speed = target;
    p.d += p.speed * dt;

    // decision point on approach
    if (p.phase === "approach" && !p.hasLock && p.d >= p.decisionD) {
      if (p.emergency) {
        this.lock.force(p.id);
        p.hasLock = true;
      } else if (this.lock.tryArrival(p.id)) p.hasLock = true;
      else {
        this.updatePose(p, dt);
        p.stand = null;
        this.emit("goaround", p);
        this.setLeg(p, "goaround", goAroundPath({ ...p.pos }, p.dir), p.speed, 70);
        return;
      }
    }

    if (p.d >= path.length) {
      p.d = path.length;
      this.updatePose(p, dt);
      this.finishLeg(p);
      return;
    }
    this.updatePose(p, dt);
  }

  private finishLeg(p: Plane) {
    switch (p.phase) {
      case "approach":
        if (p.emergency) {
          this.emit("hardTouchdown", p);
          this.setLeg(p, "emergencyRollout", emergencyRolloutPath(), 38, 0);
        } else {
          this.emit("touchdown", p);
          this.setLeg(p, "rollout", rolloutPath(), 34, 6);
        }
        return;
      case "rollout":
        this.lock.release(p.id);
        p.hasLock = false;
        this.setLeg(p, "taxiIn", taxiInPath(p.stand!), 6, 2.5);
        return;
      case "taxiIn":
      case "towed":
        this.setLeg(p, "parked", null, 0, 0);
        p.speed = 0;
        p.wait = p.phase === "towed" || p.emergency ? 45 : 10 + this.rand() * 6;
        this.emit("parked", p);
        return;
      case "pushback": {
        const s = p.stand!;
        p.stand = null;
        this.setLeg(p, "taxiOut", taxiOutPath(s), 5, 2);
        return;
      }
      case "taxiOut":
        this.setLeg(p, "hold", null, 0, 0);
        p.speed = 0;
        p.pos.x = HOLD.x;
        p.pos.z = HOLD.z;
        return;
      case "lineup":
        this.setLeg(p, "takeoff", takeoffRollPath(), 4, 34);
        return;
      case "takeoff":
        this.emit("liftoff", p);
        this.lock.release(p.id);
        p.hasLock = false;
        this.setLeg(p, "climb", climbPath(p.climbVariant), 34, 72);
        return;
      case "climb":
      case "goaround":
        this.setLeg(p, "gone", null, 0, 0);
        p.wait = 6 + this.rand() * 10;
        p.pos.y = -50;
        return;
      case "emergencyRollout":
        this.setLeg(p, "stopped", null, 0, 0);
        p.speed = 0;
        this.emit("stopped", p);
        return;
      case "crashing":
        this.setLeg(p, "crashed", null, 0, 0);
        p.speed = 0;
        p.pos.y = 0;
        this.emit("impact", p);
        return;
    }
  }

  private updatePose(p: Plane, dt: number) {
    const path = p.path!;
    path.sample(p.d, p.pos);
    path.tangent(p.d, p.dir);
    let yaw = Math.atan2(p.dir.x, p.dir.z);
    if (p.reverse) yaw = wrapAngle(yaw + Math.PI);
    const yawRate = dt > 0 ? wrapAngle(yaw - p.yaw) / dt : 0;
    p.yaw = yaw;
    const climb = Math.asin(Math.max(-1, Math.min(1, p.dir.y)));
    let pitch = 0;
    let roll = 0;
    switch (p.phase) {
      case "approach":
        pitch = climb + 0.05 + (p.pos.y < 6 ? ((6 - p.pos.y) / 6) * 0.09 : 0);
        roll = -yawRate * 1.8;
        break;
      case "goaround":
      case "climb":
        pitch = climb + 0.12;
        roll = -yawRate * 1.8;
        break;
      case "takeoff":
        pitch = p.path!.length - p.d < 18 ? ((18 - (p.path!.length - p.d)) / 18) * 0.12 : 0;
        break;
      case "crashing":
        pitch = climb * 0.8;
        roll = -yawRate * 2 + Math.sin(this.time * 3.1) * 0.12;
        break;
      case "rollout":
      case "emergencyRollout":
        pitch = p.phaseT < 1.5 ? 0.1 * (1 - p.phaseT / 1.5) : 0;
        break;
    }
    const k = Math.min(1, dt * 3);
    p.pitch += (pitch - p.pitch) * k;
    p.roll += (Math.max(-0.6, Math.min(0.6, roll)) - p.roll) * k;
  }

  // --- Emergencies --------------------------------------------------------------

  /** Pick an inbound plane, declare an emergency and close the runway. Null if nobody is available yet. */
  declareEmergency(): Plane | null {
    // scheduled planes first (passenger before cargo), the spare airframe last
    const gone = this.planes
      .filter((p) => p.phase === "gone" && !p.crashSite)
      .sort((a, b) => Number(a.spare) - Number(b.spare) || Number(a.spec.cargo) - Number(b.spec.cargo));
    for (const p of gone) {
      if (this.spawnArrival(p, true)) {
        this.lock.closed = true;
        return p;
      }
    }
    for (const p of this.planes) {
      if (p.phase !== "approach" || p.hasLock || p.emergency || p.pos.x > -1300) continue;
      p.emergency = true;
      p.callsign = "RV212";
      this.setLeg(p, "approach", emergencyApproachPath({ ...p.pos }), Math.max(p.speed, 50), 42);
      p.decisionD = decisionDistance(p.path!);
      this.lock.closed = true;
      return p;
    }
    return null;
  }

  /** The emergency plane is clear to be towed off the runway to its stand. */
  startTow(p: Plane): boolean {
    if (p.phase !== "stopped") return false;
    p.stand ??= this.freeStand(p, true);
    if (!p.stand) return false;
    this.setLeg(p, "towed", towPath(p.stand), 4.5, 3);
    return true;
  }

  /** Runway open again (incident cleared). Releases a lock still held by the emergency plane. */
  reopenRunway() {
    this.lock.closed = false;
    for (const p of this.planes)
      if (p.hasLock && (p.phase === "towed" || p.phase === "parked")) {
        this.lock.release(p.id);
        p.hasLock = false;
      }
    if (this.lock.holder !== null) {
      const h = this.planes.find((p) => p.id === this.lock.holder);
      if (!h || !ON_RUNWAY.has(h.phase)) this.lock.holder = null;
    }
  }

  /** A plane loses power and comes down at `site`. Null if nobody is available yet. */
  declareCrash(site: CrashSite): Plane | null {
    const pick = this.planes.find((p) => p.spare && p.phase === "gone") ?? null;
    if (!pick) return null;
    const path = doomedPath(site);
    path.sample(0, pick.pos);
    path.tangent(0, pick.dir);
    pick.yaw = Math.atan2(pick.dir.x, pick.dir.z);
    this.setLeg(pick, "crashing", path, 50, 62);
    pick.callsign = pick.spec.callsign;
    pick.stand = null;
    pick.hasLock = false;
    pick.emergency = false;
    pick.crashSite = site;
    return pick;
  }

  /** Wreck cleared: the airframe returns to the pool after a while. */
  releaseCrashed(p: Plane) {
    if (p.phase !== "crashed") return;
    p.crashSite = null;
    this.setLeg(p, "gone", null, 0, 0);
    p.wait = 40;
    p.pos.y = -50;
  }

  onRunway() {
    let n = 0;
    for (const p of this.planes) if (ON_RUNWAY.has(p.phase)) n++;
    return n;
  }
}
