// Container lorries: the terminal's star act. Each rig loops gate -> check-in -> (customs) -> RMG bay ->
// box lowered onto the trailer -> out the south gate onto the public network -> drop at a destination ->
// back to the gate, sometimes with an export box the RMG lifts off first. Maniac drivers speed, run lights,
// overtake and occasionally roll a box over in a bend (incident + blocked road until responders clear it).
// Owns the yard model and the three RMG schedulers too, so loading is one simulation.
import { Object3D } from "three";
import { emit, type WorldEvent } from "../../bus";
import { CT_PLACES } from "../../districts/containerTerminal";
import { getVehicle, nextId, registerVehicle, vehiclesAhead, type VehicleEntry } from "../../registry";
import { DEFAULT_BUFFER, Lookahead, type ObstacleFn } from "../DeliveryFleet/lookahead";
import { ROAD_EDGES, ROAD_NODES, edgeKey, findPath, getEdge, getNode, neighbours } from "../../roads";
import { hasSignal, signalFor } from "../../signals";
import { useWorld } from "../../store";
import { BERTHS, type BerthState } from "../../berths";
import { RmgSim, type RmgEvent } from "./cranes";
import { Quay, type QuayEvent } from "./quay";
import {
  STYLES,
  YARD_SPEED,
  cornerLimit,
  idmAccel,
  lightDecision,
  pickStyle,
  straightAhead,
  swayFor,
  tipHazard,
  wantsOvertake,
  type DriverStyle,
  type LightDecision,
} from "./drivers";
import { CONTAINER, CT_LANE_Z, RMG_COUNT, TINTS, TRAILER_BED_Y, TRUCK, makeYardBox, yardSpecs } from "./layout";
import { buildRoute, edgeAt, kappaAt, poseAt, routeEdgeKey, segIndex, tailOf, type Pose, type Route } from "./route";
import { rollPivotOffset, startWreck, stepWreck, type WreckState } from "./wreck";
import { Yard, mulberry32, type Box } from "./yard";

export const CAB_COLORS = ["#e63946", "#ffb703", "#2a9df4", "#06d6a0", "#ff6a1a", "#8338ec", "#f15bb5", "#3a86ff", "#fb5607", "#80ed99", "#ffd166", "#ef476f", "#118ab2", "#9ef01a"];

export type Leg = "toGate" | "toCustoms" | "toBay" | "toQuay" | "outbound";
export type Phase = "wait" | "driving" | "checkin" | "inspect" | "atBay" | "atQuay" | "drop" | "wrecked" | "clearing" | "gone";

export interface Truck {
  id: string;
  index: number;
  color: number;
  style: DriverStyle;
  obj: Object3D;
  entry: VehicleEntry;
  unregister: () => void;
  look: Lookahead;
  phase: Phase;
  leg: Leg;
  gate: number;
  rmg: number;
  dest: string;
  quayCrane: number; // STS crane serving this lorry directly on the quay road (-1 = none)
  quayNode: string;
  at: string; // node the current leg started from
  route: Route | null;
  s: number;
  v: number;
  edge: number; // current path edge index (front)
  retryAt: number;
  timer: number;
  box: Box | null;
  boxLock: number; // 0..1: box settling onto the twist locks (render offset)
  lat: number; // current lateral offset (m, + = right)
  latTarget: number;
  overtake: { leaderS: number; leaderV: number; until: number } | null;
  overtakeCooldown: number;
  lightEdge: number;
  lightRoll: number;
  lightCall: LightDecision;
  latAcc: number;
  sway: number;
  requested: boolean;
  loaded: boolean; // RMG put an import on this trip
  // render poses
  cab: Pose;
  trailer: Pose;
  boxPose: Pose;
  // trouble
  wreck: WreckState | null;
  incidentId: string | null;
  incidentKey: string | null;
  incidentNote: string | null;
  ownIncident: boolean;
  troubleAt: number;
  fade: number;
  respawnAt: number;
}

export interface DroppedBox {
  x: number;
  z: number;
  h: number;
  box: Box;
  until: number;
}

const DROP_TTL = 32;
const SELF_CLEAR_S = 110;
const GIVE_UP_S = 160;

const PLAZA = new Set(["ct_pz_w", "ct_pz_e", "ct_dn", ...CT_PLACES.gateApproach]);
/** Terminal-internal edges (blocked when routing on the public network so trucks use the gates). */
const INTERNAL = new Set<string>();
/** Gate-lane + plaza edges (blocked when leaving, so trucks use the out-gate). */
const GATE_SIDE = new Set<string>();
for (const e of ROAD_EDGES.values()) {
  const ct = e.a.startsWith("ct_") && e.b.startsWith("ct_");
  if (ct && !(PLAZA.has(e.a) && PLAZA.has(e.b))) INTERNAL.add(e.key);
  if (ct && (PLAZA.has(e.a) || PLAZA.has(e.b) || e.a.startsWith("ct_gm_") || e.b.startsWith("ct_gm_"))) GATE_SIDE.add(e.key);
}
for (const e of ROAD_EDGES.values()) if (e.a.startsWith("ct_gm_") || e.b.startsWith("ct_gm_")) GATE_SIDE.add(e.key);

