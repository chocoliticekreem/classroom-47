// Hamyway fleet simulation: vans and HGVs loading at the depot, driving delivery rounds, rerouting
// around closures, breaking down and crashing. Per-frame state lives here (mutable, no React),
// the store only hears about status changes.
import { Group } from "three";
import { emit, on, type WorldEvent } from "../../bus";
import { nextId, registerVehicle, vehiclesAhead, type VehicleEntry } from "../../registry";
import { findPath, getEdge, getNode, PLACES } from "../../roads";
import { hasSignal, signalFor } from "../../signals";
import { blockedSet, useWorld, type Delivery } from "../../store";
import { BAYS, etaSeconds, makeIdGen, pickBreakdownVictim, planStops, roadName, type Bay } from "./planning";
import { Lookahead, type ObstacleFn } from "./lookahead";
import { buildRoute, firstBlockedEdge, kerbPose, newSample, sampleRoute, type Pose, type Route, type RouteSample } from "./route";

export type VanKind = "van" | "truck";
export type Phase = "loading" | "driving" | "dropping" | "waiting" | "broken" | "crashed" | "towing";
export type LabelStatus = "loading" | "en_route" | "delayed" | "returning" | "delivering" | "broken";

export interface Parcel {
  id: string;
  stop: string;
  delayed: boolean;
  reason: string;
  written: Delivery["status"] | null; // last status sent to the store
  writtenTruck: string;
}

export interface Drop {
  x: number;
  z: number;
  sx: number; // start (van rear)
  sz: number;
  born: number; // sim ms
}

export interface Van {
  id: string;
  kind: VanKind;
  index: number; // instance slot for rendering
  bay: Bay;
  group: Group;
  entry: VehicleEntry;
  unregister: () => void;
  look: Lookahead;
  phase: Phase;
  phaseStart: number; // sim ms
  phaseDur: number; // ms (loading)
  parcels: Parcel[]; // on board, in visit order
  loadCount: number;
  route: Route | null;
  leg: "stop" | "depot";
  d: number;
  speed: number;
  sample: RouteSample;
  kerb: { prev: string; stop: string; along: number; pose: Pose } | null;
  dropDone: boolean;
  delayedThisLeg: boolean;
  stuckMs: number;
  rerouteDirty: boolean;
  forceReroute: boolean;
  lastRerouteTry: number;
  waitNoted: boolean;
  // pose (sim) and display (smoothed)
  x: number;
  z: number;
  heading: number;
  dx: number;
  dz: number;
  dh: number;
  roll: number;
  pitch: number;
  lift: number;
  scale: number;
  braking: boolean;
  hazard: boolean;
  crashVx: number;
  crashVz: number;
  crashYaw: number;
  crashT: number;
  incidentId: string | null;
  incidentKey: string | null;
  incidentNote: string;
  troubleAt: number; // sim ms when it broke down / crashed
  towStart: number;
  label: LabelStatus;
  labelDirty: boolean;
}

const VAN_COUNT = 10;
const TRUCK_COUNT = 4;
export const MAX_VEHICLES = 16;
export const LOAD_MS = 4000;
const DROP_MS = 2200;
export const DROP_POP_MS = 450;
const TOW_MS = 2600;
const ACCEL = 3;
const DECEL = 7;
const GAP = 9; // metres between my centre and the leader's centre when queued
const STUCK_MS = 10000;
const SELF_CLEAR_MS = 60000; // breakdowns nobody responds to get cleared by us
const CRASH_GIVEUP_MS = 120000;
export const KERB_SIDE = 2.2;

// Heavy stops for HGVs (farms, docks, edge of town) mixed with the normal pool.
const TRUCK_POOL = ["farm_n", "farm_s", "dock_n", "g_3_3", "g_-3_1", "g_2_-1", "sub_-1_1", "sub_1_1"];

