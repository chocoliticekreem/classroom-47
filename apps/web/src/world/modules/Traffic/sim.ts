// Civilian traffic simulation + instanced rendering. Owns ~220 vehicles spread over the whole road
// graph by road length (busier in central districts and on high streets, lorries and vans on the
// motorway), drives them with the pure logic in driving.ts, registers them in the shared registry
// and writes instance matrices.
//
// Level of detail: vehicles the camera can see get the full model (car following with look-ahead,
// signals, turn slowing, curves, lights). Vehicles out of view only advance along their path with
// same-edge following, re-path on closures, and refresh their registry position every few frames.
import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Frustum,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Sphere,
  Vector3,
  type Camera,
  type Material,
} from "three";
import { on } from "../../bus";
import { forgetSeparation, nearby, obstacleAhead, separation } from "../../physics";
import { allVehicles, getVehicle, nextId, registerVehicle, type VehicleEntry, type VehicleKind } from "../../registry";
import { ROAD_EDGES, edgeKey, getNode, type RoadEdge } from "../../roads";
import { hasSignal, signalFor } from "../../signals";
import { blockedSet, useWorld, type Incident } from "../../store";
import {
  IDM,
  TURN_R,
  ZONE_WEIGHT,
  advance,
  blockageT,
  edgeLen,
  edgeOf,
  idmAccel,
  isJunction,
  laneObstacle,
  lateralOf,
  needsReroute,
  pathPointAhead,
  pickDestination,
  poseAt,
  replanPath,
  shouldYield,
  signalDecision,
  smoothPose,
  turnSide,
  turnSpeed,
  uturnPose,
  type Archetype,
  type LaneEntry,
  type Pose,
  type PoseOffset,
} from "./driving";
import { HALF_LENGTH, PALETTES, PARTS, WIDTH, buildArchetype, type Part } from "./models";

export const FLEET: Record<Archetype, number> = {
  hatch: 40, saloon: 34, suv: 26, estate: 20, sports: 10, cab: 24, minibus: 10, van: 26, hgv: 22, moto: 8,
};
export const FLEET_SIZE = Object.values(FLEET).reduce((s, n) => s + n, 0);
const ARCHES = Object.keys(FLEET) as Archetype[];
const REG_KIND: Record<Archetype, VehicleKind> = {
  hatch: "car", saloon: "car", suv: "car", estate: "car", sports: "car", cab: "taxi", minibus: "car", van: "car", hgv: "truck", moto: "car",
};
const ID_PREFIX: Record<Archetype, string> = {
  hatch: "car", saloon: "car", suv: "car", estate: "car", sports: "car", cab: "taxi", minibus: "minibus", van: "cvan", hgv: "hgv", moto: "moto",
};
const KIND_HALF: Record<VehicleKind, number> = {
  car: 2.2, taxi: 2.25, bus: 5.3, van: 2.8, truck: 4.5, police: 2.4, ambulance: 3, fire: 4, roadworks: 3.5, tow: 3.5, cyclist: 0.9, motorcade: 2.6,
};
const SPEED_FACTOR: Record<Archetype, [number, number]> = {
  hatch: [0.85, 1.05], saloon: [0.88, 1.08], suv: [0.85, 1.02], estate: [0.86, 1.02], sports: [1.05, 1.25],
  cab: [0.98, 1.1], minibus: [0.8, 0.92], van: [0.85, 1.0], hgv: [0.74, 0.82], moto: [1.0, 1.2],
};
const STOP_LINE = 5.2; // front bumper stops this far before the junction centre
const CLEAR_RADIUS = 25; // incident:cleared removes crashed cars within this distance
const VIS_DIST = 1500; // beyond this the camera can't make out a car anyway
const HIDDEN_POSE_EVERY = 8; // frames between registry position refreshes for hidden vehicles
const PATH_BUDGET = 8; // new-destination path searches per frame (closures are never deferred)
const ROAD_RANK: Record<string, number> = { highway: 2, street: 1, country: 0 };
const GIVE_WAY_MAX = 6; // s: after this long giving way, a driver edges out anyway
const IMPATIENT_SPEED = 4; // m/s cap through the junction after giving up on giving way
const GHOST_SPEED = 1.5; // m/s cap while creeping out of a deadlock (below the 3.5 m/s crash threshold)
const BEAM_EXTRA = 6; // look-ahead beam range = comfortable stopping distance + this
const BEAM_HIDDEN_EVERY = 4; // frames between beam casts for vehicles out of view
const JBOX = 11; // metres around a junction node that count as "in the junction"

type Mode = "drive" | "uturn" | "crashed";

interface Driver {
  arche: Archetype;
  slot: number;
  ord: number; // index in drivers[], for the blob-shadow instance and staggering
  half: number;
  entry: VehicleEntry;
  unregister: () => void;
  path: string[];
  idx: number;
  t: number;
  speed: number;
  accel: number;
  v0Factor: number;
  dest: string;
  mode: Mode;
  visible: boolean;
  wasVisible: boolean;
  committed: boolean;
  stillFor: number;
  blockedStill: number;
  patience: number;
  retryIn: number;
  checkIn: number;
  pose: Pose;
  target: Pose;
  off: PoseOffset;
  pitch: number;
  roll: number;
  braking: boolean;
  signal: -1 | 0 | 1 | 2; // indicator: 1 left, -1 right, 2 hazards
  uA: Pose;
  uB: Pose;
  uU: number;
  uDur: number;
  crashT: number;
  crashFrom: Pose;
  crashV: number;
  crashYaw: number;
  crashRoll: number;
  crashedAt: number;
  crashVx: number; // slide velocity after a crash (own velocity + collision impulse)
  crashVz: number;
  beamGap: number; // bumper gap to whatever the look-ahead beam last hit (Infinity = clear)
  beamSpeed: number; // its speed along our heading
  beamIn: number; // frames until the next cast
  giveWay: boolean; // waiting at the line of the junction ahead for traffic with priority
  uHold: number; // seconds a U-turn has waited for something in front of it
  beamWhy: number; // debug: what the beam last braked for (see why())
  beamHit: string; // id of what the beam braked for (deadlock detection)
  stuckFor: number; // seconds stopped nose-to-tail behind another stopped car
  ghostFor: number; // > 0: breaking a deadlock, creeping past other traffic cars
  waitFor: number; // seconds spent giving way at this junction (impatience after GIVE_WAY_MAX)
}

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);

