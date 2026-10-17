"use client";
// Scripted crash actors (cars and an HGV that drive in, collide, spin, tumble or jackknife) and the
// per-crash site markers (pulsing ring, oil slick, warning triangle, floating status badge).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { registerVehicle } from "../../registry";
import type { IncidentStatus } from "../../store";
import { actorPose, type Actor, type ActorPose } from "./choreo";
import { labelTexture, triangleGeometry } from "./vfx";

// --- Shared geometry and materials (created once, lazily) --------------------

function merged(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  return g ?? new THREE.BufferGeometry();
}

function wheels(r: number, w: number, at: [number, number][], y: number) {
  return merged(at.map(([x, z]) => new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z)));
}

function boxes(size: [number, number, number], at: [number, number, number][]) {
  return merged(at.map(([x, y, z]) => new THREE.BoxGeometry(...size).translate(x, y, z)));
}

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  return {
    carBody: new THREE.BoxGeometry(1.9, 0.7, 4.2).translate(0, 0.6, 0),
    carBodyCrumpled: new THREE.BoxGeometry(1.9, 0.7, 3.6).translate(0, 0.6, -0.3),
    carCabin: new THREE.BoxGeometry(1.62, 0.6, 2.1).translate(0, 1.25, -0.25),
    carRoof: new THREE.BoxGeometry(1.72, 0.1, 2.0).translate(0, 1.58, -0.25),
    bonnet: new THREE.BoxGeometry(1.8, 0.07, 1.2).rotateX(-0.55).translate(0, 1.0, 1.0),
    carWheels: wheels(0.38, 0.3, [[0.95, 1.3], [-0.95, 1.3], [0.95, -1.3], [-0.95, -1.3]], 0.38),
    carHazards: boxes([0.28, 0.16, 0.08], [[0.7, 0.75, -2.12], [-0.7, 0.75, -2.12], [0.7, 0.75, 2.1], [-0.7, 0.75, 2.1]]),
    cab: new THREE.BoxGeometry(2.5, 2.4, 2.4).translate(0, 1.75, 1.6),
    windscreen: new THREE.BoxGeometry(2.3, 1.0, 0.1).translate(0, 2.3, 2.82),
    cabWheels: wheels(0.55, 0.4, [[1.15, 0.9], [-1.15, 0.9], [1.15, 2.2], [-1.15, 2.2]], 0.55),
    cabHazards: boxes([0.28, 0.16, 0.08], [[1.0, 1.0, 2.82], [-1.0, 1.0, 2.82]]),
    trailer: new THREE.BoxGeometry(2.6, 3.0, 9.5).translate(0, 2.6, -3.75),
    stripe: new THREE.BoxGeometry(2.64, 0.55, 9.3).translate(0, 2.0, -3.75),
    trailerWheels: wheels(0.55, 0.4, [[1.1, -7.0], [-1.1, -7.0], [1.1, -5.8], [-1.1, -5.8]], 0.55),
    ring: new THREE.RingGeometry(3.4, 4.2, 40).rotateX(-Math.PI / 2),
    slick: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    triOuter: triangleGeometry(1.5),
    triInner: triangleGeometry(0.85),
    triLeg: new THREE.BoxGeometry(0.06, 0.5, 0.06),
    glass: std("#24364a", { roughness: 0.25, metalness: 0.4 }),
    tyre: std("#1b1b1f"),
    hazardMat: new THREE.MeshStandardMaterial({ color: "#ff9d1a", emissive: "#ff8a00", emissiveIntensity: 2 }),
    cabMat: std("#ff6a1a"),
    white: std("#f4f2ee"),
    charred: std("#2a2522"),
    ringMat: new THREE.MeshBasicMaterial({ color: "#ff2a2a", transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    slickMat: new THREE.MeshStandardMaterial({
      color: "#0d0d10",
      roughness: 0.15,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    triRed: new THREE.MeshStandardMaterial({ color: "#e3141b", emissive: "#a00000", emissiveIntensity: 0.6, side: THREE.DoubleSide }),
    triWhite: new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide }),
    paint: new Map<string, THREE.MeshStandardMaterial>(),
  };
}
export function getShared() {
  if (!shared) shared = makeShared();
  return shared;
}
function paint(color: string) {
  const s = getShared();
  let m = s.paint.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, flatShading: true });
    s.paint.set(color, m);
  }
  return m;
}

export const CAR_COLORS = ["#d7263d", "#1b98e0", "#f4d35e", "#3bb273", "#7b2cbf", "#f4f2ee", "#222831", "#ff8c42"];

/** Where the smoke/fire of an actor comes from, in actor-local coords (bonnet / engine). */
export const ENGINE_Z = { car: 1.5, hgv: 1.6 } as const;

// --- Animated actor -----------------------------------------------------------

export interface Frame {
  cx: number;
  cz: number;
  h: number;
}

export interface LaneRef {
  edgeKey: string;
  from: string;
  to: string;
  t: number;
}

const ROLL_PIVOT = 0.8; // cars tumble about their middle, not their wheels

