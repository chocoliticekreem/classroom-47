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
import { syncClock, useCompare } from "../compare/store";
import { snapVehicle, useSnapIndex, VEHICLE_REACH_M, type SnapIndex, type VehicleSnap } from "../network/snap";
import { DIMS, MODEL_OF, MotionSim, State, type Entity, type Model } from "./motion";
import { beginFrame, endFrame, recordPose } from "./motionStats";
import { useLive } from "./store";

const MAX_PEOPLE = 400;
const MAX_VEHICLES = 200;
const TRAIL_N = 5;
const TRAIL_STEP_S = 0.22;
const FADE_S = 0.6;
const BIKE_LENGTH = 2;
const BIKE_HEIGHT = 1.2;
/** Walking pace at which the figure's bob reaches full amplitude. */
const STRIDE_MS = 1.4;
const GLOW = { value: 0.4 };

/** Used when the YOLO server is older and sends no colour: a London bus is red, everything else neutral. */
const FALLBACK_COLOR: Record<TrackedClass, string> = {
  person: "#c9a27e",
  car: "#6f93c9",
  bus: "#c8102e",
  truck: "#d9d9d9",
  motorcycle: "#3a3a42",
  bicycle: "#3a3a42",
};

const _railed: VehicleSnap = { x: 0, z: 0, heading: 0, laneId: -1, s: 0, dist: 0 };
/** The lane each compared vehicle last rode, so it does not flicker between lanes. */
const railLane = new WeakMap<object, number>();

/** A compared camera's track, drawn 1:1 with the real video's clock (which loops). */
interface SyncTrack {
  camId: string;
  frame: CamFrame;
  kind: TrackedObject["kind"];
  cls: TrackedClass;
  color: THREE.Color;
  pts: TrackedObject["pts"];
  t0: number;
  t1: number;
  seed: number;
  model: Model;
  skin: THREE.Color;
}

/** Uniform scale that brings each model to its class's real length. */
const MODEL_SCALE: Record<Exclude<TrackedClass, "person">, number> = {
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
  seg: number;
}

function placePerson(scene: Scene, x: number, z: number, yaw: number, fade: number, speed: number, seed: number, now: number, color: THREE.Color, skin: THREE.Color) {
  const slot = scene.person;
  if (slot.n >= MAX_PEOPLE) return false;
  const pace = Math.min(1, speed / STRIDE_MS);
  const bob = Math.abs(Math.sin(now * (4 + 6 * pace) + seed * 20)) * 0.04 * pace;
  _q.setFromAxisAngle(UP, yaw);
  _p.set(x, bob * fade, z);
  _s.set(fade, fade, fade);
  slot.meshes[0].setMatrixAt(slot.n, _m.compose(_p, _q, _s));
  slot.meshes[0].setColorAt(slot.n, color);
  scene.head.setColorAt(slot.n, skin);
  slot.n++;
  return true;
}

function placeVehicle(scene: Scene, model: Model, cls: TrackedClass, x: number, z: number, yaw: number, fade: number, color: THREE.Color) {
  const slot = scene[model];
  if (slot.n >= MAX_VEHICLES) return false;
  _q.setFromAxisAngle(UP, yaw);
  _p.set(x, 0, z);
  const sc = fade * (MODEL_SCALE[cls as keyof typeof MODEL_SCALE] ?? MODEL_SCALE.car);
  _s.set(sc, sc, sc);
  slot.meshes[0].setMatrixAt(slot.n, _m.compose(_p, _q, _s));
  // A London bus is red on the CCTV too; keep Arvin's livery rather than the camera's dim median.
  slot.meshes[0].setColorAt(slot.n, model === "bus" ? BUS_WHITE : color);
  slot.n++;
  return true;
}

function trailSegment(scene: Scene, isPerson: boolean, x0: number, z0: number, x1: number, z1: number, a0: number, a1: number) {
  const { pos, col } = scene;
  const base = isPerson ? PERSON : CAR;
  const dim = isPerson ? PERSON_DIM : CAR_DIM;
  const o = scene.seg * 6;
  const h = isPerson ? 0.9 : 0.6;
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
  scene.seg++;
}

/** Live entities: played once, dead-reckoned, never looped. The compared camera's entities are drawn by `drawSynced`. */
function drawEntities(scene: Scene, ents: Entity[], now: number, skipCam: string | null) {
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.camId === skipCam || e.fade <= 0) continue;
    const isPerson = e.kind === "person";
    const placed = isPerson
      ? placePerson(scene, e.x, e.z, e.yaw, e.fade, e.speed, e.seed, now, e.color, e.skin)
      : placeVehicle(scene, e.model, e.cls, e.x, e.z, e.yaw, e.fade, e.color);
    if (!placed) continue;
    recordPose(e.key, e.x, e.z, isPerson ? -1 : e.laneId, isPerson);
    if (e.state !== State.Tracked) continue;
    const t = now - e.clipStart;
    let px = e.x;
    let pz = e.z;
    for (let k = 1; k <= TRAIL_N; k++) {
      if (!sampleInto(e.pts, t - k * TRAIL_STEP_S, _uv)) break;
      projectInto(e.frame, _uv[0], _uv[1], _prevXz);
      trailSegment(scene, isPerson, px, pz, _prevXz[0], _prevXz[1], e.fade * (1 - (k - 1) / TRAIL_N), e.fade * (1 - k / TRAIL_N));
      px = _prevXz[0];
      pz = _prevXz[1];
    }
  }
}

