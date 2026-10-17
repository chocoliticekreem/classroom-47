"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackedClass, TrackedObject } from "@/platform/around/types";
import { ATMOS } from "../scene/palette";
import { BUS_L, getBusKit } from "./bus/busKit";
import { personBody, personHead, personMaterial, SKIN } from "./models/people";
import { bikeBody, CAR_LENGTH, carBody, lampMaterial, lamps, paintMaterial, VAN_LENGTH, vanBody } from "./models/vehicles";
import { camFrame, projectInto, sampleInto, usePoseVersion, type CamFrame } from "./project";
import {
  DIMS,
  fitVehicles,
  makePlaced,
  sampleVehicle,
  separate,
  spanOf,
  type FittedVehicle,
  type Placed,
  type VehicleClass,
  type VehiclePose,
} from "./trackFit";
import { syncClock } from "../compare/store";
import {
  ON_LANE_M,
  SNAP_ENABLED,
  SNAP_STATS,
  snapPerson,
  snapVehicle,
  useSnapIndex,
  type PersonSnap,
  type SnapIndex,
  type VehicleSnap,
} from "../network/snap";
import { useLive } from "./store";

const MAX_PEOPLE = 400;
const MAX_VEHICLES = 200;
const TRAIL_N = 5;
const TRAIL_STEP_S = 0.22;
const FADE_S = 0.6;
/** A track already there when the clip starts (or still there when it ends) doesn't fade: it was never "spawned". */
const CLIP_EDGE_S = 0.2;
const BIKE_LENGTH = 2;
const BIKE_HEIGHT = 1.2;
/** Walking pace at which the figure's bob reaches full amplitude. */
const STRIDE_MS = 1.4;
const GLOW = { value: 0.4 };
/** Smoothing rate (1/s) toward the snapped pose, so a track settling between two lanes glides rather than flips. */
const SNAP_RATE = 6;
/** Smoothing rate (1/s) of the push that keeps one car from driving into another. */
const PUSH_RATE = 8;

/** Used when the YOLO server is older and sends no colour: a London bus is red, everything else neutral. */
const FALLBACK_COLOR: Record<TrackedClass, string> = {
  person: "#c9a27e",
  car: "#6f93c9",
  bus: "#c8102e",
  truck: "#d9d9d9",
  motorcycle: "#3a3a42",
  bicycle: "#3a3a42",
};

interface PersonTrack {
  camId: string;
  frame: CamFrame;
  duration: number;
  color: THREE.Color;
  pts: TrackedObject["pts"];
  t0: number;
  t1: number;
  seed: number;
  skin: THREE.Color;
}

/** Which of Arvin's models a tracked vehicle is drawn with. */
type Model = "car" | "van" | "bus" | "bike";

interface VehicleTrack {
  camId: string;
  /** Index of the camera: overlaps are resolved between one camera's cars. */
  group: number;
  frame: CamFrame;
  duration: number;
  fit: FittedVehicle;
  t0: number;
  t1: number;
  color: THREE.Color;
  seed: number;
  model: Model;
  scale: number;
  halfL: number;
  halfW: number;
}

const MODEL_OF: Record<VehicleClass, Model> = {
  car: "car",
  truck: "van",
  bus: "bus",
  motorcycle: "bike",
  bicycle: "bike",
};

/** Uniform scale that brings each model to its class's real length. */
const MODEL_SCALE: Record<VehicleClass, number> = {
  car: DIMS.car[2] / CAR_LENGTH,
  truck: DIMS.truck[2] / VAN_LENGTH,
  bus: DIMS.bus[2] / BUS_L,
  motorcycle: DIMS.motorcycle[2] / BIKE_LENGTH,
  bicycle: DIMS.bicycle[2] / BIKE_LENGTH,
};
const BUS_WHITE = new THREE.Color("#ffffff");

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _uv = new Float32Array(2);
const _xz = new Float32Array(2);
const _prevXz = new Float32Array(2);
const UP = new THREE.Vector3(0, 1, 0);
const _vs: VehicleSnap = { x: 0, z: 0, heading: 0, laneId: -1, s: 0, dist: 0 };
const _ps: PersonSnap = { x: 0, z: 0, footwayId: -1, s: 0, dist: 0 };
const _pose: VehiclePose = { x: 0, z: 0, yaw: 0, ext: false };

