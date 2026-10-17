"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackedClass, TrackedObject } from "@/platform/around/types";
import { camFrame, projectInto, sampleInto, usePoseVersion, type CamFrame } from "./project";
import { syncClock } from "../compare/store";
import { useLive } from "./store";

const MAX_PEOPLE = 400;
const MAX_VEHICLES = 200;
const TRAIL_N = 5;
const TRAIL_STEP_S = 0.22;
const FADE_S = 0.6;

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
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _uv = new Float32Array(2);
const _xz = new Float32Array(2);
const _prevXz = new Float32Array(2);
const UP = new THREE.Vector3(0, 1, 0);

const _dims = new THREE.Vector3();
const PERSON = new THREE.Color("#ffb37a");
const PERSON_DIM = new THREE.Color("#8a4a2a");
const CAR = new THREE.Color("#6f93c9");
const CAR_DIM = new THREE.Color("#2b3b5c");

interface Scene {
  pm: THREE.InstancedMesh;
  bm: THREE.InstancedMesh;
  cm: THREE.InstancedMesh;
  tl: THREE.LineSegments;
  pos: Float32Array;
  col: Float32Array;
}

function animate({ pm, bm, cm, tl, pos, col }: Scene, tracks: FlatTrack[], now: number, syncT: number) {
  let np = 0;
  let nv = 0;
  let seg = 0;

  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i];
    const isPerson = tr.kind === "person";
    if (isPerson ? np >= MAX_PEOPLE : nv >= MAX_VEHICLES) continue;
    const synced = syncT >= 0 && tr.camId === syncClock.camId;
    const t = synced ? syncT : (now + tr.seed * tr.duration) % tr.duration;
    if (!sampleInto(tr.pts, t, _uv)) continue;
    projectInto(tr.frame, _uv[0], _uv[1], _xz);
    const fade = Math.min(1, (t - tr.t0) / FADE_S, (tr.t1 - t) / FADE_S);
    if (fade <= 0) continue;

    let yaw = 0;
    let moving = false;
    if (sampleInto(tr.pts, t - 0.3, _uv)) {
      projectInto(tr.frame, _uv[0], _uv[1], _prevXz);
      const dx = _xz[0] - _prevXz[0];
      const dz = _xz[1] - _prevXz[1];
      if (dx * dx + dz * dz > 1e-4) {
        yaw = Math.atan2(dx, dz);
        moving = true;
      }
    }
    _q.setFromAxisAngle(UP, yaw);

    if (isPerson) {
      const bob = Math.sin(now * 7 + tr.seed * 20) * 0.06;
      _p.set(_xz[0], bob * fade, _xz[1]);
      _s.set(fade, fade, fade);
      pm.setMatrixAt(np, _m.compose(_p, _q, _s));
      pm.setColorAt(np, tr.color);
      np++;
    } else {
      const [w, h, l] = DIMS[tr.cls as keyof typeof DIMS] ?? DIMS.car;
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
      _dims.set(w * fade, h * fade, l * fade);
      bm.setMatrixAt(nv, _m.compose(_p, _q, _dims));
      bm.setColorAt(nv, tr.color);
      // Only cars get the glass cabin; buses, trucks and bikes are drawn as one block.
      const cabin = tr.cls === "car" ? fade : 0;
      _s.set(cabin, cabin, cabin);
      cm.setMatrixAt(nv, _m.compose(_p, _q, _s));
      nv++;
    }

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

  pm.count = np;
  bm.count = nv;
  cm.count = nv;
  pm.instanceMatrix.needsUpdate = true;
  bm.instanceMatrix.needsUpdate = true;
  if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
  if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
  cm.instanceMatrix.needsUpdate = true;
  tl.geometry.setDrawRange(0, seg * 2);
  const posAttr = tl.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = tl.geometry.getAttribute("color") as THREE.BufferAttribute;
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
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
        });
      }
    }
    return out;
    // poseVersion: re-project when a camera's pose is adjusted in the compare view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams, clips, poseVersion]);

  const people = useRef<THREE.InstancedMesh>(null);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const cabins = useRef<THREE.InstancedMesh>(null);
  const trails = useRef<THREE.LineSegments>(null);

  const trailBuffers = useMemo(() => {
    const n = (MAX_PEOPLE + MAX_VEHICLES) * TRAIL_N * 2;
    return {
      pos: new Float32Array(n * 3),
      col: new Float32Array(n * 3),
    };
  }, []);

  const geo = useMemo(() => {
    const person = new THREE.CapsuleGeometry(0.32, 1.1, 3, 8);
    person.translate(0, 0.87, 0);
    // Unit box standing on the ground; each instance is scaled to its class's real size.
    const body = new THREE.BoxGeometry(1, 1, 1);
    body.translate(0, 0.5, 0);
    const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.2);
    cabin.translate(0, 1.3, -0.2);
    return { person, body, cabin };
  }, []);

  useEffect(() => {
    return () => {
      geo.person.dispose();
      geo.body.dispose();
      geo.cabin.dispose();
    };
  }, [geo]);

  const scene = useRef<Scene | null>(null);

  useFrame(({ clock }) => {
    if (!scene.current) {
      const pm = people.current;
      const bm = bodies.current;
      const cm = cabins.current;
      const tl = trails.current;
      if (!pm || !bm || !cm || !tl) return;
      scene.current = { pm, bm, cm, tl, pos: trailBuffers.pos, col: trailBuffers.col };
    }
    const video = syncClock.video;
    const syncT = video && video.readyState >= 2 ? video.currentTime : -1;
    animate(scene.current, tracks, clock.elapsedTime, syncT);
  });

  return (
    <group>
      <instancedMesh ref={people} args={[geo.person, undefined, MAX_PEOPLE]} frustumCulled={false}>
        {/* White base: each instance carries the person's real colour from the CCTV frame. */}
        <meshStandardMaterial color="#ffffff" emissive="#ff6a2e" emissiveIntensity={0.12} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={bodies} args={[geo.body, undefined, MAX_VEHICLES]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.3} />
      </instancedMesh>
      <instancedMesh ref={cabins} args={[geo.cabin, undefined, MAX_VEHICLES]} frustumCulled={false}>
        <meshStandardMaterial color="#9fd3ff" emissive="#7fc4ff" emissiveIntensity={1.4} roughness={0.2} />
      </instancedMesh>
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