// Reusable scratch objects (no per-frame allocation)
const mat = new Matrix4();
const quat = new Quaternion();
const euler = new Euler(0, 0, 0, "YXZ");
const pos = new Vector3();
const scl = new Vector3(1, 1, 1);
const ZERO = new Matrix4().makeScale(0, 0, 0);
const laneHit: LaneEntry = { t: 0, speed: 0, half: 0 };
const frustum = new Frustum();
const projScreen = new Matrix4();
const camPos = new Vector3();
const sphere = new Sphere();
const beamA: Pose = { x: 0, z: 0, h: 0 };
const beamB: Pose = { x: 0, z: 0, h: 0 };

const C_TAIL_OFF = new Color(0.35, 0.03, 0.03);
const C_TAIL_RUN = new Color(0.9, 0.06, 0.05);
const C_TAIL_BRAKE = new Color(2.6, 0.18, 0.1);
const C_IND_OFF = new Color(0.45, 0.25, 0.05);
const C_IND_ON = new Color(2.4, 1.2, 0.1);
const C_HEAD_DAY = new Color(0.92, 0.92, 0.86);
const C_HEAD_NIGHT = new Color(2.6, 2.4, 1.8);

/** Debug reasons for d.beamWhy: 1 stopped thing, 2 following, 3 oncoming in path, 4 junction yield, 5 waiting for the box, 6 crossing. */
function why(d: Driver, code: number, gap: number) {
  d.beamWhy = code;
  return gap;
}

/** Continue a path-end pose straight ahead by `extra` metres (the beam outruns a path that ends). */
function extendPose(p: Pose, extra: number) {
  if (extra <= 0) return;
  p.x += Math.sin(p.h) * extra;
  p.z += Math.cos(p.h) * extra;
}

// --- Spawn pools: edges weighted by length x district density x high-street bonus ---------

interface EdgePool {
  edges: RoadEdge[];
  cum: number[];
  total: number;
}

function edgePool(filter: (e: RoadEdge) => boolean, weight: (e: RoadEdge) => number): EdgePool {
  const edges: RoadEdge[] = [];
  const cum: number[] = [];
  let total = 0;
  for (const e of ROAD_EDGES.values()) {
    if (!filter(e)) continue;
    const w = e.length * weight(e);
    if (w <= 0) continue;
    total += w;
    edges.push(e);
    cum.push(total);
  }
  return { edges, cum, total };
}

function zoneW(e: RoadEdge) {
  const za = getNode(e.a).zone;
  const zb = getNode(e.b).zone;
  return ((ZONE_WEIGHT[za] ?? 1) + (ZONE_WEIGHT[zb] ?? 1)) / 2;
}

/** A street whose both ends are junctions in a busy district: a high street. */
function highStreet(e: RoadEdge) {
  return e.kind === "street" && isJunction(e.a) && isJunction(e.b) && zoneW(e) >= 1.6 ? 1.6 : 1;
}

const isRing = (e: RoadEdge) => e.a.startsWith("h_") && e.b.startsWith("h_");
const noDepot = (e: RoadEdge) => !e.a.startsWith("depot_") && !e.b.startsWith("depot_");

let pools: { town: EdgePool; motorway: EdgePool; highway: EdgePool } | null = null;
function getPools() {
  if (pools) return pools;
  const town = edgePool(noDepot, (e) => (e.kind === "highway" ? 0.5 : zoneW(e) * highStreet(e)));
  const highway = edgePool((e) => e.kind === "highway", () => 1);
  const mw = edgePool((e) => e.kind === "highway" && !isRing(e), () => 1);
  pools = { town, highway: highway.total ? highway : town, motorway: mw.total ? mw : highway.total ? highway : town };
  return pools;
}

function spawnPool(arche: Archetype): EdgePool {
  const p = getPools();
  if (arche === "hgv") return rand() < 0.8 ? p.motorway : p.highway;
  if (arche === "van") return rand() < 0.5 ? p.motorway : p.town;
  return p.town;
}

function sampleEdge(p: EdgePool): RoadEdge {
  const r = rand() * p.total;
  let lo = 0;
  let hi = p.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return p.edges[lo];
}

export class TrafficSim {
  readonly meshes: InstancedMesh[] = [];
  readonly paintMeshes = new Map<InstancedMesh, Archetype>();
  private parts = new Map<Archetype, Partial<Record<Part, InstancedMesh>>>();
  private shadow: InstancedMesh;
  private materials: Material[] = [];
  private headMat: MeshBasicMaterial;
  private drivers: Driver[] = [];
  private bySlot = new Map<Archetype, Driver[]>();
  private byId = new Map<string, Driver>();
  private lanes = new Map<string, Map<string, VehicleEntry[]>>();
  private usedLanes: VehicleEntry[][] = [];
  private blocked: Set<string> = new Set();
  private blockedDirty = true;
  private budget = PATH_BUDGET;
  private frame = 0;
  private cleanup: (() => void)[] = [];
  private night = -1;
  private sweepIn = 2;
  private selfId = "";
  /** Look-ahead beam on/off (tests compare against the lane-only model). */
  beam = true;
  /** Last frame's counts, for profiling. */
  readonly stats = { visible: 0, hidden: 0, crashed: 0 };

