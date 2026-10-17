"use client";
// The sea east of the docks: a ferry on a long loop, two small boats, foam wakes, and a lighthouse
// on a rock to the north-east with a rotating beam (brighter at night).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
} from "three";
import { WATER_X } from "../../config";
import { useWorld } from "../../store";
import { merge, paint } from "./geo";
import { nightness, stadiumPoint, type Pose } from "./sim";

const SEA_X = WATER_X + 20; // keep boats clear of the quay and the docked ship
const LIGHTHOUSE: [number, number] = [WATER_X + 14, -350];

// ferry: stadium loop up and down the coast
const FERRY = { cx: SEA_X + 18, cz: 0, r: 9, half: 280, speed: 9 };
// small boats: ellipses north and south of the docks
const BOATS = [
  { cx: SEA_X + 17, cz: -205, rx: 9, rz: 70, speed: 11, phase: 0 },
  { cx: SEA_X + 20, cz: 200, rx: 8, rz: 60, speed: 6, phase: 2 },
];

const WAKE_MAX = 220;
const WAKE_LIFE = 4.5;

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string, ry = 0) {
  const g = new BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, hex);
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, hex: string, seg = 10) {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return paint(g, hex);
}

export function ferryGeometry() {
  return merge([
    box(7, 2.4, 22, 0, 0.4, -1, "#1d3557"), // hull
    box(4.95, 2.4, 4.95, 0, 0.4, 10, "#1d3557", Math.PI / 4), // pointed bow
    box(7.06, 0.45, 22.06, 0, 1.45, -1, "#ff6a1a"), // stripe
    box(6.2, 2.0, 15, 0, 2.6, -2, "#f8f9fa"), // passenger deck
    box(6.25, 0.5, 13, 0, 2.9, -2, "#457b9d"), // window band
    box(5, 1.4, 4, 0, 4.3, 3, "#f8f9fa"), // bridge
    box(5.05, 0.45, 0.5, 0, 4.5, 4.8, "#1d3557"), // bridge windows
    cyl(0.85, 0.95, 2.6, 0, 5, -5.5, "#e63946"), // funnel
    cyl(0.88, 0.88, 0.5, 0, 6.4, -5.5, "#1b1b1b"),
  ]);
}

export function speedboatGeometry() {
  return merge([
    box(2.2, 0.9, 5.2, 0, 0.15, -0.4, "#e63946"),
    box(1.56, 0.9, 1.56, 0, 0.15, 2.2, "#e63946", Math.PI / 4),
    box(2.25, 0.2, 5.25, 0, 0.55, -0.4, "#f8f9fa"),
    box(1.5, 0.8, 1.6, 0, 1.0, 0.2, "#f8f9fa"),
    box(1.52, 0.35, 0.3, 0, 1.15, 1.0, "#457b9d"),
  ]);
}

export function sailboatGeometry() {
  const sail = new Shape();
  sail.moveTo(0, 0);
  sail.lineTo(0, 6.5);
  sail.lineTo(-2.6, 0);
  sail.lineTo(0, 0);
  const sailGeo = new ShapeGeometry(sail);
  sailGeo.rotateY(-Math.PI / 2); // in the boat's yz plane, swept back
  sailGeo.translate(0, 1.2, 0.3);
  return merge([
    box(1.9, 0.8, 5, 0, 0.1, -0.3, "#f8f9fa"),
    box(1.34, 0.8, 1.34, 0, 0.1, 2.2, "#f8f9fa", Math.PI / 4),
    box(1.95, 0.18, 5.05, 0, 0.3, -0.3, "#2a9d8f"),
    cyl(0.07, 0.07, 7, 0, 3.8, 0.3, "#5c3a21", 5),
    paint(sailGeo, "#fefae0"),
  ]);
}