export function isInternalEdge(key: string) {
  return INTERNAL.has(key);
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  const out = new Set(a);
  for (const k of b) out.add(k);
  return out;
}

const NAMES: Record<string, string> = {
  ct: "Terminal Road", h: "the Ring Road", mw: "the coast road", ind: "Furnace Lane", g: "Commercial St",
  dock: "Quay Rd", depot: "Depot Rd", airport: "Cargo Way", sub: "Elm Grove", farm: "Mill Lane",
  old: "Cathedral Lane", sb: "Bankside", sh: "Brick Lane", hp: "Heath Rd", br: "the bridge",
};
export function roadName(key: string) {
  const e = ROAD_EDGES.get(key);
  if (!e) return "the road";
  const pa = e.a.split("_")[0];
  const pb = e.b.split("_")[0];
  if (e.kind === "highway" && pa === "h") return "the Ring Road";
  return NAMES[pa !== "ct" ? pa : pb] ?? NAMES[pa] ?? "the high street";
}

/** Where loaded lorries go: industry, the depot, air cargo, the lorry park, or anywhere far away. */
export function destinationPools() {
  const deg = (id: string) => neighbours(id).length;
  const ids = [...ROAD_NODES.keys()];
  const ind = ids.filter((id) => id.startsWith("ind_") && /gate$/.test(id) && deg(id) === 1);
  const indAny = ids.filter((id) => id.startsWith("ind_") && deg(id) >= 1);
  const lorry = ids.filter((id) => id.startsWith("mw_svc_lorry"));
  const far = ids.filter((id) => {
    const n = getNode(id);
    return n.zone !== "highway" && !id.startsWith("ct_") && !id.startsWith("mw_") && Math.hypot(n.x - 290, n.z - 220) > 420 && deg(id) >= 1;
  });
  return {
    ind: ind.length ? ind : indAny,
    depot: ROAD_NODES.has("depot_yard_e") ? ["depot_yard_e"] : [],
    airport: ROAD_NODES.has("airport_cargo") ? ["airport_cargo"] : [],
    lorry,
    far,
  };
}

export interface SimOptions {
  count?: number;
  seed?: number;
  /** First self-inflicted rollover not before this sim time (s). */
  firstTipAfter?: number;
  /** Seconds between self-inflicted rollovers (min, max). */
  tipGap?: [number, number];
  /** Berth to work (defaults to BERTHS.terminal); injectable for tests. */
  berth?: BerthState;
  /** Look-ahead raycast (defaults to physics.obstacleAhead); injectable for tests. */
  obstacleFn?: ObstacleFn;
}

/** Truck cab half-width for the look-ahead corridor. */
const RIG_HALF_W = 1.3;
/** Junction radius: a vehicle this close to the node we're about to enter is "in the junction". */
const JUNCTION_R = 10;

const _p: Pose = { x: 0, z: 0, h: 0 };
const _q: Pose = { x: 0, z: 0, h: 0 };
const _a: Pose = { x: 0, z: 0, h: 0 };

export class TruckSim {
  readonly yard: Yard;
  readonly rmgs: RmgSim[];
  /** Ship-to-shore cranes + straddle carriers working the berthed ship (BERTHS.terminal). */
  readonly quay: Quay;
  readonly trucks: Truck[] = [];
  readonly dropped: DroppedBox[] = [];
  readonly rand: () => number;
  t = 0; // sim seconds
  nextTipAt: number;
  tips = 0;
  /** Bumped whenever something the renderer caches (dropped boxes, wreck list) changes. */
  version = 0;
  private readonly pools: ReturnType<typeof destinationPools>;
  private readonly tipGap: [number, number];
  private blocked: ReadonlySet<string> = new Set();
  private now = 0;
  private readonly obstacleFn: ObstacleFn | undefined;
  /** On-screen test (the renderer sets a camera frustum check); off-screen rigs raycast every 4th frame. */
  sees: (x: number, z: number) => boolean = () => true;

  constructor(opts: SimOptions = {}) {
    this.rand = mulberry32(opts.seed ?? 20261010);
    this.obstacleFn = opts.obstacleFn;
    this.yard = new Yard(yardSpecs(), makeYardBox);
    this.rmgs = Array.from({ length: RMG_COUNT }, (_, k) => new RmgSim(k, k, this.yard));
    this.quay = new Quay(opts.berth ?? BERTHS.terminal, this.yard, { rmgTouches: (st) => this.rmgs.some((m) => m.touches(st)) }, this.rand);
    this.rmgs.forEach((m, k) => (m.idleHook = () => this.quay.rmgIdleJob(k)));
    this.pools = destinationPools();
    this.nextTipAt = opts.firstTipAfter ?? 40;
    this.tipGap = opts.tipGap ?? [80, 140];
    const n = opts.count ?? 12;
    const used = new Set<string>();
    for (let i = 0; i < n; i++) this.spawn(i, used);
  }

  // ------------------------------------------------------------------------------------------------
  // spawning

