"use client";
// Module: Roadworks. A flashing highway-maintenance truck leaves the maintenance yard, drives to a busy road,
// its crew lays out cones, barriers and ROAD CLOSED / DIVERSION signs, the road is blocked (traffic reroutes),
// then they pack up, reopen the road and drive home. Every ~70 s (first ~15 s in) and on bus request:roadworks.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { emit, on } from "../bus";
import { getEdge, getNode, lanePosition, PLACES, findPath, edgeMidpoint, type RoadEdge } from "../roads";
import { nextId, registerVehicle, vehiclesAhead, type VehicleEntry } from "../registry";
import { blockedSet, useWorld } from "../store";
import {
  MAX_CONCURRENT,
  advanceRoute,
  chooseTarget,
  createJobClock,
  createScheduler,
  needsRepath,
  planOutbound,
  planReturn,
  roadName,
  schedulerDue,
  siteLayout,
  siteProgress,
  spliceRoute,
  stepJob,
  type Cursor,
  type JobClock,
  type Route,
  type SiteItemKind,
} from "./Roadworks/logic";
import { Lookahead, ViewCheck } from "./DeliveryFleet/lookahead";
import { RW_BRAKE, RW_HALF_LEN, RW_HALF_W, RW_STOP_LINE, approachSpeed, lookWant, queueWant } from "./Roadworks/drive";
import { ARROW_FRAMES, makeArrowAtlas, makeBarrierStripes, makeChevrons, makeClosedSign } from "./Roadworks/textures";

const YARD = PLACES.maintenanceYard;
const CREW = 3;
const MAX_ITEMS = 48; // per job, layout tops out around 35
const DESPAWN_S = 0.7;
const SPAWN_S = 0.6;
const STUCK_GHOST_S = 6; // if queued this long behind something that never moves, drive through
const ITEM_SCALE = 1.5; // cones etc. are oversized so they read from the high camera

interface PlacedItem {
  kind: SiteItemKind;
  x: number;
  z: number;
  rotY: number;
}

interface Job {
  id: string; // vehicle id, e.g. "RW-7"
  target: string; // edge key being closed
  site: { a: string; b: string; heading: number; road: string };
  clock: JobClock;
  route: Route;
  cursor: Cursor;
  lastSeg: number;
  items: PlacedItem[];
  crewPos: Float32Array; // x, z per crew member
  incidentId: string | null;
  closed: boolean;
  entry: VehicleEntry;
  unregister: () => void;
  look: Lookahead;
  group: Group | null;
  heading: number;
  speed: number;
  stuck: number;
  ghost: number; // > 0: ignoring the queue for a moment (stuck behind something that never moves)
  repathT: number;
  age: number;
  leaving: number; // < 0 while alive, then counts up to DESPAWN_S
}

// ---------- scratch objects (no per-frame allocation) ----------
const dummy = new Object3D();
const scratchBlocked = new Set<string>();
// Camera frustum check so off-screen trucks only raycast every 4th frame.
const view = new ViewCheck();

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function cruiseSpeed(e: RoadEdge | undefined) {
  if (!e) return 10;
  if (e.kind === "highway") return 19;
  if (e.kind === "ramp") return 14;
  return 12;
}

function placeSite(a: string, b: string): { items: PlacedItem[]; heading: number } {
  const na = getNode(a);
  const nb = getNode(b);
  const dx = nb.x - na.x;
  const dz = nb.z - na.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  const lx = fz; // left of the direction of travel (see lanePosition)
  const lz = -fx;
  const mx = (na.x + nb.x) / 2;
  const mz = (na.z + nb.z) / 2;
  const heading = Math.atan2(dx, dz);
  const items = siteLayout(len)
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      kind: it.kind,
      x: mx + fx * it.s + lx * it.left,
      z: mz + fz * it.s + lz * it.left,
      rotY: it.facing === 1 ? heading : heading + Math.PI,
    }));
  return { items, heading };
}

