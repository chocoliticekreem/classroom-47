"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toLocal } from "../config";
import type { XZ } from "../network/types";
import { useNetwork } from "../network/useNetwork";
import { ATMOS } from "../scene/palette";
import { useGeometry } from "../scene/useGeometry";
import { writeYawMatrix } from "./sim/matrix";
import { PedSim } from "./sim/pedestrians";
import { useLive } from "./store";

const COUNT = 650;
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

interface StreamerSeen {
  lat: number;
  lon: number;
}

function step(
  sim: PedSim,
  body: THREE.InstancedMesh,
  stations: XZ[],
  seen: StreamerSeen,
  cam: THREE.Vector3,
  dt: number,
  frame: number,
) {
  const st = useLive.getState().streamer;
  if (st.lat !== seen.lat || st.lon !== seen.lon) {
    seen.lat = st.lat;
    seen.lon = st.lon;
    sim.setHotspots(toLocal(st.lat, st.lon), stations);
  }
  sim.update(dt, cam.x, cam.z, frame);
  const arr = body.instanceMatrix.array;
  const peds = sim.peds;
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    if (p.dirty) writeYawMatrix(arr, i * 16, p.x, p.bob, p.z, p.yaw, p.scale, p.scale);
  }
  body.instanceMatrix.needsUpdate = true;
  GLOW.value = 0.1 + 0.35 * ATMOS.windowGlow;
}

export function Pedestrians() {
  const net = useNetwork();
  const geometry = useGeometry();
  const stations = useMemo(() => geometry.stations.map((s) => s.pos), [geometry]);
  const sim = useMemo(() => {
    const { lat, lon } = useLive.getState().streamer;
    return new PedSim(net, COUNT, SEED, toLocal(lat, lon), stations);
  }, [net, stations]);

  const frame = useRef(0);
  const streamerSeen = useRef<StreamerSeen>({ lat: NaN, lon: NaN });

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
    body.count = head.count = sim.peds.length;
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
    step(sim, meshes.body, stations, streamerSeen.current, camera.position, dt, frame.current++);
  });

  return (
    <group>
      <primitive object={meshes.body} />
      <primitive object={meshes.head} />
    </group>
  );
}
