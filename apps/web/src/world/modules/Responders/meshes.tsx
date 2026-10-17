"use client";
// Low-poly emergency vehicles built from a shared unit box/cylinder. Each unit gets its own
// light-bar and siren-ring materials (so they can flash out of phase); everything else is shared.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { UnitRole } from "./dispatch";
import { ambulanceSide, fireSide, policeSide, roofMark, towSide } from "./livery";

export interface UnitParts {
  car: THREE.Group;
  officer: THREE.Group | null;
  lightL: THREE.MeshStandardMaterial;
  lightR: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
}

interface Shared {
  box: THREE.BoxGeometry;
  axle: THREE.CylinderGeometry;
  ring: THREE.RingGeometry;
  head: THREE.SphereGeometry;
  helmet: THREE.CylinderGeometry;
  body: THREE.CylinderGeometry;
  cone: THREE.ConeGeometry;
  mats: Record<string, THREE.Material | THREE.Material[]>;
}

let shared: Shared | null = null;

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
const tex = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.6 });

export function getShared(): Shared {
  if (shared) return shared;
  const white = std("#f4f4ee");
  const glass = std("#1c2a38", { roughness: 0.25, metalness: 0.3 });
  const dark = std("#1b1b1f");
  const yellow = std("#e6f01e");
  const red = std("#c8141c");
  const amber = std("#f2b01a");
  const grey = std("#9aa0a8", { metalness: 0.4 });
  const steel = std("#3a3d42");
  const cone = std("#ff5a12", { emissive: "#ff3a00", emissiveIntensity: 0.15 });
  shared = {
    box: new THREE.BoxGeometry(1, 1, 1),
    axle: new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2),
    ring: new THREE.RingGeometry(1.4, 1.75, 40).rotateX(-Math.PI / 2),
    head: new THREE.SphereGeometry(0.2, 8, 6),
    helmet: new THREE.CylinderGeometry(0.09, 0.2, 0.34, 8),
    body: new THREE.CylinderGeometry(0.22, 0.27, 1.2, 8),
    cone: new THREE.ConeGeometry(0.28, 0.8, 8).translate(0, 0.4, 0),
    mats: {
      white, glass, dark, yellow, red, amber, grey, steel, cone,
      hiVis: std("#d8f21a", { emissive: "#7a8a00", emissiveIntensity: 0.25 }),
      paramedic: std("#1f7a4a", { emissive: "#0b3a20", emissiveIntensity: 0.2 }),
      paramedicVest: std("#d8f21a", { emissive: "#7a8a00", emissiveIntensity: 0.25 }),
      skin: std("#e2b48c"),
      // box face order: +x, -x, +y, -y, +z, -z
      policeBody: [tex(policeSide()), tex(policeSide()), white, dark, white, white],
      policeCabin: [glass, glass, tex(roofMark("R7", "#f4f4ee", "#111")), glass, glass, glass],
      ambBox: [tex(ambulanceSide()), tex(ambulanceSide()), tex(roofMark("A2", "#e6f01e", "#0d5a28")), yellow, yellow, yellow],
      ambCab: [yellow, yellow, yellow, dark, glass, yellow],
      fireBody: [tex(fireSide()), tex(fireSide()), grey, dark, red, red],
      fireCab: [red, red, red, dark, glass, red],
      towCab: [tex(towSide()), tex(towSide()), amber, dark, glass, amber],
    },
  };
  return shared;
}

type V3 = [number, number, number];
interface Part {
  mat: string;
  pos: V3;
  scale: V3;
  rotX?: number;
  shadow?: boolean;
}
interface Spec {
  parts: Part[];
  axles: { z: number; r: number; w: number }[];
  bar: { y: number; z: number; dx: number; w: number };
  ring: number; // ring scale
}