/** Per-track smoothed pose; `t` is the clip time it was last written at (a loop restart resets it). */
interface Smooth {
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  t: Float32Array;
  push: Float32Array;
}

function makeSmooth(n: number): Smooth {
  return {
    x: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    t: new Float32Array(n).fill(Infinity),
    push: new Float32Array(n),
  };
}

/** Share of tracked vehicles within ON_LANE_M of a lane line and people within ON_LANE_M of a footway, raw vs snapped. Read via `window.__snapStats` with `?snapstats`. */
const stats = { vehicles: 0, vehiclesOnLaneRaw: 0, vehiclesOnLane: 0, people: 0, peopleOnPavementRaw: 0, peopleOnPavement: 0 };
if (SNAP_STATS) (window as unknown as { __snapStats: typeof stats }).__snapStats = stats;

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** Fade in and out mid-clip only; at the clip's own start and end the real camera cuts too. */
function fadeOf(t: number, t0: number, t1: number, duration: number) {
  return Math.min(1, t0 > CLIP_EDGE_S ? (t - t0) / FADE_S : 1, t1 < duration - CLIP_EDGE_S ? (t1 - t) / FADE_S : 1);
}

/** Clip time for a track: the compared camera follows its <video>, the rest loop on the wall clock. */
function clipTime(camId: string, seed: number, duration: number, now: number, syncT: number) {
  return syncT >= 0 && camId === syncClock.camId ? syncT : (now + seed * duration) % duration;
}

const PERSON = new THREE.Color("#ffb37a");
const PERSON_DIM = new THREE.Color("#8a4a2a");
const CAR = new THREE.Color("#6f93c9");
const CAR_DIM = new THREE.Color("#2b3b5c");

interface Slot {
  /** Meshes sharing one instance matrix buffer: the first carries the colour and the matrix. */
  meshes: THREE.InstancedMesh[];
  n: number;
}

interface Scene {
  person: Slot;
  car: Slot;
  van: Slot;
  bus: Slot;
  bike: Slot;
  head: THREE.InstancedMesh;
  tl: THREE.LineSegments;
  pos: Float32Array;
  col: Float32Array;
  placed: Placed;
  /** For each placed car: its index in the vehicle list, clip time, fade and whether its smoothing restarted. */
  placedTrack: Int32Array;
  placedT: Float32Array;
  placedFade: Float32Array;
  placedFresh: Uint8Array;
}

/** One trail segment from (x0, z0) to (x1, z1), brightness a0 → a1. Returns the next segment index. */
function trailSegment(scene: Scene, seg: number, x0: number, z0: number, x1: number, z1: number, h: number, a0: number, a1: number, base: THREE.Color, dim: THREE.Color) {
  const { pos, col } = scene;
  const o = seg * 6;
  pos[o] = x0;
  pos[o + 1] = h;
  pos[o + 2] = z0;
  pos[o + 3] = x1;
  pos[o + 4] = h;
  pos[o + 5] = z1;
  col[o] = dim.r + (base.r - dim.r) * a0;
  col[o + 1] = dim.g + (base.g - dim.g) * a0;
  col[o + 2] = dim.b + (base.b - dim.b) * a0;
  col[o + 3] = dim.r + (base.r - dim.r) * a1;
  col[o + 4] = dim.g + (base.g - dim.g) * a1;
  col[o + 5] = dim.b + (base.b - dim.b) * a1;
  return seg + 1;
}

