// The six city events, each acted out in the city: vehicles (instanced), GPU crowds, props, closures.
// A Show owns everything it creates and gives it all back in stop(), which is idempotent.
import * as THREE from "three";
import { blockedSet } from "../../store";
import { edgeKey, getNode, neighbours, ROAD_NODES, findPath } from "../../roads";
import { obstacleAhead } from "../../physics";
import { registerVehicle, type VehicleEntry } from "../../registry";
import { SIDEWALK_Y, SIDEWALK_Y_DOWNTOWN } from "../Crowds/paths";
import type { Pose } from "../Traffic/driving";
import { AHEAD_EDGES, fullClosure, rollingWindow, type ClosureLedger } from "./closure";
import { Convoy, type Member } from "./convoy";
import { CrowdLayer, eventPath, KIND, People } from "./crowd";
import type { Fireworks } from "./fireworks";
import type { HeliRig } from "./heli";
import { barrier, type PropRenderer, type Prop, type VehicleHandle, type VehicleRenderer } from "./render";
import { governmentDestination, gridRun, joinLegs, motorcadeRoute, outAndBack, RouteTrack } from "./route";
import { mulberry32, type EventKind } from "./schedule";
import * as S from "./specs";

export interface Ctx {
  vehicles: VehicleRenderer;
  props: PropRenderer;
  crowd: CrowdLayer;
  heli: HeliRig;
  fwCrowd: CrowdLayer;
  fireworks: Fireworks;
  anchors: THREE.Group;
  night: () => boolean;
  /** A ledger for this show's closures (reason = its "Road closed: …" note). */
  ledger: (reason: string) => ClosureLedger;
}

const CASUAL = ["#e63946", "#1d3557", "#f4a261", "#2a9d8f", "#ffb703", "#8338ec", "#3a86ff", "#ff006e", "#fefae0", "#264653", "#ff6a1a", "#6d6875", "#90be6d", "#f1faee", "#bc4749", "#a8dadc"];
const TROUSERS = ["#1d3557", "#2b2d42", "#3d405b", "#22223b", "#4a4e69", "#6b705c", "#14213d", "#5e503f"];
const SPORT = ["#ff006e", "#06d6a0", "#ffd60a", "#3a86ff", "#ff6a1a", "#f72585", "#ffffff"];
const FLAGS = ["#c8102e", "#012169", "#ffffff", "#c8102e", "#012169"];
const PLACARDS = ["#ffffff", "#ffd60a", "#ff8fab", "#a8dadc", "#caffbf", "#ffffff"];
const FEATHERS = ["#ff006e", "#ffd60a", "#06d6a0", "#8338ec", "#ff6a1a", "#3a86ff", "#ff4d6d"];
const HI_VIS = "#d8f21a";
const POLICE_PANTS = "#1b1f2a";

const pick = <T,>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length) % a.length];

let showSeq = 0;

export abstract class Show {
  abstract readonly kind: EventKind;
  abstract readonly title: string;
  /** One-line incident note while live (null: no incident, e.g. fireworks). */
  abstract readonly note: string | null;
  abstract readonly route: string[];
  abstract readonly maxMs: number;
  /** "Road closed: …" reason on every road it closes. */
  readonly reason: string;
  x = 0;
  z = 0;
  ledger: ClosureLedger | null = null;
  /** Bumped whenever the closed set changes (the director mirrors it into the CityEvent). */
  closureVersion = 0;
  protected rand: () => number;
  protected ctx: Ctx | null = null;
  protected elapsed = 0;

  constructor(label: string) {
    this.reason = `Road closed: ${label}`;
    this.rand = mulberry32(0x5eed + ++showSeq * 7919);
  }

  /** Go live: build visuals, close roads. */
  start(ctx: Ctx) {
    this.ctx = ctx;
    this.ledger = ctx.ledger(this.reason);
    this.begin(ctx);
  }

  protected abstract begin(ctx: Ctx): void;

  /** Per frame while live. Returns true once the show has finished. */
  update(dt: number): boolean {
    if (!this.ctx) return true;
    this.elapsed += dt;
    return this.step(dt, this.ctx);
  }

  protected abstract step(dt: number, ctx: Ctx): boolean;

  /** Tear everything down and reopen every road. Safe to call twice. */
  stop() {
    const ctx = this.ctx;
    this.ledger?.releaseAll();
    if (this.ledger) this.closureVersion++;
    this.ledger = null;
    if (!ctx) return;
    this.teardown(ctx);
    this.ctx = null;
  }

  protected abstract teardown(ctx: Ctx): void;

  /** Keys closed right now. */
  closed(): string[] {
    return this.ledger ? [...this.ledger.keys] : [];
  }

  protected close(keys: ReadonlySet<string>) {
    if (this.ledger?.set(keys)) this.closureVersion++;
  }