/** The compared camera stays 1:1 with its (looping) video clock, unsnapped, so figures cross when the real ones do. */
function drawSynced(scene: Scene, tracks: SyncTrack[], syncT: number, now: number, snap: SnapIndex | null) {
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i];
    if (!sampleInto(tr.pts, syncT, _uv)) continue;
    projectInto(tr.frame, _uv[0], _uv[1], _xz);
    const fade = Math.min(1, (syncT - tr.t0) / FADE_S, (tr.t1 - syncT) / FADE_S);
    if (fade <= 0) continue;
    let yaw = 0;
    let speed = 0;
    let moving = false;
    if (sampleInto(tr.pts, syncT - 0.3, _uv)) {
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      const dx = _xz[0] - _prevXz[0];
      const dz = _xz[1] - _prevXz[1];
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4) {
        yaw = Math.atan2(dx, dz);
        speed = Math.sqrt(d2) / 0.3;
        moving = true;
      }
    }
    const isPerson = tr.kind === "person";
    let cx = _xz[0];
    let cz = _xz[1];
    if (isPerson) {
      if (!placePerson(scene, cx, cz, yaw, fade, speed, tr.seed, now, tr.color, tr.skin)) continue;
    } else {
      if (snap && snapVehicle(snap, cx, cz, moving ? yaw : NaN, _railed, VEHICLE_REACH_M, railLane.get(tr) ?? -1, tr.cls === "bus")) {
        // On rails: the pose is the lane's, the track only says which lane and which way.
        railLane.set(tr, _railed.laneId);
        cx = _railed.x;
        cz = _railed.z;
        yaw = _railed.heading;
      } else {
        const [w, , l] = DIMS[tr.cls as keyof typeof DIMS] ?? DIMS.car;
        const rx = cx - tr.frame.x;
        const rz = cz - tr.frame.z;
        const rl = Math.hypot(rx, rz) || 1;
        if (!moving) yaw = Math.atan2(rx, rz);
        const along = Math.abs((rx / rl) * Math.sin(yaw) + (rz / rl) * Math.cos(yaw));
        const push = 0.5 * (along * l + Math.sqrt(1 - Math.min(1, along * along)) * w);
        cx += (rx / rl) * push;
        cz += (rz / rl) * push;
      }
      if (!placeVehicle(scene, tr.model, tr.cls, cx, cz, yaw, fade, tr.color)) continue;
    }
    let px = cx;
    let pz = cz;
    for (let k = 1; k <= TRAIL_N; k++) {
      if (!sampleInto(tr.pts, syncT - k * TRAIL_STEP_S, _uv)) break;
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      trailSegment(scene, isPerson, px, pz, _prevXz[0], _prevXz[1], fade * (1 - (k - 1) / TRAIL_N), fade * (1 - k / TRAIL_N));
      px = _prevXz[0];
      pz = _prevXz[1];
    }
  }
}

function flush(scene: Scene) {
  for (const slot of [scene.person, scene.car, scene.van, scene.bus, scene.bike]) {
    for (const m of slot.meshes) m.count = slot.n;
    const lead = slot.meshes[0];
    lead.instanceMatrix.needsUpdate = true;
    if (lead.instanceColor) lead.instanceColor.needsUpdate = true;
  }
  if (scene.head.instanceColor) scene.head.instanceColor.needsUpdate = true;
  scene.tl.geometry.setDrawRange(0, scene.seg * 2);
  (scene.tl.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  (scene.tl.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
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

  const sim = useMemo(() => new MotionSim(), []);
  const compareCamId = useCompare((s) => s.camId);

  useEffect(() => {
    sim.ingest(cams, clips, performance.now() / 1000);
  }, [sim, cams, clips]);

  useEffect(() => {
    if (poseVersion > 0) sim.reframe(cams);
  }, [sim, cams, poseVersion]);

  // The compared camera is drawn straight from its clip on the video's clock, so it is memoised here, not simulated.
  const synced = useMemo<SyncTrack[]>(() => {
    const cam = cams.find((c) => c.id === compareCamId);
    const clip = cam ? clips[cam.id] : null;
    if (!cam || !clip || clip.duration <= 0) return [];
    const frame = camFrame(cam);
    const out: SyncTrack[] = [];
    for (const tr of clip.tracks) {
      if (tr.pts.length < 2) continue;
      const cls: TrackedClass = tr.cls ?? (tr.kind === "person" ? "person" : "car");
      out.push({
        camId: cam.id,
        frame,
        kind: tr.kind,
        cls,
        color: new THREE.Color(tr.color ?? FALLBACK_COLOR[cls]),
        pts: tr.pts,
        t0: tr.pts[0][0],
        t1: tr.pts[tr.pts.length - 1][0],
        seed: (tr.id * 0.618) % 1,
        model: MODEL_OF[cls],
        skin: SKIN[tr.id % SKIN.length],
      });
    }
    return out;
    // poseVersion: re-project when a camera's pose is adjusted in the compare view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams, clips, compareCamId, poseVersion]);

  const trails = useRef<THREE.LineSegments>(null);

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
        seg: 0,
      };
    }
    const sc = scene.current;
    const video = syncClock.video;
    const syncT = video && video.readyState >= 2 ? video.currentTime : -1;
    const night = ATMOS.windowGlow;
    rig.lights.color.setScalar(0.3 + 0.7 * night);
    GLOW.value = 0.1 + 0.35 * night;
    sc.person.n = sc.car.n = sc.van.n = sc.bus.n = sc.bike.n = 0;
    sc.seg = 0;
    beginFrame();
    sim.step(performance.now() / 1000, Math.min(dt, 0.1), snap);
    drawEntities(sc, sim.ents, performance.now() / 1000, syncClock.camId);
    if (syncT >= 0) drawSynced(sc, synced, syncT, clock.elapsedTime, snap);
    endFrame();
    flush(sc);
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