export function ActorView({ actor, clock, frame, lane, burnt }: { actor: Actor; clock: { t: number }; frame: Frame; lane: LaneRef; burnt: boolean }) {
  const s = getShared();
  const root = useRef<THREE.Group>(null);
  const roll = useRef<THREE.Group>(null);
  const trailer = useRef<THREE.Group>(null);
  const pose = useMemo<ActorPose>(() => ({ x: 0, y: 0, z: 0, yaw: 0, roll: 0, fold: 0, moving: true }), []);
  const proxy = useMemo(() => new THREE.Object3D(), []);

  // Registry proxy in world space (registry readers expect world position / rotation.y).
  useEffect(() => {
    const off = registerVehicle({
      id: actor.id,
      kind: actor.model === "hgv" ? "truck" : "car",
      object: proxy,
      edgeKey: lane.edgeKey,
      from: lane.from,
      to: lane.to,
      t: lane.t,
      speed: 0,
      stopped: true, // never a candidate for another crash
      crash: () => false,
    });
    return () => {
      off();
    };
  }, [actor, proxy, lane]);

  useFrame(() => {
    actorPose(actor, clock.t, pose);
    const g = root.current;
    if (!g) return;
    g.position.set(pose.x, pose.y, pose.z);
    g.rotation.y = pose.yaw;
    if (roll.current) roll.current.rotation.z = pose.roll;
    if (trailer.current) trailer.current.rotation.y = pose.fold;
    const c = Math.cos(frame.h);
    const sn = Math.sin(frame.h);
    proxy.position.set(frame.cx + pose.x * c + pose.z * sn, 0, frame.cz - pose.x * sn + pose.z * c);
    proxy.rotation.set(0, frame.h + pose.yaw, 0);
  });

  if (actor.model === "hgv") {
    return (
      <group ref={root}>
        <group ref={roll} position={[0, ROLL_PIVOT, 0]}>
          <group position={[0, -ROLL_PIVOT, 0]}>
            <mesh geometry={s.cab} material={burnt && actor.fire ? s.charred : s.cabMat} castShadow />
            <mesh geometry={s.windscreen} material={s.glass} />
            <mesh geometry={s.cabWheels} material={s.tyre} />
            <mesh geometry={s.cabHazards} material={s.hazardMat} />
            <group ref={trailer}>
              <mesh geometry={s.trailer} material={s.white} castShadow />
              <mesh geometry={s.stripe} material={s.cabMat} />
              <mesh geometry={s.trailerWheels} material={s.tyre} />
            </group>
          </group>
        </group>
      </group>
    );
  }
  const body = burnt && actor.fire ? s.charred : paint(actor.color);
  return (
    <group ref={root}>
      <group ref={roll} position={[0, ROLL_PIVOT, 0]}>
        <group position={[0, -ROLL_PIVOT, 0]}>
          <mesh geometry={actor.crumpled ? s.carBodyCrumpled : s.carBody} material={body} castShadow />
          <mesh geometry={s.carCabin} material={s.glass} />
          <mesh geometry={s.carRoof} material={body} />
          {actor.crumpled && <mesh geometry={s.bonnet} material={body} />}
          <mesh geometry={s.carWheels} material={s.tyre} />
          <mesh geometry={s.carHazards} material={s.hazardMat} />
        </group>
      </group>
    </group>
  );
}

// --- Site markers -----------------------------------------------------------

const STATUS_TEXT: Record<IncidentStatus, [string, string]> = {
  active: ["Road closed · no units yet", "#e0262b"],
  responding: ["Units on scene", "#ef7d00"],
  clearing: ["Clearing wreckage", "#2f6fd6"],
  cleared: ["Road reopened", "#2a9d55"],
};

export function SiteMarker({
  title,
  status,
  slick,
  tri,
  phase,
  size = 1,
  labelZ = 0,
}: {
  title: string;
  status: IncidentStatus;
  slick: number; // oil slick radius
  tri: [number, number]; // warning triangle position in the crash frame (faces upstream, -z)
  phase: number; // animation offset so sites don't pulse in sync
  size?: number; // ring scale (pileups are big)
  labelZ?: number; // badge position along the crash frame
}) {
  const s = getShared();
  const ring = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.Sprite>(null);
  const [text, color] = STATUS_TEXT[status];
  const map = useMemo(() => labelTexture(title, text, color), [title, text, color]);
  const ringMat = useMemo(() => s.ringMat.clone(), [s]);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  useEffect(() => {
    ringMat.color.set(status === "active" ? "#ff2a2a" : status === "responding" ? "#ff9a1a" : "#3a8bff");
  }, [ringMat, status]);
  useFrame(() => {
    const t = performance.now() / 1000 + phase;
    if (ring.current) {
      const k = (t * 0.9) % 1;
      ring.current.scale.setScalar((0.7 + k * 1.6) * size);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
    }
    if (label.current) label.current.position.y = 12 + size * 2 + Math.sin(t * 2) * 0.35;
  });
  return (
    <>
      <mesh ref={ring} geometry={s.ring} material={ringMat} position={[0, 0.09, labelZ]} renderOrder={5} />
      <mesh geometry={s.slick} material={s.slickMat} position={[0.4, 0.075, -0.3]} scale={[slick, 1, slick * 0.75]} />
      <group position={[tri[0], 0, tri[1]]}>
        <group rotation={[0, Math.PI, 0]} scale={1.6}>
          <mesh geometry={s.triLeg} material={s.tyre} position={[-0.3, 0.25, -0.15]} rotation={[0.5, 0, 0]} />
          <mesh geometry={s.triLeg} material={s.tyre} position={[0.3, 0.25, -0.15]} rotation={[0.5, 0, 0]} />
          <group position={[0, 0.2, 0]} rotation={[-0.25, 0, 0]}>
            <mesh geometry={s.triOuter} material={s.triRed} />
            <mesh geometry={s.triInner} material={s.triWhite} position={[0, 0.2, 0.01]} />
          </group>
        </group>
      </group>
      <sprite ref={label} position={[0, 12, labelZ]} scale={[13 * Math.sqrt(size), 4.06 * Math.sqrt(size), 1]} renderOrder={20}>
        <spriteMaterial map={map} depthTest={false} depthWrite={false} transparent toneMapped={false} />
      </sprite>
    </>
  );
}