  /** Re-close roads someone else reopened (called every second or so). */
  reassert() {
    if (this.ledger?.reassert()) this.closureVersion++;
  }
}

// ---------------------------------------------------------------- shared helpers

const tmpPose: Pose = { x: 0, z: 0, h: 0 } as Pose;

/** Convoy vehicles: instanced drawing + registry entries that other traffic sees and yields to. */
class ConvoyRig {
  readonly handles: (VehicleHandle | null)[] = [];
  readonly entries: VehicleEntry[] = [];
  private offs: (() => void)[] = [];
  readonly ids = new Set<string>();
  private keys: string[];

  constructor(private readonly ctx: Ctx, readonly convoy: Convoy, readonly specs: S.VehicleSpec[], prefix: string) {
    const path = convoy.track.path;
    this.keys = path.slice(0, -1).map((a, k) => edgeKey(a, path[k + 1]));
    specs.forEach((spec, i) => {
      this.handles.push(ctx.vehicles.add(spec));
      const object = new THREE.Object3D();
      object.name = `${prefix}-${i}`;
      object.userData.half = spec.half;
      object.userData.halfWidth = spec.halfWidth;
      object.visible = false;
      ctx.anchors.add(object);
      const entry: VehicleEntry = {
        id: `${prefix}-${i + 1}`,
        kind: spec.kind,
        object,
        edgeKey: null,
        from: null,
        to: null,
        t: 0,
        speed: 0,
        stopped: true,
        crash: () => false, // escorted: never written off
      };
      this.entries.push(entry);
      this.ids.add(entry.id);
    });
  }

  /** Vehicles join the live registry as they roll onto the route (sync() does it), never before. */
  register() {
    this.live = true;
  }
  private live = false;
  private registered = new Set<number>();

  get lead() {
    return this.entries[0];
  }

  /** Move every member to its place along the route. */
  sync() {
    const c = this.convoy;
    const tr = c.track;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const m = c.members[i];
      const s = c.memberS(i);
      const on = s >= 0;
      tr.pose(Math.max(0, s), tmpPose);
      const lat = m.lateral;
      const x = tmpPose.x - Math.cos(tmpPose.h) * lat;
      const z = tmpPose.z + Math.sin(tmpPose.h) * lat;
      e.object.position.set(x, 0, z);
      e.object.rotation.set(0, tmpPose.h, 0);
      e.object.visible = on;
      if (on && this.live && !this.registered.has(i)) {
        this.registered.add(i);
        this.offs.push(registerVehicle(e));
      }
      const idx = tr.edgeAt(Math.max(0, s));
      e.from = tr.path[idx];
      e.to = tr.path[idx + 1];
      e.edgeKey = this.keys[idx];
      e.t = tr.tAt(idx, Math.max(0, s));
      e.speed = on ? c.speed : 0;
      e.stopped = !on || c.speed < 0.3;
      const h = this.handles[i];
      if (h) this.ctx.vehicles.setPose(h, x, 0, z, tmpPose.h, on);
    }
  }

  /** Metres to the nearest outside vehicle ahead of the lead (Infinity when clear). */
  obstacleAhead(range = 40): number {
    const lead = this.lead.object;
    if (!lead.visible) return Infinity;
    const h = lead.rotation.y;
    const half = this.specs[0].half;
    const hit = obstacleAhead(this.lead.id, lead.position.x + Math.sin(h) * half, lead.position.z + Math.cos(h) * half, h, range, 1.3);
    if (!hit || this.ids.has(hit.id)) return Infinity;
    return hit.dist;
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    for (const e of this.entries) this.ctx.anchors.remove(e.object);
  }
}

function sidewalkY(id: string) {
  return getNode(id).zone === "downtown" ? SIDEWALK_Y_DOWNTOWN : SIDEWALK_Y;
}

interface LineOpts {
  spacing: number; // metres between people along each kerb
  offset: [number, number]; // distance from the centre line (min, max)
  flagShare: number;
  junctionGap: number; // leave crossings clear near nodes
  sides?: (1 | -1)[];
  only?: (a: string, b: string) => boolean;
  rows?: number;
}