  private spawn(index: number, used: Set<string>, prev?: Truck) {
    const r = this.rand;
    const id = prev ? nextId("CT") : `CT-${String(index + 1).padStart(2, "0")}`;
    const obj = new Object3D();
    obj.name = id;
    const style = STYLES[index === 0 ? "maniac" : pickStyle(r)];
    // the ray starts at the fifth wheel (the registry position), so the cab front is `kingpin` ahead of it;
    // maniacs look 50% less far past their stopping distance, so they still rear-end now and then
    const look = new Lookahead(
      { halfLength: TRUCK.kingpin, halfWidth: RIG_HALF_W, decel: style.brake, buffer: style.name === "maniac" ? DEFAULT_BUFFER * 0.5 : DEFAULT_BUFFER, standoff: 0 },
      this.obstacleFn,
      index,
    );
    const t: Truck = {
      id, index, color: index % CAB_COLORS.length, style, obj,
      entry: null as unknown as VehicleEntry, unregister: () => {}, look,
      phase: "driving", leg: "toGate", gate: index % 4, rmg: index % RMG_COUNT, dest: "", quayCrane: -1, quayNode: "", at: "", route: null, s: 0, v: 0, edge: 0,
      retryAt: 0, timer: 0, box: null, boxLock: 1, lat: 0, latTarget: 0, overtake: null, overtakeCooldown: 0,
      lightEdge: -1, lightRoll: 0, lightCall: "go", latAcc: 0, sway: 0, requested: false, loaded: false,
      cab: { x: 0, z: 0, h: 0 }, trailer: { x: 0, z: 0, h: 0 }, boxPose: { x: 0, z: 0, h: 0 },
      wreck: null, incidentId: null, incidentKey: null, incidentNote: null, ownIncident: false, troubleAt: 0, fade: 1, respawnAt: 0,
    };
    t.entry = { id, kind: "truck", object: obj, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: false, crash: () => this.crashByOther(t) };
    t.unregister = registerVehicle(t.entry);

    // Start spread out: three rolling up to the RMGs, some heading out loaded, the rest on their way in.
    const mode = prev ? 0 : index < RMG_COUNT ? 3 : index % 3;
    let start: string | null = null;
    if (mode === 3) {
      start = `ct_w_${CT_LANE_Z[index]}`;
      t.leg = "toBay";
      t.rmg = index;
      if (r() < 0.5) t.box = this.randomBox();
    } else if (mode === 2) {
      const spots = ["ct_q_323", "ct_q_296", "ct_x_b", "ct_w_310", "ct_q_264"];
      start = spots.find((s) => !used.has(s) && ROAD_NODES.has(s)) ?? null;
      if (start) {
        t.box = this.randomBox();
        t.leg = "outbound";
        t.dest = this.pickDest();
      }
    }
    if (!start && mode === 1) {
      // somewhere close by (ring road, docks, industry) so the gates get busy early
      const near = [...ROAD_NODES.values()].filter((n) => {
        const d = Math.hypot(n.x - 270, n.z - 110);
        return d > 90 && d < 320 && !n.id.startsWith("ct_") && !used.has(n.id) && neighbours(n.id).length >= 2;
      });
      if (near.length) start = near[Math.floor(r() * near.length)].id;
      t.leg = "toGate";
      if (start && r() < 0.45) t.box = this.randomBox();
    }
    if (!start) {
      const pool = [...this.pools.far, ...this.pools.ind, ...this.pools.depot];
      for (let k = 0; k < 12 && !start; k++) {
        const c = pool[Math.floor(r() * pool.length)];
        if (c && !used.has(c)) start = c;
      }
      start = start ?? "dock_s";
      t.leg = "toGate";
      if (r() < 0.45) t.box = this.randomBox();
    }
    used.add(start);
    t.route = null;
    this.planLeg(t, start);
    t.v = 4;
    this.updatePose(t);
    this.trucks[index] = t;
    return t;
  }

  private randomBox(): Box {
    const r = this.rand;
    const p = r();
    const brand = p < 0.18 ? 1 : p < 0.32 ? 2 : p < 0.42 ? 3 : p < 0.52 ? 4 : p < 0.6 ? 5 : p < 0.68 ? 6 : 0;
    return { brand, tint: Math.floor(r() * TINTS.length) };
  }

  pickDest(): string {
    const r = this.rand;
    const P = this.pools;
    const roll = r();
    const pickFrom = (a: string[]) => (a.length ? a[Math.floor(r() * a.length)] : null);
    const order: (string | null)[] =
      roll < 0.36 ? [pickFrom(P.ind)] : roll < 0.5 ? [pickFrom(P.depot)] : roll < 0.64 ? [pickFrom(P.airport)] : roll < 0.74 ? [pickFrom(P.lorry)] : [pickFrom(P.far)];
    order.push(pickFrom(P.far), pickFrom(P.ind), "depot_yard_e");
    return order.find((x): x is string => !!x && ROAD_NODES.has(x)) ?? "depot_yard_e";
  }

  // ------------------------------------------------------------------------------------------------
  // routing