// ---------- shared assets ----------
function useAssets() {
  const assets = useMemo(() => {
    const arrow = makeArrowAtlas();
    const chevron = makeChevrons();
    const stripes = makeBarrierStripes();
    const sign = makeClosedSign();

    const std = (color: string, extra: Partial<MeshStandardMaterial> = {}) =>
      Object.assign(new MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }), extra);

    const wheelGeoms: BufferGeometry[] = [];
    for (const z of [2.3, -1.3, -2.4])
      for (const x of [-1.05, 1.05]) {
        const w = new CylinderGeometry(0.48, 0.48, 0.4, 10);
        w.rotateZ(Math.PI / 2);
        w.translate(x, 0.48, z);
        wheelGeoms.push(w);
      }
    const lightGeoms = (pts: [number, number, number][], size: [number, number, number]) => {
      const parts = pts.map(([x, y, z]) => new BoxGeometry(...size).translate(x, y, z));
      const merged = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return merged;
    };

    const coneGeo = new ConeGeometry(0.28, 0.78, 8).translate(0, 0.43, 0);
    const coneStripeGeo = new CylinderGeometry(0.155, 0.2, 0.14, 8).translate(0, 0.42, 0);
    const coneBaseGeo = new BoxGeometry(0.56, 0.06, 0.56).translate(0, 0.03, 0);

    const geo = {
      wheels: mergeGeometries(wheelGeoms)!,
      chassis: new BoxGeometry(2.3, 0.45, 7).translate(0, 0.85, 0),
      cab: new BoxGeometry(2.4, 1.75, 1.9).translate(0, 1.9, 2.55),
      windscreen: new BoxGeometry(2.15, 0.75, 0.06).translate(0, 2.25, 3.52),
      bed: new BoxGeometry(2.4, 1.15, 4.7).translate(0, 1.6, -1.0),
      stripe: new BoxGeometry(2.44, 0.18, 4.72).translate(0, 1.35, -1.0),
      rear: new PlaneGeometry(2.3, 1.05).rotateY(Math.PI).translate(0, 1.55, -3.37),
      headlights: lightGeoms([[-0.8, 1.25, 3.51], [0.8, 1.25, 3.51]], [0.45, 0.22, 0.05]),
      taillights: lightGeoms([[-1.0, 0.85, -3.52], [1.0, 0.85, -3.52]], [0.3, 0.2, 0.05]),
      boardFrame: new BoxGeometry(2.3, 1.55, 0.12).translate(0, 0.85, 0),
      boardFace: new PlaneGeometry(2.1, 1.4).rotateY(Math.PI).translate(0, 0.85, -0.065),
      boardMast: new BoxGeometry(0.2, 0.3, 0.2).translate(0, 0.1, 0),
      beaconBase: new CylinderGeometry(0.2, 0.22, 0.3, 10).translate(0, 0.15, 0),
      beaconSpin: new BoxGeometry(0.06, 0.2, 0.42).translate(0, 0.17, 0),
      lightbar: new BoxGeometry(1.2, 0.12, 0.25).translate(0, 0.06, 0),
      cone: coneGeo,
      coneStripe: coneStripeGeo,
      coneBase: coneBaseGeo,
      barrierBoard: new BoxGeometry(3.3, 0.3, 0.07).translate(0, 0.85, 0),
      barrierFeet: lightGeoms([[-1.4, 0.42, 0], [1.4, 0.42, 0]], [0.08, 0.84, 0.6]),
      lamp: new CylinderGeometry(0.11, 0.11, 0.16, 8).rotateX(Math.PI / 2),
      signBoard: new BoxGeometry(1.7, 1.7, 0.06).translate(0, 2.05, 0),
      signPost: new BoxGeometry(0.1, 1.2, 0.1).translate(0, 0.6, 0),
      crewLegs: new BoxGeometry(0.42, 0.75, 0.28).translate(0, 0.38, 0),
      crewBody: new BoxGeometry(0.56, 0.72, 0.36).translate(0, 1.1, 0),
      crewHead: new SphereGeometry(0.19, 8, 6).translate(0, 1.62, 0),
      crewHat: new SphereGeometry(0.23, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.67, 0),
    };
    wheelGeoms.forEach((w) => w.dispose());

    const amber = new Color("#ffa20a");
    const mat = {
      tyre: std("#1d1d22"),
      chassis: std("#33343a"),
      cab: std("#ffc61a"),
      bed: std("#ff7a12"),
      stripe: std("#f4f4f4"),
      glass: std("#1c2b3d", { roughness: 0.3 }),
      rear: new MeshStandardMaterial({ map: chevron, roughness: 0.7, emissive: new Color("#ffffff"), emissiveMap: chevron, emissiveIntensity: 0.25 }),
      headlights: new MeshBasicMaterial({ color: new Color(2.2, 2.2, 1.9), toneMapped: false }),
      taillights: new MeshBasicMaterial({ color: new Color(2.4, 0.15, 0.1), toneMapped: false }),
      boardFrame: std("#141414"),
      // LED face: bright and not tone mapped so it blooms
      boardFace: new MeshBasicMaterial({ map: arrow, color: new Color(3, 3, 3), toneMapped: false }),
      beacon: new MeshStandardMaterial({ color: amber, emissive: amber, emissiveIntensity: 2, toneMapped: false, transparent: true, opacity: 0.9 }),
      beaconSpin: new MeshBasicMaterial({ color: new Color(5, 3.2, 0.6), toneMapped: false }),
      cone: std("#ff5a0a"),
      coneStripe: new MeshStandardMaterial({ color: "#ffffff", emissive: new Color("#ffffff"), emissiveIntensity: 0.35, roughness: 0.5 }),
      coneBase: std("#202020"),
      barrierBoard: new MeshStandardMaterial({ map: stripes, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: stripes, emissiveIntensity: 0.15 }),
      barrierFeet: std("#2a2a2a"),
      lamp: new MeshStandardMaterial({ color: amber, emissive: amber, emissiveIntensity: 3, toneMapped: false }),
      signFace: new MeshStandardMaterial({ map: sign, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.3 }),
      signBack: std("#8a8f96"),
      signPost: std("#5b5f66"),
      crewLegs: std("#23324f"),
      crewBody: new MeshStandardMaterial({ color: "#ff8c00", emissive: new Color("#ff8c00"), emissiveIntensity: 0.35, roughness: 0.7 }),
      crewHead: std("#e2b48f"),
      crewHat: std("#f7f7f2"),
    };
    // Sign box: front (+z) gets the sign, other faces plain grey. Order: px, nx, py, ny, pz, nz.
    const signMats: Material[] = [mat.signBack, mat.signBack, mat.signBack, mat.signBack, mat.signFace, mat.signBack];
    /** Per-frame flashing of the shared emissive materials (all sites flash in sync). */
    const animate = (now: number) => {
      mat.lamp.emissiveIntensity = Math.sin(now * Math.PI * 3) > 0 ? 4 : 0.25;
      mat.beacon.emissiveIntensity = 1.5 + 2.5 * Math.max(0, Math.sin(now * 14));
      arrow.offset.x = (Math.floor(now * 3.2) % ARROW_FRAMES) / ARROW_FRAMES;
    };
    return { geo, mat, signMats, tex: [arrow, chevron, stripes, sign] as Texture[], animate };
  }, []);

  useEffect(
    () => () => {
      Object.values(assets.geo).forEach((g) => g.dispose());
      Object.values(assets.mat).forEach((m) => m.dispose());
      assets.tex.forEach((t) => t.dispose());
    },
    [assets],
  );
  return assets;
}