/** Spectators lining a route on the pavements, facing the road, many waving flags. */
function lineRoute(route: readonly string[], people: People, flags: People, rand: () => number, o: LineOpts) {
  for (let k = 0; k + 1 < route.length; k++) {
    const a = getNode(route[k]);
    const b = getNode(route[k + 1]);
    if (o.only && !o.only(a.id, b.id)) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < o.junctionGap * 2 + 2) continue;
    const ux = dx / len;
    const uz = dz / len;
    const y = Math.max(sidewalkY(a.id), sidewalkY(b.id));
    for (const side of o.sides ?? [1, -1]) {
      // side normal (+1 = right of travel)
      const nx = -uz * side;
      const nz = ux * side;
      for (let row = 0; row < (o.rows ?? 1); row++)
        for (let s = o.junctionGap; s < len - o.junctionGap; s += o.spacing * (0.7 + rand() * 0.6)) {
          const off = o.offset[0] + rand() * (o.offset[1] - o.offset[0]) + row * 0.8;
          const x = a.x + ux * s + nx * off;
          const z = a.z + uz * s + nz * off;
          const yaw = Math.atan2(-nx, -nz) + (rand() - 0.5) * 0.6;
          const kind = rand() < 0.85 ? KIND.loiterer : KIND.walker;
          people.stander(x, z, y, yaw, kind, pick(CASUAL, rand), pick(TROUSERS, rand), rand);
          if (kind === KIND.loiterer && rand() < o.flagShare) flags.copyOf(people, people.count - 1, pick(FLAGS, rand));
        }
    }
  }
}

/** Barriers (and an officer each) across the side roads a closure holds, `dist` metres from the junction. */
function holdPoints(closed: Iterable<string>, onRoute: ReadonlySet<string>, stewards: People, rand: () => number, dist = 9, shirt = HI_VIS): Prop[] {
  const props: Prop[] = [];
  for (const key of closed) {
    const [a, b] = key.split("|");
    const aOn = onRoute.has(a);
    const bOn = onRoute.has(b);
    if (aOn === bOn) continue; // a route edge (or unrelated): no barrier
    const n = getNode(aOn ? a : b);
    const m = getNode(aOn ? b : a);
    const dx = m.x - n.x;
    const dz = m.z - n.z;
    const len = Math.hypot(dx, dz) || 1;
    const d = Math.min(dist, len * 0.4);
    const x = n.x + (dx / len) * d;
    const z = n.z + (dz / len) * d;
    const h = Math.atan2(dx, dz);
    props.push(...barrier(x, z, h));
    // officer on the pavement beside the barrier, facing the junction
    const px = Math.cos(h);
    const pz = -Math.sin(h);
    stewards.stander(x + px * 4.6, z + pz * 4.6, sidewalkY(n.id), Math.atan2(-dx, -dz), KIND.loiterer, shirt, POLICE_PANTS, rand);
  }
  return props;
}

/** Barriers (each with a steward) on closed roads where they meet open ones: the entrances to a closed area. */
function entryBarriers(closed: readonly string[], stewards: People, rand: () => number, dist = 8): Prop[] {
  const set = new Set(closed);
  const props: Prop[] = [];
  for (const key of closed) {
    const [a, b] = key.split("|");
    for (const [n, m] of [[a, b], [b, a]]) {
      if (!neighbours(n).some((nb) => !set.has(edgeKey(n, nb)))) continue;
      const N = getNode(n);
      const M = getNode(m);
      const dx = M.x - N.x;
      const dz = M.z - N.z;
      const len = Math.hypot(dx, dz) || 1;
      const d = Math.min(dist, len * 0.4);
      const x = N.x + (dx / len) * d;
      const z = N.z + (dz / len) * d;
      const h = Math.atan2(dx, dz);
      props.push(...barrier(x, z, h));
      stewards.stander(x + Math.cos(h) * 4.6, z - Math.sin(h) * 4.6, sidewalkY(n), Math.atan2(-dx, -dz), KIND.loiterer, HI_VIS, POLICE_PANTS, rand);
    }
  }
  return props;
}

/** Fences along both kerbs of a route (marathon), leaving junctions open for the barriers. */
function kerbFences(route: readonly string[], every = 6, gap = 9): Prop[] {
  const out: Prop[] = [];
  for (let k = 0; k + 1 < route.length; k++) {
    const a = getNode(route[k]);
    const b = getNode(route[k + 1]);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const h = Math.atan2(dx, dz);
    for (const side of [1, -1])
      for (let s = gap; s < len - gap; s += every) {
        const x = a.x + ux * s - uz * side * 4.3;
        const z = a.z + uz * s + ux * side * 4.3;
        out.push({ x, y: 0.55, z, sx: 0.08, sy: 1.0, sz: every * 0.85, h, c: (Math.floor(s / every) + k) % 2 ? "#d9dde3" : "#ff6a1a" });
      }
  }
  return out;
}

// ---------------------------------------------------------------- 1. presidential motorcade

