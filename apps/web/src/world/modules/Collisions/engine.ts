// Collision engine: each frame, find overlapping vehicle pairs (physics.overlapping) and decide what
// they are. Fast overlaps are real crashes: both owners' crash() hooks run with an impulse hint in
// object.userData.impulse, an incident is filed, the road closes and events go out. Slow overlaps
// (a queue bunching up, a responder parking in a wreck) only get a separation hint for the owner.
// No React or three.js rendering here: the component calls step() and draws debris via onImpact.
import { emit } from "../../bus";
import { allVehicles, nextId, type VehicleEntry } from "../../registry";
import { addSeparation, beginSeparation, footprint, overlapping, pairMtv, physicsStats, rebuildSpatialIndex } from "../../physics";
import { getEdge, getNode } from "../../roads";
import { useWorld } from "../../store";
import { roadName } from "../DeliveryFleet/planning";
import {
  CROWD_N, CyclistGate, DAMAGE_CLOSING, FADE_MS, HITTERS, SELF_CLEAR_MS, cyclistHitNote, cyclistHits, isCyclistHit, isRivet, launch,
  makeCrowd, newTumble, restPoint, stepCrowd, stepTumble, type CyclistHit,
} from "./cyclist";
import { CrashGate, closingSpeed, crashNote, impulse, isCrash, mass, pairKey, type Body } from "./rules";

export interface CollisionStats {
  overlaps: number; // overlapping pairs this frame (at least one moving)
  slowOverlaps: number; // of which slow (separation hints only)
  crashes: number; // crashes created since start
  suppressed: number; // fast overlaps that the rate limit / active cap turned away (frames)
  refused: number; // fast overlaps where neither vehicle accepted crash()
  queriesPerFrame: number; // obstacleAhead calls last frame
  vehicles: number;
  buildMs: number; // spatial index rebuild
  stepMs: number; // rebuild + overlap pass + crash handling
  lastCrash: string;
  cyclistHits: number; // cyclist hits since start (natural + staged)
  cyclistSuppressed: number; // hits the 60 s rate limit turned away
  lastCyclistHit: string;
}

export type ImpactFx = (x: number, z: number, nx: number, nz: number, strength: number, truck: boolean) => void;

const SEP_RATE = 0.5; // fraction of the penetration to resolve per frame

function edgeOf(key: string) {
  const [a, b] = key.split("|");
  const e = a && b ? getEdge(a, b) : undefined;
  if (!e) return null;
  const na = getNode(e.a);
  const nb = getNode(e.b);
  return { ax: na.x, az: na.z, bx: nb.x, bz: nb.z };
}

export class CollisionEngine {
  readonly stats: CollisionStats = {
    overlaps: 0, slowOverlaps: 0, crashes: 0, suppressed: 0, refused: 0, queriesPerFrame: 0, vehicles: 0, buildMs: 0, stepMs: 0, lastCrash: "",
    cyclistHits: 0, cyclistSuppressed: 0, lastCyclistHit: "",
  };
  readonly cyclistGate = new CyclistGate();
  private stagePending = 0;
  private lastNow = -1;
  private crowdRand = mulberry(0xc1c1e);
  readonly gate = new CrashGate();
  private mine = new Set<string>(); // incident ids we created and that aren't cleared yet
  private done = new Set<string>(); // vehicles crashed this frame
  private A: Body = { x: 0, z: 0, h: 0, speed: 0, stopped: false };
  private B: Body = { x: 0, z: 0, h: 0, speed: 0, stopped: false };

  constructor(private onImpact?: ImpactFx) {}

  /** Rebuild the spatial index (always) and resolve overlaps (unless paused). */
  step(now: number, paused: boolean) {
    const t0 = performance.now();
    rebuildSpatialIndex();
    const s = this.stats;
    s.queriesPerFrame = physicsStats.queriesPerFrame;
    s.vehicles = physicsStats.vehicles;
    s.buildMs = physicsStats.buildMs;
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    if (!paused) {
      this.resolve(now);
      if (this.stagePending > 0) {
        this.stagePending = 0;
        this.stageCyclistHit(now);
      }
      this.stepCyclistHits(now, dt);
    }
    s.suppressed = this.gate.suppressed;
    s.cyclistSuppressed = this.cyclistGate.suppressed;
    s.stepMs = performance.now() - t0;
  }

