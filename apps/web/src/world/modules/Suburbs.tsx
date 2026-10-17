"use client";
// Module: Suburbs. Houses lining every suburb street, a high-street parade, a corner pub, a church and a
// primary school. Everything is built from a seeded layout (Suburbs/layout.ts) and drawn as one
// InstancedMesh per primitive pool, plus one merged mesh for the text signs (~9 draw calls).
// Windows glow at night: the lit-window material is updated only when the hour changes.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useWorld } from "../store";
import { buildLayout, glowForHour, type Part, type PoolName, type Sign } from "./Suburbs/layout";

const SEED = 20260;

function prismGeometry() {
  // Triangular prism, ridge along x, base at y = 0, unit size.
  const A = [-0.5, 0, -0.5], B = [-0.5, 0, 0.5], C = [-0.5, 1, 0];
  const A2 = [0.5, 0, -0.5], B2 = [0.5, 0, 0.5], C2 = [0.5, 1, 0];
  const tris = [A, B, C, A2, C2, B2, B, B2, C2, B, C2, C, A, C, C2, A, C2, A2, A, A2, B2, A, B2, B];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

function makeGeometries(): Record<PoolName, THREE.BufferGeometry> {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pyramid = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  pyramid.rotateY(Math.PI / 4);
  pyramid.translate(0, 0.5, 0);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  cyl.translate(0, 0.5, 0);
  return {
    body: box,
    detail: box,
    winLit: box,
    winDark: box,
    roof: prismGeometry(),
    pyramid,
    cyl,
    foliage: new THREE.IcosahedronGeometry(0.5, 0),
  };
}

const std = (o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, ...o });

function makeMaterials(): Record<PoolName, THREE.MeshStandardMaterial> {
  return {
    body: std(),
    detail: std(),
    roof: std({ roughness: 0.85 }),
    pyramid: std({ roughness: 0.85 }),
    cyl: std(),
    foliage: std({ roughness: 0.9 }),
    winLit: std({ roughness: 0.35, metalness: 0.1, emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0 }),
    winDark: std({ roughness: 0.35, metalness: 0.1 }),
  };
}

const SHADOW: Record<PoolName, boolean> = {
  body: true, roof: true, pyramid: true, foliage: true,
  detail: false, cyl: false, winLit: false, winDark: false,
};

function Pool({ parts, geometry, material, cast }: { parts: Part[]; geometry: THREE.BufferGeometry; material: THREE.Material; cast: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    parts.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.tilt, p.ry, 0, "YXZ");
      o.scale.set(p.sx, p.sy, p.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  return <instancedMesh ref={ref} args={[geometry, material, parts.length]} castShadow={cast} receiveShadow />;
}

/** Draw every sign into one canvas atlas (one row each) and merge the planes into one geometry. */
function makeSigns(signs: Sign[]) {
  const ROW = 128;
  const W = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = ROW * Math.max(1, signs.length);
  const ctx = canvas.getContext("2d");
  const planes: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();
  signs.forEach((s, i) => {
    const rowW = Math.min(W, Math.round(ROW * (s.w / s.h)));
    const y0 = i * ROW;
    if (ctx) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, y0, rowW, ROW);
      ctx.strokeStyle = s.fg;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 6;
      ctx.strokeRect(6, y0 + 6, rowW - 12, ROW - 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const words = rowW < 400 ? s.text.split(" ") : [s.text];
      let size = words.length > 1 ? 44 : 78;
      ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      const widest = Math.max(...words.map((w) => ctx.measureText(w).width));
      if (widest > rowW - 40) {
        size = Math.floor((size * (rowW - 40)) / widest);
        ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
      }
      words.forEach((w, k) => ctx.fillText(w, rowW / 2, y0 + ROW / 2 + (k - (words.length - 1) / 2) * size * 1.05));
    }
    const g = new THREE.PlaneGeometry(s.w, s.h);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const v0 = 1 - (y0 + ROW) / canvas.height;
    const v1 = 1 - y0 / canvas.height;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (rowW / W), uv.getY(k) > 0.5 ? v1 : v0);
    o.position.set(s.x, s.y, s.z);
    o.rotation.set(0, s.ry, 0);
    o.updateMatrix();
    g.applyMatrix4(o.matrix);
    planes.push(g);
  });
  const geometry = planes.length ? mergeGeometries(planes) : new THREE.BufferGeometry();
  planes.forEach((p) => p.dispose());
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.15, roughness: 0.7 });
  return { geometry, material, tex };
}

function applyGlow(windows: THREE.MeshStandardMaterial, signs: THREE.MeshStandardMaterial, k: number) {
  windows.emissiveIntensity = k * 1.8;
  signs.emissiveIntensity = 0.15 + k * 0.65;
}

const POOLS: PoolName[] = ["body", "detail", "roof", "pyramid", "cyl", "foliage", "winLit", "winDark"];

export default function Suburbs() {
  const layout = useMemo(() => buildLayout(SEED), []);
  const byPool = useMemo(() => {
    const m = Object.fromEntries(POOLS.map((p) => [p, [] as Part[]])) as Record<PoolName, Part[]>;
    for (const p of layout.parts) m[p.pool].push(p);
    return m;
  }, [layout]);
  const geometries = useMemo(() => makeGeometries(), []);
  const materials = useMemo(() => makeMaterials(), []);
  const signs = useMemo(() => makeSigns(layout.signs), [layout]);

  useEffect(
    () => () => {
      new Set(Object.values(geometries)).forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
      signs.geometry.dispose();
      signs.material.dispose();
      signs.tex.dispose();
    },
    [geometries, materials, signs],
  );

  // Re-render only when the hour changes, not every tick of timeOfDay.
  const hour = useWorld((s) => Math.floor(s.timeOfDay));
  useEffect(() => {
    applyGlow(materials.winLit, signs.material, glowForHour(hour));
  }, [hour, materials, signs]);

  return (
    <group name="suburbs">
      {POOLS.map((p) =>
        byPool[p].length ? <Pool key={p} parts={byPool[p]} geometry={geometries[p]} material={materials[p]} cast={SHADOW[p]} /> : null,
      )}
      <mesh geometry={signs.geometry} material={signs.material} />
    </group>
  );
}