const MOTORCADE_MEMBERS: [() => S.VehicleSpec, Member][] = [
  [S.outrider, { offset: 0, lateral: -0.8 }],
  [S.outrider, { offset: 1.5, lateral: 0.9 }],
  [S.policeCar, { offset: 11, lateral: 0 }],
  [S.suv, { offset: 21.5, lateral: 0 }],
  [S.outrider, { offset: 27, lateral: 2.7 }],
  [S.limousine, { offset: 32, lateral: 0 }],
  [S.outrider, { offset: 37.5, lateral: 2.7 }],
  [S.suv, { offset: 43, lateral: 0 }],
  [S.suv, { offset: 53, lateral: 0 }],
  [S.policeCar, { offset: 63, lateral: 0 }],
  [S.ambulance, { offset: 73, lateral: 0 }],
  [S.sweeper, { offset: 83, lateral: 0 }],
];

export class MotorcadeShow extends Show {
  readonly kind: EventKind;
  readonly title: string;
  readonly note = "President's motorcade: roads closing on its route";
  readonly route: string[];
  readonly maxMs = 240_000;
  readonly dest: string;
  private convoy: Convoy;
  private rig: ConvoyRig | null = null;
  private lastWin = "";
  private arrivedFor = 0;
  private onRoute: Set<string>;

  constructor(kind: "motorcade" | "state_visit" = "motorcade") {
    super("motorcade");
    this.kind = kind;
    this.dest = governmentDestination();
    const r = motorcadeRoute(this.dest, blockedSet()) ?? motorcadeRoute(this.dest);
    if (!r) throw new Error("no motorcade route");
    this.route = r;
    this.onRoute = new Set(r);
    const to = this.dest.startsWith("gov_") ? "the Residence" : "the Government quarter";
    this.title = kind === "state_visit" ? `State visit: the President drives from the Airport to ${to}` : `President's motorcade: Airport → ${to}`;
    this.convoy = new Convoy(new RouteTrack(r), MOTORCADE_MEMBERS.map(([, m]) => m), 14);
    const a = getNode(r[0]);
    this.x = a.x;
    this.z = a.z;
  }

  protected begin(ctx: Ctx) {
    this.rig = new ConvoyRig(ctx, this.convoy, MOTORCADE_MEMBERS.map(([f]) => f()), "MOTORCADE");
    this.rig.register();
    this.rig.sync();
    // crowds line the downtown stretch, waving flags
    const people = new People();
    const flags = new People();
    lineRoute(this.route, people, flags, this.rand, {
      spacing: 1.5, offset: [5.3, 6.6], flagShare: 0.55, junctionGap: 8, rows: 2,
      only: (a, b) => a.startsWith("g_") && b.startsWith("g_"),
    });
    ctx.crowd.setPaths([]);
    ctx.crowd.people.set(people.attrs());
    ctx.crowd.props.set(flags.attrs());
    ctx.heli.show(this.x, this.z);
  }

  protected step(dt: number, ctx: Ctx) {
    const rig = this.rig!;
    this.convoy.step(dt, rig.obstacleAhead());
    rig.sync();
    ctx.crowd.tick(dt);
    const lead = rig.lead.object.position;
    this.x = lead.x;
    this.z = lead.z;
    const tail = this.convoy.tailIdx();
    const head = this.convoy.headIdx();
    const win = `${tail}:${head}`;
    if (win !== this.lastWin) {
      this.lastWin = win;
      this.close(rollingWindow(this.route, tail, head, AHEAD_EDGES));
      const stewards = new People();
      ctx.props.setLayer("hold", holdPoints(this.closed(), this.onRoute, stewards, this.rand));
      ctx.crowd.stewards.set(stewards.attrs());
    }
    // the helicopter shadows the limousine
    const limo = rig.entries[5].object;
    ctx.heli.follow(limo.visible ? limo.position.x : lead.x, limo.visible ? limo.position.z : lead.z, dt, ctx.night());
    if (this.convoy.arrived) this.arrivedFor += dt;
    return this.arrivedFor > 6;
  }

  protected teardown(ctx: Ctx) {
    this.rig?.dispose();
    this.rig = null;
    ctx.vehicles.clear();
    ctx.props.clear();
    ctx.crowd.clear();
    ctx.heli.hide();
  }
}

// ---------------------------------------------------------------- 2. marathon

export class MarathonShow extends Show {
  readonly kind = "marathon" as const;
  readonly title = "City Marathon: course closed along King's Row and East Side";
  readonly note = "City marathon: roads closed along the course";
  readonly route: string[];
  readonly maxMs = 150_000;
  private runMs = 120_000;

  constructor() {
    super("marathon");
    const r = joinLegs([gridRun([-4, 1], [4, 1]), gridRun([4, 1], [4, 4])]);
    if (!r) throw new Error("no marathon route");
    this.route = r;
    const mid = getNode(r[Math.floor(r.length / 2)]);
    this.x = mid.x;
    this.z = mid.z;
  }