function animatePeople(scene: Scene, tracks: PersonTrack[], now: number, syncT: number, snap: SnapIndex | null, smooth: Smooth, dt: number, seg: number) {
  const lerpK = 1 - Math.exp(-SNAP_RATE * dt);
  const comparing = syncClock.camId;
  const slot = scene.person;
  const body = slot.meshes[0];
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i];
    if (slot.n >= MAX_PEOPLE) break;
    // The compare view shows exactly what its camera saw: nobody from a neighbouring camera's clip.
    if (comparing && tr.camId !== comparing) continue;
    const t = clipTime(tr.camId, tr.seed, tr.duration, now, syncT);
    if (!sampleInto(tr.pts, t, _uv)) continue;
    projectInto(tr.frame, _uv[0], _uv[1], _xz);
    const fade = fadeOf(t, tr.t0, tr.t1, tr.duration);
    if (fade <= 0) continue;

    let yaw = 0;
    let speed = 0;
    if (sampleInto(tr.pts, t - 0.3, _uv)) {
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      const dx = _xz[0] - _prevXz[0];
      const dz = _xz[1] - _prevXz[1];
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4) {
        yaw = Math.atan2(dx, dz);
        speed = Math.sqrt(d2) / 0.3;
      }
    }
    _q.setFromAxisAngle(UP, yaw);

    // The compared camera stays 1:1 with its pixels; everything else is pulled onto Arvin's network.
    const snapTo = SNAP_ENABLED && tr.camId !== syncClock.camId ? snap : null;
    // A looping or freshly synced track restarts its smoothing instead of gliding across the scene.
    const fresh = t < smooth.t[i] || t - smooth.t[i] > 1;
    smooth.t[i] = t;
    if (SNAP_STATS && snap) {
      stats.people++;
      if (snapPerson(snap, _xz[0], _xz[1], _ps, ON_LANE_M)) stats.peopleOnPavementRaw++;
    }
    if (snapTo && snapPerson(snapTo, _xz[0], _xz[1], _ps)) {
      if (fresh) {
        smooth.x[i] = _ps.x;
        smooth.z[i] = _ps.z;
      } else {
        smooth.x[i] += (_ps.x - smooth.x[i]) * lerpK;
        smooth.z[i] += (_ps.z - smooth.z[i]) * lerpK;
      }
      _xz[0] = smooth.x[i];
      _xz[1] = smooth.z[i];
    }
    if (SNAP_STATS && snap && snapPerson(snap, _xz[0], _xz[1], _ps, ON_LANE_M)) stats.peopleOnPavement++;
    const pace = Math.min(1, speed / STRIDE_MS);
    const bob = Math.abs(Math.sin(now * (4 + 6 * pace) + tr.seed * 20)) * 0.04 * pace;
    _p.set(_xz[0], bob * fade, _xz[1]);
    _s.set(fade, fade, fade);
    body.setMatrixAt(slot.n, _m.compose(_p, _q, _s));
    body.setColorAt(slot.n, tr.color);
    scene.head.setColorAt(slot.n, tr.skin);
    slot.n++;

    let px = _p.x;
    let pz = _p.z;
    for (let k = 1; k <= TRAIL_N; k++) {
      if (!sampleInto(tr.pts, t - k * TRAIL_STEP_S, _uv)) break;
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      seg = trailSegment(scene, seg, px, pz, _prevXz[0], _prevXz[1], 0.9, fade * (1 - (k - 1) / TRAIL_N), fade * (1 - k / TRAIL_N), PERSON, PERSON_DIM);
      px = _prevXz[0];
      pz = _prevXz[1];
    }
  }
  return seg;
}

/**
 * Vehicles come pre-fitted (trackFit.ts): stitched, extended in and out of shot and kept on their road.
 * Each frame places them, then `separate` pushes any car that would clip a nearer one back along its ray.
 */