export function lighthouseGeometry() {
  const rock = new DodecahedronGeometry(9, 0);
  rock.scale(1, 0.35, 1);
  const parts: BufferGeometry[] = [paint(rock, "#6c757d")];
  const bands = ["#f8f9fa", "#d62828", "#f8f9fa", "#d62828"];
  for (let i = 0; i < 4; i++) {
    const r0 = 3 - i * 0.22;
    parts.push(cyl(r0 - 0.22, r0, 4.5, 0, 2.25 + i * 4.5, 0, bands[i], 12));
  }
  parts.push(cyl(2.9, 2.9, 0.4, 0, 18.2, 0, "#2b2d42", 12)); // gallery
  parts.push(cyl(2.9, 2.9, 0.6, 0, 18.7, 0, "#2b2d42", 12));
  const roof = new ConeGeometry(2.1, 2, 12);
  roof.translate(0, 22.4, 0);
  parts.push(paint(roof, "#d62828"));
  parts.push(box(3, 2.4, 3.4, 5, 2.2, 1, "#f8f9fa")); // keeper's hut
  const hutRoof = new ConeGeometry(2.6, 1.4, 4);
  hutRoof.rotateY(Math.PI / 4);
  hutRoof.translate(5, 4.1, 1);
  parts.push(paint(hutRoof, "#d62828"));
  return merge(parts);
}

export function beamGeometry() {
  // two opposite cones with the apex at the lantern, pointing along +z and -z
  const a = new ConeGeometry(7, 150, 16, 1, true);
  a.translate(0, -75, 0);
  a.rotateX(-Math.PI / 2);
  const b = a.clone();
  b.rotateY(Math.PI);
  return merge([a, b]);
}

interface Emitter extends Pose {
  stern: number;
  width: number;
  acc: number;
}