  constructor() {
    const paint = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0.15, flatShading: true });
    const fixed = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true });
    this.headMat = new MeshBasicMaterial({ color: C_HEAD_DAY, toneMapped: false });
    const lamp = new MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    const shadowMat = new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false });
    this.materials.push(paint, fixed, this.headMat, lamp, shadowMat);
    const matFor: Record<Part, Material> = { paint, fixed, head: this.headMat, tail: lamp, indL: lamp, indR: lamp };
    const white = new Color("#ffffff");

    for (const arche of ARCHES) {
      const n = FLEET[arche];
      const geos = buildArchetype(arche);
      const rec: Partial<Record<Part, InstancedMesh>> = {};
      for (const part of PARTS) {
        const g = geos[part];
        if (!g) continue;
        const m = new InstancedMesh(g, matFor[part], n);
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        // instances roam the whole city: per-mesh culling would only ever hide visible cars
        m.frustumCulled = false;
        m.name = `traffic-${arche}-${part}`;
        m.castShadow = arche === "hgv" && (part === "paint" || part === "fixed");
        m.receiveShadow = part === "paint" || part === "fixed";
        for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO);
        if (part !== "fixed") for (let i = 0; i < n; i++) m.setColorAt(i, part === "paint" || part === "head" ? white : C_TAIL_OFF);
        rec[part] = m;
        this.meshes.push(m);
        if (part === "paint") this.paintMeshes.set(m, arche);
      }
      this.parts.set(arche, rec);
    }
    const disc = new CircleGeometry(1, 12);
    disc.rotateX(-Math.PI / 2);
    this.shadow = new InstancedMesh(disc, shadowMat, FLEET_SIZE);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    for (let i = 0; i < FLEET_SIZE; i++) this.shadow.setMatrixAt(i, ZERO);
    this.meshes.push(this.shadow);
  }

  /** Vehicle id for a clicked instance (for camera follow). */
  idAt(mesh: InstancedMesh, instanceId: number): string | null {
    const arche = this.paintMeshes.get(mesh);
    if (!arche) return null;
    return this.bySlot.get(arche)?.[instanceId]?.entry.id ?? null;
  }

  start() {
    this.blocked = blockedSet();
    let ord = 0;
    for (const arche of ARCHES) {
      const list: Driver[] = [];
      for (let slot = 0; slot < FLEET[arche]; slot++) {
        const d = this.makeDriver(arche, slot, ord++);
        this.spawn(d, null);
        list.push(d);
        this.drivers.push(d);
      }
      this.bySlot.set(arche, list);
    }
    this.cleanup.push(
      useWorld.subscribe((s, prev) => {
        if (s.blocked !== prev.blocked) this.blockedDirty = true;
      }),
      on((e) => {
        if (e.type === "incident:cleared") this.onCleared(e.incidentId);
        if (e.type === "road:blocked" || e.type === "road:reopened") this.blockedDirty = true;
      }),
    );
  }

  stop() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    for (const d of this.drivers) d.unregister();
    this.drivers = [];
    this.byId.clear();
    this.bySlot.clear();
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }

  // --- lifecycle --------------------------------------------------------------------------

  private makeDriver(arche: Archetype, slot: number, ord: number): Driver {
    const p = (): Pose => ({ x: 0, z: 0, h: 0 });
    const object = new Object3D();
    object.userData.half = HALF_LENGTH[arche];
    const entry: VehicleEntry = {
      id: "", kind: REG_KIND[arche], object, edgeKey: null, from: null, to: null, t: 0, speed: 0, stopped: false,
    };
    const d: Driver = {
      arche, slot, ord, half: HALF_LENGTH[arche], entry, unregister: () => {},
      path: [], idx: 0, t: 0, speed: 0, accel: 0, v0Factor: 1, dest: "", mode: "drive", visible: true, wasVisible: true,
      committed: false, stillFor: 0, blockedStill: 0, patience: 1, retryIn: 0, checkIn: 0,
      pose: p(), target: p(), off: { x: 0, z: 0, h: 0 }, pitch: 0, roll: 0, braking: false, signal: 0,
      uA: p(), uB: p(), uU: 0, uDur: 2.5, crashT: 0, crashFrom: p(), crashV: 0, crashYaw: 0, crashRoll: 0, crashedAt: 0,
      crashVx: 0, crashVz: 0, beamGap: Infinity, beamSpeed: 0, beamIn: ord % BEAM_HIDDEN_EVERY, giveWay: false, uHold: 0, beamWhy: 0, beamHit: "", stuckFor: 0, ghostFor: 0, waitFor: 0,
    };
    entry.crash = () => this.crash(d);
    return d;
  }

  /** (Re)spawn a driver on a free random lane, optionally at least 80 m from `avoid`. */
  private spawn(d: Driver, avoid: { x: number; z: number } | null) {
    d.unregister();
    if (d.entry.id) {
      forgetSeparation(d.entry.id);
      this.byId.delete(d.entry.id);
    }
    d.stuckFor = d.ghostFor = 0;
    d.beamGap = Infinity;
    d.beamSpeed = 0;
    let a = "";
    let b = "";
    let t = 0.5;
    for (let attempt = 0; attempt < 40; attempt++) {
      const e = sampleEdge(spawnPool(d.arche));
      if (this.blocked.has(e.key)) continue;
      [a, b] = rand() < 0.5 ? [e.a, e.b] : [e.b, e.a];
      t = e.length > 12 ? between(0.15, 0.75) : 0.5;
      poseAt([a, b], 0, t, d.pose);
      if (avoid && Math.hypot(d.pose.x - avoid.x, d.pose.z - avoid.z) < 80) continue;
      if (this.isFree(d.pose.x, d.pose.z, 12)) break;
    }
    d.path = [a, b];
    d.idx = 0;
    d.t = t;
    d.mode = "drive";
    d.v0Factor = between(...SPEED_FACTOR[d.arche]);
    d.speed = edgeOf(a, b)!.speedLimit * d.v0Factor * 0.7;
    d.accel = 0;
    d.committed = false;
    d.stillFor = d.blockedStill = 0;
    d.patience = between(0.6, 1.6);
    d.retryIn = 0;
    d.checkIn = between(0.5, 2);
    d.off.x = d.off.z = d.off.h = 0;
    d.pitch = d.roll = 0;
    d.dest = "";
    d.wasVisible = false;
    this.extend(d, false);
    poseAt(d.path, d.idx, d.t, d.pose);

    const palette = PALETTES[d.arche];
    const paint = this.parts.get(d.arche)!.paint!;
    paint.setColorAt(d.slot, new Color(palette[Math.floor(rand() * palette.length)]));
    paint.instanceColor!.needsUpdate = true;

    d.entry.id = nextId(ID_PREFIX[d.arche]);
    this.byId.set(d.entry.id, d);
    d.entry.stopped = false;
    d.entry.from = null;
    this.syncEntry(d, true);
    d.unregister = registerVehicle(d.entry);
  }

  private isFree(x: number, z: number, r: number) {
    for (const v of allVehicles()) if (Math.abs(v.object.position.x - x) < r && Math.abs(v.object.position.z - z) < r) return false;
    return true;
  }

  /** Make sure the path continues past the current edge (pick a new destination when needed). */
  private extend(d: Driver, budgeted = true) {
    if (d.idx + 2 < d.path.length) return true;
    if (budgeted && this.budget <= 0) return false;
    const last = d.path[d.path.length - 1];
    for (let i = 0; i < 3; i++) {
      if (budgeted) this.budget--;
      const dest = pickDestination(d.arche, last, rand);
      const r = replanPath(d.path, d.idx, dest, this.blocked);
      if (r) {
        d.path = r.path;
        d.idx = r.idx;
        d.dest = dest;
        return true;
      }
    }
    return false;
  }

  private reroute(d: Driver) {
    if (!needsReroute(d.path, d.idx, this.blocked)) return;
    const r = d.dest ? replanPath(d.path, d.idx, d.dest, this.blocked) : null;
    if (r) {
      d.path = r.path;
      d.idx = r.idx;
      return;
    }
    d.path = d.path.slice(Math.max(0, d.idx - 1), d.idx + 2);
    d.idx = Math.min(d.idx, 1);
    this.extend(d, false);
  }

  private crash(d: Driver): boolean {
    if (d.mode === "crashed") return false;
    // A physics crash (Collisions sets an impulse hint) is refused off screen: hidden cars only
    // refresh their pose every few frames, so their overlaps aren't trustworthy, and nobody sees it.
    const imp = d.entry.object.userData.impulse as { x: number; z: number } | undefined;
    if (imp && !d.visible) return false;
    d.mode = "crashed";
    d.crashFrom.x = d.pose.x;
    d.crashFrom.z = d.pose.z;
    d.crashFrom.h = d.pose.h;
    const fx = Math.sin(d.pose.h);
    const fz = Math.cos(d.pose.h);
    const big = d.arche === "hgv";
    let sign = rand() < 0.5 ? -1 : 1;
    let spinK = 1;
    if (imp) {
      // momentum: keep our own velocity plus the impulse from the other vehicle
      d.crashVx = fx * d.speed + imp.x;
      d.crashVz = fz * d.speed + imp.z;
      d.crashV = Math.hypot(d.crashVx, d.crashVz);
      // a hit from the side spins us away from it; a straight shunt barely spins
      const side = imp.x * fz - imp.z * fx; // > 0 = pushed to the right
      const along = Math.abs(imp.x * fx + imp.z * fz);
      sign = side >= 0 ? -1 : 1;
      spinK = Math.min(1, 0.35 + Math.abs(side) / (Math.abs(side) + along + 0.01));
    } else {
      d.crashV = Math.max(d.speed, 5);
      const lat = sign > 0 ? -0.25 : 0.25; // slide out the way the car spins
      d.crashVx = (fx + fz * lat) * d.crashV;
      d.crashVz = (fz - fx * lat) * d.crashV;
    }
    d.crashYaw = sign * spinK * between(40, big ? 60 : 120) * (Math.PI / 180);
    const rollSign = rand() < 0.5 ? -1 : 1;
    d.crashRoll = rollSign * (d.arche === "moto" ? between(1.3, 1.45) : big ? between(0.03, 0.06) : between(0.07, 0.15));
    d.crashT = 0;
    d.crashedAt = performance.now();
    d.speed = 0;
    d.accel = 0;
    d.entry.stopped = true;
    d.entry.speed = 0;
    return true;
  }

  private onCleared(incidentId: string) {
    const inc = useWorld.getState().incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    for (const d of this.drivers)
      if (d.mode === "crashed" && Math.hypot(d.pose.x - inc.x, d.pose.z - inc.z) < CLEAR_RADIUS) this.spawn(d, inc);
  }

  /** Safety net: crashed cars nobody is handling disappear after a while. */
  private sweepCrashed(now: number) {
    const incidents = useWorld.getState().incidents;
    for (const d of this.drivers) {
      if (d.mode !== "crashed" || now - d.crashedAt < 150_000) continue;
      let handled = false;
      for (const i of incidents)
        if (i.status !== "cleared" && Math.hypot(d.pose.x - i.x, d.pose.z - i.z) < CLEAR_RADIUS) handled = true;
      if (!handled) this.spawn(d, d.pose);
    }
  }

  /** Turn round on the current edge. Hidden vehicles do it instantly. */
  private startUturn(d: Driver, animate: boolean) {
    const a = d.path[d.idx];
    const b = d.path[d.idx + 1];
    d.uA.x = d.pose.x;
    d.uA.z = d.pose.z;
    d.uA.h = d.pose.h;
    d.path = [b, a];
    d.idx = 0;
    d.t = 1 - d.t;
    if (d.dest) {
      const r = replanPath(d.path, 0, d.dest, this.blocked);
      if (r) d.path = r.path;
    }
    this.extend(d, false);
    poseAt(d.path, d.idx, d.t, d.uB);
    d.speed = 0;
    d.committed = false;
    d.stillFor = d.blockedStill = 0;
    d.uHold = 0;
    if (animate) {
      d.mode = "uturn";
      d.uU = 0;
      d.uDur = d.arche === "hgv" ? 4 : d.arche === "moto" ? 1.6 : 2.6;
    } else {
      d.pose.x = d.uB.x;
      d.pose.z = d.uB.z;
      d.pose.h = d.uB.h;
      this.syncEntry(d, true);
    }
  }

  // --- per frame --------------------------------------------------------------------------

  /** Bucket every registered vehicle by directed lane (from -> to), reusing arrays. */
  private buildLaneIndex() {
    for (const l of this.usedLanes) l.length = 0;
    this.usedLanes.length = 0;
    for (const v of allVehicles()) {
      if (!v.from || !v.to) continue;
      let m = this.lanes.get(v.from);
      if (!m) {
        m = new Map();
        this.lanes.set(v.from, m);
      }
      let l = m.get(v.to);
      if (!l) {
        l = [];
        m.set(v.to, l);
      }
      if (!l.length) this.usedLanes.push(l);
      l.push(v);
    }
  }

  private lookup = (from: string, to: string, afterT: number): LaneEntry | null => {
    const l = this.lanes.get(from)?.get(to);
    if (!l) return null;
    let best: VehicleEntry | null = null;
    for (const v of l)
      if (v.id !== this.selfId && v.from === from && v.to === to && v.t > afterT && (!best || v.t < best.t)) best = v;
    if (!best) return null;
    laneHit.t = best.t;
    laneHit.speed = best.speed;
    const h = best.object.userData.half;
    laneHit.half = typeof h === "number" ? h : (KIND_HALF[best.kind] ?? 2.5);
    return laneHit;
  };

  step(rawDt: number, camera?: Camera) {
    const dt = Math.min(rawDt, 0.1);
    const world = useWorld.getState();
    if (world.paused || dt <= 0) return;
    const now = performance.now();
    this.frame++;
    this.budget = PATH_BUDGET;

    if (this.blockedDirty) {
      this.blocked = blockedSet();
      for (const d of this.drivers) if (d.mode === "drive") this.reroute(d);
      this.blockedDirty = false;
    }

    if (camera) {
      camera.updateMatrixWorld();
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
      camPos.setFromMatrixPosition(camera.matrixWorld);
    }

    this.buildLaneIndex();
    const stats = this.stats;
    stats.visible = stats.hidden = stats.crashed = 0;

    for (const d of this.drivers) {
      if (camera) {
        sphere.center.set(d.pose.x, 1, d.pose.z);
        sphere.radius = d.half + 3;
        const dx = d.pose.x - camPos.x;
        const dz = d.pose.z - camPos.z;
        d.visible = dx * dx + dz * dz < VIS_DIST * VIS_DIST && frustum.intersectsSphere(sphere);
      } else d.visible = true;

      if (d.mode === "drive") this.drive(d, dt, now, world.incidents);
      else if (d.mode === "uturn") this.uturn(d, dt);
      else this.crashed(d, dt);
      if (d.mode === "crashed") stats.crashed++;
      else if (d.visible) stats.visible++;
      else stats.hidden++;
      d.wasVisible = d.visible;
    }

    this.sweepIn -= dt;
    if (this.sweepIn <= 0) {
      this.sweepIn = 2;
      this.sweepCrashed(now);
    }

    this.render(now, world.timeOfDay);
  }

  private drive(d: Driver, dt: number, now: number, incidents: readonly Incident[]) {
    this.selfId = d.entry.id;
    const full = d.visible;
    if (d.idx + 2 >= d.path.length) {
      d.retryIn -= dt;
      if (d.retryIn <= 0) {
        d.retryIn = this.extend(d) ? 0 : this.budget <= 0 ? 0.05 : 1;
      }
    }
    d.checkIn -= dt;
    if (d.checkIn <= 0) {
      d.checkIn = 1.5;
      this.reroute(d);
    }

    const a = d.path[d.idx];
    const b = d.path[d.idx + 1];
    const edge = edgeOf(a, b)!;
    const len = Math.max(edge.length, 0.5);
    const distToNode = (1 - d.t) * len;
    const hasNext = d.idx + 2 < d.path.length;
    const c = hasNext ? d.path[d.idx + 2] : "";
    const v = d.speed;

    let v0 = edge.speedLimit * d.v0Factor;
    if (hasNext && distToNode < 45) {
      const vTurn = turnSpeed(a, b, c, v0);
      if (vTurn < v0) v0 = Math.min(v0, vTurn + Math.max(0, distToNode - TURN_R) * 0.4);
    }

    if (d.ghostFor > 0) {
      d.ghostFor -= dt;
      v0 = Math.min(v0, GHOST_SPEED);
    }
    if (d.waitFor >= GIVE_WAY_MAX) v0 = Math.min(v0, IMPATIENT_SPEED); // edging out after a long wait
    const lead = laneObstacle(d.path, d.idx, d.t, d.half, this.lookup, full ? 60 : 0);
    let gap = lead.gap;
    let closing = v - lead.speed;
    // Look-ahead beam: anything physically in front (other modules' vehicles, crossing traffic, wrecks)
    if (this.beam && (full || --d.beamIn <= 0)) {
      d.beamIn = BEAM_HIDDEN_EVERY;
      this.castBeam(d, v, a, b, len, distToNode, hasNext, full);
      // give way at the junction ahead (hidden cars ignore lights, so they always use the gap rule)
      d.giveWay = false;
      if (hasNext && isJunction(b) && d.waitFor < GIVE_WAY_MAX) {
        const toLine = distToNode - STOP_LINE - d.half;
        if (toLine > -0.5 && toLine < (v * v) / (2 * IDM.bComf) + 4)
          d.giveWay = this.mustGiveWay(d, a, b, c, edge, distToNode, v, full && hasSignal(b));
      }
    }
    if (d.beamGap < gap) {
      gap = d.beamGap;
      closing = v - d.beamSpeed;
    }
    // deadlock: a ring of cars each stopped for the next (acute junctions, U-turn tangles). The lowest
    // id in the ring creeps through (a slow overlap: Collisions nudges, no crash).
    if (v < 0.3 && d.beamWhy === 1 && d.beamGap < 3 && d.ghostFor <= 0) {
      d.stuckFor += dt;
      if (d.stuckFor > 2.5 && this.deadlockLeader(d)) {
        d.ghostFor = 4;
        d.stuckFor = 0;
      }
    } else d.stuckFor = 0;
    let atSignal = false;
    const consider = (g: number) => {
      if (g < gap) {
        gap = g;
        closing = v;
      }
    };

    if (full && hasSignal(b)) {
      const distToLine = distToNode - STOP_LINE - d.half;
      const act = signalDecision(signalFor(b, a, now), distToLine, v, d.committed);
      if (act === "commit") d.committed = true;
      else if (act === "stop") {
        consider(distToLine + IDM.s0);
        atSignal = gap === distToLine + IDM.s0;
      }
    }
    // waited long enough: edge out (the beam still stops us for anything actually in the way)
    if (d.giveWay) d.waitFor += dt;
    else if (d.waitFor < GIVE_WAY_MAX) d.waitFor = 0; // (once impatient, stays so until the next edge)
    if (d.giveWay && hasNext) consider(Math.max(0, distToNode - STOP_LINE - d.half) + IDM.s0);
    if (!hasNext) consider(distToNode - d.half - 1 + IDM.s0);
    else if (this.blocked.size && this.blocked.has(edgeOf(b, c)?.key ?? edgeKey(b, c))) consider(distToNode - STOP_LINE - d.half + IDM.s0);

    let closureAhead = false;
    if (this.blocked.size && this.blocked.has(edge.key)) {
      let bt = 0.5;
      for (const i of incidents)
        if (i.edgeKey === edge.key && i.status !== "cleared") {
          bt = blockageT(a, b, i.x, i.z);
          break;
        }
      bt = Math.min(0.95, Math.max(0.05, bt));
      if (bt > d.t) {
        closureAhead = true;
        consider((bt - d.t) * len - d.half - 5);
      }
    }

    const acc = idmAccel(v, v0, gap, closing);
    let nv = Math.max(0, v + acc * dt);
    let ds = nv * dt;
    if (Number.isFinite(gap)) {
      const room = Math.max(0, gap - 0.4);
      if (ds > room) {
        ds = room;
        nv = Math.min(nv, room / dt);
      }
    }
    d.accel = (nv - v) / dt;
    d.speed = nv;
    if (d.beamGap !== Infinity) d.beamGap -= ds; // between casts, assume the obstacle stood still
    const entered = advance(d, ds);
    if (entered) {
      d.committed = false;
      d.waitFor = 0;
      if (needsReroute(d.path, d.idx, this.blocked)) this.reroute(d);
      if (d.idx > 4) {
        d.path.splice(0, d.idx - 1);
        d.idx = 1;
      }
      this.extend(d);
    }

    if (nv < 0.3) {
      if (closureAhead) {
        d.blockedStill += dt;
        if (d.blockedStill > d.patience && this.uturnClear(d)) {
          this.startUturn(d, full);
          if (full) this.uturn(d, 0);
          return;
        }
      } else if (!atSignal) {
        d.stillFor += dt;
        if (d.stillFor > (hasNext ? 18 : 3) + d.patience * 4 && this.uturnClear(d)) {
          this.startUturn(d, full);
          if (full) this.uturn(d, 0);
          return;
        }
      }
    } else {
      d.stillFor = 0;
      d.blockedStill = 0;
    }

    if (!full) {
      // hidden: no curves, lights or smoothing; refresh the registry position now and then
      d.braking = false;
      d.signal = 0;
      if ((this.frame + d.ord) % HIDDEN_POSE_EVERY === 0 || entered) poseAt(d.path, d.idx, d.t, d.pose);
      this.syncEntry(d, false);
      return;
    }

    d.braking = d.accel < -0.8 || nv < 0.4;
    d.signal = 0;
    const ia = d.path[d.idx];
    const ib = d.path[d.idx + 1];
    if (d.idx + 2 < d.path.length && isJunction(ib) && (1 - d.t) * edgeLen(ia, ib) < 30)
      d.signal = turnSide(ia, ib, d.path[d.idx + 2]);
    else if (d.idx >= 1 && isJunction(ia) && d.t * edgeLen(ia, ib) < TURN_R)
      d.signal = turnSide(d.path[d.idx - 1], ia, ib);

    const targetPitch = Math.max(-0.035, Math.min(0.04, -d.accel * 0.007));
    d.pitch += (targetPitch - d.pitch) * Math.min(1, dt * 5);

    const prevH = d.pose.h;
    poseAt(d.path, d.idx, d.t, d.target);
    if (!d.wasVisible) {
      // just came into view: snap, nothing to smooth from
      d.pose.x = d.target.x;
      d.pose.z = d.target.z;
      d.pose.h = d.target.h;
      d.off.x = d.off.z = d.off.h = 0;
    } else smoothPose(d.pose, d.target, d.off, dt, nv * dt * 1.6 + 0.12, d.pose);
    // slow overlap with something (Collisions): nudge out of it; the offset decays back onto the lane
    const sep = separation(d.entry.id);
    if (sep) {
      d.pose.x += sep.x;
      d.pose.z += sep.z;
      d.off.x += sep.x;
      d.off.z += sep.z;
    }

    // lean: motorbikes into the corner, cars a touch outwards
    const yawRate = Math.atan2(Math.sin(d.pose.h - prevH), Math.cos(d.pose.h - prevH)) / dt;
    const lean = d.arche === "moto" ? Math.max(-0.45, Math.min(0.45, -yawRate * nv * 0.08)) : Math.max(-0.05, Math.min(0.05, yawRate * nv * 0.006));
    d.roll += (lean - d.roll) * Math.min(1, dt * 6);
    this.syncEntry(d, true);
  }

  private near: VehicleEntry[] = [];

  /**
   * Gap acceptance at the junction b we're approaching (path a -> b -> c). Give way to anything moving
   * in the junction box, and (unsignalled) to crossing traffic that gets there first: a major road
   * (highway) has priority over minor ones, equal roads go by time to the junction (ties by id).
   * Oncoming traffic only matters when we turn right across it (UK).
   */
  private mustGiveWay(d: Driver, a: string, b: string, c: string, edge: RoadEdge, distToNode: number, v: number, signalled: boolean): boolean {
    const jn = getNode(b);
    const myRank = ROAD_RANK[edge.kind] ?? 1;
    const myTTJ = distToNode / Math.max(v, 1);
    const turningRight = turnSide(a, b, c) === -1;
    const hx = Math.sin(d.pose.h);
    const hz = Math.cos(d.pose.h);
    for (const o of nearby(jn.x, jn.z, JBOX + 35, this.near)) {
      if (o === d.entry || o.stopped || o.speed < 1) continue;
      const oh = o.object.rotation.y;
      const ofx = Math.sin(oh);
      const ofz = Math.cos(oh);
      const dot = hx * ofx + hz * ofz;
      if (dot > 0.7) continue; // same direction: lane following handles it
      const oncoming = dot < -0.7;
      if (oncoming && !turningRight) continue;
      const dx = jn.x - o.object.position.x;
      const dz = jn.z - o.object.position.z;
      const dist = Math.hypot(dx, dz);
      const toward = dx * ofx + dz * ofz;
      if (dist < JBOX) {
        if (toward > 0 || dist < 5) return true; // in the junction and not leaving it
        continue;
      }
      if (signalled || toward <= 0.3 * dist) continue; // lights decide / not heading for this junction
      const ttj = (dist - JBOX * 0.5) / o.speed;
      const e = o.edgeKey ? ROAD_EDGES.get(o.edgeKey) : undefined;
      const oRank = e ? (ROAD_RANK[e.kind] ?? 1) : myRank;
      if (oRank > myRank) {
        if (ttj < 3.5) return true;
      } else if (oRank === myRank && ttj < 2.5 && (ttj < myTTJ || (Math.abs(ttj - myTTJ) < 0.05 && o.id < d.entry.id))) return true;
    }
    return false;
  }

  /** Is `d` in a ring of cars each beam-blocked by the next, and the lowest id in it? */
  private deadlockLeader(d: Driver): boolean {
    let cur = d;
    let minId = d.entry.id;
    for (let k = 0; k < 10; k++) {
      const nx = this.byId.get(cur.beamHit);
      if (!nx || nx.mode !== "drive" || nx.speed >= 0.3 || nx.beamGap > 3 || nx.beamWhy === 0) return false;
      if (nx === d) return minId === d.entry.id;
      if (nx.entry.id < minId) minId = nx.entry.id;
      cur = nx;
    }
    return false;
  }

  /** Room to swing round into the other lane: nothing moving where the U-turn ends up. */
  private uturnClear(d: Driver): boolean {
    const P = d.pose;
    const fx = Math.sin(P.h);
    const fz = Math.cos(P.h);
    // UK: the other lane is to our right, 2 x LANE_OFFSET over
    const tx = P.x + fz * 4 + fx * 2;
    const tz = P.z - fx * 4 + fz * 2;
    for (const o of nearby(tx, tz, 9, this.near)) if (o !== d.entry && !o.stopped && o.speed > 0.5) return false;
    return true;
  }

  /**
   * Cast the look-ahead beam along the path (two chords: nose -> half range -> full range, so it
   * follows bends) and decide what the nearest hit means: follow it, stop for it, or (in a junction)
   * give way / ignore it by the yield rule. Sets d.beamGap / d.beamSpeed.
   */
  private castBeam(d: Driver, v: number, a: string, b: string, len: number, distToNode: number, hasNext: boolean, full: boolean) {
    d.beamGap = Infinity;
    d.beamSpeed = 0;
    d.beamWhy = 0;
    if (!full) {
      // hidden vehicles keep a stale pose: refresh it (and the registry) for an honest cast
      poseAt(d.path, d.idx, d.t, d.pose);
      d.entry.object.position.set(d.pose.x, 0, d.pose.z);
      d.entry.object.rotation.set(0, d.pose.h, 0, "YXZ");
    }
    const P = d.pose;
    const range = (v * v) / (2 * IDM.bComf) + BEAM_EXTRA;
    const halfW = Math.max(0.6, WIDTH[d.arche] / 2 + 0.15);
    const ox = P.x + Math.sin(P.h) * d.half;
    const oz = P.z + Math.cos(P.h) * d.half;
    extendPose(beamA, pathPointAhead(d.path, d.idx, d.t, d.half + range * 0.5, beamA));
    extendPose(beamB, pathPointAhead(d.path, d.idx, d.t, d.half + range, beamB));

    // the junction we're in or approaching
    let J = "";
    if (hasNext && distToNode < JBOX + range && isJunction(b)) J = b;
    else if (d.t * len < JBOX && isJunction(a)) J = a;
    const jn = J ? getNode(J) : null;
    const selfIn = !!jn && Math.hypot(P.x - jn.x, P.z - jn.z) < JBOX;

    let sx = ox;
    let sz = oz;
    let offset = 0;
    for (let seg = 0; seg < 2; seg++) {
      const tx = seg === 0 ? beamA.x : beamB.x;
      const tz = seg === 0 ? beamA.z : beamB.z;
      const segLen = Math.hypot(tx - sx, tz - sz);
      if (segLen > 0.3) {
        const h = Math.atan2(tx - sx, tz - sz);
        let from = 0;
        for (let tries = 0; tries < 3 && from < segLen; tries++) {
          const hit = obstacleAhead(d.entry.id, sx + Math.sin(h) * from, sz + Math.cos(h) * from, h, segLen - from, halfW);
          if (!hit) break;
          const dist = from + hit.dist;
          const gap = this.judge(d, hit.id, hit.stopped, offset + dist, h, sx, sz, jn, selfIn, distToNode, J === b);
          if (gap !== null) {
            d.beamGap = Math.max(0, gap);
            d.beamHit = hit.id;
            return;
          }
          // ignored (oncoming in its own lane, or it must give way to us): look past it
          from = dist + 0.5;
        }
      }
      offset += segLen;
      sx = tx;
      sz = tz;
    }
  }

  /** What a beam hit means. Returns the gap to brake for (and sets beamSpeed), or null to ignore it. */
  private judge(
    d: Driver, id: string, stopped: boolean, gap: number, h: number, sx: number, sz: number,
    jn: { x: number; z: number } | null, selfIn: boolean, distToNode: number, jAhead: boolean,
  ): number | null {
    const o = getVehicle(id);
    if (!o) return null;
    if (d.ghostFor > 0) {
      const od = this.byId.get(id);
      if (od && od.mode !== "crashed") return null; // breaking a deadlock: creep past other cars
    }
    const ox = o.object.position.x;
    const oz = o.object.position.z;
    const oh = o.object.rotation.y;
    if (stopped || o.speed < 0.5) return why(d, 1, gap); // wreck, queue, parked responder: stop behind it
    const dot = Math.cos(oh - h);
    if (dot > 0.5) {
      d.beamSpeed = o.speed * dot; // going our way: follow it
      return why(d, 2, gap);
    }
    // oncoming traffic whose centre is well off our line is in its own lane: the beam clipped it on a bend
    if (dot < -0.5 && Math.abs(lateralOf(sx, sz, h, ox, oz)) > 2.4) return null;
    if (jn) {
      const otherIn = Math.hypot(ox - jn.x, oz - jn.z) < JBOX;
      if (selfIn && otherIn) {
        // both in the junction: exactly one gives way
        return shouldYield(d.pose.x, d.pose.z, d.pose.h, d.entry.id, ox, oz, oh, id) ? why(d, 4, gap) : null;
      }
      if (!selfIn && otherIn && jAhead) {
        // something crossing the junction ahead: wait at the line rather than nose in behind it
        const toLine = distToNode - STOP_LINE - d.half;
        return why(d, 5, toLine > 0 ? Math.min(gap, toLine) : gap);
      }
    }
    return why(d, dot < -0.5 ? 3 : 6, gap); // crossing or wrong-way in our path: stop for it
  }

  private uturn(d: Driver, dt: number) {
    // swinging across the other lane: hold (up to a few seconds) while something is right in front
    if (this.beam && dt > 0 && d.uU > 0 && d.uHold < 4) {
      const nx = d.pose.x + Math.sin(d.pose.h) * d.half;
      const nz = d.pose.z + Math.cos(d.pose.h) * d.half;
      if (obstacleAhead(d.entry.id, nx, nz, d.pose.h, 2.5, Math.max(0.6, WIDTH[d.arche] / 2 + 0.1))) {
        d.uHold += dt;
        d.speed = 0;
        d.braking = true;
        this.syncEntry(d, true);
        return;
      }
    }
    d.uU = Math.min(1, d.uU + dt / d.uDur);
    const u = d.uU * d.uU * (3 - 2 * d.uU);
    uturnPose(d.uA, d.uB, u, d.pose);
    d.speed = d.uU < 1 ? 3 : 2;
    d.braking = false;
    d.signal = -1; // UK: a U-turn goes across to the right
    d.pitch *= 0.9;
    d.roll *= 0.9;
    if (d.uU >= 1) {
      d.mode = "drive";
      d.off.x = d.off.z = d.off.h = 0;
      d.pose.x = d.uB.x;
      d.pose.z = d.uB.z;
      d.pose.h = d.uB.h;
    }
    this.syncEntry(d, true);
  }

  private crashed(d: Driver, dt: number) {
    const DUR = 1.1;
    d.crashT += dt;
    const u = Math.min(1, d.crashT / DUR);
    const eased = 1 - (1 - u) * (1 - u);
    const k = DUR * 0.5 * eased; // decelerating slide
    d.pose.x = d.crashFrom.x + d.crashVx * k;
    d.pose.z = d.crashFrom.z + d.crashVz * k;
    d.pose.h = d.crashFrom.h + d.crashYaw * eased;
    d.roll = d.crashRoll * eased;
    d.pitch = 0.03 * Math.sin(u * Math.PI);
    d.speed = 0;
    d.braking = false;
    d.signal = 2;
    d.entry.stopped = true;
    d.entry.speed = 0;
    d.entry.object.position.set(d.pose.x, 0, d.pose.z);
    d.entry.object.rotation.set(d.pitch, d.pose.h, d.roll, "YXZ");
  }

  private syncEntry(d: Driver, withPose: boolean) {
    const e = d.entry;
    const a = d.path[d.idx];
    const b = d.path[d.idx + 1];
    if (e.from !== a || e.to !== b) {
      e.from = a;
      e.to = b;
      e.edgeKey = edgeOf(a, b)?.key ?? edgeKey(a, b);
    }
    e.t = d.t;
    e.speed = d.speed;
    e.stopped = d.speed < 0.3 && d.mode !== "uturn";
    if (withPose || (this.frame + d.ord) % HIDDEN_POSE_EVERY === 0) {
      e.object.position.set(d.pose.x, 0, d.pose.z);
      e.object.rotation.set(d.pitch, d.pose.h, d.roll, "YXZ");
    }
  }

  // --- rendering --------------------------------------------------------------------------

  private render(now: number, timeOfDay: number) {
    const night = timeOfDay < 7 || timeOfDay > 18.5 ? 1 : 0;
    if (night !== this.night) {
      this.night = night;
      this.headMat.color.copy(night ? C_HEAD_NIGHT : C_HEAD_DAY);
    }
    const blinkOn = Math.floor(now / 380) % 2 === 0;
    for (const d of this.drivers) {
      // hidden vehicles keep their last matrix: it's off screen
      if (!d.visible && d.mode !== "crashed") continue;
      const rec = this.parts.get(d.arche)!;
      const halfW = WIDTH[d.arche] / 2;
      const lift = d.arche === "moto" ? 0 : Math.abs(Math.sin(d.roll)) * halfW;
      pos.set(d.pose.x, lift, d.pose.z);
      euler.set(d.pitch, d.pose.h, d.roll, "YXZ");
      quat.setFromEuler(euler);
      mat.compose(pos, quat, scl);
      for (const part of PARTS) rec[part]?.setMatrixAt(d.slot, mat);

      rec.tail?.setColorAt(d.slot, d.braking ? C_TAIL_BRAKE : night ? C_TAIL_RUN : C_TAIL_OFF);
      const left = blinkOn && (d.signal === 1 || d.signal === 2);
      const right = blinkOn && (d.signal === -1 || d.signal === 2);
      rec.indL?.setColorAt(d.slot, left ? C_IND_ON : C_IND_OFF);
      rec.indR?.setColorAt(d.slot, right ? C_IND_ON : C_IND_OFF);

      pos.y = 0.07;
      euler.set(0, d.pose.h, 0, "YXZ");
      quat.setFromEuler(euler);
      scl.set(Math.max(halfW, 0.35) * 1.25, 1, d.half * 1.1);
      mat.compose(pos, quat, scl);
      this.shadow.setMatrixAt(d.ord, mat);
      scl.set(1, 1, 1);
    }
    // one upload per mesh per frame (instances are tiny: 220 x 64 bytes)
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