export const VEHICLE_DIMS: Record<VanKind, { len: number; height: number; halfWidth: number }> = {
  van: { len: 5.4, height: 2.3, halfWidth: 1.05 },
  truck: { len: 8.6, height: 3.5, halfWidth: 1.3 },
};
/** Braking rate the speed profile plans with (see drive()); also sizes the look-ahead ray. */
const PLAN_DECEL = 4.5;
/** Radius around a junction node inside which a vehicle counts as "in the junction" (we yield). */
const JUNCTION_R = 10;

export class FleetSim {
  vans = new Map<string, Van>();
  drops: Drop[] = [];
  flashes: Drop[] = [];
  now = 0; // sim clock (ms), only advances while unpaused
  private nextDelivery = makeIdGen("DL-", 1001);
  private nextVan = makeIdGen("V-", 1, 2);
  private nextTruck = makeIdGen("T-", 1, 2);
  private freeIndices: number[] = [];
  private blockedDirty = false;
  private offs: (() => void)[] = [];
  private rand: () => number;
  /** Called when the vehicle list changes (spawn/remove), so React can re-render labels. */
  onListChange: () => void = () => {};
  /** On-screen test (the renderer sets a camera frustum check); off-screen vans raycast every 4th frame. */
  sees: (x: number, z: number) => boolean = () => true;
  private obstacleFn: ObstacleFn | undefined;

  constructor(rand: () => number = Math.random, opts: { obstacleFn?: ObstacleFn } = {}) {
    this.rand = rand;
    this.obstacleFn = opts.obstacleFn;
    for (let i = MAX_VEHICLES - 1; i >= 0; i--) this.freeIndices.push(i);
  }

  start() {
    // Truck bays at the far end of the south row, vans in the rest.
    const truckBays = BAYS.filter((b) => b.row === "south").slice(0, TRUCK_COUNT);
    const vanBays = BAYS.filter((b) => !truckBays.includes(b));
    const order: Van[] = [];
    for (let i = 0; i < VAN_COUNT; i++) order.push(this.spawn("van", this.nextVan(), vanBays[i], []));
    for (let i = 0; i < TRUCK_COUNT; i++) order.push(this.spawn("truck", this.nextTruck(), truckBays[i], []));
    // Stagger departures; warm-start about half the fleet already out on its round so the city is busy at once.
    order.sort(() => this.rand() - 0.5);
    order.forEach((v, i) => {
      if (i % 2 === 0) {
        this.depart(v);
        if (v.phase === "driving" && v.route) {
          v.d = v.route.length * (0.15 + this.rand() * 0.6);
          this.snapDisplay(v);
        }
      } else {
        v.phaseDur = LOAD_MS + i * 1700;
      }
    });
    this.offs.push(on((e) => this.onEvent(e)));
    this.offs.push(useWorld.subscribe((s, p) => {
      if (s.blocked !== p.blocked) this.blockedDirty = true;
    }));
    this.onListChange();
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    for (const v of this.vans.values()) v.unregister();
    this.vans.clear();
  }

  // --- lifecycle ---------------------------------------------------------------

  private spawn(kind: VanKind, id: string, bay: Bay, carry: Parcel[]): Van {
    const group = new Group();
    group.name = id;
    group.userData.vehicleId = id;
    const index = this.freeIndices.pop() ?? 0;
    const entry: VehicleEntry = { id, kind, object: group, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: true };
    const dims = VEHICLE_DIMS[kind];
    const look = new Lookahead({ halfLength: dims.len / 2, halfWidth: dims.halfWidth, decel: PLAN_DECEL }, this.obstacleFn, index);
    const v: Van = {
      id, kind, index, bay, group, entry, unregister: () => {}, look,
      phase: "loading", phaseStart: this.now, phaseDur: LOAD_MS,
      parcels: carry, loadCount: 0, route: null, leg: "stop", d: 0, speed: 0, sample: newSample(),
      kerb: null, dropDone: false, delayedThisLeg: false, stuckMs: 0, rerouteDirty: false, forceReroute: false, lastRerouteTry: -1e9, waitNoted: false,
      x: bay.pose.x, z: bay.pose.z, heading: bay.pose.heading, dx: bay.pose.x, dz: bay.pose.z, dh: bay.pose.heading,
      roll: 0, pitch: 0, lift: 0, scale: 1, braking: false, hazard: false,
      crashVx: 0, crashVz: 0, crashYaw: 0, crashT: 0,
      incidentId: null, incidentKey: null, incidentNote: "", troubleAt: 0, towStart: 0,
      label: "loading", labelDirty: true,
    };
    entry.crash = () => this.crash(v);
    group.position.set(v.x, 0, v.z);
    group.rotation.y = v.heading;
    v.unregister = registerVehicle(entry);
    this.vans.set(id, v);
    this.startLoading(v);
    return v;
  }