export default function Sea() {
  const ferry = useRef<Group>(null);
  const boat0 = useRef<Group>(null);
  const boat1 = useRef<Group>(null);
  const beam = useRef<Group>(null);
  const wakes = useRef<InstancedMesh>(null);
  const lantern = useRef<Mesh<BufferGeometry, MeshStandardMaterial>>(null);
  const beamMesh = useRef<Mesh<BufferGeometry, MeshBasicMaterial>>(null);

  const res = useMemo(() => {
    const wakeGeo = new PlaneGeometry(1, 1);
    wakeGeo.rotateX(-Math.PI / 2);
    return {
      ferryGeo: ferryGeometry(),
      speedGeo: speedboatGeometry(),
      sailGeo: sailboatGeometry(),
      lightGeo: lighthouseGeometry(),
      lanternGeo: new CylinderGeometry(1.6, 1.6, 2.4, 12),
      beamGeo: beamGeometry(),
      wakeGeo,
      mat: new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true, side: DoubleSide }),
      lanternMat: new MeshStandardMaterial({ color: "#fff3b0", emissive: "#ffd166", emissiveIntensity: 0.5 }),
      beamMat: new MeshBasicMaterial({
        color: "#fff3c0",
        transparent: true,
        opacity: 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      wakeMat: new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const d of Object.values(res)) d.dispose();
    },
    [res],
  );

  const st = useRef({
    t: 0,
    ferryS: 0,
    angles: BOATS.map((b) => b.phase),
    emitters: [
      { stern: 12, width: 5, acc: 0, x: 0, z: 0, heading: 0 },
      { stern: 3, width: 1.8, acc: 0, x: 0, z: 0, heading: 0 },
      { stern: 2.8, width: 1.4, acc: 0, x: 0, z: 0, heading: 0 },
    ] as Emitter[],
    // wake particles (ring buffer)
    wx: new Float32Array(WAKE_MAX),
    wz: new Float32Array(WAKE_MAX),
    wh: new Float32Array(WAKE_MAX),
    ww: new Float32Array(WAKE_MAX),
    age: new Float32Array(WAKE_MAX).fill(WAKE_LIFE),
    next: 0,
  });

  useFrame((_, delta) => {
    const world = useWorld.getState();
    const night = nightness(world.timeOfDay);
    if (lantern.current) lantern.current.material.emissiveIntensity = 0.5 + 2.5 * night;
    if (beamMesh.current) beamMesh.current.material.opacity = 0.05 + 0.22 * night;
    if (world.paused) return;
    const dt = Math.min(delta, 0.1);
    const s = st.current;
    s.t += dt;

    // ferry
    s.ferryS += FERRY.speed * dt;
    const fe = s.emitters[0];
    stadiumPoint(s.ferryS, FERRY.cx, FERRY.cz, FERRY.r, FERRY.half, fe);
    if (ferry.current) {
      ferry.current.position.set(fe.x, Math.sin(s.t * 0.8) * 0.12, fe.z);
      ferry.current.rotation.set(Math.sin(s.t * 0.6) * 0.01, fe.heading, Math.sin(s.t * 0.9) * 0.02);
    }
    // small boats
    for (let i = 0; i < BOATS.length; i++) {
      const b = BOATS[i];
      const avgR = (b.rx + b.rz) / 2;
      s.angles[i] += (b.speed / avgR) * dt;
      const a = s.angles[i];
      const e = s.emitters[i + 1];
      e.x = b.cx + Math.cos(a) * b.rx;
      e.z = b.cz + Math.sin(a) * b.rz;
      e.heading = Math.atan2(-Math.sin(a) * b.rx, Math.cos(a) * b.rz);
      const g = i === 0 ? boat0.current : boat1.current;
      if (g) {
        g.position.set(e.x, Math.sin(s.t * 1.7 + i) * 0.15, e.z);
        g.rotation.set(-0.06 * (i === 0 ? 1 : 0), e.heading, Math.sin(s.t * 1.3 + i) * 0.06);
      }
    }
    // emit wake foam at each stern
    for (const e of s.emitters) {
      e.acc += dt;
      while (e.acc > 0.09) {
        e.acc -= 0.09;
        const k = s.next;
        s.next = (s.next + 1) % WAKE_MAX;
        s.wx[k] = e.x - Math.sin(e.heading) * e.stern;
        s.wz[k] = e.z - Math.cos(e.heading) * e.stern;
        s.wh[k] = e.heading;
        s.ww[k] = e.width;
        s.age[k] = 0;
      }
    }
    // update wake instances
    const m = wakes.current;
    if (m) {
      for (let k = 0; k < WAKE_MAX; k++) {
        s.age[k] += dt;
        const life = s.age[k] / WAKE_LIFE;
        if (life >= 1) {
          dummy.scale.set(0, 0, 0);
        } else {
          const fade = 1 - life;
          dummy.scale.set(s.ww[k] * (0.6 + s.age[k] * 0.9) * fade, 1, 1.6 * fade + 0.2);
        }
        dummy.position.set(s.wx[k], 0.06, s.wz[k]);
        dummy.rotation.set(0, s.wh[k], 0);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    if (beam.current) beam.current.rotation.y += dt * 0.9;
  });

  return (
    <group>
      <group ref={ferry}>
        <mesh geometry={res.ferryGeo} material={res.mat} castShadow />
      </group>
      <group ref={boat0}>
        <mesh geometry={res.speedGeo} material={res.mat} />
      </group>
      <group ref={boat1}>
        <mesh geometry={res.sailGeo} material={res.mat} />
      </group>
      <instancedMesh ref={wakes} args={[res.wakeGeo, res.wakeMat, WAKE_MAX]} frustumCulled={false} />
      <group position={[LIGHTHOUSE[0], 0, LIGHTHOUSE[1]]}>
        <mesh geometry={res.lightGeo} material={res.mat} castShadow />
        <mesh ref={lantern} geometry={res.lanternGeo} material={res.lanternMat} position={[0, 20.2, 0]} />
        <group ref={beam} position={[0, 20.2, 0]}>
          <mesh ref={beamMesh} geometry={res.beamGeo} material={res.beamMat} />
        </group>
      </group>
    </group>
  );
}

const dummy = new Object3D();