function animateVehicles(scene: Scene, tracks: VehicleTrack[], now: number, syncT: number, snap: SnapIndex | null, smooth: Smooth, dt: number, seg: number) {
  const lerpK = 1 - Math.exp(-SNAP_RATE * dt);
  const pushK = 1 - Math.exp(-PUSH_RATE * dt);
  const comparing = syncClock.camId;
  const placed = scene.placed;
  placed.n = 0;
  for (let i = 0; i < tracks.length && placed.n < MAX_VEHICLES; i++) {
    const tr = tracks[i];
    if (comparing && tr.camId !== comparing) continue;
    const clock = clipTime(tr.camId, tr.seed, tr.duration, now, syncT);
    // A car there from the clip's first frame (or still there at its last) holds still across the loop point.
    const t = !tr.fit.fadeIn && clock < tr.t0 ? tr.t0 : !tr.fit.fadeOut && clock > tr.t1 ? tr.t1 : clock;
    if (!sampleVehicle(tr.fit, t, _pose)) continue;
    const fade = fadeOf(t, tr.t0, tr.t1, tr.duration);
    if (fade <= 0) continue;
    let { x, z, yaw } = _pose;
    // The compared camera stays 1:1 with its pixels; everything else is pulled onto Arvin's lane lines.
    const snapTo = SNAP_ENABLED && tr.camId !== syncClock.camId ? snap : null;
    const fresh = t < smooth.t[i] || t - smooth.t[i] > 1;
    smooth.t[i] = t;
    if (SNAP_STATS && snap) {
      stats.vehicles++;
      if (snapVehicle(snap, x, z, NaN, _vs, ON_LANE_M)) stats.vehiclesOnLaneRaw++;
    }
    if (snapTo && snapVehicle(snapTo, x, z, yaw, _vs)) {
      if (fresh) {
        smooth.x[i] = _vs.x;
        smooth.z[i] = _vs.z;
        smooth.yaw[i] = _vs.heading;
      } else {
        smooth.x[i] += (_vs.x - smooth.x[i]) * lerpK;
        smooth.z[i] += (_vs.z - smooth.z[i]) * lerpK;
        smooth.yaw[i] = lerpAngle(smooth.yaw[i], _vs.heading, lerpK);
      }
      x = smooth.x[i];
      z = smooth.z[i];
      yaw = smooth.yaw[i];
    }
    if (SNAP_STATS && snap && snapVehicle(snap, x, z, NaN, _vs, ON_LANE_M)) stats.vehiclesOnLane++;
    const p = placed.n++;
    placed.x[p] = x;
    placed.z[p] = z;
    placed.yaw[p] = yaw;
    placed.halfL[p] = tr.halfL;
    placed.halfW[p] = tr.halfW;
    placed.camX[p] = tr.frame.x;
    placed.camZ[p] = tr.frame.z;
    placed.group[p] = tr.group;
    placed.ext[p] = _pose.ext ? 1 : 0;
    scene.placedTrack[p] = i;
    scene.placedT[p] = t;
    scene.placedFade[p] = fade;
    scene.placedFresh[p] = fresh ? 1 : 0;
  }

  separate(placed);

  for (let p = 0; p < placed.n; p++) {
    const i = scene.placedTrack[p];
    const tr = tracks[i];
    const slot = scene[tr.model];
    const target = placed.push[p];
    // An extrapolated car sitting on one the camera really sees is a stale copy of it.
    if (target < 0 || slot.n >= MAX_VEHICLES) {
      smooth.push[i] = 0;
      continue;
    }
    smooth.push[i] = scene.placedFresh[p] ? target : smooth.push[i] + (target - smooth.push[i]) * pushK;
    const rx = placed.x[p] - placed.camX[p];
    const rz = placed.z[p] - placed.camZ[p];
    const rl = Math.hypot(rx, rz) || 1;
    const fade = scene.placedFade[p];
    _p.set(placed.x[p] + (rx / rl) * smooth.push[i], 0, placed.z[p] + (rz / rl) * smooth.push[i]);
    _q.setFromAxisAngle(UP, placed.yaw[p]);
    const sc = fade * tr.scale;
    _s.set(sc, sc, sc);
    const body = slot.meshes[0];
    body.setMatrixAt(slot.n, _m.compose(_p, _q, _s));
    // A London bus is red on the CCTV too; keep Arvin's livery rather than the camera's dim median.
    body.setColorAt(slot.n, tr.model === "bus" ? BUS_WHITE : tr.color);
    slot.n++;

    let px = _p.x;
    let pz = _p.z;
    for (let k = 1; k <= TRAIL_N; k++) {
      if (!sampleVehicle(tr.fit, scene.placedT[p] - k * TRAIL_STEP_S, _pose)) break;
      seg = trailSegment(scene, seg, px, pz, _pose.x, _pose.z, 0.6, fade * (1 - (k - 1) / TRAIL_N), fade * (1 - k / TRAIL_N), CAR, CAR_DIM);
      px = _pose.x;
      pz = _pose.z;
    }
  }
  return seg;
}