  private resolve(now: number) {
    beginSeparation();
    this.done.clear();
    const pairs = overlapping();
    const s = this.stats;
    s.overlaps = pairs.length;
    s.slowOverlaps = 0;
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i][0];
      const b = pairs[i][1];
      if (this.done.has(a.id) || this.done.has(b.id)) continue;
      const m = pairMtv(i);
      const nx = m.nx;
      const nz = m.nz;
      const depth = m.depth;
      if (a.kind === "cyclist" || b.kind === "cyclist") {
        // bikes never make car crashes: either it's a cyclist hit or a slow brush (only the car backs off)
        const bikeIsA = a.kind === "cyclist";
        const veh = bikeIsA ? b : a;
        const bike = bikeIsA ? a : b;
        if (veh.kind === "cyclist") continue;
        if (this.tryCyclistHit(veh, bike, now)) continue;
        if (!veh.stopped) {
          const k = depth * SEP_RATE;
          const sgn = bikeIsA ? 1 : -1; // n points a -> b: move the vehicle away from the bike
          addSeparation(veh.id, nx * k * sgn, nz * k * sgn);
        }
        s.slowOverlaps++;
        continue;
      }
      const A = body(a, this.A);
      const B = body(b, this.B);
      if (isCrash(A, B)) {
        const key = pairKey(a.id, b.id);
        if (!this.gate.isDuplicate(key, now) && this.gate.allows(key, now, this.activeCount())) {
          if (this.crash(a, b, A, B, nx, nz, now)) {
            this.gate.commit(key, now);
            continue;
          }
          s.refused++;
        }
      }
      // slow (or not allowed to crash): push apart, lighter / moving one gives way
      s.slowOverlaps++;
      const k = depth * SEP_RATE;
      if (A.stopped) addSeparation(b.id, nx * k, nz * k);
      else if (B.stopped) addSeparation(a.id, -nx * k, -nz * k);
      else {
        const ma = mass(a.kind);
        const mb = mass(b.kind);
        const fa = mb / (ma + mb);
        addSeparation(a.id, -nx * k * fa, -nz * k * fa);
        addSeparation(b.id, nx * k * (1 - fa), nz * k * (1 - fa));
      }
    }
  }

  // --- cyclists ------------------------------------------------------------------------------------

  /** UI request (bus request:cyclist_hit): stage one on the next step, when the index is fresh. */
  requestCyclistHit() {
    this.stagePending++;
  }

  /** Cyclist hits still on the map (not cleared). */
  activeCyclistHits(): number {
    let n = 0;
    for (const h of cyclistHits.values()) if (h.clearedAt === null) n++;
    return n;
  }

  private tryCyclistHit(veh: VehicleEntry, bike: VehicleEntry, now: number): boolean {
    if (!HITTERS.has(veh.kind)) return false;
    const V = body(veh, this.A);
    const C = body(bike, this.B);
    if (!isCyclistHit(V, C)) return false;
    if (!this.cyclistGate.allows(now, this.activeCyclistHits())) return false;
    return this.hitCyclist(veh, bike, C.x, C.z, C.h, closingSpeed(V, C), false, now);
  }

  /**
   * request:cyclist_hit: pick a moving van (Hamyway first) near a cyclist and stage it: the driver doesn't
   * see the cyclist pulling out of the gutter in time. The rider goes down just off the van's nose.
   */
  stageCyclistHit(now: number): boolean {
    if (!this.cyclistGate.allows(now, this.activeCyclistHits(), true)) return false;
    const bikes: VehicleEntry[] = [];
    const cands: { v: VehicleEntry; d: number; bike: VehicleEntry | null; tier: number }[] = [];
    for (const v of allVehicles()) {
      if (v.kind === "cyclist") {
        if (!v.stopped || v.speed > 0) bikes.push(v);
      }
    }
    for (const v of allVehicles()) {
      if (!HITTERS.has(v.kind) || v.stopped || v.speed < 2 || !v.edgeKey || !v.crash) continue;
      const tier = isRivet(v.id) && v.kind === "van" ? 0 : v.kind === "van" ? 1 : isRivet(v.id) ? 2 : 3;
      let best: VehicleEntry | null = null;
      let bd = Infinity;
      for (const b of bikes) {
        const d = Math.hypot(b.object.position.x - v.object.position.x, b.object.position.z - v.object.position.z);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      cands.push({ v, d: bd, bike: best, tier });
    }
    cands.sort((p, q) => p.tier - q.tier || p.d - q.d);
    for (const c of cands.slice(0, 6)) {
      const v = c.v;
      const h = v.object.rotation.y;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const half = typeof v.object.userData.half === "number" ? v.object.userData.half : footprint(v.kind).halfLength;
      // just off the front-left corner, swerving out of the gutter across the van's nose
      const x = v.object.position.x + fx * (half + 0.8) + fz * 0.7;
      const z = v.object.position.z + fz * (half + 0.8) - fx * 0.7;
      if (this.hitCyclist(v, c.bike, x, z, h - 0.5, Math.max(v.speed, 6), true, now)) return true;
    }
    return false;
  }

  /** Knock a cyclist off: rider and bike tumble, the driver stops, incident + closure + events. */
  private hitCyclist(veh: VehicleEntry, bike: VehicleEntry | null, bx: number, bz: number, bh: number, closing: number, staged: boolean, now: number): boolean {
    const h = veh.object.rotation.y;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const sp = veh.stopped ? 0 : veh.speed;
    const damaged = closing >= DAMAGE_CLOSING;
    // the driver stops: cancel their momentum (a slow hit) or most of it (a fast one: it skids and is damaged)
    const keep = damaged ? 0.35 : 0;
    veh.object.userData.impulse = { x: -fx * sp * (1 - keep), z: -fz * sp * (1 - keep) };
    let ok = veh.crash ? veh.crash() : false;
    delete veh.object.userData.impulse;
    if (!ok && staged && veh.crash) ok = veh.crash(); // owners that refuse impulse hints off screen still stop for a staged one
    if (!ok) return false;
    if (bike) {
      bike.object.userData.hitBy = veh.id;
      bike.crash?.();
    }

    const rand = this.crowdRand;
    const throwSp = Math.max(2.5, closing * 0.75);
    const spin = (rand() < 0.5 ? -1 : 1) * (5 + rand() * 4);
    const rider = newTumble();
    launch(rider, bx, bz, bh, h, throwSp, 2.5 + Math.min(3, closing * 0.2), spin, (rand() - 0.5) * 1.5);
    const bk = newTumble();
    launch(bk, bx, bz, bh, h, throwSp * 0.8, 1.6, -spin * 1.3, (rand() - 0.5) * 2.5);
    const rest = restPoint(rider);
    const edge = veh.edgeKey ?? bike?.edgeKey ?? "";
    const e = edge ? edgeOf(edge) : null;
    const roadH = e ? Math.atan2(e.bx - e.ax, e.bz - e.az) : h;
    const note = cyclistHitNote(veh.kind, veh.id, roadName(edge));
    const incidentId = nextId("INC");
    const hit: CyclistHit = {
      incidentId, vehicleId: veh.id, cyclistId: bike?.id ?? "", edgeKey: edge, damaged, x: rest.x, z: rest.z,
      bike: bk, rider, jersey: Math.floor(rand() * 8), carry: null, loaded: false, createdAt: now, clearedAt: null,
      crowd: makeCrowd(rest.x, rest.z, roadH, rand, CROWD_N),
    };
    cyclistHits.set(incidentId, hit);
    const w = useWorld.getState();
    w.addIncident({ id: incidentId, kind: "cyclist_hit", edgeKey: edge, x: rest.x, z: rest.z, status: "active", createdAt: now, note });
    if (edge && !w.blocked[edge]) {
      w.blockEdge(edge, note);
      emit({ type: "road:blocked", edgeKey: edge, reason: note });
    }
    emit({ type: "incident:created", incidentId });
    emit({ type: "vehicle:crashed", vehicleId: veh.id, incidentId });
    this.cyclistGate.commit(now);
    this.done.add(veh.id);
    if (bike) this.done.add(bike.id);
    this.stats.cyclistHits++;
    this.stats.lastCyclistHit = note;
    this.onImpact?.(bx, bz, fx, fz, 0.25, false);
    return true;
  }

  /** Tumbles, crowds, fade-out after clearing, and the no-responder safety net. */
  private stepCyclistHits(now: number, dt: number) {
    if (!cyclistHits.size) return;
    const w = useWorld.getState();
    for (const hit of cyclistHits.values()) {
      stepTumble(hit.bike, dt);
      stepTumble(hit.rider, dt);
      const inc = w.incidents.find((i) => i.id === hit.incidentId);
      if (hit.clearedAt === null && (!inc || inc.status === "cleared")) hit.clearedAt = now;
      if (hit.clearedAt === null && inc && inc.status === "active" && now - hit.createdAt > SELF_CLEAR_MS) {
        // nobody came: clear it ourselves so the demo keeps flowing
        w.updateIncident(hit.incidentId, { status: "cleared" });
        if (hit.edgeKey && w.blocked[hit.edgeKey] === inc.note) {
          w.unblockEdge(hit.edgeKey);
          emit({ type: "road:reopened", edgeKey: hit.edgeKey });
        }
        emit({ type: "incident:cleared", incidentId: hit.incidentId });
        hit.clearedAt = now;
      }
      const age = (now - hit.createdAt) / 1000;
      stepCrowd(hit.crowd, dt, age, hit.clearedAt !== null, hit.x, hit.z);
      if (hit.clearedAt !== null && now - hit.clearedAt > FADE_MS) cyclistHits.delete(hit.incidentId);
    }
  }

  /** Crashes we created that are still on the map. */
  activeCount(): number {
    if (!this.mine.size) return 0;
    const incidents = useWorld.getState().incidents;
    for (const id of this.mine) {
      const inc = incidents.find((x) => x.id === id);
      if (!inc || inc.status === "cleared") this.mine.delete(id);
    }
    return this.mine.size;
  }

  private crash(a: VehicleEntry, b: VehicleEntry, A: Body, B: Body, nx: number, nz: number, now: number): boolean {
    const closing = Math.max(closingSpeed(A, B), A.stopped ? 0 : A.speed, B.stopped ? 0 : B.speed);
    const imp = impulse(A, mass(a.kind), B, mass(b.kind), nx, nz);
    // owners read this in crash(): velocity change in m/s, world x/z
    a.object.userData.impulse = { x: imp.ax, z: imp.az };
    b.object.userData.impulse = { x: imp.bx, z: imp.bz };
    const okA = a.crash ? a.crash() : false;
    const okB = b.crash ? b.crash() : false;
    delete a.object.userData.impulse;
    delete b.object.userData.impulse;
    if (!okA && !okB) return false;
    this.done.add(a.id).add(b.id);

    // the faster one did the hitting
    const [hitter, victim, victimStopped] = (A.stopped ? 0 : A.speed) >= (B.stopped ? 0 : B.speed) ? [a, b, B.stopped] : [b, a, A.stopped];
    const truck = a.kind === "truck" || b.kind === "truck";
    const kind = truck ? "truck_crash" : "car_crash";
    const note = crashNote(hitter.kind, hitter.id, victim.kind, victim.id, closing, victimStopped);
    const x = (A.x + B.x) / 2;
    const z = (A.z + B.z) / 2;
    const edge = (okA ? a.edgeKey : b.edgeKey) ?? a.edgeKey ?? b.edgeKey ?? "";
    const incidentId = nextId("INC");
    const w = useWorld.getState();
    w.addIncident({ id: incidentId, kind, edgeKey: edge, x, z, status: "active", createdAt: now, note });
    if (edge && !w.blocked[edge]) {
      w.blockEdge(edge, note);
      emit({ type: "road:blocked", edgeKey: edge, reason: note });
    }
    emit({ type: "incident:created", incidentId });
    if (okA) emit({ type: "vehicle:crashed", vehicleId: a.id, incidentId });
    if (okB) emit({ type: "vehicle:crashed", vehicleId: b.id, incidentId });
    this.mine.add(incidentId);
    this.stats.crashes++;
    this.stats.lastCrash = note;
    this.onImpact?.(x, z, nx, nz, Math.min(1, closing / 20), truck);
    return true;
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function body(v: VehicleEntry, out: Body): Body {
  out.x = v.object.position.x;
  out.z = v.object.position.z;
  out.h = v.object.rotation.y;
  out.speed = v.speed;
  out.stopped = v.stopped;
  return out;
}