  private startLoading(v: Van) {
    v.phase = "loading";
    v.phaseStart = this.now;
    v.phaseDur = LOAD_MS;
    v.route = null;
    v.kerb = null;
    v.speed = 0;
    v.hazard = false;
    v.x = v.bay.pose.x;
    v.z = v.bay.pose.z;
    v.heading = v.bay.pose.heading;
    this.offLane(v);
    if (!v.parcels.length) {
      const n = v.kind === "truck" ? 3 + Math.floor(this.rand() * 2) : 3 + Math.floor(this.rand() * 3);
      const stops = v.kind === "truck" ? planStops(n, this.rand, TRUCK_POOL) : planStops(n, this.rand);
      v.parcels = stops.map((stop) => ({ id: this.nextDelivery(), stop, delayed: false, reason: "", written: null, writtenTruck: "" }));
    }
    v.loadCount = v.parcels.length;
    for (let i = 0; i < v.parcels.length; i++) this.write(v, v.parcels[i], "loading", i);
    this.setLabel(v);
  }

  /** Leave the bay (or the kerb) for the next stop, or head home when empty. */
  private depart(v: Van) {
    v.leg = v.parcels.length ? "stop" : "depot";
    const blocked = blockedSet();
    let route: Route | null;
    if (v.kerb) route = this.buildLeg(v, [v.kerb.prev, v.kerb.stop], v.kerb.along + 5, v.kerb.pose, blocked);
    else route = this.buildLeg(v, [v.bay.entry, v.bay.exit], v.bay.along + 8, v.bay.pose, blocked);
    if (!route) {
      v.phase = "waiting";
      v.phaseStart = this.now;
      if (!v.waitNoted && v.parcels.length) {
        v.waitNoted = true;
        this.markDelayed(v, `Hamyway City ${v.kind} ${v.id} has no open route to ${v.parcels[0].stop}`);
      }
      this.setLabel(v);
      return;
    }
    v.waitNoted = false;
    v.route = route;
    v.d = 0;
    v.sample.seg = 0;
    v.speed = 0;
    v.phase = "driving";
    v.phaseStart = this.now;
    v.delayedThisLeg = false;
    v.stuckMs = 0;
    v.entry.stopped = false;
    for (let i = 0; i < v.parcels.length; i++) this.write(v, v.parcels[i], "en_route", i);
    this.setLabel(v);
  }

  /**
   * Route along `prefix` (the lane we're on / leaving) then the shortest open path to the leg target,
   * ending pulled over at the kerb (stop) or in the bay (depot).
   */
  private buildLeg(v: Van, prefix: string[], startAlong: number, startPose: Pose | undefined, blocked: Set<string>): Route | null {
    const target = v.leg === "stop" ? v.parcels[0].stop : v.bay.entry;
    const last = prefix[prefix.length - 1];
    const path = findPath(last, target, blocked);
    if (!path) return null;
    const nodes = [...prefix, ...path.slice(1)];
    if (v.leg === "depot") {
      if (nodes[nodes.length - 2] === v.bay.exit) nodes.pop(); // already on the yard lane the right way
      else nodes.push(v.bay.exit);
    }
    const a = nodes[nodes.length - 2];
    const b = nodes[nodes.length - 1];
    const lastLen = getEdge(a, b)!.length;
    let endAlong: number;
    let endPose: Pose;
    if (v.leg === "stop") {
      const kerbAlong = Math.max(lastLen - 16, lastLen * 0.55);
      endAlong = kerbAlong - 8;
      endPose = kerbPose(a, b, kerbAlong, KERB_SIDE);
    } else {
      endAlong = Math.max(7, v.bay.along - 9);
      endPose = v.bay.pose;
    }
    // Already past the pull-over point on a single-edge leg: nothing sensible to build.
    if (nodes.length === 2 && endAlong < startAlong - 0.5 && !startPose) return null;
    try {
      return buildRoute(nodes, { startAlong, startPose, endAlong, endPose });
    } catch {
      return null;
    }
  }