  protected begin(ctx: Ctx) {
    this.close(fullClosure(this.route, true));
    const onRoute = new Set(this.route);
    const r = this.rand;
    // runners: an out-and-back loop on the road, out on one half, back on the other
    const loop = outAndBack(this.route);
    ctx.crowd.setPaths([eventPath(loop, 0.05)]);
    const L = loopLen(loop);
    const people = new People();
    for (let i = 0; i < 1100; i++) {
      // a dense pack near the front, then a long tail
      const s0 = Math.pow(r(), 1.6) * L;
      people.walker(0, s0, 3.1 + r() * 2.2, 0.5 + r() * 3.0, KIND.jogger, pick(SPORT, r), pick(["#111", "#1d3557", "#333", "#ffffff"], r), r);
    }
    // spectators on the pavements
    const fans = new People();
    const flags = new People();
    lineRoute(this.route, fans, flags, r, { spacing: 2.4, offset: [5.4, 6.4], flagShare: 0.35, junctionGap: 9 });
    // merge fans into the people layer (same mesh)
    concat(people, fans);
    ctx.crowd.people.set(people.attrs());
    ctx.crowd.props.set(flags.attrs());
    // barriers, fences, water stations, start/finish gantry
    const stewards = new People();
    const props: Prop[] = [...holdPoints(this.closed(), onRoute, stewards, r, 8, "#ff6a1a"), ...kerbFences(this.route)];
    for (const k of [2, 6, 9]) {
      if (k + 1 >= this.route.length) continue;
      const a = getNode(this.route[k]);
      const b = getNode(this.route[k + 1]);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const h = Math.atan2(ux, uz);
      for (const side of [1, -1]) {
        const cx = a.x + ux * len * 0.5 - uz * side * 5.6;
        const cz = a.z + uz * len * 0.5 + ux * side * 5.6;
        const y = sidewalkY(a.id);
        props.push({ x: cx, y: y + 0.4, z: cz, sx: 0.9, sy: 0.8, sz: 5, h, c: "#3a86ff" }); // table
        for (let c = 0; c < 8; c++) props.push({ x: cx + ux * (c - 3.5) * 0.55, y: y + 0.9, z: cz + uz * (c - 3.5) * 0.55, sx: 0.14, sy: 0.2, sz: 0.14, h, c: "#ffffff" });
        for (let v = 0; v < 3; v++)
          stewards.stander(cx - uz * side * 1.1 + ux * (v - 1) * 1.6, cz + ux * side * 1.1 + uz * (v - 1) * 1.6, y, Math.atan2(uz * side, -ux * side), KIND.loiterer, "#ff6a1a", "#1d3557", r);
      }
    }
    props.push(...gantry(this.route[0], this.route[1], "#ff6a1a"));
    const n = this.route.length;
    props.push(...gantry(this.route[n - 1], this.route[n - 2], "#111111"));
    ctx.props.setLayer("course", props);
    ctx.crowd.stewards.set(stewards.attrs());
  }

  protected step(dt: number, ctx: Ctx) {
    ctx.crowd.tick(dt);
    return this.elapsed * 1000 >= this.runMs;
  }

  protected teardown(ctx: Ctx) {
    ctx.props.clear();
    ctx.crowd.clear();
  }
}

function loopLen(flat: readonly number[]) {
  let L = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    L += Math.hypot(flat[j * 2] - flat[i * 2], flat[j * 2 + 1] - flat[i * 2 + 1]);
  }
  return L;
}

function concat(into: People, from: People) {
  into.aWalk.push(...from.aWalk);
  into.aLook.push(...from.aLook);
  into.aShirt.push(...from.aShirt);
  into.aPants.push(...from.aPants);
}

/** Start/finish gantry over the road at node `at`, facing towards `toward`. */
function gantry(at: string, toward: string, colour: string): Prop[] {
  const a = getNode(at);
  const b = getNode(toward);
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const x = a.x + ux * 7;
  const z = a.z + uz * 7;
  const h = Math.atan2(ux, uz);
  const px = Math.cos(h);
  const pz = -Math.sin(h);
  return [
    { x: x + px * 4.6, y: 3, z: z + pz * 4.6, sx: 0.5, sy: 6, sz: 0.5, h, c: colour },
    { x: x - px * 4.6, y: 3, z: z - pz * 4.6, sx: 0.5, sy: 6, sz: 0.5, h, c: colour },
    { x, y: 5.6, z, sx: 9.8, sy: 1.3, sz: 0.4, h, c: colour },
    { x, y: 5.6, z, sx: 7.5, sy: 0.6, sz: 0.45, h, c: "#ffffff" },
  ];
}

// ---------------------------------------------------------------- 3. protest march

export class ProtestShow extends Show {
  readonly kind = "protest" as const;
  readonly title = "Protest march down Centre Avenue";
  readonly note = "Protest march: roads closing along the avenue";
  readonly route: string[];
  readonly maxMs = 260_000;
  private track: RouteTrack;
  private readonly speed = 1.4;
  private readonly body = 55;
  private marchT = 0;
  private sitAt: number; // metres: the head sits down when it reaches this junction
  private sitLeft = -1; // seconds of sit-down remaining (-1: not yet)
  private sitNode: string;
  private lastWin = "";
  private onRoute: Set<string>;

