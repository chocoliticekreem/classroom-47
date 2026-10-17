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
import { syncClock } from "../compare/store";
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

/** Real-world footprint per YOLO class: [width, height, length] in metres. */
const DIMS: Record<Exclude<TrackedClass, "person">, [number, number, number]> = {
  car: [1.85, 1.05, 4.4],
  bus: [2.55, 4.4, 10.8], // London double-decker
  truck: [2.5, 3.2, 7.5],
  motorcycle: [0.8, 1.25, 2.1],
  bicycle: [0.6, 1.15, 1.8],
};

/** Used when the YOLO server is older and sends no colour: a London bus is red, everything else neutral. */
const FALLBACK_COLOR: Record<TrackedClass, string> = {
  person: "#c9a27e",
  car: "#6f93c9",
  bus: "#c8102e",
  truck: "#d9d9d9",
  motorcycle: "#3a3a42",
  bicycle: "#3a3a42",
};

interface FlatTrack {
  camId: string;
  frame: CamFrame;
  duration: number;
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

/** Which of Arvin's models a tracked object is drawn with. */
type Model = "person" | "car" | "van" | "bus" | "bike";

const MODEL_OF: Record<TrackedClass, Model> = {
  person: "person",
  car: "car",
  truck: "van",
  bus: "bus",
  motorcycle: "bike",
  bicycle: "bike",
};

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
}

function animate(scene: Scene, tracks: FlatTrack[], now: number, syncT: number) {
  const { tl, pos, col } = scene;
  scene.person.n = scene.car.n = scene.van.n = scene.bus.n = scene.bike.n = 0;
  let seg = 0;

  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i];
    const isPerson = tr.kind === "person";
    const slot = scene[tr.model];
    if (slot.n >= (isPerson ? MAX_PEOPLE : MAX_VEHICLES)) continue;
    const synced = syncT >= 0 && tr.camId === syncClock.camId;
    const t = synced ? syncT : (now + tr.seed * tr.duration) % tr.duration;
    if (!sampleInto(tr.pts, t, _uv)) continue;
    projectInto(tr.frame, _uv[0], _uv[1], _xz);
    const fade = Math.min(1, (t - tr.t0) / FADE_S, (tr.t1 - t) / FADE_S);
    if (fade <= 0) continue;

    let yaw = 0;
    let moving = false;
    let speed = 0;
    if (sampleInto(tr.pts, t - 0.3, _uv)) {
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      const dx = _xz[0] - _prevXz[0];
      const dz = _xz[1] - _prevXz[1];
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4) {
        yaw = Math.atan2(dx, dz);
        moving = true;
        speed = Math.sqrt(d2) / 0.3;
      }
    }
    _q.setFromAxisAngle(UP, yaw);

    const body = slot.meshes[0];
    if (isPerson) {
      const pace = Math.min(1, speed / STRIDE_MS);
      const bob = Math.abs(Math.sin(now * (4 + 6 * pace) + tr.seed * 20)) * 0.04 * pace;
      _p.set(_xz[0], bob * fade, _xz[1]);
      _s.set(fade, fade, fade);
      body.setMatrixAt(slot.n, _m.compose(_p, _q, _s));
      body.setColorAt(slot.n, tr.color);
      scene.head.setColorAt(slot.n, tr.skin);
    } else {
      const [w, , l] = DIMS[tr.cls as keyof typeof DIMS] ?? DIMS.car;
      // YOLO's point is the bottom of the box: the vehicle's near edge. Push the centre away from the
      // camera by half the footprint seen along the ray, so the far side lands where the real one ends.
      const rx = _xz[0] - tr.frame.x;
      const rz = _xz[1] - tr.frame.z;
      const rl = Math.hypot(rx, rz) || 1;
      if (!moving) yaw = Math.atan2(rx, rz);
      _q.setFromAxisAngle(UP, yaw);
      const along = Math.abs((rx / rl) * Math.sin(yaw) + (rz / rl) * Math.cos(yaw));
      const push = 0.5 * (along * l + Math.sqrt(1 - Math.min(1, along * along)) * w);
      _p.set(_xz[0] + (rx / rl) * push, 0, _xz[1] + (rz / rl) * push);
      const k = fade * (MODEL_SCALE[tr.cls as keyof typeof MODEL_SCALE] ?? MODEL_SCALE.car);
      _s.set(k, k, k);
      body.setMatrixAt(slot.n, _m.compose(_p, _q, _s));
      // A London bus is red on the CCTV too; keep Arvin's livery rather than the camera's dim median.
      body.setColorAt(slot.n, tr.model === "bus" ? BUS_WHITE : tr.color);
    }
    slot.n++;

    const base = isPerson ? PERSON : CAR;
    const dim = isPerson ? PERSON_DIM : CAR_DIM;
    let px = _xz[0];
    let pz = _xz[1];
    for (let k = 1; k <= TRAIL_N; k++) {
      const ts = t - k * TRAIL_STEP_S;
      if (!sampleInto(tr.pts, ts, _uv)) break;
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      const o = seg * 6;
      const h = isPerson ? 0.9 : 0.6;
      pos[o] = px;
      pos[o + 1] = h;
      pos[o + 2] = pz;
      pos[o + 3] = _prevXz[0];
      pos[o + 4] = h;
      pos[o + 5] = _prevXz[1];
      const a0 = fade * (1 - (k - 1) / TRAIL_N);
      const a1 = fade * (1 - k / TRAIL_N);
      col[o] = dim.r + (base.r - dim.r) * a0;
      col[o + 1] = dim.g + (base.g - dim.g) * a0;
      col[o + 2] = dim.b + (base.b - dim.b) * a0;
      col[o + 3] = dim.r + (base.r - dim.r) * a1;
      col[o + 4] = dim.g + (base.g - dim.g) * a1;
      col[o + 5] = dim.b + (base.b - dim.b) * a1;
      seg++;
      px = _prevXz[0];
      pz = _prevXz[1];
    }
  }

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

  const tracks = useMemo<FlatTrack[]>(() => {
    const out: FlatTrack[] = [];
    for (const cam of cams) {
      const clip = clips[cam.id];
      if (!clip || clip.duration <= 0) continue;
      const frame = camFrame(cam);
      for (const tr of clip.tracks) {
        if (tr.pts.length < 2) continue;
        const cls: TrackedClass = tr.cls ?? (tr.kind === "person" ? "person" : "car");
        out.push({
          camId: cam.id,
          frame,
          duration: clip.duration,
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
    }
    return out;
    // poseVersion: re-project when a camera's pose is adjusted in the compare view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams, clips, poseVersion]);

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

  useFrame(({ clock }) => {
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
      };
    }
    const video = syncClock.video;
    const syncT = video && video.readyState >= 2 ? video.currentTime : -1;
    const night = ATMOS.windowGlow;
    rig.lights.color.setScalar(0.3 + 0.7 * night);
    GLOW.value = 0.1 + 0.35 * night;
    animate(scene.current, tracks, clock.elapsedTime, syncT);
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