  // --- per frame -----------------------------------------------------------------

  update(dt: number, wallNow: number) {
    this.now += dt * 1000;
    const recheck = this.blockedDirty;
    this.blockedDirty = false;
    for (const v of this.vans.values()) {
      if (recheck) v.rerouteDirty = true;
      switch (v.phase) {
        case "loading":
          if (this.now - v.phaseStart >= v.phaseDur) this.depart(v);
          break;
        case "waiting":
          if (this.now - v.phaseStart >= 2000) this.depart(v);
          break;
        case "driving":
          this.drive(v, dt, wallNow);
          break;
        case "dropping":
          this.dropping(v);
          break;
        case "crashed":
          this.crashing(v, dt);
          break;
        case "broken":
          this.brokenDown(v);
          break;
        case "towing":
          this.towing(v);
          break;
      }
      this.smooth(v, dt);
    }
  }

  private drive(v: Van, dt: number, wallNow: number) {
    const r = v.route!;
    const s = sampleRoute(r, v.d, v.sample);
    const seg = r.segs[s.seg];
    const e = v.entry;
    let len = 1;
    if (s.edge >= 0) {
      e.from = r.nodes[s.edge];
      e.to = r.nodes[s.edge + 1];
      e.edgeKey = r.edgeKeys[s.edge];
      e.t = s.t;
      len = r.edgeLens[s.edge];
    } else this.offLane(v);

    // Re-plan when the road ahead closes (or we've been stuck a while). Only on straights.
    if ((v.rerouteDirty || v.forceReroute) && seg.kind === "line" && s.edge >= 0) this.maybeReroute(v);
    const route = v.route!;
    if (route !== r) sampleRoute(route, v.d, v.sample);

    let stopAt = route.length;
    if (s.edge >= 0 && seg.kind === "line" && route === r) {
      const k = s.edge + 1;
      // never turn onto a closed road: re-plan, and hold at the stop line if there's no way round
      if (k < route.nodes.length - 1 && useWorld.getState().blocked[route.edgeKeys[k]] !== undefined) {
        if (this.now - v.lastRerouteTry > 1000) v.rerouteDirty = true;
        stopAt = Math.min(stopAt, route.stopLine[k] - 0.3);
      }
      // traffic lights at the next junction
      if (k < route.nodes.length - 1 && hasSignal(route.nodes[k])) {
        const sl = route.stopLine[k];
        const col = signalFor(route.nodes[k], route.nodes[k - 1], wallNow);
        const toLine = sl - v.d;
        if (toLine > -0.2) {
          if (col === "red" || (col === "amber" && toLine > (v.speed * v.speed) / (2 * 5) + 0.5)) stopAt = Math.min(stopAt, sl - 0.3);
        }
      }
      // keep a gap to whoever is ahead on this lane, or just round the next corner
      const ahead = vehiclesAhead(e.from!, e.to!, s.t, v.id);
      if (ahead.length) stopAt = Math.min(stopAt, v.d + (ahead[0].t - s.t) * len - GAP);
      else if (k < route.nodes.length - 1 && (1 - s.t) * len < 25) {
        const next = vehiclesAhead(route.nodes[k], route.nodes[k + 1], -1, v.id);
        if (next.length) stopAt = Math.min(stopAt, v.d + (1 - s.t) * len + next[0].t * route.edgeLens[k] - GAP);
      }
    }

    // look-ahead raycast: brake for anything in front (not just our lane's queue); take the more cautious
    const look = v.look;
    look.scan(v.id, v.x, v.z, v.heading, v.speed, dt, this.sees(v.x, v.z));
    if (look.hitId) {
      let lim = v.d + look.room;
      // something sitting in the junction we're about to enter: give way at the stop line
      if (s.edge >= 0 && route === r) {
        const k = s.edge + 1;
        const sl = route.stopLine[k] - 0.3;
        if (k < route.nodes.length - 1 && v.d < sl) {
          const n = getNode(route.nodes[k]);
          if (look.hitInJunction(n.x, n.z, JUNCTION_R)) lim = Math.min(lim, sl);
        }
      }
      stopAt = Math.min(stopAt, lim);
    }

    // speed target: edge limit, slower for corners ahead, and able to stop at stopAt
    const factor = v.kind === "truck" ? 0.72 : 0.88;
    const edgeLimit = s.edge >= 0 ? getEdge(route.nodes[s.edge], route.nodes[s.edge + 1])!.speedLimit * factor : 4;
    const curSeg = route.segs[v.sample.seg];
    let vmax = Math.min(edgeLimit, curSeg.vmax);
    const nextSeg = route.segs[v.sample.seg + 1];
    if (nextSeg && nextSeg.vmax < vmax) vmax = Math.min(vmax, Math.sqrt(nextSeg.vmax ** 2 + 2 * 3 * Math.max(0, nextSeg.start - v.d)));
    const room = stopAt - v.d;
    const target = Math.min(vmax, room > 0 ? Math.sqrt(2 * PLAN_DECEL * room) : 0);
    const prev = v.speed;
    v.speed = target > v.speed ? Math.min(target, v.speed + ACCEL * dt) : Math.max(target, v.speed - DECEL * dt);
    v.braking = v.speed < prev - 0.01 || v.speed < 0.2;
    const before = v.d;
    v.d = Math.min(v.d + v.speed * dt, Math.max(before, stopAt), route.length);
    e.speed = v.speed;
    e.stopped = v.speed < 0.2;

    sampleRoute(route, v.d, v.sample);
    v.x = v.sample.x;
    v.z = v.sample.z;
    v.heading = v.sample.heading;

    // stuck?
    if (v.speed < 0.4) v.stuckMs += dt * 1000;
    else v.stuckMs = 0;
    if (v.stuckMs > STUCK_MS) {
      v.stuckMs = 0;
      v.forceReroute = true;
      if (!v.delayedThisLeg && v.parcels.length) {
        v.delayedThisLeg = true;
        const where = s.edge >= 0 ? roadName(route.edgeKeys[s.edge]) : "the depot yard";
        this.markDelayed(v, `Hamyway City ${v.kind} ${v.id} stuck in traffic on ${where}`);
      }
    }

    if (v.d >= route.length - 0.05) this.arrive(v);
  }