  constructor() {
    super("protest march");
    const r = joinLegs([gridRun([-1, -4], [-1, 3])]);
    if (!r) throw new Error("no protest route");
    this.route = r;
    this.onRoute = new Set(r);
    this.track = new RouteTrack(r);
    const k = Math.floor(r.length / 2);
    this.sitNode = r[k];
    this.sitAt = this.track.cum[k] - 6;
    const a = getNode(r[0]);
    this.x = a.x;
    this.z = a.z;
  }

  get headS() {
    return this.body + this.speed * this.marchT;
  }

  protected begin(ctx: Ctx) {
    const r = this.rand;
    ctx.crowd.setPaths([eventPath(outAndBack(this.route), 0.05)]);
    const people = new People();
    const placards = new People();
    for (let i = 0; i < 520; i++) {
      const s0 = r() * this.body;
      people.walker(0, s0, this.speed, (r() * 2 - 1) * 3.4, KIND.walker, pick(CASUAL, r), pick(TROUSERS, r), r);
      if (r() < 0.32) placards.copyOf(people, people.count - 1, pick(PLACARDS, r));
    }
    ctx.crowd.people.set(people.attrs());
    ctx.crowd.placards.set(placards.attrs());
    ctx.heli.show(this.x, this.z);
  }

  protected step(dt: number, ctx: Ctx) {
    // sit-down at the middle junction: the march stops and blocks the crossing for a while
    if (this.sitLeft < 0 && this.headS >= this.sitAt) {
      this.sitLeft = 25;
      ctx.crowd.setSitting(true);
    }
    const sitting = this.sitLeft > 0;
    if (sitting) {
      this.sitLeft = Math.max(0, this.sitLeft - dt);
      if (this.sitLeft === 0) ctx.crowd.setSitting(false);
    } else {
      this.marchT += dt;
      ctx.crowd.tick(dt);
    }
    const head = Math.min(this.headS, this.track.length);
    const tail = Math.max(0, head - this.body);
    this.track.pose(head, tmpPose);
    this.x = tmpPose.x;
    this.z = tmpPose.z;
    const hi = this.track.edgeAt(head);
    const ti = this.track.edgeAt(tail);
    const win = `${ti}:${hi}:${sitting}`;
    if (win !== this.lastWin) {
      this.lastWin = win;
      const keys = rollingWindow(this.route, ti, hi, 2);
      if (sitting) for (const nb of neighbours(this.sitNode)) keys.add(edgeKey(this.sitNode, nb));
      this.close(keys);
      const officers = new People();
      ctx.props.setLayer("hold", holdPoints(this.closed(), this.onRoute, officers, this.rand));
      // police walk alongside in hi-vis with a line at the front and back; officers hold the barriers
      const escort = new People();
      const r = mulberry32(99);
      for (let s = 0; s <= this.body; s += 4) for (const side of [1, -1]) escort.walker(0, s, this.speed, side * 4.6, KIND.walker, HI_VIS, POLICE_PANTS, r);
      for (const s of [-3, this.body + 3]) for (let l = -3.5; l <= 3.5; l += 1.4) escort.walker(0, s, this.speed, l, KIND.walker, HI_VIS, POLICE_PANTS, r);
      concat(escort, officers);
      ctx.crowd.stewards.set(escort.attrs());
    }
    ctx.heli.follow(this.x, this.z, dt, ctx.night(), 45, 65);
    return this.headS >= this.track.length - 2;
  }

  protected teardown(ctx: Ctx) {
    ctx.props.clear();
    ctx.crowd.clear();
    ctx.heli.hide();
  }
}

// ---------------------------------------------------------------- 4. carnival parade

export class ParadeShow extends Show {
  readonly kind = "parade" as const;
  readonly title = "Carnival parade along South Row";
  readonly note = "Carnival parade: roads closing on its route";
  readonly route: string[];
  readonly maxMs = 240_000;
  private convoy: Convoy;
  private rig: ConvoyRig | null = null;
  private lastWin = "";
  private onRoute: Set<string>;
  private specs: S.VehicleSpec[];
  private readonly lead = 125; // the parade starts already strung out along the first stretch

  constructor() {
    super("carnival parade");
    const r = joinLegs([gridRun([4, 3], [-4, 3])]);
    if (!r) throw new Error("no parade route");
    this.route = r;
    this.onRoute = new Set(r);
    const members: Member[] = [{ offset: 0, lateral: 2 }];
    this.specs = [S.policeCar()];
    for (let i = 0; i < 5; i++) {
      members.push({ offset: 14 + i * 22, lateral: 2 });
      this.specs.push(S.carnivalFloat(i));
    }
    this.convoy = new Convoy(new RouteTrack(r), members, 2.6, this.lead);
    this.convoy.speed = 2.6;
    const a = getNode(r[0]);
    this.x = a.x;
    this.z = a.z;
  }