  private legPath(t: Truck, from: string): string[] | null {
    const B = this.blocked;
    const gn = CT_PLACES.gateApproach[t.gate];
    const gm = CT_PLACES.gateIn[t.gate];
    if (t.leg === "toGate") {
      if (from === gm) return null;
      const p = from === gn ? [gn] : findPath(from, gn, union(B, INTERNAL)) ?? findPath(from, gn, B);
      return p ? [...p, gm] : findPath(from, gm, B);
    }
    if (t.leg === "toCustoms") return findPath(from, CT_PLACES.customs, B);
    if (t.leg === "toQuay") return findPath(from, t.quayNode, union(B, new Set([...GATE_SIDE].filter((k) => !k.includes(from))))) ?? findPath(from, t.quayNode, B);
    if (t.leg === "toBay") return findPath(from, CT_PLACES.bays[t.rmg], union(B, new Set([...GATE_SIDE].filter((k) => !k.includes(from))))) ?? findPath(from, CT_PLACES.bays[t.rmg], B);
    // outbound: out through the south gate, then over the public network
    const exit = CT_PLACES.exit;
    const p1 = from === exit ? [exit] : findPath(from, exit, union(B, GATE_SIDE)) ?? findPath(from, exit, B);
    if (!p1) return null;
    for (let k = 0; k < 4; k++) {
      const p2 = findPath(exit, t.dest, union(B, INTERNAL)) ?? findPath(exit, t.dest, B);
      if (p2 && p2.length >= 2) return [...p1, ...p2.slice(1)];
      t.dest = this.pickDest();
    }
    return null;
  }

  /** Plan the current leg from node `from` (the truck is standing at it). */
  private planLeg(t: Truck, from: string) {
    t.at = from;
    const path = this.legPath(t, from);
    if (!path || path.length < 2) {
      t.retryAt = this.t + 1.5 + this.rand();
      t.phase = "wait";
      return false;
    }
    const tail = t.route ? tailOf(t.route, t.s) : undefined;
    t.route = buildRoute(path, 0, tail);
    t.s = t.route.here;
    t.edge = -1;
    t.lightEdge = -1;
    t.phase = "driving";
    return true;
  }

  /** Re-route around a newly blocked road, keeping the current edge. */
  private replan(t: Truck) {
    const r = t.route!;
    const i = t.edge;
    if (i < 0 || i >= r.nodes.length - 1) return;
    const target = r.nodes[r.nodes.length - 1];
    const next = r.nodes[i + 1];
    const extra = t.leg === "outbound" ? INTERNAL : t.leg === "toGate" ? INTERNAL : new Set<string>();
    const rest = findPath(next, target, union(this.blocked, extra)) ?? findPath(next, target, this.blocked);
    if (!rest) return;
    const { t: et } = edgeAt(r, t.s);
    const path = [r.nodes[i], ...rest];
    const tail = tailOf(r, t.s);
    t.route = buildRoute(path, Math.min(0.98, et), tail);
    t.s = t.route.here;
    t.edge = -1;
  }