  private maybeReroute(v: Van) {
    const r = v.route!;
    const s = v.sample;
    const forced = v.forceReroute;
    v.rerouteDirty = false;
    v.forceReroute = false;
    v.lastRerouteTry = this.now;
    const blocked = blockedSet();
    const i = s.edge;
    const from = r.nodes[i];
    const to = r.nodes[i + 1];
    const len = r.edgeLens[i];
    const along = s.t * len;
    const curKey = r.edgeKeys[i];
    let cause: string | null = null;
    let prefix = [from, to];
    let startAlong = along;
    if (blocked.has(curKey)) {
      cause = curKey;
      // Is the closure still ahead of us on this road? Then turn around.
      const inc = useWorld.getState().incidents.find((x) => x.edgeKey === curKey && x.status !== "cleared");
      let tInc = 0.5;
      if (inc) {
        const a = getNode(from);
        const b = getNode(to);
        tInc = ((inc.x - a.x) * (b.x - a.x) + (inc.z - a.z) * (b.z - a.z)) / (len * len);
      }
      if (tInc > s.t - 0.02) {
        prefix = [to, from];
        startAlong = len - along;
      }
    } else {
      cause = firstBlockedEdge(r, i + 1, blocked);
      if (!cause && !forced) return;
      // don't re-plan a stuck van on its final edge: it's about to pull over anyway
      if (!cause && i === r.edgeKeys.length - 1) return;
    }
    const route = this.buildLeg(v, prefix, startAlong, undefined, blocked);
    if (!route) return;
    v.route = route;
    v.d = 0;
    v.sample.seg = 0;
    if (prefix[0] === to) v.speed = Math.min(v.speed, 2); // U-turn
    if (cause) this.markDelayed(v, this.reasonFor(v, cause));
  }

