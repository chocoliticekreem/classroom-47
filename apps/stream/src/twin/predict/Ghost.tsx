"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { FieldSegment } from "@/twin/field/types";
import { getLastField, useFieldStore } from "../sim/useField";
import { placeIntervention, setMinute, shownRun, usePredict } from "./store";
import type { InterventionKind, TimelineStep } from "./types";

const MAX_RIBBONS = 3000;
const MAX_GHOSTS = 1600;
const RIBBON_W = 9;
const RIBBON_H = 0.5;
const PLAY_MIN_PER_S = 2.5;

export const KIND_COLOR: Record<InterventionKind, string> = {
  closure: "#ff2d55",
  incident: "#ffb020",
  event: "#ff4d2e",
  weather: "#9fd3ff",
};

const BUSIER = new THREE.Color("#ff6a3d");
const QUIETER = new THREE.Color("#4f9fe0");
const GHOST = new THREE.Color("#ffb37a");
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function stepAt(steps: TimelineStep[], minute: number): TimelineStep | null {
  if (!steps.length) return null;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s.minute - minute) < Math.abs(best.minute - minute)) best = s;
  return best;
}

function hash(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function Ribbons({ step, byId }: { step: TimelineStep | null; byId: Map<number, FieldSegment> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    if (step) {
      for (const seg of step.segments) {
        if (n >= MAX_RIBBONS) break;
        const f = byId.get(seg.id);
        if (!f) continue;
        const dx = f.b[0] - f.a[0];
        const dz = f.b[1] - f.a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const delta = seg.peds - f.peds;
        const mag = Math.min(1, Math.abs(delta) / 12);
        _c.copy(delta >= 0 ? BUSIER : QUIETER).multiplyScalar(0.7 + 0.6 * mag);
        _p.set((f.a[0] + f.b[0]) / 2, RIBBON_H / 2 + 0.08, (f.a[1] + f.b[1]) / 2);
        _q.setFromAxisAngle(UP, Math.atan2(dx, dz));
        _s.set(RIBBON_W * (0.6 + 0.4 * mag), RIBBON_H, len);
        m.setMatrixAt(n, _m.compose(_p, _q, _s));
        m.setColorAt(n, _c);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [step, byId]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_RIBBONS]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0.7} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

function Ghosts({ step, byId, on }: { step: TimelineStep | null; byId: Map<number, FieldSegment>; on: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.45, 1.3, 2, 6);
    g.translate(0, 0.85, 0);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    if (step && on && step.minute > 0) {
      const weighted: { f: FieldSegment; people: number }[] = [];
      let total = 0;
      for (const seg of step.segments) {
        const f = byId.get(seg.id);
        if (!f) continue;
        const people = (seg.peds * Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])) / 100;
        if (people <= 0.05) continue;
        weighted.push({ f, people });
        total += people;
      }
      const scale = total > MAX_GHOSTS ? MAX_GHOSTS / total : 1;
      let carry = 0;
      for (const { f, people } of weighted) {
        carry += people * scale;
        const count = Math.floor(carry);
        carry -= count;
        const dx = f.b[0] - f.a[0];
        const dz = f.b[1] - f.a[1];
        const len = Math.hypot(dx, dz) || 1;
        for (let k = 0; k < count && n < MAX_GHOSTS; k++) {
          const u = hash(n * 3 + 1);
          const side = (hash(n * 3 + 2) - 0.5) * 4;
          _p.set(f.a[0] + dx * u - (dz / len) * side, 0, f.a[1] + dz * u + (dx / len) * side);
          _q.setFromAxisAngle(UP, hash(n * 3 + 3) * Math.PI * 2);
          const h = 0.9 + hash(n) * 0.2;
          _s.set(1, h, 1);
          m.setMatrixAt(n++, _m.compose(_p, _q, _s));
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }, [step, byId, on]);
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, MAX_GHOSTS]} frustumCulled={false}>
      <meshStandardMaterial color={GHOST} emissive={GHOST} emissiveIntensity={0.35} transparent opacity={0.38} depthWrite={false} roughness={0.9} />
    </instancedMesh>
  );
}

function Marker({ x, z, kind }: { x: number; z: number; kind: InterventionKind }) {
  const color = KIND_COLOR[kind];
  const radius = kind === "closure" ? 45 : kind === "incident" ? 70 : kind === "event" ? 60 : 120;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 14, 0]}>
        <cylinderGeometry args={[0.8, 0.8, 28, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 30, 0]}>
        <sphereGeometry args={[2.6, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 1.5, radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.75} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PickPlane() {
  const placing = usePredict((s) => s.placing);
  if (!placing) return null;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    placeIntervention(e.point.x, e.point.z);
  };
  return (
    <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <planeGeometry args={[2400, 2400]} />
      <meshBasicMaterial color={KIND_COLOR[placing]} transparent opacity={0.07} depthWrite={false} />
    </mesh>
  );
}

function Player() {
  const acc = useRef(0);
  useFrame((_, dt) => {
    const s = usePredict.getState();
    if (!s.playing) return;
    acc.current += dt;
    if (acc.current < 0.2) return;
    const next = s.minute + PLAY_MIN_PER_S * acc.current;
    acc.current = 0;
    if (next >= 30) usePredict.setState({ minute: 30, playing: false });
    else setMinute(next);
  });
  return null;
}

/** Future ghost layer: predicted per-segment load as heat ribbons, ghost walkers, intervention markers. */
export function PredictLayers() {
  const run = usePredict(shownRun);
  const minute = usePredict((s) => s.minute);
  const ghosts = usePredict((s) => s.ghosts);
  const pending = usePredict((s) => s.interventions);
  const fieldAt = useFieldStore((s) => s?.at ?? 0);
  const byId = useMemo(() => {
    const map = new Map<number, FieldSegment>();
    if (fieldAt) for (const s of getLastField()?.segments ?? []) map.set(s.id, s);
    return map;
  }, [fieldAt]);
  const step = useMemo(() => (run ? stepAt(run.timeline, Math.round(minute)) : null), [run, minute]);

  return (
    <group>
      <Player />
      <PickPlane />
      {run && minute > 0 && <Ribbons step={step} byId={byId} />}
      {run && <Ghosts step={step} byId={byId} on={ghosts && minute > 0} />}
      {pending.map((iv, i) => (
        <Marker key={i} x={iv.where.x} z={iv.where.z} kind={iv.kind} />
      ))}
    </group>
  );
}