  private remainingBlocked(t: Truck) {
    const r = t.route!;
    for (let i = Math.max(0, t.edge + 1); i < r.nodes.length - 1; i++) if (this.blocked.has(routeEdgeKey(r, i))) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------------
  // main loop

  update(dt: number, nowMs: number, blocked: ReadonlySet<string>) {
    this.t += dt;
    this.now = nowMs;
    this.blocked = blocked;
    for (let i = 0; i < this.rmgs.length; i++) for (const e of this.rmgs[i].update(dt, this.rand)) this.onRmg(e);
    for (const e of this.quay.update(dt)) this.onQuay(e);
    for (const t of this.trucks) if (t) this.tick(t, dt);
    for (let i = this.dropped.length - 1; i >= 0; i--)
      if (this.dropped[i].until < this.t) {
        this.dropped.splice(i, 1);
        this.version++;
      }
  }

  private tick(t: Truck, dt: number) {
    if (t.boxLock < 1) t.boxLock = Math.min(1, t.boxLock + dt * 1.2);
    switch (t.phase) {
      case "driving":
        this.drive(t, dt);
        break;
      case "wait":
        this.settle(t, dt);
        if (this.t >= t.retryAt) this.planLeg(t, t.at);
        break;
      case "checkin":
        t.timer -= dt;
        this.settle(t, dt);
        if (t.timer <= 0) {
          const crane = t.box ? null : this.quay.craneWantingTruck();
          const taken = crane !== null && this.trucks.some((o) => o && o !== t && o.quayCrane === crane && (o.leg === "toQuay" || o.phase === "atQuay"));
          if (crane !== null && !taken && this.rand() < 0.5) {
            // straight to the quay road: the ship-to-shore crane puts a box right onto the trailer
            t.leg = "toQuay";
            t.quayCrane = crane;
            t.quayNode = this.quayNodeFor(this.quay.cranes[crane].z);
          } else {
            t.leg = this.rand() < 0.12 ? "toCustoms" : "toBay";
            t.rmg = this.pickRmg();
          }
          this.planLeg(t, CT_PLACES.gateIn[t.gate]);
        }
        break;
      case "inspect":
        t.timer -= dt;
        this.settle(t, dt);
        if (t.timer <= 0) {
          t.leg = "toBay";
          this.planLeg(t, CT_PLACES.customs);
        }
        break;
      case "atBay":
        this.settle(t, dt);
        this.atBay(t, dt);
        break;
      case "atQuay":
        this.settle(t, dt);
        this.atQuay(t, dt);
        break;
      case "drop":
        this.settle(t, dt);
        this.dropping(t, dt);
        break;
      case "wrecked":
      case "clearing":
        this.wrecked(t, dt);
        break;
      case "gone":
        if (this.t >= t.respawnAt) {
          const used = new Set<string>();
          for (const o of this.trucks) if (o && o !== t && o.route) used.add(o.route.nodes[o.route.nodes.length - 1]);
          this.spawn(t.index, used, t);
          this.version++;
        }
        break;
    }
  }

  private pickRmg() {
    const loads = this.rmgs.map((m) => m.load());
    for (const t of this.trucks) if (t && (t.leg === "toBay" || t.phase === "atBay") && t.phase !== "gone") loads[t.rmg] += 1;
    let best = 0;
    for (let k = 1; k < loads.length; k++) if (loads[k] < loads[best] || (loads[k] === loads[best] && this.rand() < 0.4)) best = k;
    return best;
  }

  /** Stationary: bleed off speed, keep the pose + registry fresh. */
  private settle(t: Truck, dt: number) {
    t.v = Math.max(0, t.v - 6 * dt);
    t.latTarget = 0;
    t.lat += (0 - t.lat) * Math.min(1, dt * 2);
    t.sway *= Math.exp(-dt * 3);
    t.entry.speed = t.v;
    t.entry.stopped = true;
    this.updatePose(t);
  }

  private drive(t: Truck, dt: number) {
    if (!t.route) {
      t.phase = "wait";
      return;
    }
    const r = t.route;
    const st = t.style;
    let { i, t: et } = edgeAt(r, t.s);
    if (i !== t.edge) {
      t.edge = i;
      if (this.remainingBlocked(t)) {
        this.replan(t);
        ({ i, t: et } = edgeAt(t.route!, t.s));
        t.edge = i;
      }
    }
    const route = t.route;
    const a = route.nodes[t.edge];
    const b = route.nodes[t.edge + 1];
    const e = getEdge(a, b);
    const key = edgeKey(a, b);
    const internal = INTERNAL.has(key);
    const len = e?.length ?? 1;
    let v0 = (e?.speedLimit ?? 11) * st.speedMul;
    if (internal || a.startsWith("ct_") || b.startsWith("ct_")) v0 = Math.min(v0, YARD_SPEED * (st.name === "maniac" ? 1.25 : 1));
    const vi = segIndex(route, t.s);
    // plan the bends a little behind the front bumper (the cab's steer axle)
    const vCorner = cornerLimit(route, t.s - 2.5, t.v, st, segIndex(route, t.s - 2.5));
    const desired = Math.min(v0, vCorner);

    // obstacles: nearest of leader, red light, end of path
    let gap = Infinity;
    let leadV = 0;
    const toEnd = route.length - t.s;
    // the IDM keeps a ~2 m standstill gap: aim that gap past the end so the rig stops on its mark
    gap = toEnd + 1.9;
    leadV = 0;
    let leaderGap = Infinity;
    let leaderSpeed = 0;
    if (!t.overtake) {
      const ahead = vehiclesAhead(a, b, et, t.id)[0];
      if (ahead) {
        leaderGap = (ahead.t - et) * len - (ahead.id.startsWith("CT-") ? 0.5 : 2.6);
        leaderSpeed = ahead.speed;
      } else if (t.edge + 2 < route.nodes.length) {
        const c = route.nodes[t.edge + 2];
        const nx = vehiclesAhead(b, c, -1, t.id)[0];
        if (nx) {
          leaderGap = (1 - et) * len + nx.t * (getEdge(b, c)?.length ?? 1) - (nx.id.startsWith("CT-") ? 0.5 : 2.6);
          leaderSpeed = nx.speed;
        }
      }
      if (leaderGap < gap) {
        gap = leaderGap;
        leadV = leaderSpeed;
      }
    }
    // traffic light at the end of this edge
    if (hasSignal(b) && t.edge + 1 < route.nodes.length - 1) {
      const dist = (1 - et) * len - 6.5;
      const colour = signalFor(b, a, this.now);
      if (t.lightEdge !== t.edge) {
        t.lightEdge = t.edge;
        t.lightRoll = this.rand();
        t.lightCall = "go";
      }
      if (dist > -1) {
        if (colour === "green") t.lightCall = "go";
        else if (t.lightCall === "go" && t.lightRoll >= 0 && dist > 0) {
          t.lightCall = lightDecision(colour, dist, t.v, st, t.lightRoll);
          if (t.lightCall === "go") t.lightRoll = -1; // committed: keep going whatever it turns
        } else if (t.lightCall === "stop") t.lightCall = lightDecision(colour, Math.max(0.1, dist), t.v, st, t.lightRoll);
        if (t.lightCall === "stop" && dist < gap) {
          gap = Math.max(0.05, dist);
          leadV = 0;
        }
      }
    }

    // look-ahead raycast: anything in front (cross traffic, a wreck, a queue on the next road), as a bumper
    // gap for the IDM; and give way at the line to a vehicle sitting in the junction we're about to enter
    const look = t.look;
    look.scan(t.id, t.cab.x, t.cab.z, t.cab.h, t.v, dt, this.sees(t.cab.x, t.cab.z));
    if (look.hitId) {
      let g = look.room;
      let lv = 0;
      const o = look.hitStopped ? undefined : getVehicle(look.hitId);
      if (o) lv = Math.max(0, o.speed * Math.cos(o.object.rotation.y - t.cab.h)); // its speed along our heading
      if (t.edge + 1 < route.nodes.length - 1) {
        const toLine = (1 - et) * len - 6.5;
        const n = getNode(b);
        if (toLine > 0 && toLine < g && look.hitInJunction(n.x, n.z, JUNCTION_R)) {
          g = Math.max(0.05, toLine);
          lv = 0;
        }
      }
      if (g < gap) {
        gap = g;
        leadV = lv;
      }
    }

    // overtaking (maniacs on long straights)
    t.overtakeCooldown -= dt;
    const publicRoad = !a.startsWith("ct_") || !b.startsWith("ct_");
    if (t.overtake) {
      t.overtake.leaderS += t.overtake.leaderV * dt;
      if (t.s > t.overtake.leaderS + 24 || this.t > t.overtake.until || straightAhead(route, t.s, vi) < 30) {
        t.overtake = null;
        t.latTarget = 0;
        t.overtakeCooldown = 6;
      }
    } else if (t.overtakeCooldown <= 0 && wantsOvertake(st, leaderGap, leaderSpeed, desired, straightAhead(route, t.s, vi), publicRoad)) {
      t.overtake = { leaderS: t.s + leaderGap + 4, leaderV: leaderSpeed, until: this.t + 9 };
      t.latTarget = 4;
    }
    if (t.overtake && gap === leaderGap) gap = toEnd + 1.9;

    let acc = idmAccel(t.v, desired, gap, t.v - leadV, st);
    // over the target (a bend ahead, or onto a slower road): brake properly, not just coast
    if (t.v > desired + 0.2) acc = Math.min(acc, Math.max(-st.brake * 1.6, -(t.v - desired) * 3));
    t.v = Math.max(0, t.v + acc * dt);
    t.s = Math.min(route.length, t.s + t.v * dt);

    // lateral: overtaking lane + maniac wobble
    const wobble = st.swerve * Math.sin(this.t * 1.7 + t.index * 1.3) * (t.v > 8 && Math.abs(kappaAt(route, t.s)) < 0.01 ? 1 : 0);
    const target = t.latTarget + wobble;
    const rate = 2.4 * dt;
    t.lat += Math.max(-rate, Math.min(rate, target - t.lat));

    // cornering forces
    const k = kappaAt(route, t.s - TRUCK.kingpin);
    t.latAcc = t.v * t.v * k;
    const loaded = t.box ? 1 : 0.4;
    t.sway += (swayFor(t.latAcc) * loaded - t.sway) * Math.min(1, dt * 5);

    t.entry.speed = t.v;
    t.entry.stopped = t.v < 0.3;
    this.updatePose(t);

    // rollover?
    if (publicRoad && t.box && Math.abs(k) < 0.7 && this.t >= this.nextTipAt && !this.anyWreck()) {
      const hz = tipHazard(t.latAcc, st);
      if (hz > 0 && this.rand() < hz * dt) {
        this.tip(t, true);
        return;
      }
    }

    // arrived?
    if (route.length - t.s < 0.9 && t.v < 0.6) this.arrive(t);
  }

  private anyWreck() {
    return this.trucks.some((t) => t && (t.phase === "wrecked" || t.phase === "clearing"));
  }

  private arrive(t: Truck) {
    const end = t.route!.nodes[t.route!.nodes.length - 1];
    t.v = 0;
    t.overtake = null;
    t.latTarget = 0;
    if (t.leg === "toGate") {
      if (end !== CT_PLACES.gateIn[t.gate]) {
        // ended somewhere else (re-route fallback): try again
        this.planLeg(t, end);
        return;
      }
      t.phase = "checkin";
      t.timer = 2.4 + this.rand() * 2.2;
    } else if (t.leg === "toQuay") {
      if (end !== t.quayNode) {
        this.planLeg(t, end);
        return;
      }
      t.phase = "atQuay";
      t.loaded = false;
      t.timer = 0;
      this.quay.requestDirect(t.quayCrane, t.id, t.boxPose.x, t.boxPose.z);
    } else if (t.leg === "toCustoms") {
      t.phase = "inspect";
      t.timer = 6 + this.rand() * 3;
    } else if (t.leg === "toBay") {
      if (end !== CT_PLACES.bays[t.rmg]) {
        this.planLeg(t, end);
        return;
      }
      t.phase = "atBay";
      t.requested = false;
      t.loaded = false;
      t.timer = 0;
    } else {
      t.phase = "drop";
      t.timer = 0;
    }
    t.entry.stopped = true;
    t.entry.speed = 0;
  }

  private atBay(t: Truck, dt: number) {
    const m = this.rmgs[t.rmg];
    if (!t.requested) {
      t.requested = true;
      if (t.box) m.request({ truckId: t.id, kind: "unload", x: t.boxPose.x, z: t.boxPose.z, box: t.box });
      m.request({ truckId: t.id, kind: "load", x: t.boxPose.x, z: t.boxPose.z });
      return;
    }
    if (t.loaded || (!m.busyWith(t.id) && !t.box)) {
      t.timer += dt;
      if (t.timer > (t.loaded ? 1.1 : 0.2)) {
        t.leg = "outbound";
        t.dest = this.pickDest();
        this.planLeg(t, CT_PLACES.bays[t.rmg]);
      }
    } else if (!m.busyWith(t.id) && t.box && !t.loaded) {
      // load failed / unload refused: leave with what we have
      t.leg = "outbound";
      t.dest = this.pickDest();
      this.planLeg(t, CT_PLACES.bays[t.rmg]);
    }
  }

  /** Quay-road node whose stopped lorry puts its trailer centre closest to quay z. */
  private quayNodeFor(z: number) {
    const back = TRUCK.kingpin + TRUCK.trailerLen / 2 - 0.9;
    let best = "ct_q_209";
    let bd = Infinity;
    for (const n of ROAD_NODES.values()) {
      if (!n.id.startsWith("ct_q_") || n.z < 160) continue;
      const d = Math.abs(n.z - back - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  private atQuay(t: Truck, dt: number) {
    t.timer += dt;
    const c = this.quay.cranes[t.quayCrane];
    if (t.loaded) {
      if (t.timer > 1.1) {
        t.quayCrane = -1;
        t.leg = "outbound";
        t.dest = this.pickDest();
        this.planLeg(t, t.quayNode);
      }
    } else if (t.timer > 90 || !c || (c.mode !== "discharge" && !c.job)) {
      // the crane moved on: get a box from an RMG instead
      this.quay.cancelDirect(t.id);
      t.quayCrane = -1;
      t.leg = "toBay";
      t.rmg = this.pickRmg();
      this.planLeg(t, t.quayNode);
    }
  }

  private onQuay(e: QuayEvent) {
    const t = this.trucks.find((x) => x && x.id === e.truckId);
    if (!t || t.phase !== "atQuay") return;
    t.box = e.box;
    t.boxLock = 0;
    t.loaded = true;
    t.timer = 0;
  }

  private onRmg(e: RmgEvent) {
    if (e.type === "failed") return;
    const id = e.job.truckId;
    if (!id) return;
    const t = this.trucks.find((x) => x && x.id === id);
    if (!t || t.phase !== "atBay") return;
    if (e.type === "picked" && e.job.kind === "unload") t.box = null;
    if (e.type === "dropped" && e.job.kind === "load" && e.job.box) {
      t.box = e.job.box;
      t.boxLock = 0;
      t.loaded = true;
      t.timer = 0;
    }
  }

  private dropping(t: Truck, dt: number) {
    t.timer += dt;
    if (t.box && t.timer > 1.6) {
      // set the box down on the kerb beside the trailer
      const rx = -Math.cos(t.trailer.h);
      const rz = Math.sin(t.trailer.h);
      this.dropped.push({ x: t.boxPose.x - rx * 3.2, z: t.boxPose.z - rz * 3.2, h: t.trailer.h, box: t.box, until: this.t + DROP_TTL });
      if (this.dropped.length > 16) this.dropped.shift();
      t.box = null;
      this.version++;
    }
    if (t.timer > 4.2) {
      // export run: low yard -> most lorries bring a box back
      let fill = 0;
      for (let k = 0; k < RMG_COUNT; k++) fill += this.yard.fill(k);
      fill /= RMG_COUNT;
      const pExport = Math.min(0.9, Math.max(0.15, 1.25 - fill * 1.4));
      if (!t.box && this.rand() < pExport) {
        t.box = this.randomBox();
        t.boxLock = 0;
      }
      t.leg = "toGate";
      t.gate = Math.floor(this.rand() * CT_PLACES.gateIn.length);
      t.timer = 0;
      this.planLeg(t, t.route!.nodes[t.route!.nodes.length - 1]);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // pose

  private updatePose(t: Truck) {
    const r = t.route;
    if (!r) return;
    const rx = (h: number) => -Math.cos(h);
    const rz = (h: number) => Math.sin(h);
    poseAt(r, t.s, _p);
    poseAt(r, t.s - TRUCK.kingpin, _q);
    poseAt(r, t.s - TRUCK.kingpin - TRUCK.axleBack, _a);
    const L = t.lat;
    const fx = _p.x + rx(_p.h) * L;
    const fz = _p.z + rz(_p.h) * L;
    const kx = _q.x + rx(_q.h) * L;
    const kz = _q.z + rz(_q.h) * L;
    const ax = _a.x + rx(_a.h) * L;
    const az = _a.z + rz(_a.h) * L;
    t.cab.x = kx;
    t.cab.z = kz;
    if (Math.hypot(fx - kx, fz - kz) > 0.05) t.cab.h = Math.atan2(fx - kx, fz - kz);
    t.trailer.x = kx;
    t.trailer.z = kz;
    if (Math.hypot(kx - ax, kz - az) > 0.05) t.trailer.h = Math.atan2(kx - ax, kz - az);
    const back = TRUCK.trailerLen / 2 - 0.9;
    t.boxPose.x = kx - Math.sin(t.trailer.h) * back;
    t.boxPose.z = kz - Math.cos(t.trailer.h) * back;
    t.boxPose.h = t.trailer.h;
    t.obj.position.set(kx, 0, kz);
    t.obj.rotation.y = t.cab.h;
    // registry: report the rig's rear so followers keep clear of the trailer
    const rear = edgeAt(r, t.s - TRUCK.length + 1.5);
    t.entry.from = r.nodes[rear.i];
    t.entry.to = r.nodes[rear.i + 1];
    t.entry.edgeKey = routeEdgeKey(r, rear.i);
    t.entry.t = rear.t;
  }

  // ------------------------------------------------------------------------------------------------
  // trouble

  /** Registry crash(): the Crashes module picked one of our lorries. It files the incident itself. */
  crashByOther(t: Truck): boolean {
    if (t.phase !== "driving" || !t.route || t.v < 1.5) return false;
    const key = routeEdgeKey(t.route, Math.max(0, t.edge));
    if (INTERNAL.has(key)) return false;
    this.tip(t, false);
    return true;
  }

  /** Force a rollover now (debug / tests). Returns false if no lorry is out on a public road. */
  tipAny(): boolean {
    for (const t of this.trucks) {
      if (!t || t.phase !== "driving" || !t.route || !t.box) continue;
      const key = routeEdgeKey(t.route, Math.max(0, t.edge));
      if (INTERNAL.has(key)) continue;
      this.tip(t, true);
      return true;
    }
    return false;
  }

  private tip(t: Truck, own: boolean) {
    this.quay.cancelDirect(t.id);
    const side: 1 | -1 = t.latAcc >= 0 ? 1 : -1;
    t.wreck = startWreck(t.cab.x, t.cab.z, t.cab.h, Math.max(t.v, 7), side, t.boxPose, TRAILER_BED_Y);
    for (const m of this.rmgs) m.cancel(t.id);
    t.phase = "wrecked";
    t.overtake = null;
    t.troubleAt = this.t;
    t.v = 0;
    t.entry.speed = 0;
    t.entry.stopped = true;
    t.fade = 1;
    this.nextTipAt = this.t + this.tipGap[0] + this.rand() * (this.tipGap[1] - this.tipGap[0]);
    this.tips++;
    this.version++;
    const key = routeEdgeKey(t.route!, Math.max(0, t.edge));
    t.incidentKey = key;
    t.ownIncident = own;
    if (!own) return;
    const id = nextId("INC");
    const note = `Container lorry ${t.id} overturned on ${roadName(key)}, load shed`;
    t.incidentId = id;
    t.incidentNote = note;
    const w = useWorld.getState();
    w.addIncident({ id, kind: "truck_crash", edgeKey: key, x: t.cab.x, z: t.cab.z, status: "active", createdAt: this.now || 0, note });
    w.blockEdge(key, note);
    emit({ type: "incident:created", incidentId: id });
    emit({ type: "road:blocked", edgeKey: key, reason: note });
    emit({ type: "vehicle:crashed", vehicleId: t.id, incidentId: id });
  }

  private wrecked(t: Truck, dt: number) {
    const w = t.wreck;
    if (w && !w.settled) stepWreck(w, dt, this.rand);
    if (w) {
      t.cab.x = w.x;
      t.cab.z = w.z;
      t.cab.h = w.h;
      t.obj.position.set(w.x, 0, w.z);
      t.obj.rotation.y = w.h;
    }
    const age = this.t - t.troubleAt;
    if (t.phase === "clearing") {
      t.fade -= dt / 2.5;
      if (t.fade <= 0) this.remove(t);
      return;
    }
    const inc = t.incidentId ? useWorld.getState().incidents.find((i) => i.id === t.incidentId) : undefined;
    if (inc?.status === "cleared") {
      t.phase = "clearing";
      return;
    }
    if (t.ownIncident && t.incidentId && age > SELF_CLEAR_S && (!inc || inc.status === "active")) {
      // nobody came: clear it ourselves so the demo keeps flowing
      this.clearOwn(t);
      t.phase = "clearing";
      return;
    }
    if (age > GIVE_UP_S) t.phase = "clearing";
  }

  private clearOwn(t: Truck) {
    const w = useWorld.getState();
    if (t.incidentId) w.updateIncident(t.incidentId, { status: "cleared" });
    if (t.incidentKey && w.blocked[t.incidentKey] === t.incidentNote) {
      w.unblockEdge(t.incidentKey);
      emit({ type: "road:reopened", edgeKey: t.incidentKey });
    }
    if (t.incidentId) emit({ type: "incident:cleared", incidentId: t.incidentId });
  }

  private remove(t: Truck) {
    t.unregister();
    if (useWorld.getState().selectedVehicle === t.id) useWorld.getState().select(null);
    t.phase = "gone";
    t.wreck = null;
    t.box = null;
    t.respawnAt = this.t + 6;
    t.incidentId = null;
    this.version++;
  }

  onEvent(e: WorldEvent) {
    if (e.type === "vehicle:crashed") {
      const t = this.trucks.find((x) => x && x.id === e.vehicleId);
      if (t && !t.incidentId) t.incidentId = e.incidentId;
    } else if (e.type === "incident:cleared") {
      for (const t of this.trucks) if (t && t.incidentId === e.incidentId && t.phase === "wrecked") t.phase = "clearing";
    }
  }

  /** Unregister everything and close our own open incidents (module unmount). */
  dispose() {
    for (const t of this.trucks) {
      if (!t) continue;
      if (t.ownIncident && (t.phase === "wrecked" || t.phase === "clearing")) this.clearOwn(t);
      t.unregister();
    }
  }
}

/** Rig body roll for rendering: wreck roll, or the cornering lean. */
export function rigRoll(t: Truck) {
  return t.wreck ? t.wreck.roll : t.sway * 0.35;
}

export { rollPivotOffset, CONTAINER };
