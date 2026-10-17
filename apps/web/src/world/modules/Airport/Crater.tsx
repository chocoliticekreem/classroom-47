"use client";
// The scar a plane crash leaves in the city: a scorched crater (decal with radial cracks, a dark pit, a raised
// earth rim, rubble) while the damage zone is "destroyed"; then over ~20 s it shrinks into a muddy construction
// pad with a fence, a small tower crane and hi-vis workers while the city rebuilds. Gone when the zone is.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useWorld } from "../../store";
import { box, merge, personGeometry } from "./geometry";
import { DAMAGE_RADIUS } from "./layout";
import type { AirportSim } from "./sim";

const R = DAMAGE_RADIUS;
const RUBBLE = 36;
const WORKERS = 6;
const m4 = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function scorchTexture() {
  const N = 512;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d")!;
  const h = N / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, "rgba(8,6,5,1)");
  grd.addColorStop(0.3, "rgba(20,14,10,0.97)");
  grd.addColorStop(0.55, "rgba(38,28,20,0.85)");
  grd.addColorStop(0.8, "rgba(45,38,32,0.45)");
  grd.addColorStop(1, "rgba(45,38,32,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  // radial cracks
  g.strokeStyle = "rgba(4,3,2,0.9)";
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    let a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    let r = h * 0.25;
    g.lineWidth = 2 + Math.random() * 4;
    g.beginPath();
    g.moveTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
    const end = h * (0.6 + Math.random() * 0.35);
    while (r < end) {
      r += 10 + Math.random() * 16;
      a += (Math.random() - 0.5) * 0.25;
      g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
    }
    g.stroke();
  }
  // ash speckle
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * h * 0.9;
    g.fillStyle = Math.random() < 0.5 ? "rgba(90,85,80,0.35)" : "rgba(0,0,0,0.4)";
    g.fillRect(h + Math.cos(a) * r, h + Math.sin(a) * r, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function craneGeometry() {
  return merge([
    box(0, 7, 0, 0.9, 14, 0.9, "#f4c20d"),
    box(0, 0.4, 0, 3, 0.8, 3, "#8b9097"),
    box(0, 14.4, 0, 1.4, 1.2, 1.4, "#2c3138"),
  ]);
}

function jibGeometry() {
  return merge([
    box(4, 0, 0, 13, 0.6, 0.6, "#f4c20d"),
    box(-3.5, -0.2, 0, 3, 1.2, 1.2, "#8b9097"),
    box(9, -3, 0, 0.06, 6, 0.06, "#2a2a2a"),
    box(9, -6.2, 0, 1.2, 0.5, 1.2, "#e63946"),
  ]);
}

function fenceGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const r = R * 0.62;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    parts.push(box(Math.cos(a) * r, 0.55, Math.sin(a) * r, 0.15, 1.1, 3.6, i % 2 ? "#ff7a00" : "#f2f2f2", -a));
  }
  parts.push(box(-6, 0.5, 4, 3, 1, 2, "#a9825a"), box(5, 0.4, -5, 2.5, 0.8, 2.5, "#9aa3ad"), box(2, 1.2, 7, 5, 2.4, 2.4, "#2f5fa8"));
  return merge(parts);
}