  private reasonFor(v: Van, key: string) {
    const st = useWorld.getState();
    const inc = st.incidents.find((x) => x.edgeKey === key && x.status !== "cleared");
    const why = inc?.note || st.blocked[key] || `road closed on ${roadName(key)}`;
    return `Hamyway City ${v.kind} ${v.id} rerouted: ${why}`;
  }

  private arrive(v: Van) {
    const r = v.route!;
    v.speed = 0;
    v.entry.speed = 0;
    v.entry.stopped = true;
    this.offLane(v);
    if (v.leg === "depot") {
      this.startLoading(v);
      return;
    }
    const a = r.nodes[r.nodes.length - 2];
    const b = r.nodes[r.nodes.length - 1];
    const lastLen = r.edgeLens[r.edgeLens.length - 1];
    const along = Math.max(lastLen - 16, lastLen * 0.55);
    v.kerb = { prev: a, stop: b, along, pose: kerbPose(a, b, along, KERB_SIDE) };
    v.phase = "dropping";
    v.phaseStart = this.now;
    v.dropDone = false;
    v.label = "delivering";
    v.labelDirty = true;
  }

  private dropping(v: Van) {
    const t = this.now - v.phaseStart;
    if (!v.dropDone && t >= 250) {
      v.dropDone = true;
      const p = v.parcels.shift();
      if (p) {
        const fx = Math.sin(v.heading);
        const fz = Math.cos(v.heading);
        const lx = Math.cos(v.heading);
        const lz = -Math.sin(v.heading);
        const half = VEHICLE_DIMS[v.kind].len / 2;
        const drop: Drop = {
          sx: v.x - fx * (half - 0.4),
          sz: v.z - fz * (half - 0.4),
          x: v.x - fx * (half - 1.2) + lx * 2.3,
          z: v.z - fz * (half - 1.2) + lz * 2.3,
          born: this.now,
        };
        this.drops.push(drop);
        if (this.drops.length > 40) this.drops.shift();
        this.flashes.push({ ...drop, born: this.now + DROP_POP_MS });
        if (this.flashes.length > 12) this.flashes.shift();
        this.write(v, p, "delivered", 0);
        emit({ type: "delivery:completed", deliveryId: p.id });
        for (let i = 0; i < v.parcels.length; i++) this.write(v, v.parcels[i], "en_route", i);
      }
      this.setLabel(v);
    }
    if (t >= DROP_MS) this.depart(v);
  }

  // --- trouble -----------------------------------------------------------------

  private crash(v: Van): boolean {
    if (v.phase !== "driving" && v.phase !== "dropping" && v.phase !== "waiting") return false;
    const sp = Math.max(v.speed, 6);
    v.crashVx = Math.sin(v.heading) * sp;
    v.crashVz = Math.cos(v.heading) * sp;
    v.crashYaw = (this.rand() < 0.5 ? -1 : 1) * (1.8 + this.rand() * 1.4);
    v.crashT = 0;
    v.phase = "crashed";
    v.troubleAt = this.now;
    v.speed = 0;
    v.hazard = true;
    v.entry.speed = 0;
    v.entry.stopped = true;
    const key = v.entry.edgeKey;
    this.markDelayed(v, `Hamyway City ${v.kind} ${v.id} crashed${key ? ` on ${roadName(key)}` : ""}`);
    this.setLabel(v);
    return true;
  }