  protected begin(ctx: Ctx) {
    const r = this.rand;
    this.rig = new ConvoyRig(ctx, this.convoy, this.specs, "PARADE");
    this.rig.register();
    this.rig.sync();
    // dancers in feathers between and beside the floats, moving with them
    ctx.crowd.setPaths([eventPath(outAndBack(this.route), 0.05)]);
    const people = new People();
    for (let i = 0; i < 420; i++) {
      const s0 = this.lead - 8 - r() * (this.convoy.span + 10);
      const lat = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 1.4) + 0;
      people.walker(0, Math.max(0, s0), 2.6, lat, r() < 0.5 ? KIND.jogger : KIND.walker, pick(FEATHERS, r), pick(FEATHERS, r), r, 1.02);
    }
    const fans = new People();
    const flags = new People();
    lineRoute(this.route, fans, flags, r, { spacing: 1.1, offset: [5.2, 6.6], flagShare: 0.4, junctionGap: 8, rows: 2 });
    concat(people, fans);
    ctx.crowd.people.set(people.attrs());
    ctx.crowd.props.set(flags.attrs());
  }

  protected step(dt: number, ctx: Ctx) {
    const rig = this.rig!;
    this.convoy.step(dt); // a parade doesn't stop for cars: police clear the way, it rolls at walking pace
    rig.sync();
    ctx.crowd.tick(dt);
    const lead = rig.lead.object.position;
    this.x = lead.x;
    this.z = lead.z;
    const tail = this.convoy.tailIdx();
    const head = this.convoy.headIdx();
    const win = `${tail}:${head}`;
    if (win !== this.lastWin) {
      this.lastWin = win;
      this.close(rollingWindow(this.route, tail, head, 2));
      const stewards = new People();
      ctx.props.setLayer("hold", holdPoints(this.closed(), this.onRoute, stewards, this.rand));
      ctx.crowd.stewards.set(stewards.attrs());
    }
    return this.convoy.arrived;
  }

  protected teardown(ctx: Ctx) {
    this.rig?.dispose();
    this.rig = null;
    ctx.vehicles.clear();
    ctx.props.clear();
    ctx.crowd.clear();
  }
}

// ---------------------------------------------------------------- 5. stadium concert

const SURGE_CHAINS = [
  ["sb_s1_5", "sb_s1_4", "sb_s1_3", "sb_s1_2", "sb_s1_1", "sb_ra2_2"],
  ["sb_s1_2", "sb_s3_1", "sb_s3_2", "sb_s3_3", "sb_s3_4"],
  ["sb_ra2_4", "sb_crs_3", "sb_crs_2", "sb_crs_1"],
];

export class ConcertShow extends Show {
  readonly kind = "concert" as const;
  readonly title = "Stadium concert lets out: crowds pour onto Southbank roads";
  readonly note = "Stadium concert ending: crowds, taxis and buses around Southbank";
  readonly route: string[];
  readonly maxMs = 150_000;
  private chains: string[][];
  private convoy: Convoy | null = null;
  private rig: ConvoyRig | null = null;
  private specs: S.VehicleSpec[] = [];
  private readonly runMs = 110_000;

  constructor() {
    super("concert crowds");
    this.chains = SURGE_CHAINS.filter((c) => c.every((id) => ROAD_NODES.has(id)) && joinLegs([c]) !== null);
    if (!this.chains.length) throw new Error("no stadium roads");
    this.route = [...new Set(this.chains.flat())];
    const n = getNode(this.chains[0][2] ?? this.chains[0][0]);
    this.x = n.x - 20;
    this.z = n.z;
  }

