"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KIND_PERSON, MAX_AGENTS, MAX_PEOPLE, MAX_VEHICLES, registry as R } from "./registry";
import { step } from "./sim";
import { useField } from "./useField";

/**
 * Default renderer for the field agents: one InstancedMesh per kind, reading the registry each
 * frame. Deliberately plain (capsules and boxes) so the look can be restyled without touching
 * the simulation: swap the geometries/materials here, keep the registry read loop.
 */

/** Agents farther than this from the camera are not drawn (fog hides the cut). */
const LOD_M = 1100;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const PERSON = new THREE.Color("#e8d6c2");
const VEHICLE = new THREE.Color("#5b6f94");
const VEHICLE_ALT = new THREE.Color("#b8bcc4");
const _c = new THREE.Color();

export function Crowd() {
  useField();
  const people = useRef<THREE.InstancedMesh>(null);
  const vehicles = useRef<THREE.InstancedMesh>(null);

  const geo = useMemo(() => {
    const person = new THREE.CapsuleGeometry(0.28, 1.05, 2, 6);
    person.translate(0, 0.8, 0);
    const car = new THREE.BoxGeometry(1.8, 1.4, 4.2);
    car.translate(0, 0.75, 0);
    return { person, car };
  }, []);
  useEffect(() => {
    return () => {
      geo.person.dispose();
      geo.car.dispose();
    };
  }, [geo]);

  const coloured = useRef(false);

  useFrame(({ camera, clock }, dt) => {
    const pm = people.current;
    const vm = vehicles.current;
    if (!pm || !vm) return;
    step(dt);
    if (!coloured.current) {
      for (let i = 0; i < MAX_PEOPLE; i++) pm.setColorAt(i, PERSON);
      for (let i = 0; i < MAX_VEHICLES; i++) {
        _c.copy(i % 3 === 0 ? VEHICLE_ALT : VEHICLE);
        vm.setColorAt(i, _c);
      }
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
      if (vm.instanceColor) vm.instanceColor.needsUpdate = true;
      coloured.current = true;
    }
    const cx = camera.position.x;
    const cz = camera.position.z;
    const lod2 = LOD_M * LOD_M;
    const t = clock.elapsedTime;
    let np = 0;
    let nv = 0;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (!R.alive[i]) continue;
      const x = R.x[i];
      const z = R.z[i];
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > lod2) continue;
      const fade = R.fade[i];
      _q.setFromAxisAngle(UP, R.heading[i]);
      if (R.kind[i] === KIND_PERSON) {
        const h = 0.9 + R.seed[i] * 0.2;
        const bob = Math.sin(t * 6 + R.seed[i] * 40) * 0.04;
        _p.set(x, bob, z);
        _s.set(fade, fade * h, fade);
        pm.setMatrixAt(np++, _m.compose(_p, _q, _s));
      } else {
        _p.set(x, 0, z);
        _s.set(fade, fade, fade * (0.9 + R.seed[i] * 0.3));
        vm.setMatrixAt(nv++, _m.compose(_p, _q, _s));
      }
    }
    pm.count = np;
    vm.count = nv;
    pm.instanceMatrix.needsUpdate = true;
    vm.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={people} args={[geo.person, undefined, MAX_PEOPLE]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={vehicles} args={[geo.car, undefined, MAX_VEHICLES]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.4} metalness={0.3} />
      </instancedMesh>
    </group>
  );
}
