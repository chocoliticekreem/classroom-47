"use client";
// Module: TrafficLights. UK-style signals at every downtown junction (colour from signals.ts),
// street lamps along downtown streets and the highway (glow at night), and zebra crossings with
// blinking Belisha beacons. Everything is instanced: ~14 draw calls total.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { signalFor, type SignalColour } from "../signals";
import { useWorld } from "../store";
import { lampPosts, signalHeads, zebraCrossings } from "./TrafficLights/layout";

// --- dimensions (metres) ---------------------------------------------------
const POLE_H = 3.8;
const HEAD_Y = 3.2; // housing centre
const HEAD_Z = 0.26; // housing sits in front of the pole, toward the driver
const LENS_STEP = 0.42;
const LENS_Z = HEAD_Z + 0.2;

const LAMP_H = 6.6;
const ARM = 1.9;

// --- colours ---------------------------------------------------------------
// Lens colours are written straight into instanceColor of an unlit, non-tonemapped material,
// so values > 1 read as emissive (and bloom if a post pass is present).
const LIT: Record<SignalColour, THREE.Color> = {
  red: new THREE.Color("#ff2414").multiplyScalar(2.4),
  amber: new THREE.Color("#ffa800").multiplyScalar(2.2),
  green: new THREE.Color("#22ff66").multiplyScalar(2.0),
};
const DARK: Record<SignalColour, THREE.Color> = {
  red: new THREE.Color("#2c0906"),
  amber: new THREE.Color("#2c1f05"),
  green: new THREE.Color("#07230f"),
};
const ORDER: SignalColour[] = ["red", "amber", "green"]; // top to bottom
const CODE: Record<SignalColour, number> = { red: 0, amber: 1, green: 2 };

const BEACON_ON = new THREE.Color("#ff8a1a").multiplyScalar(2.2);
const BEACON_OFF = new THREE.Color("#4a2208");

// --- helpers ---------------------------------------------------------------
const dummy = new THREE.Object3D();

/** Place an instance at world (x, z) with yaw, plus a local offset (ox, y, oz) in the yawed frame. */
function place(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  z: number,
  yaw: number,
  ox: number,
  y: number,
  oz: number,
  rotX = 0,
) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  dummy.position.set(x + ox * c + oz * s, y, z - ox * s + oz * c);
  dummy.rotation.set(rotX, yaw, 0, "YXZ");
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.matrixAutoUpdate = false;
  return m;
}

function finish(m: THREE.InstancedMesh) {
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
}