  private crashing(v: Van, dt: number) {
    if (v.crashT < 0.9) {
      const k = 1 - v.crashT / 0.9;
      v.x += v.crashVx * dt * k;
      v.z += v.crashVz * dt * k;
      v.heading += v.crashYaw * dt * k;
      v.crashT += dt;
    }
    v.roll += (0.1 * Math.sign(v.crashYaw) - v.roll) * Math.min(1, dt * 6);
    const st = useWorld.getState();
    const inc = v.incidentId ? st.incidents.find((x) => x.id === v.incidentId) : undefined;
    const age = this.now - v.troubleAt;
    // Nobody filed an incident, or it was never cleared: get it off the road eventually.
    if ((!v.incidentId && age > 30000) || age > CRASH_GIVEUP_MS || inc?.status === "cleared") this.startTow(v);
  }

  /** request:breakdown: one en-route van stops dead with steam pouring from the bonnet. */
  breakdown() {
    const cands = [...this.vans.values()].map((v) => ({
      id: v.id,
      parcels: v.parcels.length,
      eligible:
        v.kind === "van" && v.phase === "driving" && v.leg === "stop" && v.sample.edge >= 0 &&
        v.route?.segs[v.sample.seg]?.kind === "line" && v.route?.nodes[v.sample.edge] !== v.bay.exit,
    }));
    let pick = pickBreakdownVictim(cands, this.rand);
    if (!pick) pick = pickBreakdownVictim(cands.map((c) => ({ ...c, eligible: c.eligible || this.vans.get(c.id)!.phase === "driving" })), this.rand);
    if (!pick) return;
    const v = this.vans.get(pick.id)!;
    const key = v.entry.edgeKey ?? v.route?.edgeKeys[Math.max(0, v.sample.edge)];
    if (!key) return;
    v.phase = "broken";
    v.troubleAt = this.now;
    v.speed = 0;
    v.hazard = true;
    v.entry.speed = 0;
    v.entry.stopped = true;
    const id = nextId("INC");
    const note = `Hamyway City ${v.kind === "van" ? "van" : "truck"} ${v.id} broke down on ${roadName(key)}`;
    v.incidentId = id;
    v.incidentKey = key;
    v.incidentNote = note;
    const st = useWorld.getState();
    st.addIncident({ id, kind: "breakdown", edgeKey: key, x: v.x, z: v.z, status: "active", createdAt: performance.now(), note });
    st.blockEdge(key, note);
    emit({ type: "road:blocked", edgeKey: key, reason: note });
    emit({ type: "incident:created", incidentId: id });
    this.markDelayed(v, note);
    this.setLabel(v);
  }

  private brokenDown(v: Van) {
    if (!v.incidentId) return;
    if (this.now - v.troubleAt < SELF_CLEAR_MS) return;
    const inc = useWorld.getState().incidents.find((x) => x.id === v.incidentId);
    // No responder picked it up: clear it ourselves so the demo keeps flowing.
    if (!inc || inc.status === "active") {
      useWorld.getState().updateIncident(v.incidentId, { status: "cleared" });
      this.reopen(v);
      emit({ type: "incident:cleared", incidentId: v.incidentId });
    }
  }

  private reopen(v: Van) {
    const key = v.incidentKey;
    if (key && useWorld.getState().blocked[key] === v.incidentNote) {
      useWorld.getState().unblockEdge(key);
      emit({ type: "road:reopened", edgeKey: key });
    }
  }

  private startTow(v: Van) {
    if (v.phase === "towing") return;
    v.phase = "towing";
    v.towStart = this.now;
    v.hazard = true;
    this.setLabel(v);
  }

  private towing(v: Van) {
    const t = (this.now - v.towStart) / TOW_MS;
    v.pitch = -Math.min(1, t * 2) * 0.12; // nose hooked up
    v.lift = Math.min(1, t * 2) * 0.35;
    v.scale = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
    if (t < 1) return;
    // gone: free the slot and send a replacement out of the depot with the same parcels
    this.reopen(v);
    v.unregister();
    this.vans.delete(v.id);
    this.freeIndices.push(v.index);
    if (useWorld.getState().selectedVehicle === v.id) useWorld.getState().select(null);
    const id = v.kind === "truck" ? this.nextTruck() : this.nextVan();
    const carry = v.parcels.map((p) => ({ ...p }));
    const nv = this.spawn(v.kind, id, v.bay, carry);
    for (let i = 0; i < carry.length; i++) this.write(nv, carry[i], "loading", i);
    this.onListChange();
  }