function animate(scene: Scene, people: PersonTrack[], vehicles: VehicleTrack[], now: number, syncT: number, snap: SnapIndex | null, smooth: { people: Smooth; vehicles: Smooth }, dt: number) {
  const { tl } = scene;
  scene.person.n = scene.car.n = scene.van.n = scene.bus.n = scene.bike.n = 0;
  if (SNAP_STATS) stats.vehicles = stats.vehiclesOnLaneRaw = stats.vehiclesOnLane = stats.people = stats.peopleOnPavementRaw = stats.peopleOnPavement = 0;
  let seg = animatePeople(scene, people, now, syncT, snap, smooth.people, dt, 0);
  seg = animateVehicles(scene, vehicles, now, syncT, snap, smooth.vehicles, dt, seg);

  for (const slot of [scene.person, scene.car, scene.van, scene.bus, scene.bike]) {
    for (const m of slot.meshes) m.count = slot.n;
    const lead = slot.meshes[0];
    lead.instanceMatrix.needsUpdate = true;
    if (lead.instanceColor) lead.instanceColor.needsUpdate = true;
  }
  if (scene.head.instanceColor) scene.head.instanceColor.needsUpdate = true;
  tl.geometry.setDrawRange(0, seg * 2);
  const posAttr = tl.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = tl.geometry.getAttribute("color") as THREE.BufferAttribute;
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

/** Instanced meshes that share the lead mesh's matrix buffer, so one write per object places every part. */
function makeSlot(parts: [THREE.BufferGeometry, THREE.Material][], capacity: number): Slot {
  const meshes = parts.map(([g, m]) => {
    const mesh = new THREE.InstancedMesh(g, m, capacity);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  });
  for (let i = 1; i < meshes.length; i++) meshes[i].instanceMatrix = meshes[0].instanceMatrix;
  return { meshes, n: 0 };
}

export function Agents() {
  const cams = useLive((s) => s.cams);
  const clips = useLive((s) => s.clips);
  const poseVersion = usePoseVersion((s) => s.v);
  const snap = useSnapIndex();

  const { people, vehicles } = useMemo(() => {
    const people: PersonTrack[] = [];
    const vehicles: VehicleTrack[] = [];
    cams.forEach((cam, group) => {
      const clip = clips[cam.id];
      if (!clip || clip.duration <= 0) return;
      const frame = camFrame(cam);
      for (const tr of clip.tracks) {
        if (tr.kind !== "person" || tr.pts.length < 2) continue;
        people.push({
          camId: cam.id,
          frame,
          duration: clip.duration,
          color: new THREE.Color(tr.color ?? FALLBACK_COLOR.person),
          pts: tr.pts,
          t0: tr.pts[0][0],
          t1: tr.pts[tr.pts.length - 1][0],
          seed: (tr.id * 0.618) % 1,
          skin: SKIN[tr.id % SKIN.length],
        });
      }
      for (const fit of fitVehicles(frame, clip.tracks, clip.duration, snap)) {
        const [t0, t1] = spanOf(fit);
        const [w, , l] = DIMS[fit.cls];
        vehicles.push({
          camId: cam.id,
          group,
          frame,
          duration: clip.duration,
          fit,
          t0,
          t1,
          color: new THREE.Color(fit.color ?? FALLBACK_COLOR[fit.cls]),
          seed: (fit.id * 0.618) % 1,
          model: MODEL_OF[fit.cls],
          scale: MODEL_SCALE[fit.cls],
          halfL: l / 2,
          halfW: w / 2,
        });
      }
    });
    return { people, vehicles };
    // poseVersion: re-project when a camera's pose is adjusted in the compare view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams, clips, poseVersion, snap]);

  const trails = useRef<THREE.LineSegments>(null);

  const smooth = useMemo(() => ({ people: makeSmooth(people.length), vehicles: makeSmooth(vehicles.length) }), [people, vehicles]);

  const trailBuffers = useMemo(() => {
    const n = (MAX_PEOPLE + MAX_VEHICLES) * TRAIL_N * 2;
    return {
      pos: new Float32Array(n * 3),
      col: new Float32Array(n * 3),
    };
  }, []);

  const rig = useMemo(() => {
    const paint = paintMaterial();
    const lights = lampMaterial();
    const clothes = personMaterial(GLOW);
    const kit = getBusKit();
    const geos = {
      body: personBody(),
      head: personHead(),
      car: carBody(),
      carLamps: lamps(CAR_LENGTH, 1.8),
      van: vanBody(),
      vanLamps: lamps(VAN_LENGTH, 2),
      bike: bikeBody(BIKE_LENGTH, BIKE_HEIGHT),
    };
    const person = makeSlot(
      [
        [geos.body, clothes],
        [geos.head, clothes],
      ],
      MAX_PEOPLE,
    );
    const car = makeSlot(
      [
        [geos.car, paint],
        [geos.carLamps, lights],
      ],
      MAX_VEHICLES,
    );
    const van = makeSlot(
      [
        [geos.van, paint],
        [geos.vanLamps, lights],
      ],
      MAX_VEHICLES,
    );
    const bus = makeSlot(
      [
        [kit.body, kit.bodyMat],
        [kit.glass, kit.glassMat],
        [kit.lamps, kit.lampMat],
      ],
      MAX_VEHICLES,
    );
    const bike = makeSlot([[geos.bike, paint]], MAX_VEHICLES);
    return { paint, lights, clothes, geos, person, car, van, bus, bike };
  }, []);

  useEffect(() => {
    return () => {
      for (const s of [rig.person, rig.car, rig.van, rig.bus, rig.bike]) for (const m of s.meshes) m.dispose();
      for (const g of Object.values(rig.geos)) g.dispose();
      rig.paint.dispose();
      rig.lights.dispose();
      rig.clothes.dispose();
    };
  }, [rig]);

  const scene = useRef<Scene | null>(null);

  useFrame(({ clock }, dt) => {
    if (!scene.current) {
      const tl = trails.current;
      if (!tl) return;
      scene.current = {
        person: rig.person,
        car: rig.car,
        van: rig.van,
        bus: rig.bus,
        bike: rig.bike,
        head: rig.person.meshes[1],
        tl,
        pos: trailBuffers.pos,
        col: trailBuffers.col,
        placed: makePlaced(MAX_VEHICLES),
        placedTrack: new Int32Array(MAX_VEHICLES),
        placedT: new Float32Array(MAX_VEHICLES),
        placedFade: new Float32Array(MAX_VEHICLES),
        placedFresh: new Uint8Array(MAX_VEHICLES),
      };
    }
    const video = syncClock.video;
    const syncT = video && video.readyState >= 2 ? video.currentTime : -1;
    const night = ATMOS.windowGlow;
    rig.lights.color.setScalar(0.3 + 0.7 * night);
    GLOW.value = 0.1 + 0.35 * night;
    animate(scene.current, people, vehicles, clock.elapsedTime, syncT, snap, smooth, Math.min(dt, 0.1));
  });

  return (
    <group>
      {[rig.person, rig.car, rig.van, rig.bus, rig.bike].map((s, i) =>
        s.meshes.map((m, j) => <primitive key={`${i}-${j}`} object={m} />),
      )}
      <lineSegments ref={trails} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[trailBuffers.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[trailBuffers.col, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.75}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