function buildScene() {
  const heads = signalHeads();
  const lamps = lampPosts();
  const zebras = zebraCrossings();

  const black = std("#16181a", { roughness: 0.6 });
  const yellow = std("#f2c200", { roughness: 0.7 });
  const lampMetal = std("#28332f", { roughness: 0.6 });
  const white = std("#f4f4ef");
  const stripe = std("#f7f7f2", { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  // --- traffic signals ---
  const hN = heads.length;
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, POLE_H, 6);
  const housingGeo = new THREE.BoxGeometry(0.46, 1.32, 0.34);
  const boardGeo = new THREE.BoxGeometry(0.82, 1.7, 0.05);
  const lensGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12).rotateX(Math.PI / 2);
  const visorGeo = new THREE.BoxGeometry(0.38, 0.04, 0.22);

  const sigPoles = instanced(poleGeo, black, hN);
  const housings = instanced(housingGeo, black, hN);
  const boards = instanced(boardGeo, yellow, hN);
  const lensMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const lenses = instanced(lensGeo, lensMat, hN * 3);
  const visors = instanced(visorGeo, black, hN * 3);

  heads.forEach((h, i) => {
    place(sigPoles, i, h.x, h.z, h.yaw, 0, POLE_H / 2, 0);
    place(housings, i, h.x, h.z, h.yaw, 0, HEAD_Y, HEAD_Z);
    place(boards, i, h.x, h.z, h.yaw, 0, HEAD_Y, HEAD_Z - 0.2);
    ORDER.forEach((col, k) => {
      const y = HEAD_Y + LENS_STEP * (1 - k);
      place(lenses, i * 3 + k, h.x, h.z, h.yaw, 0, y, LENS_Z);
      place(visors, i * 3 + k, h.x, h.z, h.yaw, 0, y + 0.18, LENS_Z + 0.1);
      lenses.setColorAt(i * 3 + k, DARK[col]);
    });
  });

  // --- street lamps ---
  const lN = lamps.length;
  const lampPoleGeo = new THREE.CylinderGeometry(0.08, 0.13, LAMP_H, 6);
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, ARM);
  const lampHeadGeo = new THREE.BoxGeometry(0.36, 0.16, 0.72);
  const poolGeo = new THREE.CircleGeometry(4.2, 20).rotateX(-Math.PI / 2);
  const lampHeadMat = std("#fff4dc", { emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0 });
  const poolMat = new THREE.MeshBasicMaterial({
    color: "#ffb35c",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const lampPoles = instanced(lampPoleGeo, lampMetal, lN);
  const arms = instanced(armGeo, lampMetal, lN);
  const lampHeads = instanced(lampHeadGeo, lampHeadMat, lN);
  const pools = instanced(poolGeo, poolMat, lN);
  pools.visible = false;
  pools.renderOrder = 2;

  lamps.forEach((l, i) => {
    place(lampPoles, i, l.x, l.z, l.yaw, 0, LAMP_H / 2, 0);
    place(arms, i, l.x, l.z, l.yaw, 0, LAMP_H - 0.1, ARM / 2);
    place(lampHeads, i, l.x, l.z, l.yaw, 0, LAMP_H - 0.2, ARM);
    place(pools, i, l.x, l.z, l.yaw, 0, 0.075, ARM + 0.4);
  });

  // --- zebra crossings + Belisha beacons ---
  const STRIPES = 8;
  const zN = zebras.length;
  const stripeGeo = new THREE.PlaneGeometry(0.5, 3).rotateX(-Math.PI / 2);
  const stripes = instanced(stripeGeo, stripe, zN * STRIPES);
  const bPoleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.7, 8);
  const bBandGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.24, 8);
  const globeGeo = new THREE.SphereGeometry(0.3, 12, 8);
  const globeMat = new THREE.MeshBasicMaterial({ color: BEACON_ON, toneMapped: false });
  const BANDS = 5;
  const bPoles = instanced(bPoleGeo, white, zN * 2);
  const bBands = instanced(bBandGeo, black, zN * 2 * BANDS);
  const globes = instanced(globeGeo, globeMat, zN * 2);

  zebras.forEach((zc, i) => {
    for (let k = 0; k < STRIPES; k++) {
      const lat = (k - (STRIPES - 1) / 2) * 1.0;
      place(stripes, i * STRIPES + k, zc.x, zc.z, zc.yaw, lat, 0.07, 0);
    }
    [-1, 1].forEach((side, s) => {
      const j = i * 2 + s;
      // on the kerb at each end of the crossing, just beside the stripes
      const ox = side * 4.7;
      const oz = 1.9;
      place(bPoles, j, zc.x, zc.z, zc.yaw, ox, 1.35, oz);
      for (let b = 0; b < BANDS; b++)
        place(bBands, j * BANDS + b, zc.x, zc.z, zc.yaw, ox, 0.3 + b * 0.5, oz);
      place(globes, j, zc.x, zc.z, zc.yaw, ox, 2.95, oz);
    });
  });

  const meshes = [
    sigPoles, housings, boards, lenses, visors,
    lampPoles, arms, lampHeads, pools,
    stripes, bPoles, bBands, globes,
  ].map(finish);
  stripes.receiveShadow = true;

  const geometries = [
    poleGeo, housingGeo, boardGeo, lensGeo, visorGeo, lampPoleGeo, armGeo, lampHeadGeo, poolGeo,
    stripeGeo, bPoleGeo, bBandGeo, globeGeo,
  ];
  const materials = [black, yellow, lampMetal, white, stripe, lensMat, lampHeadMat, poolMat, globeMat];

  const shown = new Uint8Array(hN).fill(255); // last colour code per head (255 = not yet shown)
  let beaconOn = true;

  return {
    meshes,
    /** Street lamps: call when the hour changes. level 0 = off, 1 = full night glow. */
    setLampLevel(level: number) {
      lampHeadMat.emissiveIntensity = level * 2.6;
      poolMat.opacity = level * 0.22;
      pools.visible = level > 0;
    },
    /** Per frame: cheap check per approach, writes instance colours only when a head changes. */
    tick(now: number) {
      let dirty = false;
      for (let i = 0; i < hN; i++) {
        const h = heads[i];
        const code = CODE[signalFor(h.node, h.from, now)];
        const prev = shown[i];
        if (code === prev) continue;
        if (prev !== 255) lenses.setColorAt(i * 3 + prev, DARK[ORDER[prev]]);
        lenses.setColorAt(i * 3 + code, LIT[ORDER[code]]);
        shown[i] = code;
        dirty = true;
      }
      if (dirty && lenses.instanceColor) lenses.instanceColor.needsUpdate = true;

      // Belisha beacons: ~1 Hz blink, one material colour swap.
      const on = Math.floor(now / 500) % 2 === 0;
      if (on !== beaconOn) {
        beaconOn = on;
        globeMat.color.copy(on ? BEACON_ON : BEACON_OFF);
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      meshes.forEach((m) => m.dispose());
    },
  };
}

/** 0 = day, 0.5 = dusk/dawn, 1 = night. */
function lampLevel(hour: number) {
  if (hour >= 19 || hour < 6) return 1;
  if (hour === 18 || hour === 6) return 0.5;
  return 0;
}

export default function TrafficLights() {
  const scene = useMemo(() => buildScene(), []);
  const hour = useWorld((s) => Math.floor(s.timeOfDay));

  useEffect(() => () => scene.dispose(), [scene]);
  useEffect(() => scene.setLampLevel(lampLevel(hour)), [hour, scene]);

  useFrame(() => {
    if (useWorld.getState().paused) return;
    scene.tick(performance.now());
  });

  return (
    <group name="TrafficLights">
      {scene.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