export default function Crater({ sim }: { sim: AirportSim }) {
  const group = useRef<THREE.Group>(null);
  const decal = useRef<THREE.Mesh>(null);
  const pit = useRef<THREE.Group>(null);
  const pad = useRef<THREE.Group>(null);
  const padDisc = useRef<THREE.Mesh>(null);
  const crane = useRef<THREE.Group>(null);
  const jib = useRef<THREE.Group>(null);
  const rubbleRef = useRef<THREE.InstancedMesh>(null);
  const workersRef = useRef<THREE.InstancedMesh>(null);
  const current = useRef<string | null>(null);

  const built = useMemo(() => {
    const decalGeo = new THREE.PlaneGeometry(R * 2.6, R * 2.6);
    decalGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.TorusGeometry(R * 0.4, 2.2, 6, 32);
    rim.rotateX(Math.PI / 2);
    rim.scale(1, 0.35, 1);
    const hole = new THREE.CircleGeometry(R * 0.4, 32);
    hole.rotateX(-Math.PI / 2);
    const padGeo = new THREE.CircleGeometry(R * 0.62, 32);
    padGeo.rotateX(-Math.PI / 2);
    const tex = scorchTexture();
    return {
      decalGeo,
      tex,
      decalMat: new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -18 }),
      rim,
      rimMat: new THREE.MeshStandardMaterial({ color: "#3b2a1e", roughness: 1, flatShading: true }),
      hole,
      holeMat: new THREE.MeshStandardMaterial({ color: "#0f0b08", roughness: 1, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -20 }),
      padGeo,
      padMat: new THREE.MeshStandardMaterial({ color: "#6b5038", roughness: 1, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -11, polygonOffsetUnits: -22 }),
      solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
      crane: craneGeometry(),
      jib: jibGeometry(),
      fence: fenceGeometry(),
      rubble: new THREE.DodecahedronGeometry(1, 0),
      rubbleMat: new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
      worker: personGeometry(),
      workerMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
    };
  }, []);

  useEffect(() => {
    const w = workersRef.current;
    if (w) {
      const c = new THREE.Color();
      for (let i = 0; i < WORKERS; i++) {
        w.setMatrixAt(i, ZERO);
        w.setColorAt(i, c.set(i % 2 ? "#ff7a00" : "#d7f20a"));
      }
      if (w.instanceColor) w.instanceColor.needsUpdate = true;
    }
    return () => {
      built.tex.dispose();
      for (const g of [built.decalGeo, built.rim, built.hole, built.padGeo, built.crane, built.jib, built.fence, built.rubble, built.worker]) g.dispose();
      for (const m of [built.decalMat, built.rimMat, built.holeMat, built.padMat, built.solidMat, built.rubbleMat, built.workerMat]) m.dispose();
    };
  }, [built]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const k = sim.crater;
    g.visible = !!k;
    if (!k) {
      current.current = null;
      return;
    }
    if (current.current !== k.damageId) {
      // new crater: scatter rubble around the rim
      current.current = k.damageId;
      g.position.set(k.x, 0, k.z);
      const rb = rubbleRef.current;
      if (rb) {
        const c = new THREE.Color();
        const cols = ["#5a5048", "#7a6f66", "#3a332d", "#8a5a44", "#9a9188"];
        for (let i = 0; i < RUBBLE; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = R * (0.32 + Math.random() * 0.35);
          const s = 0.6 + Math.random() * 1.6;
          m4.makeRotationFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0));
          m4.scale(new THREE.Vector3(s, s * 0.6, s));
          m4.setPosition(Math.cos(a) * r, s * 0.2, Math.sin(a) * r);
          rb.setMatrixAt(i, m4);
          rb.setColorAt(i, c.set(cols[i % cols.length]));
        }
        rb.instanceMatrix.needsUpdate = true;
        if (rb.instanceColor) rb.instanceColor.needsUpdate = true;
      }
    }
    const paused = useWorld.getState().paused;
    const dt = paused ? 0 : Math.min(delta, 0.1);
    const t = performance.now() / 1000;
    // 0 = fresh crater, 1 = construction pad
    const p = k.stage === "destroyed" ? 0 : Math.min(1, k.t / 20);
    if (decal.current) {
      decal.current.scale.setScalar(1 - 0.55 * p);
      (decal.current.material as THREE.MeshStandardMaterial).opacity = 1 - 0.8 * p;
    }
    if (pit.current) {
      pit.current.visible = p < 0.98;
      pit.current.scale.set(1 - 0.6 * p, Math.max(0.02, 1 - p), 1 - 0.6 * p);
    }
    if (rubbleRef.current) rubbleRef.current.visible = p < 0.6;
    if (pad.current) pad.current.visible = p > 0;
    if (padDisc.current) (padDisc.current.material as THREE.MeshStandardMaterial).opacity = Math.min(1, p * 1.5);
    if (crane.current) crane.current.scale.set(1, Math.max(0.01, Math.min(1, (p - 0.25) / 0.5)), 1);
    if (jib.current) jib.current.rotation.y += dt * 0.25;
    const w = workersRef.current;
    if (w) {
      for (let i = 0; i < WORKERS; i++) {
        if (p < 0.3) {
          w.setMatrixAt(i, ZERO);
          continue;
        }
        const a = (i / WORKERS) * Math.PI * 2 + t * 0.12 * (i % 2 ? 1 : -1);
        const r = R * (0.2 + (i % 3) * 0.1);
        const bob = Math.abs(Math.sin(t * 6 + i)) * 0.06;
        m4.makeRotationY(a + (i % 2 ? 0 : Math.PI)).setPosition(Math.cos(a) * r, bob, Math.sin(a) * r);
        w.setMatrixAt(i, m4);
      }
      w.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={decal} geometry={built.decalGeo} material={built.decalMat} position={[0, 0.09, 0]} renderOrder={2} />
      <group ref={pit}>
        <mesh geometry={built.hole} material={built.holeMat} position={[0, 0.1, 0]} />
        <mesh geometry={built.rim} material={built.rimMat} position={[0, 0.2, 0]} />
      </group>
      <instancedMesh ref={rubbleRef} args={[built.rubble, built.rubbleMat, RUBBLE]} frustumCulled={false} />
      <group ref={pad} visible={false}>
        <mesh ref={padDisc} geometry={built.padGeo} material={built.padMat} position={[0, 0.12, 0]} />
        <mesh geometry={built.fence} material={built.solidMat} />
        <group ref={crane} position={[R * 0.3, 0, -R * 0.25]}>
          <mesh geometry={built.crane} material={built.solidMat} castShadow />
          <group ref={jib} position={[0, 14.2, 0]}>
            <mesh geometry={built.jib} material={built.solidMat} />
          </group>
        </group>
        <instancedMesh ref={workersRef} args={[built.worker, built.workerMat, WORKERS]} frustumCulled={false} />
      </group>
    </group>
  );
}
