"use client";
// The airliners: one merged mesh each, plus instanced nav/strobe/beacon/landing lights, landing light beams,
// blob shadows, pushback tugs, the emergency "squawk" ring, evacuation slides and evacuees.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useWorld } from "../../store";
import { AIRBORNE, type Plane } from "./flight";
import { personGeometry, PLANE_LIGHTS, planeGeometry, slideGeometry, tugGeometry } from "./geometry";
import { DOORS, evacPose, PASSENGERS } from "./incidents";
import { EMERGENCY_STOP_X, nightFactor, RWY } from "./layout";
import type { AirportSim } from "./sim";

const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, "YXZ");
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const pose = { x: 0, y: 0, z: 0, visible: false };

const LIT_PHASES = new Set(["approach", "goaround", "rollout", "lineup", "takeoff", "climb", "emergencyRollout", "crashing"]);
const ENGINES_ON = new Set(["approach", "goaround", "rollout", "taxiIn", "taxiOut", "hold", "lineup", "takeoff", "climb", "emergencyRollout", "pushback", "crashing"]);

export default function Planes({ sim }: { sim: AirportSim }) {
  const planes = sim.fleet.planes;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const lightsRef = useRef<THREE.InstancedMesh>(null);
  const beamsRef = useRef<THREE.InstancedMesh>(null);
  const shadowRef = useRef<THREE.InstancedMesh>(null);
  const tugRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const slideRef = useRef<THREE.InstancedMesh>(null);
  const peopleRef = useRef<THREE.InstancedMesh>(null);

  const built = useMemo(() => {
    const beam = new THREE.ConeGeometry(4, 38, 14, 1, true);
    beam.rotateX(-Math.PI / 2);
    beam.translate(0, 0, 19);
    const shadow = new THREE.CircleGeometry(1, 20);
    shadow.rotateX(-Math.PI / 2);
    const ring = new THREE.TorusGeometry(6, 0.4, 6, 40);
    ring.rotateX(Math.PI / 2);
    return {
      geos: planes.map((p) => planeGeometry(p.spec)),
      mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }),
      lightGeo: new THREE.OctahedronGeometry(1, 1),
      lightMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
      beam,
      beamMat: new THREE.MeshBasicMaterial({
        color: "#fff1c4",
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      shadow,
      shadowMat: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }),
      tug: tugGeometry(),
      solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }),
      ring,
      ringMat: new THREE.MeshBasicMaterial({ color: "#ff2a2a", transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      slide: slideGeometry(DOORS[0].door.y - DOORS[0].foot.y, DOORS[0].foot.x - DOORS[0].door.x),
      person: personGeometry(),
      personMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    };
  }, [planes]);

  useEffect(() => {
    const lights = lightsRef.current;
    if (lights) {
      for (let i = 0; i < planes.length; i++)
        PLANE_LIGHTS.forEach((l, j) => {
          lights.setMatrixAt(i * PLANE_LIGHTS.length + j, ZERO);
          lights.setColorAt(i * PLANE_LIGHTS.length + j, col.set(l.color));
        });
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    }
    const people = peopleRef.current;
    if (people) {
      const shirts = ["#e63946", "#457b9d", "#f1c453", "#2a9d8f", "#f4a261", "#8e7dbe", "#ffffff", "#1d3557"];
      for (let i = 0; i < PASSENGERS; i++) {
        people.setMatrixAt(i, ZERO);
        people.setColorAt(i, col.set(shirts[i % shirts.length]));
      }
      if (people.instanceColor) people.instanceColor.needsUpdate = true;
    }
    for (const r of [beamsRef, shadowRef, tugRef, slideRef]) {
      const m = r.current;
      if (!m) continue;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
    return () => {
      for (const g of built.geos) g.dispose();
      for (const g of [built.lightGeo, built.beam, built.shadow, built.tug, built.ring, built.slide, built.person]) g.dispose();
      for (const m of [built.mat, built.lightMat, built.beamMat, built.shadowMat, built.solidMat, built.ringMat, built.personMat]) m.dispose();
    };
  }, [built, planes]);

  useFrame(() => {
    const night = nightFactor(useWorld.getState().timeOfDay);
    const t = performance.now() / 1000;
    const lights = lightsRef.current;
    const beams = beamsRef.current;
    const shadows = shadowRef.current;
    const tugs = tugRef.current;
    if (!lights || !beams || !shadows || !tugs) return;
    (lights.material as THREE.MeshBasicMaterial).color.setScalar(1 + night * 2.2);
    (beams.material as THREE.MeshBasicMaterial).opacity = 0.11 * night;

    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      const g = groups.current[i];
      if (!g) continue;
      const vis = p.phase !== "gone" && p.phase !== "crashed";
      g.visible = vis;
      const base = i * PLANE_LIGHTS.length;
      if (!vis) {
        for (let j = 0; j < PLANE_LIGHTS.length; j++) lights.setMatrixAt(base + j, ZERO);
        beams.setMatrixAt(i, ZERO);
        shadows.setMatrixAt(i, ZERO);
        tugs.setMatrixAt(i, ZERO);
        continue;
      }
      g.position.set(p.pos.x, p.pos.y, p.pos.z);
      g.rotation.set(-p.pitch, p.yaw, p.roll, "YXZ");
      g.updateMatrix();
      const pm = g.matrix;

      // lights
      const engines = ENGINES_ON.has(p.phase);
      const landing = LIT_PHASES.has(p.phase) && p.pos.y < 160;
      const strobeOn = (AIRBORNE.has(p.phase) || p.phase === "takeoff" || p.phase === "rollout") && ((t + i * 0.37) % 1.3 < 0.06 || ((t + i * 0.37) % 1.3 > 0.16 && (t + i * 0.37) % 1.3 < 0.22));
      const beaconOn = engines && (t * 1.1 + i * 0.21) % 1 < 0.14;
      const grow = 1 + night * 0.9 + (p.pos.y > 30 ? Math.min(2, p.pos.y / 60) : 0);
      PLANE_LIGHTS.forEach((l, j) => {
        const on = j < 3 ? true : j === 3 ? beaconOn : j < 6 ? strobeOn : landing;
        if (!on) {
          lights.setMatrixAt(base + j, ZERO);
          return;
        }
        const sz = l.size * (j >= 6 ? 1 + night : grow);
        m4.makeScale(sz, sz, sz).setPosition(l.x, l.y, l.z).premultiply(pm);
        lights.setMatrixAt(base + j, m4);
      });
      if (landing && night > 0.05) {
        m4b.makeRotationX(0.13).setPosition(0, 1.6, 3.5);
        beams.setMatrixAt(i, m4.multiplyMatrices(pm, m4b));
      } else beams.setMatrixAt(i, ZERO);

      // blob shadow
      if (p.pos.y < 80) {
        const k = 1 - p.pos.y / 110;
        e.set(0, p.yaw, 0);
        q.setFromEuler(e);
        s.set(10.5 * k, 1, 11 * k);
        v.set(p.pos.x, 0.05, p.pos.z);
        shadows.setMatrixAt(i, m4.compose(v, q, s));
      } else shadows.setMatrixAt(i, ZERO);

      // pushback / tow tug at the nose wheel
      if (p.phase === "pushback" || p.phase === "towed") {
        m4b.makeRotationY(p.phase === "pushback" ? Math.PI : 0).setPosition(0, 0, 12.2);
        tugs.setMatrixAt(i, m4.multiplyMatrices(pm, m4b));
      } else tugs.setMatrixAt(i, ZERO);
    }
    lights.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
    tugs.instanceMatrix.needsUpdate = true;

    // squawk ring over the plane in trouble
    const ring = ringRef.current;
    const em = sim.emergency;
    const cr = sim.crash;
    let trouble: Plane | null = null;
    if (em && (em.plane.phase === "approach" || em.plane.phase === "emergencyRollout" || em.plane.phase === "stopped")) trouble = em.plane;
    if (cr && cr.plane.phase === "crashing") trouble = cr.plane;
    if (ring) {
      ring.visible = !!trouble;
      if (trouble) {
        const k = (t * 1.6) % 1;
        ring.position.set(trouble.pos.x, trouble.pos.y + 9, trouble.pos.z);
        ring.scale.setScalar(0.8 + k * 1.1 + (trouble.pos.y > 40 ? trouble.pos.y / 80 : 0));
        (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.95;
      }
    }

    // evacuation: slides inflate on the stopped plane, then passengers slide down and gather
    const slides = slideRef.current;
    const people = peopleRef.current;
    if (slides && people) {
      const stopped = em && em.sinceStop >= 0 ? em : null;
      const g = stopped ? groups.current[planes.indexOf(stopped.plane)] : null;
      if (stopped && g && stopped.plane.phase === "stopped") {
        const k = Math.min(1, stopped.sinceStop / 1.4);
        const inflate = k * (1.05 - 0.05 * Math.cos(k * 9));
        DOORS.forEach((d, j) => {
          m4b.makeScale(Math.max(0.01, inflate), Math.max(0.01, k), 1).setPosition(d.door.x, d.door.y, d.door.z);
          slides.setMatrixAt(j, m4.multiplyMatrices(g.matrix, m4b));
        });
      } else for (let j = 0; j < DOORS.length; j++) slides.setMatrixAt(j, ZERO);
      slides.instanceMatrix.needsUpdate = true;

      // evacuees in the frame where the plane stopped (heading east on runway 09)
      const c = Math.cos(Math.PI / 2);
      const sn = Math.sin(Math.PI / 2);
      for (let i = 0; i < PASSENGERS; i++) {
        if (!stopped) {
          people.setMatrixAt(i, ZERO);
          continue;
        }
        evacPose(i, stopped.sinceStop, pose);
        if (!pose.visible) {
          people.setMatrixAt(i, ZERO);
          continue;
        }
        const wx = EMERGENCY_STOP_X + c * pose.x + sn * pose.z;
        const wz = RWY.z - sn * pose.x + c * pose.z;
        const bob = pose.y < 0.05 ? Math.abs(Math.sin(t * 9 + i)) * 0.08 : 0;
        m4.makeRotationY(Math.PI + Math.sin(i * 1.7) * 0.6).setPosition(wx, pose.y + bob, wz);
        people.setMatrixAt(i, m4);
      }
      people.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {planes.map((p, i) => (
        <group
          key={p.id}
          ref={(el) => {
            groups.current[i] = el;
          }}
          visible={false}
        >
          <mesh geometry={built.geos[i]} material={built.mat} castShadow />
        </group>
      ))}
      <instancedMesh ref={lightsRef} args={[built.lightGeo, built.lightMat, planes.length * PLANE_LIGHTS.length]} frustumCulled={false} />
      <instancedMesh ref={beamsRef} args={[built.beam, built.beamMat, planes.length]} frustumCulled={false} renderOrder={11} />
      <instancedMesh ref={shadowRef} args={[built.shadow, built.shadowMat, planes.length]} frustumCulled={false} />
      <instancedMesh ref={tugRef} args={[built.tug, built.solidMat, planes.length]} frustumCulled={false} />
      <mesh ref={ringRef} geometry={built.ring} material={built.ringMat} visible={false} renderOrder={13} />
      <instancedMesh ref={slideRef} args={[built.slide, built.solidMat, DOORS.length]} frustumCulled={false} />
      <instancedMesh ref={peopleRef} args={[built.person, built.personMat, PASSENGERS]} frustumCulled={false} />
    </group>
  );
}
