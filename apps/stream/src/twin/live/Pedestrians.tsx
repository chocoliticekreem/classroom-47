"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useDemoSettings } from "@/platform/demo";
import { useNetwork } from "../network/useNetwork";
import { ATMOS } from "../scene/palette";
import { getLastField, useCoveredFrames, useFieldStore } from "../sim/useField";
import { useTwinCounts } from "./sim/counts";
import { coveredBy, snapToField } from "./sim/field";
import { writeYawMatrix } from "./sim/matrix";
import { PedSim } from "./sim/pedestrians";

const CAPACITY = 1400;
const SEED = 9151;
const GLOW = { value: 0.4 };

const CLOTHES = [
  "#1a1d24",
  "#2b303a",
  "#3a2a2a",
  "#5a6070",
  "#c23b3b",
  "#e0a53a",
  "#2f7f8f",
  "#d8d2c4",
  "#7a4fa3",
  "#1f3a6b",
  "#4c7a3c",
  "#e8e8ea",
].map((c) => new THREE.Color(c));
const SKIN = ["#f1c9a5", "#d9a577", "#b57b50", "#8a5a3a", "#5e3b26", "#f6d7bd"].map((c) => new THREE.Color(c));

type Rgb = [number, number, number];

function part(g: THREE.BufferGeometry, [r, gr, b]: Rgb, x: number, y: number, z: number) {
  const out = g.toNonIndexed();
  out.translate(x, y, z);
  const n = out.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return out;
}

function personBody() {
  const leg = new THREE.BoxGeometry(0.16, 0.82, 0.18);
  const arm = new THREE.BoxGeometry(0.1, 0.56, 0.13);
  return mergeGeometries([
    part(leg, [0.22, 0.24, 0.3], -0.1, 0.41, 0),
    part(leg, [0.22, 0.24, 0.3], 0.1, 0.41, 0),
    part(new THREE.BoxGeometry(0.46, 0.64, 0.27), [1, 1, 1], 0, 1.14, 0),
    part(arm, [0.85, 0.85, 0.85], -0.29, 1.1, 0),
    part(arm, [0.85, 0.85, 0.85], 0.29, 1.1, 0),
  ])!;
}

function personHead() {
  return part(new THREE.SphereGeometry(0.12, 8, 6), [1, 1, 1], 0, 1.6, 0);
}

function step(sim: PedSim, body: THREE.InstancedMesh, head: THREE.InstancedMesh, cam: THREE.Vector3, dt: number, frame: number) {
  sim.update(dt, cam.x, cam.z, frame);
  const arr = body.instanceMatrix.array;
  const peds = sim.peds;
  for (let i = 0; i < sim.active; i++) {
    const p = peds[i];
    if (p.dirty) writeYawMatrix(arr, i * 16, p.x, p.bob, p.z, p.yaw, p.scale, p.scale);
  }
  body.count = head.count = sim.active;
  body.instanceMatrix.needsUpdate = true;
  GLOW.value = 0.1 + 0.35 * ATMOS.windowGlow;
  if (frame % 60 === 0 && useTwinCounts.getState().people !== sim.active) useTwinCounts.setState({ people: sim.active });
}

export function Pedestrians() {
  const net = useNetwork();
  const sim = useMemo(() => new PedSim(net, CAPACITY, SEED), [net]);
  const frame = useRef(0);

  const fieldAt = useFieldStore((s) => s?.at ?? 0);
  const covered = useCoveredFrames((s) => s.frames);
  const crowd = useDemoSettings().crowd;
  useEffect(() => {
    const field = getLastField();
    if (!field) return;
    const snap = snapToField(sim.mids, field);
    const fws = net.footways;
    const weight = new Float32Array(fws.length);
    let target = 0;
    for (let i = 0; i < fws.length; i++) {
      const seg = snap[i];
      if (seg < 0 || coveredBy(covered, sim.mids[i * 2], sim.mids[i * 2 + 1])) continue;
      weight[i] = field.segments[seg].peds;
      target += (weight[i] * fws[i].length) / 100;
    }
    sim.setDensities(weight, target * crowd);
  }, [sim, net, fieldAt, covered, crowd]);

  const shared = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = GLOW;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float uGlow;\nvoid main() {")
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uGlow;",
        );
    };
    return { material, body: personBody(), head: personHead() };
  }, []);

  const meshes = useMemo(() => {
    const n = Math.max(1, sim.peds.length);
    const body = new THREE.InstancedMesh(shared.body, shared.material, n);
    const head = new THREE.InstancedMesh(shared.head, shared.material, n);
    head.instanceMatrix = body.instanceMatrix;
    body.count = head.count = 0;
    sim.peds.forEach((p, i) => {
      body.setColorAt(i, CLOTHES[(i * 5 + (i >> 3)) % CLOTHES.length]);
      head.setColorAt(i, SKIN[(i * 3 + (i >> 4)) % SKIN.length]);
      writeYawMatrix(body.instanceMatrix.array, i * 16, p.x, p.bob, p.z, p.yaw, p.scale, p.scale);
    });
    body.frustumCulled = head.frustumCulled = false;
    return { body, head };
  }, [sim, shared]);

  useEffect(
    () => () => {
      meshes.body.dispose();
      meshes.head.dispose();
    },
    [meshes],
  );

  useEffect(
    () => () => {
      shared.material.dispose();
      shared.body.dispose();
      shared.head.dispose();
    },
    [shared],
  );

  useFrame(({ camera }, dt) => {
    step(sim, meshes.body, meshes.head, camera.position, dt, frame.current++);
  });

  return (
    <group>
      <primitive object={meshes.body} />
      <primitive object={meshes.head} />
    </group>
  );
}