type Assets = ReturnType<typeof useAssets>;

// ---------- the truck ----------
function Truck({ id, jobs, assets }: { id: string; jobs: RefObject<Map<string, Job>>; assets: Assets }) {
  const group = useRef<Group>(null);
  const board = useRef<Group>(null);
  const spinA = useRef<Group>(null);
  const spinB = useRef<Group>(null);
  const { geo, mat } = assets;

  useEffect(() => {
    const job = jobs.current.get(id);
    if (!job || !group.current) return;
    job.group = group.current;
    job.entry.object = group.current;
    return () => {
      job.group = null;
    };
  }, [id, jobs]);

  useFrame((_, delta) => {
    const job = jobs.current.get(id);
    if (!job) return;
    const t = performance.now() / 1000;
    if (spinA.current) spinA.current.rotation.y = t * 9;
    if (spinB.current) spinB.current.rotation.y = -t * 9 + 1.3;
    if (board.current) {
      // arrow board folds up while working, lies flat (face up) while driving
      const up = job.clock.phase === "deploying" || job.clock.phase === "active" || job.clock.phase === "packing";
      const target = up ? 0 : Math.PI / 2;
      const cur = board.current.rotation.x;
      board.current.rotation.x = cur + (target - cur) * Math.min(1, Math.min(delta, 0.1) * 2.5);
    }
  });

  return (
    <group ref={group} name={id} scale={0.001}>
      <mesh geometry={geo.wheels} material={mat.tyre} />
      <mesh geometry={geo.chassis} material={mat.chassis} castShadow />
      <mesh geometry={geo.cab} material={mat.cab} castShadow />
      <mesh geometry={geo.windscreen} material={mat.glass} />
      <mesh geometry={geo.bed} material={mat.bed} castShadow />
      <mesh geometry={geo.stripe} material={mat.stripe} />
      <mesh geometry={geo.rear} material={mat.rear} />
      <mesh geometry={geo.headlights} material={mat.headlights} />
      <mesh geometry={geo.taillights} material={mat.taillights} />
      {/* cab roof light bar with two rotating amber beacons */}
      <group position={[0, 2.78, 2.6]}>
        <mesh geometry={geo.lightbar} material={mat.boardFrame} />
        <group position={[-0.5, 0.1, 0]}>
          <mesh geometry={geo.beaconBase} material={mat.beacon} />
          <group ref={spinA}>
            <mesh geometry={geo.beaconSpin} material={mat.beaconSpin} />
          </group>
        </group>
        <group position={[0.5, 0.1, 0]}>
          <mesh geometry={geo.beaconBase} material={mat.beacon} />
          <group ref={spinB}>
            <mesh geometry={geo.beaconSpin} material={mat.beaconSpin} />
          </group>
        </group>
      </group>
      {/* rear-mounted LED arrow board on a hinge */}
      <group position={[0, 2.2, -2.9]}>
        <mesh geometry={geo.boardMast} material={mat.boardFrame} />
        <group ref={board} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={geo.boardFrame} material={mat.boardFrame} />
          <mesh geometry={geo.boardFace} material={mat.boardFace} />
        </group>
      </group>
    </group>
  );
}

