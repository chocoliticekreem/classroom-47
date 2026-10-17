"use client";
// ~250 tiny people walking round downtown blocks, crossing at junctions on the pedestrian red.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CapsuleGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry } from "three";
import { useWorld } from "../../store";
import { createPedestrian, mulberry32, stepPedestrian, type Pedestrian } from "./sim";
import { pedCanCross } from "./signalsLocal";

const COUNT = 250;
const SCALE = 1.25; // a touch bigger than life so they read from the camera
const CLOTHES = ["#e63946", "#1d3557", "#f4a261", "#2a9d8f", "#ffb703", "#8338ec", "#3a86ff", "#ff006e", "#fefae0", "#264653", "#ff6a1a", "#6d6875", "#90be6d", "#222222"];
const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#5c3a21"];

export default function Pedestrians() {
  const bodyRef = useRef<InstancedMesh>(null);
  const headRef = useRef<InstancedMesh>(null);
  const sim = useRef<{ peds: Pedestrian[]; rand: () => number } | null>(null);

  const { bodyGeo, headGeo, mat } = useMemo(() => {
    const bodyGeo = new CapsuleGeometry(0.26, 0.72, 3, 7);
    bodyGeo.translate(0, 0.62, 0);
    const headGeo = new SphereGeometry(0.2, 8, 6);
    headGeo.translate(0, 1.42, 0);
    const mat = new MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    return { bodyGeo, headGeo, mat };
  }, []);

  useEffect(
    () => () => {
      bodyGeo.dispose();
      headGeo.dispose();
      mat.dispose();
    },
    [bodyGeo, headGeo, mat],
  );

  useLayoutEffect(() => {
    const rand = mulberry32(1337);
    const peds = Array.from({ length: COUNT }, () => createPedestrian(rand));
    sim.current = { peds, rand };
    const body = bodyRef.current!;
    const head = headRef.current!;
    const c = new Color();
    for (let i = 0; i < COUNT; i++) {
      body.setColorAt(i, c.set(CLOTHES[Math.floor(rand() * CLOTHES.length)]));
      head.setColorAt(i, c.set(SKIN[Math.floor(rand() * SKIN.length)]));
    }
    body.instanceColor!.needsUpdate = true;
    head.instanceColor!.needsUpdate = true;
    write(peds, body, head);
  }, []);

  useFrame((_, delta) => {
    const s = sim.current;
    if (!s || useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    for (const p of s.peds) stepPedestrian(p, dt, s.rand, pedCanCross);
    write(s.peds, bodyRef.current!, headRef.current!);
  });

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[bodyGeo, mat, COUNT]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[headGeo, mat, COUNT]} frustumCulled={false} />
    </group>
  );
}

const dummy = new Object3D();
dummy.scale.setScalar(SCALE);

function write(peds: Pedestrian[], body: InstancedMesh, head: InstancedMesh) {
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    const moving = p.mode !== 1;
    dummy.position.set(p.x, moving ? Math.abs(Math.sin(p.phase)) * 0.09 : 0, p.z);
    dummy.rotation.set(0, p.heading, moving ? Math.sin(p.phase) * 0.07 : 0);
    dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix);
    head.setMatrixAt(i, dummy.matrix);
  }
  body.instanceMatrix.needsUpdate = true;
  head.instanceMatrix.needsUpdate = true;
}