const SPECS: Record<UnitRole, Spec> = {
  police: {
    parts: [
      { mat: "policeBody", pos: [0, 0.62, 0], scale: [1.85, 0.72, 4.4], shadow: true },
      { mat: "policeCabin", pos: [0, 1.26, -0.25], scale: [1.66, 0.56, 2.3] },
    ],
    axles: [{ z: 1.38, r: 0.36, w: 2.0 }, { z: -1.38, r: 0.36, w: 2.0 }],
    bar: { y: 1.6, z: -0.1, dx: 0.4, w: 0.66 },
    ring: 1.6,
  },
  ambulance: {
    parts: [
      { mat: "ambCab", pos: [0, 0.95, 2.0], scale: [2.0, 1.25, 1.5] },
      { mat: "ambBox", pos: [0, 1.45, -0.75], scale: [2.15, 2.2, 4.1], shadow: true },
    ],
    axles: [{ z: 1.8, r: 0.4, w: 2.15 }, { z: -1.9, r: 0.4, w: 2.2 }],
    bar: { y: 2.62, z: 1.0, dx: 0.48, w: 0.8 },
    ring: 2,
  },
  fire: {
    parts: [
      { mat: "fireCab", pos: [0, 1.25, 2.75], scale: [2.4, 1.9, 2.1] },
      { mat: "fireBody", pos: [0, 1.4, -1.1], scale: [2.4, 2.1, 5.4], shadow: true },
      { mat: "grey", pos: [0, 2.6, -0.6], scale: [0.9, 0.22, 6.6] },
    ],
    axles: [{ z: 2.6, r: 0.5, w: 2.4 }, { z: -2.6, r: 0.5, w: 2.4 }],
    bar: { y: 2.28, z: 2.9, dx: 0.55, w: 0.9 },
    ring: 2.4,
  },
  tow: {
    parts: [
      { mat: "towCab", pos: [0, 1.2, 2.2], scale: [2.2, 1.8, 1.9], shadow: true },
      { mat: "steel", pos: [0, 0.9, -1.0], scale: [2.2, 0.35, 4.3] },
      { mat: "amber", pos: [0, 1.75, -2.4], scale: [0.28, 0.28, 2.2], rotX: 0.55 },
    ],
    axles: [{ z: 2.0, r: 0.45, w: 2.2 }, { z: -2.0, r: 0.45, w: 2.2 }],
    bar: { y: 2.18, z: 2.4, dx: 0.5, w: 0.5 },
    ring: 2.2,
  },
};

export function UnitMesh({
  id,
  role,
  onBind,
}: {
  id: string;
  role: UnitRole;
  onBind: (id: string, parts: UnitParts | null) => void;
}) {
  const s = getShared();
  const spec = SPECS[role];
  const carRef = useRef<THREE.Group>(null);
  const officerRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const own = useMemo(() => {
    const tow = role === "tow";
    const light = () =>
      new THREE.MeshStandardMaterial({
        color: tow ? "#5a3a00" : "#0b1f6e",
        emissive: tow ? "#ffa020" : "#2b5cff",
        emissiveIntensity: 0.3,
        roughness: 0.4,
        toneMapped: false,
      });
    return {
      lightL: light(),
      lightR: light(),
      ringMat: new THREE.MeshBasicMaterial({
        color: tow ? "#ffae2a" : "#3d6bff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    };
  }, [role]);

  useEffect(() => {
    if (!carRef.current || !ringRef.current) return;
    onBind(id, {
      car: carRef.current,
      officer: officerRef.current,
      lightL: own.lightL,
      lightR: own.lightR,
      ring: ringRef.current,
      ringMat: own.ringMat,
    });
    return () => onBind(id, null);
  }, [id, onBind, own]);

  useEffect(
    () => () => {
      own.lightL.dispose();
      own.lightR.dispose();
      own.ringMat.dispose();
    },
    [own],
  );

  const m = s.mats;
  return (
    <>
      <group ref={carRef} visible={false}>
        {spec.parts.map((p, i) => (
          <mesh
            key={i}
            geometry={s.box}
            material={m[p.mat]}
            position={p.pos}
            scale={p.scale}
            rotation-x={p.rotX ?? 0}
            castShadow={p.shadow}
          />
        ))}
        {spec.axles.map((a, i) => (
          <mesh key={`a${i}`} geometry={s.axle} material={m.dark} position={[0, a.r, a.z]} scale={[a.w, a.r, a.r]} />
        ))}
        <mesh geometry={s.box} material={own.lightL} position={[-spec.bar.dx, spec.bar.y, spec.bar.z]} scale={[spec.bar.w, 0.15, 0.34]} />
        <mesh geometry={s.box} material={own.lightR} position={[spec.bar.dx, spec.bar.y, spec.bar.z]} scale={[spec.bar.w, 0.15, 0.34]} />
        <mesh ref={ringRef} geometry={s.ring} material={own.ringMat} position={[0, 0.08, 0]} scale={spec.ring} renderOrder={2} />
      </group>
      {role === "police" && (
        <group ref={officerRef} visible={false}>
          <mesh geometry={s.body} material={m.hiVis} position={[0, 0.6, 0]} />
          <mesh geometry={s.head} material={m.skin} position={[0, 1.38, 0]} />
          <mesh geometry={s.helmet} material={m.dark} position={[0, 1.62, 0]} />
        </group>
      )}
      {role === "ambulance" && (
        // paramedic (cyclist hits): green uniform, hi-vis band; Responders moves, kneels and hides it
        <group ref={officerRef} visible={false}>
          <mesh geometry={s.body} material={m.paramedic} position={[0, 0.6, 0]} />
          <mesh geometry={s.box} material={m.paramedicVest} position={[0, 0.85, 0]} scale={[0.5, 0.16, 0.5]} />
          <mesh geometry={s.head} material={m.skin} position={[0, 1.38, 0]} />
        </group>
      )}
    </>
  );
}