  protected begin(ctx: Ctx) {
    const r = this.rand;
    const keys = new Set<string>();
    for (const c of this.chains) for (const k of fullClosure(c, false)) keys.add(k);
    this.close(keys);
    // the surge: thousands streaming out along the approach roads, spilling off the pavements
    const loops = this.chains.map((c) => outAndBack(c));
    ctx.crowd.setPaths(loops.map((l) => eventPath(l, 0.06)));
    const lens = loops.map(loopLen);
    const total = lens.reduce((a, b) => a + b, 0);
    const people = new People();
    for (let i = 0; i < 1700; i++) {
      let pid = 0;
      let x = r() * total;
      while (pid < lens.length - 1 && x > lens[pid]) x -= lens[pid++];
      const shirt = r() < 0.3 ? "#111111" : pick(CASUAL, r); // band tees
      people.walker(pid, r() * lens[pid], 1.1 + r() * 0.6, 0.3 + r() * 5.2, KIND.walker, shirt, pick(TROUSERS, r), r);
    }
    ctx.crowd.people.set(people.attrs());
    const stewards = new People();
    ctx.props.setLayer("hold", entryBarriers(this.closed(), stewards, r));
    ctx.crowd.stewards.set(stewards.attrs());
    // taxis and buses swarm in to the roundabout south of the stadium
    const dest = ROAD_NODES.has("sb_ra2_7") ? "sb_ra2_7" : this.chains[0][this.chains[0].length - 1];
    const from = ROAD_NODES.has("g_-3_4") ? "g_-3_4" : "g_0_4";
    const path = findPath(from, dest, blockedSet());
    if (path && path.length >= 2) {
      const members: Member[] = [];
      let off = 0;
      for (let i = 0; i < 9; i++) {
        const spec = i === 3 || i === 7 ? S.redBus() : S.blackCab();
        this.specs.push(spec);
        members.push({ offset: off, lateral: 0 });
        off += spec.half * 2 + 3.5 + (i === 2 || i === 6 ? 2.5 : 0);
      }
      this.convoy = new Convoy(new RouteTrack(path), members, 10);
      this.rig = new ConvoyRig(ctx, this.convoy, this.specs, "CONCERT-CAB");
      this.rig.register();
      this.rig.sync();
    }
  }

  protected step(dt: number, ctx: Ctx) {
    ctx.crowd.tick(dt);
    if (this.convoy && this.rig) {
      this.convoy.step(dt, this.rig.obstacleAhead(30));
      this.rig.sync();
    }
    return this.elapsed * 1000 >= this.runMs;
  }

  protected teardown(ctx: Ctx) {
    this.rig?.dispose();
    this.rig = null;
    ctx.vehicles.clear();
    ctx.props.clear();
    ctx.crowd.clear();
  }
}

// ---------------------------------------------------------------- 6. fireworks over the river

export class FireworksShow extends Show {
  readonly kind = "fireworks" as const;
  readonly title = "Fireworks over the river";
  readonly note = null;
  readonly route: string[];
  readonly maxMs = 100_000;
  private readonly runMs = 80_000;

  constructor() {
    super("fireworks");
    // the south embankment road, west to east
    const chain: string[] = [];
    let cur = ROAD_NODES.has("br_sbank_m165") ? "br_sbank_m165" : "";
    const seen = new Set<string>();
    while (cur && !seen.has(cur) && chain.length < 14) {
      chain.push(cur);
      seen.add(cur);
      cur = neighbours(cur).find((n) => n.startsWith("br_sbank") && !seen.has(n)) ?? "";
    }
    this.route = chain;
    this.x = -60;
    this.z = -605;
  }

  protected begin(ctx: Ctx) {
    ctx.fireworks.start(this.x, 2, this.z);
    if (this.route.length < 2) return;
    const people = new People();
    const flags = new People();
    // watchers along the river side of the embankment (north = -z), facing the water
    for (let k = 0; k + 1 < this.route.length; k++) {
      const a = getNode(this.route[k]);
      const b = getNode(this.route[k + 1]);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      let nx = -uz;
      let nz = ux;
      if (nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      for (let s = 2; s < len - 2; s += 0.9) {
        const off = 5.4 + this.rand() * 2.4;
        people.stander(a.x + ux * s + nx * off, a.z + uz * s + nz * off, SIDEWALK_Y, Math.atan2(nx, nz) + (this.rand() - 0.5) * 0.8, this.rand() < 0.7 ? KIND.loiterer : KIND.walker, pick(CASUAL, this.rand), pick(TROUSERS, this.rand), this.rand);
        if (this.rand() < 0.12) flags.copyOf(people, people.count - 1, pick(SPORT, this.rand));
      }
    }
    ctx.fwCrowd.setPaths([]);
    ctx.fwCrowd.people.set(people.attrs());
    ctx.fwCrowd.props.set(flags.attrs());
  }

  protected step(dt: number, ctx: Ctx) {
    ctx.fwCrowd.tick(dt);
    return this.elapsed * 1000 >= this.runMs;
  }

  protected teardown(ctx: Ctx) {
    ctx.fireworks.stop();
    ctx.fwCrowd.clear();
  }
}

/** Build the show for a kind (throws if its roads are missing). */
export function makeShow(kind: EventKind): Show {
  switch (kind) {
    case "motorcade":
    case "state_visit":
      return new MotorcadeShow(kind);
    case "marathon":
      return new MarathonShow();
    case "protest":
      return new ProtestShow();
    case "parade":
      return new ParadeShow();
    case "concert":
      return new ConcertShow();
    case "fireworks":
      return new FireworksShow();
  }
}