  private onEvent(e: WorldEvent) {
    if (e.type === "request:breakdown") this.breakdown();
    else if (e.type === "vehicle:crashed") {
      const v = this.vans.get(e.vehicleId);
      if (!v) return;
      if (v.phase !== "crashed") this.crash(v);
      v.incidentId = e.incidentId;
    } else if (e.type === "incident:cleared") {
      for (const v of this.vans.values()) if (v.incidentId === e.incidentId && (v.phase === "broken" || v.phase === "crashed")) this.startTow(v);
    }
  }

  // --- helpers -------------------------------------------------------------------

  private offLane(v: Van) {
    v.entry.from = null;
    v.entry.to = null;
    v.entry.edgeKey = null;
    v.entry.t = 0;
  }

  private snapDisplay(v: Van) {
    sampleRoute(v.route!, v.d, v.sample);
    v.x = v.dx = v.sample.x;
    v.z = v.dz = v.sample.z;
    v.heading = v.dh = v.sample.heading;
  }

  private smooth(v: Van, dt: number) {
    const a = 1 - Math.exp(-dt * 14);
    v.dx += (v.x - v.dx) * a;
    v.dz += (v.z - v.dz) * a;
    let dh = v.heading - v.dh;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.dh += dh * (1 - Math.exp(-dt * 10));
    const g = v.group;
    g.position.set(v.dx, v.lift, v.dz);
    g.rotation.set(v.pitch, v.dh, v.roll, "YXZ");
    g.scale.setScalar(Math.max(v.scale, 0.0001));
    g.updateMatrix();
  }

  private markDelayed(v: Van, reason: string) {
    for (let i = 0; i < v.parcels.length; i++) {
      const p = v.parcels[i];
      const isNew = p.reason !== reason;
      p.delayed = true;
      p.reason = reason;
      this.write(v, p, "delayed", i);
      if (isNew) emit({ type: "delivery:delayed", deliveryId: p.id, reason });
    }
    this.setLabel(v);
  }

  /** Push a status to the store, only if it actually changed. */
  private write(v: Van, p: Parcel, status: Delivery["status"], order: number) {
    const s: Delivery["status"] = status !== "delivered" && p.delayed ? "delayed" : status;
    if (p.written === s && p.writtenTruck === v.id) return;
    p.written = s;
    p.writtenTruck = v.id;
    useWorld.getState().upsertDelivery({ id: p.id, truckId: v.id, stop: p.stop, status: s, etaS: s === "delivered" ? 0 : this.eta(v, order) });
  }

  private eta(v: Van, order: number) {
    let metres = v.route && v.phase === "driving" ? Math.max(0, v.route.length - v.d) : 0;
    let prev = v.route && v.phase === "driving" ? v.parcels[0]?.stop : null;
    if (!prev) {
      const first = v.parcels[0];
      if (first) {
        const a = getNode(PLACES.depot);
        const b = getNode(first.stop);
        metres += Math.hypot(a.x - b.x, a.z - b.z) * 1.4;
        prev = first.stop;
      }
    }
    for (let i = 1; i <= order && i < v.parcels.length; i++) {
      const a = getNode(prev!);
      const b = getNode(v.parcels[i].stop);
      metres += Math.hypot(a.x - b.x, a.z - b.z) * 1.4;
      prev = v.parcels[i].stop;
    }
    return etaSeconds(metres, order) + (v.phase === "loading" ? Math.max(0, (v.phaseDur - (this.now - v.phaseStart)) / 1000) : 0);
  }

  private setLabel(v: Van) {
    let l: LabelStatus;
    if (v.phase === "broken" || v.phase === "crashed" || v.phase === "towing") l = "broken";
    else if (v.phase === "loading") l = "loading";
    else if (v.phase === "dropping") l = "delivering";
    else if (v.parcels.some((p) => p.delayed)) l = "delayed";
    else if (!v.parcels.length) l = "returning";
    else l = "en_route";
    v.label = l;
    v.labelDirty = true;
  }
}