// ---------- the module ----------
export default function Roadworks() {
  const assets = useAssets();
  const { geo, mat, signMats } = assets;
  const jobs = useRef(new Map<string, Job>());
  const [truckIds, setTruckIds] = useState<string[]>([]);
  const requests = useRef(0);
  const simT = useRef(0);
  const scheduler = useRef(createScheduler());

  const cones = useRef<InstancedMesh>(null);
  const coneStripes = useRef<InstancedMesh>(null);
  const coneBases = useRef<InstancedMesh>(null);
  const boards = useRef<InstancedMesh>(null);
  const feet = useRef<InstancedMesh>(null);
  const lamps = useRef<InstancedMesh>(null);
  const signBoards = useRef<InstancedMesh>(null);
  const signPosts = useRef<InstancedMesh>(null);
  const crewLegs = useRef<InstancedMesh>(null);
  const crewBody = useRef<InstancedMesh>(null);
  const crewHead = useRef<InstancedMesh>(null);
  const crewHat = useRef<InstancedMesh>(null);

  const cap = MAX_CONCURRENT * MAX_ITEMS;
  const crewCap = MAX_CONCURRENT * CREW;

  // UI requests
  useEffect(
    () =>
      on((e) => {
        if (e.type === "request:roadworks") requests.current += 1;
      }),
    [],
  );

  // On unmount (HMR, page leave): reopen anything we closed and drop our vehicles.
  useEffect(() => {
    const map = jobs.current;
    return () => {
      const w = useWorld.getState();
      for (const job of map.values()) {
        job.unregister();
        if (job.closed) {
          w.unblockEdge(job.target);
          if (job.incidentId) w.updateIncident(job.incidentId, { status: "cleared" });
        }
      }
      map.clear();
    };
  }, []);

  function spawn(): boolean {
    if (jobs.current.size >= MAX_CONCURRENT) return false;
    const blocked = blockedSet();
    const exclude = new Set([...jobs.current.values()].map((j) => j.target));
    const target = chooseTarget({ from: YARD, blocked, exclude });
    if (!target) return false;
    const route = planOutbound(target, YARD, blocked);
    if (!route) return false;
    const a = route.nodes[route.nodes.length - 2];
    const b = route.nodes[route.nodes.length - 1];
    const { items, heading } = placeSite(a, b);
    const id = nextId("RW");
    const entry: VehicleEntry = {
      id,
      kind: "roadworks",
      object: new Object3D(), // swapped for the real group once the truck mounts
      edgeKey: null,
      from: route.nodes[0],
      to: route.nodes[1] ?? route.nodes[0],
      t: 0,
      speed: 0,
      stopped: false,
      crash: () => false, // a 20-tonne works truck doesn't get written off
    };
    const crewPos = new Float32Array(CREW * 2);
    const job: Job = {
      id,
      target,
      site: { a, b, heading, road: roadName(target) },
      clock: createJobClock(),
      route,
      cursor: { seg: 0, t: 0 },
      lastSeg: 0,
      items,
      crewPos,
      incidentId: null,
      closed: false,
      entry,
      unregister: registerVehicle(entry),
      look: new Lookahead({ halfLength: RW_HALF_LEN, halfWidth: RW_HALF_W, decel: RW_BRAKE }),
      group: null,
      heading: lanePosition(route.nodes[0], route.nodes[1] ?? route.nodes[0], 0)[2],
      speed: 0,
      stuck: 0,
      ghost: 0,
      repathT: 0,
      age: 0,
      leaving: -1,
    };
    jobs.current.set(id, job);
    setTruckIds((ids) => [...ids, id]);
    return true;
  }

  function despawn(job: Job) {
    job.unregister();
    jobs.current.delete(job.id);
    setTruckIds((ids) => ids.filter((x) => x !== job.id));
  }

  function closeRoad(job: Job) {
    const w = useWorld.getState();
    const [x, z] = edgeMidpoint(job.target);
    const incidentId = nextId("INC");
    const note = `Emergency roadworks: ${job.site.road} closed`;
    job.incidentId = incidentId;
    w.addIncident({ id: incidentId, kind: "roadworks", edgeKey: job.target, x, z, status: "active", createdAt: performance.now(), note });
    emit({ type: "incident:created", incidentId });
    // If something else (a crash) already closed this road, leave its block alone so we don't reopen it early.
    if (!(job.target in w.blocked)) {
      job.closed = true;
      w.blockEdge(job.target, note);
      emit({ type: "road:blocked", edgeKey: job.target, reason: note });
    }
  }

  function reopenRoad(job: Job) {
    const w = useWorld.getState();
    if (job.incidentId) w.updateIncident(job.incidentId, { status: "cleared", note: `Roadworks finished: ${job.site.road} reopened` });
    if (job.closed) {
      w.unblockEdge(job.target);
      emit({ type: "road:reopened", edgeKey: job.target });
    }
    if (job.incidentId) emit({ type: "incident:cleared", incidentId: job.incidentId });
    job.closed = false;
  }

  function drive(job: Job, dt: number, blocked: ReadonlySet<string>): boolean {
    const { route, cursor } = job;
    if (route.nodes.length < 2) return true;
    let from = route.nodes[cursor.seg];
    let to = route.nodes[cursor.seg + 1];
    const edge = getEdge(from, to);
    const len = edge?.length ?? 1;

    // Queue behind whatever is ahead in our lane.
    let want = cruiseSpeed(edge);
    const lastSeg = cursor.seg === route.nodes.length - 2;
    if (lastSeg) {
      // ease into the stop
      const remain = (route.endT - cursor.t) * len;
      want = Math.min(want, Math.max(2.5, remain * 0.9));
    }
    if (job.stuck >= STUCK_GHOST_S) {
      job.ghost = 2.5;
      job.stuck = 0;
    }
    job.ghost = Math.max(0, job.ghost - dt);
    const ahead = job.ghost > 0 ? undefined : vehiclesAhead(from, to, cursor.t, job.id)[0];
    if (ahead) want = queueWant(want, (ahead.t - cursor.t) * len, ahead.speed);
    // look-ahead raycast: brake for anything in front, give way to a vehicle sitting in the junction
    if (job.ghost <= 0) {
      const [lx, lz, lh] = lanePosition(from, to, cursor.t);
      job.look.scan(job.id, lx, lz, lh, job.speed, dt, view.sees(lx, lz));
      want = lookWant(want, job.look, (1 - cursor.t) * len - RW_STOP_LINE - RW_HALF_LEN, lastSeg ? null : getNode(to));
    }
    job.speed = approachSpeed(job.speed, want, dt);
    if (job.speed < 0.05 && want === 0) {
      job.speed = 0;
      job.stuck += dt;
    } else job.stuck = 0;

    const arrived = advanceRoute(route, cursor, job.speed * dt);

    // New road, or every half second: if something further on got closed since we planned, re-plan from here.
    job.repathT -= dt;
    if (cursor.seg !== job.lastSeg || job.repathT <= 0) {
      job.lastSeg = cursor.seg;
      job.repathT = 0.5;
      const ignore = job.clock.phase === "outbound" ? job.target : undefined;
      if (needsRepath(route, cursor, blocked, ignore)) {
        const head = route.nodes[cursor.seg + 1];
        const tail =
          job.clock.phase === "outbound"
            ? planOutbound(job.target, head, blocked)
            : (() => {
                const p = findPath(head, YARD, blocked);
                return p ? { nodes: p, endT: 1 } : null;
              })();
        if (tail && tail.nodes.length >= 1) {
          spliceRoute(route, cursor, tail);
          // the new route may enter the works road from the other end: re-lay the site to match
          const n = route.nodes.length;
          if (job.clock.phase === "outbound" && route.nodes[n - 2] !== job.site.a) {
            const a = route.nodes[n - 2];
            const b = route.nodes[n - 1];
            const placed = placeSite(a, b);
            job.items = placed.items;
            job.site = { ...job.site, a, b, heading: placed.heading };
          }
        }
      }
    }

    from = route.nodes[cursor.seg];
    to = route.nodes[cursor.seg + 1];
    const [x, z, h] = lanePosition(from, to, cursor.t);
    const e = job.entry;
    e.from = from;
    e.to = to;
    e.t = cursor.t;
    e.edgeKey = getEdge(from, to)?.key ?? null;
    e.speed = job.speed;
    e.stopped = job.speed < 0.1;
    if (job.group) {
      job.group.position.set(x, 0, z);
      job.heading = wrapAngle(job.heading + wrapAngle(h - job.heading) * Math.min(1, dt * 8));
      job.group.rotation.y = job.heading;
    }
    return arrived;
  }

  useFrame(({ camera }, rawDelta) => {
    const world = useWorld.getState();
    view.update(camera);
    const now = performance.now() / 1000;
    if (!world.paused) {
      const dt = Math.min(rawDelta, 0.1);
      simT.current += dt;

      // spawn: schedule + UI requests (requests beyond the limit are dropped)
      while (requests.current > 0) {
        requests.current -= 1;
        spawn();
      }
      if (schedulerDue(scheduler.current, simT.current, jobs.current.size)) spawn();

      scratchBlocked.clear();
      for (const k in world.blocked) scratchBlocked.add(k);
      const blocked = scratchBlocked;

      for (const job of jobs.current.values()) {
        if (job.leaving >= 0) {
          job.leaving += dt;
          if (job.group) job.group.scale.setScalar(Math.max(0.001, 1 - job.leaving / DESPAWN_S));
          if (job.leaving >= DESPAWN_S) despawn(job);
          continue;
        }
        const phase = job.clock.phase;
        let arrived = false;
        if (phase === "outbound" || phase === "returning") arrived = drive(job, dt, blocked);
        job.age += dt;
        if (job.group) job.group.scale.setScalar(Math.min(1, 0.001 + job.age / SPAWN_S));

        for (const action of stepJob(job.clock, dt, arrived)) {
          if (action === "arrived") {
            job.speed = 0;
            job.entry.speed = 0;
            job.entry.stopped = true;
            // crew hop out of the cab doors
            const [cx, cz] = [job.group?.position.x ?? 0, job.group?.position.z ?? 0];
            for (let c = 0; c < CREW; c++) {
              job.crewPos[c * 2] = cx + Math.sin(job.heading) * 2.4 + Math.cos(job.heading) * (c - 1) * 1.3;
              job.crewPos[c * 2 + 1] = cz + Math.cos(job.heading) * 2.4 - Math.sin(job.heading) * (c - 1) * 1.3;
            }
          } else if (action === "close_road") closeRoad(job);
          else if (action === "start_packing") {
            if (job.incidentId) world.updateIncident(job.incidentId, { status: "clearing" });
          } else if (action === "reopen_road") {
            reopenRoad(job);
            const back = planReturn(job.site.a, job.site.b, YARD, blockedSet());
            if (!back) job.leaving = 0;
            else {
              job.route = back.route;
              job.cursor = back.cursor;
              job.lastSeg = 0;
            }
          } else if (action === "despawn") {
            job.entry.stopped = true;
            job.leaving = 0;
          }
        }
        if (job.clock.phase === "deploying" || job.clock.phase === "active" || job.clock.phase === "packing") {
          job.entry.stopped = true;
          job.entry.speed = 0;
        }
      }
    }

    // ---- site visuals: cones, barriers, lamps, signs, crew ----
    let nCone = 0;
    let nBarrier = 0;
    let nLamp = 0;
    let nSign = 0;
    let nCrew = 0;
    assets.animate(now);

    for (const job of jobs.current.values()) {
      const p = siteProgress(job.clock);
      const working = job.clock.phase === "deploying" || job.clock.phase === "active" || job.clock.phase === "packing";
      if (p <= 0 && !working) continue;
      const N = job.items.length;
      const placed = p * N;
      for (let i = 0; i < N; i++) {
        const k = Math.max(0, Math.min(1, placed - i));
        if (k <= 0) continue;
        const it = job.items[i];
        const pop = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
        const drop = (1 - pop) * 1.2;
        dummy.position.set(it.x, drop, it.z);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.setScalar(ITEM_SCALE * Math.max(0.001, pop));
        dummy.updateMatrix();
        if (it.kind === "cone") {
          if (nCone < cap) {
            cones.current?.setMatrixAt(nCone, dummy.matrix);
            coneStripes.current?.setMatrixAt(nCone, dummy.matrix);
            coneBases.current?.setMatrixAt(nCone, dummy.matrix);
            nCone++;
          }
        } else if (it.kind === "barrier") {
          if (nBarrier < cap) {
            boards.current?.setMatrixAt(nBarrier, dummy.matrix);
            feet.current?.setMatrixAt(nBarrier, dummy.matrix);
            nBarrier++;
            // two flashing lamps on top of each barrier
            const s = ITEM_SCALE * pop;
            const ax = Math.cos(it.rotY);
            const az = -Math.sin(it.rotY);
            for (const side of [-1.45, 1.45]) {
              if (nLamp >= cap * 2) break;
              dummy.position.set(it.x + ax * side * s, drop + 1.12 * s, it.z + az * side * s);
              dummy.updateMatrix();
              lamps.current?.setMatrixAt(nLamp++, dummy.matrix);
            }
          }
        } else if (nSign < cap) {
          signBoards.current?.setMatrixAt(nSign, dummy.matrix);
          signPosts.current?.setMatrixAt(nSign, dummy.matrix);
          nSign++;
        }
      }

      // crew: walk to the item being placed / packed, stand around the truck while working
      if (working && job.group) {
        const tx = job.group.position.x;
        const tz = job.group.position.z;
        const sh = Math.sin(job.heading);
        const ch = Math.cos(job.heading);
        for (let c = 0; c < CREW; c++) {
          let gx: number;
          let gz: number;
          if (job.clock.phase === "active") {
            // dig in beside the truck, behind the centre-line cones
            const along = -4.5 - c * 1.6;
            const side = c === 1 ? 2.8 : 0.9;
            gx = tx + sh * along + ch * side * 0.6;
            gz = tz + ch * along - sh * side * 0.6;
          } else {
            const idx = Math.min(N - 1, Math.max(0, Math.floor(placed) + c));
            const it = job.items[idx];
            gx = it.x + ch * 0.9;
            gz = it.z - sh * 0.9;
          }
          const cxp = job.crewPos[c * 2];
          const czp = job.crewPos[c * 2 + 1];
          const dx = gx - cxp;
          const dz = gz - czp;
          const dist = Math.hypot(dx, dz);
          const step = Math.min(dist, 9 * Math.min(rawDelta, 0.1));
          const nx = dist > 1e-3 ? cxp + (dx / dist) * step : cxp;
          const nz = dist > 1e-3 ? czp + (dz / dist) * step : czp;
          if (!world.paused) {
            job.crewPos[c * 2] = nx;
            job.crewPos[c * 2 + 1] = nz;
          }
          if (nCrew >= crewCap) break;
          const walking = dist > 0.3;
          const bob = walking ? Math.abs(Math.sin(now * 12 + c)) * 0.12 : Math.max(0, Math.sin(now * 5 + c * 2)) * 0.06;
          dummy.position.set(nx, bob, nz);
          dummy.rotation.set(walking ? 0 : Math.sin(now * 5 + c * 2) * 0.25, walking ? Math.atan2(dx, dz) : job.heading + Math.PI, 0);
          dummy.scale.setScalar(1.3);
          dummy.updateMatrix();
          crewLegs.current?.setMatrixAt(nCrew, dummy.matrix);
          crewBody.current?.setMatrixAt(nCrew, dummy.matrix);
          crewHead.current?.setMatrixAt(nCrew, dummy.matrix);
          crewHat.current?.setMatrixAt(nCrew, dummy.matrix);
          nCrew++;
        }
      }
    }

    const commit = (m: InstancedMesh | null, n: number) => {
      if (!m) return;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    };
    commit(cones.current, nCone);
    commit(coneStripes.current, nCone);
    commit(coneBases.current, nCone);
    commit(boards.current, nBarrier);
    commit(feet.current, nBarrier);
    commit(lamps.current, nLamp);
    commit(signBoards.current, nSign);
    commit(signPosts.current, nSign);
    commit(crewLegs.current, nCrew);
    commit(crewBody.current, nCrew);
    commit(crewHead.current, nCrew);
    commit(crewHat.current, nCrew);
  });

  const inst = (ref: RefObject<InstancedMesh | null>, g: BufferGeometry, m: Material | Material[], n: number, shadow = false) => (
    <instancedMesh ref={ref} args={[g, m, n]} count={0} frustumCulled={false} castShadow={shadow} />
  );

  return (
    <group name="roadworks">
      {truckIds.map((id) => (
        <Truck key={id} id={id} jobs={jobs} assets={assets} />
      ))}
      {inst(cones, geo.cone, mat.cone, cap)}
      {inst(coneStripes, geo.coneStripe, mat.coneStripe, cap)}
      {inst(coneBases, geo.coneBase, mat.coneBase, cap)}
      {inst(boards, geo.barrierBoard, mat.barrierBoard, cap)}
      {inst(feet, geo.barrierFeet, mat.barrierFeet, cap)}
      {inst(lamps, geo.lamp, mat.lamp, cap * 2)}
      {inst(signBoards, geo.signBoard, signMats, cap)}
      {inst(signPosts, geo.signPost, mat.signPost, cap)}
      {inst(crewLegs, geo.crewLegs, mat.crewLegs, crewCap)}
      {inst(crewBody, geo.crewBody, mat.crewBody, crewCap)}
      {inst(crewHead, geo.crewHead, mat.crewHead, crewCap)}
      {inst(crewHat, geo.crewHat, mat.crewHat, crewCap)}
    </group>
  );
}
