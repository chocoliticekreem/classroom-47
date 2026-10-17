"use client";
// Module: Hampstead. The affluent hilly village north of the river: a heath with low-poly hills, bathing ponds,
// kite flyers on Parliament Hill, dog walkers and joggers, an observatory with a turning dome, a Highgate-style
// Victorian cemetery, a cricket match, tennis rallies, a village high street, villas with pools.
// Everything comes from a seeded pure layout (Hampstead/layout.ts) and is drawn as one InstancedMesh per
// primitive pool. Moving things (people, dogs, swimmers, kites, balls) animate on the GPU: one uTime uniform,
// per-instance motion attributes, no per-frame matrix writes. Night glow updates only when the hour changes.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useWorld } from "../store";
import { buildLayout, glowForHour, type Anim, type AnimPool, type Part, type PoolName, type Sign } from "./Hampstead/layout";
import { HEATH, LIFT, hampsteadSegments, heightAt, pathDistance, roadDistance } from "./Hampstead/terrain";

const SEED = 7311;

// ------------------------------------------------------------------------------------------ geometry

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
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const pyramid = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const disc = new THREE.CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0);
  return {
    box,
    winLit: box,
    winDark: box,
    glow: box,
    water: box,
    fence: box,
    prism: prismGeometry(),
    pyramid,
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0),
    disc,
    pond: disc,
    flat: box,
    flatDisc: disc,
    cone: new THREE.ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0),
    sphere: new THREE.IcosahedronGeometry(0.5, 1),
    foliage: new THREE.IcosahedronGeometry(0.5, 0),
    dome: new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  };
}

const std = (o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, ...o });

/** Ground-level surfaces win the depth test against Ground's grass (y ~0.008) and each other. */
const OFFSET = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;

function makeMaterials(): Record<PoolName, THREE.MeshStandardMaterial> {
  const base = std();
  return {
    box: base,
    prism: std({ roughness: 0.85 }),
    pyramid: std({ roughness: 0.85 }),
    cyl: base,
    disc: std({ roughness: 0.95 }),
    cone: std({ roughness: 0.9 }),
    sphere: base,
    foliage: std({ roughness: 0.9 }),
    dome: std({ roughness: 0.5, metalness: 0.2 }),
    winLit: std({ roughness: 0.35, metalness: 0.1, emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0 }),
    winDark: std({ roughness: 0.35, metalness: 0.1 }),
    glow: std({ emissive: new THREE.Color("#ffd58a"), emissiveIntensity: 0.1 }),
    water: std({ ...OFFSET, roughness: 0.15, metalness: 0.1, flatShading: false, emissive: new THREE.Color("#2fd6e8"), emissiveIntensity: 0 }),
    pond: std({ ...OFFSET, roughness: 0.18, metalness: 0.2, flatShading: false }),
    flat: std({ ...OFFSET, roughness: 0.95 }),
    flatDisc: std({ ...OFFSET, roughness: 0.95 }),
    fence: std({ transparent: true, opacity: 0.35, depthWrite: false }),
  };
}

/** Building bases start at y = -0.5 so no sliver of grass shows (or flickers) under a wall. */
const sinks = (p: Part) => p.y === 0 && p.sy >= 1.5 && (p.pool === "box" || p.pool === "cyl");

/** Only big, tall things cast shadows (houses, shops, the church, mausoleum-sized and up). */
const casts = (p: Part) => (p.pool === "box" || p.pool === "prism" || p.pool === "pyramid") && p.sy >= 4 && p.sx * p.sz >= 20;

function Pool({ parts, geometry, material, cast }: { parts: Part[]; geometry: THREE.BufferGeometry; material: THREE.Material; cast: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    parts.forEach((p, i) => {
      const sink = sinks(p) ? 0.5 : 0;
      o.position.set(p.x, p.y - sink, p.z);
      o.rotation.set(p.tilt, p.ry, 0, "YXZ");
      o.scale.set(p.sx, p.sy + sink, p.sz);
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

// ------------------------------------------------------------------------------------------ GPU animation

const ANIM_VERT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
float aa = uTime * aAnimB.y + aAnimB.x;
vec3 off;
if ( aAnimB.z < 0.5 ) off = aAnimA.xyz * sin( aa ) + vec3( 0.0, aAnimA.w * abs( cos( aa ) ), 0.0 );
else if ( aAnimB.z < 1.5 ) off = aAnimA.xyz * sin( aa ) + vec3( 0.0, aAnimA.w * cos( 2.0 * aa ), 0.0 );
else off = vec3( cos( aa ) * aAnimA.x, aAnimA.w * sin( 3.0 * aa ), sin( aa ) * aAnimA.x );
mvPosition.xyz += off * ANIM_WEIGHT;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

function animMaterial(uTime: { value: number }, weightByY: boolean, extra: THREE.MeshStandardMaterialParameters = {}) {
  const m = std(extra);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
attribute vec4 aAnimA;
attribute vec4 aAnimB;
#define ANIM_WEIGHT ${weightByY ? "clamp( position.y, 0.0, 1.0 )" : "1.0"}`,
      )
      .replace("#include <project_vertex>", ANIM_VERT);
  };
  m.customProgramCacheKey = () => (weightByY ? "hp-anim-y" : "hp-anim");
  return m;
}

function makeAnimGeometry(pool: AnimPool) {
  switch (pool) {
    case "aBody":
      return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    case "aHead":
      return new THREE.IcosahedronGeometry(0.5, 1);
    case "aKite":
      return new THREE.OctahedronGeometry(0.5, 0);
    case "aString":
      return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function AnimPoolMesh({ anims, pool, material }: { anims: Anim[]; pool: AnimPool; material: THREE.Material }) {
  const geometry = useMemo(() => {
    const g = makeAnimGeometry(pool);
    const a = new Float32Array(anims.length * 4);
    const b = new Float32Array(anims.length * 4);
    anims.forEach((p, i) => {
      a.set([p.dx, p.dy, p.dz, p.hop], i * 4);
      b.set([p.phase, p.speed, p.mode, 0], i * 4);
    });
    g.setAttribute("aAnimA", new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute("aAnimB", new THREE.InstancedBufferAttribute(b, 4));
    return g;
  }, [anims, pool]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const dir = new THREE.Vector3();
    anims.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      if (p.to) {
        dir.set(p.to[0] - p.x, p.to[1] - p.y, p.to[2] - p.z);
        const len = dir.length();
        o.quaternion.setFromUnitVectors(UP, dir.normalize());
        o.scale.set(p.sx, len, p.sz);
      } else {
        o.rotation.set(0, p.ry, 0);
        o.scale.set(p.sx, p.sy, p.sz);
      }
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [anims]);
  // Offsets are applied in the shader, so the CPU bounding sphere is a little small: skip culling (few draws).
  return <instancedMesh ref={ref} args={[geometry, material, anims.length]} frustumCulled={false} />;
}

// ------------------------------------------------------------------------------------------ heath terrain

function heathGeometry() {
  const CELL = 5;
  const segs = hampsteadSegments();
  const nx = Math.ceil((HEATH.maxX - HEATH.minX) / CELL);
  const nz = Math.ceil((HEATH.maxZ - HEATH.minZ) / CELL);
  const hs: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) hs.push(heightAt(HEATH.minX + i * CELL, HEATH.minZ + j * CELL));
  const pos: number[] = [];
  const col: number[] = [];
  const grass = new THREE.Color("#78ab4c");
  const hilltop = new THREE.Color("#a8b85c");
  const hollow = new THREE.Color("#5f9443");
  const path = new THREE.Color("#c8b88a");
  const c = new THREE.Color();
  const vert = (i: number, j: number) => {
    const x = HEATH.minX + i * CELL;
    const z = HEATH.minZ + j * CELL;
    const h = hs[j * (nx + 1) + i];
    pos.push(x, h + LIFT, z);
    const n = Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.5 + 0.5;
    c.copy(hollow).lerp(grass, Math.min(1, h / 3 + n * 0.4)).lerp(hilltop, Math.max(0, Math.min(1, (h - 7) / 8)));
    if (pathDistance(x, z) < 2.6) c.lerp(path, 0.85);
    col.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const cx = HEATH.minX + (i + 0.5) * CELL;
      const cz = HEATH.minZ + (j + 0.5) * CELL;
      if (roadDistance(cx, cz, segs) < 7) continue; // the road and its kerb stay visible
      vert(i, j); vert(i, j + 1); vert(i + 1, j);
      vert(i + 1, j); vert(i, j + 1); vert(i + 1, j + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------ signs

/** Draw every sign into one canvas atlas (one row each) and merge the planes into one geometry. */
function makeSigns(signs: Sign[]) {
  const ROW = 112;
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
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 5;
      ctx.strokeRect(6, y0 + 6, rowW - 12, ROW - 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let size = 70;
      ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
      const wText = ctx.measureText(s.text).width;
      if (wText > rowW - 36) {
        size = Math.floor((size * (rowW - 36)) / wText);
        ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
      }
      ctx.fillText(s.text, rowW / 2, y0 + ROW / 2 + 2);
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

// ------------------------------------------------------------------------------------------ module

const ANIM_POOLS: AnimPool[] = ["aBody", "aHead", "aKite", "aString"];

function makeAnimMaterials() {
  const uTime = { value: 0 };
  return {
    uTime,
    mats: {
      aBody: animMaterial(uTime, false),
      aHead: animMaterial(uTime, false, { flatShading: false }),
      aKite: animMaterial(uTime, false, { side: THREE.DoubleSide, roughness: 0.6 }),
      aString: animMaterial(uTime, true, { roughness: 1 }),
    } as Record<AnimPool, THREE.MeshStandardMaterial>,
  };
}

function applyGlow(materials: Record<PoolName, THREE.MeshStandardMaterial>, signs: THREE.MeshStandardMaterial, slit: THREE.MeshStandardMaterial, k: number) {
  materials.winLit.emissiveIntensity = k * 1.8;
  materials.glow.emissiveIntensity = 0.1 + k * 2.4;
  materials.water.emissiveIntensity = k * 0.9;
  signs.emissiveIntensity = 0.15 + k * 0.6;
  slit.emissiveIntensity = k * 2;
}

function tick(anim: { uTime: { value: number } }, dome: THREE.Group | null, dt: number) {
  anim.uTime.value += dt;
  if (dome) dome.rotation.y += dt * 0.06;
}

export default function Hampstead() {
  const layout = useMemo(() => buildLayout(SEED), []);
  const groups = useMemo(() => {
    const out: { key: string; pool: PoolName; cast: boolean; parts: Part[] }[] = [];
    const by = new Map<string, (typeof out)[number]>();
    for (const p of layout.parts) {
      const cast = casts(p);
      const key = `${p.pool}${cast ? "+" : ""}`;
      let g = by.get(key);
      if (!g) {
        g = { key, pool: p.pool, cast, parts: [] };
        by.set(key, g);
        out.push(g);
      }
      g.parts.push(p);
    }
    return out;
  }, [layout]);
  const animsBy = useMemo(() => {
    const m = Object.fromEntries(ANIM_POOLS.map((p) => [p, [] as Anim[]])) as Record<AnimPool, Anim[]>;
    for (const a of layout.anims) m[a.pool].push(a);
    return m;
  }, [layout]);

  const geometries = useMemo(() => makeGeometries(), []);
  const materials = useMemo(() => makeMaterials(), []);
  const signs = useMemo(() => makeSigns(layout.signs), [layout]);
  const heath = useMemo(() => heathGeometry(), []);
  const heathMat = useMemo(() => new THREE.MeshStandardMaterial({ ...OFFSET, vertexColors: true, roughness: 0.95, flatShading: true }), []);
  const anim = useMemo(() => makeAnimMaterials(), []);
  const dome = useMemo(
    () => ({
      geo: new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat: new THREE.MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.35, metalness: 0.55 }),
      slitGeo: new THREE.BoxGeometry(1, 1, 1),
      slitMat: new THREE.MeshStandardMaterial({ color: "#1b1f26", emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0 }),
      tubeGeo: new THREE.CylinderGeometry(0.45, 0.6, 1, 10),
      tubeMat: new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5, metalness: 0.3 }),
    }),
    [],
  );

  useEffect(
    () => () => {
      new Set(Object.values(geometries)).forEach((g) => g.dispose());
      new Set(Object.values(materials)).forEach((m) => m.dispose());
      Object.values(anim.mats).forEach((m) => m.dispose());
      signs.geometry.dispose();
      signs.material.dispose();
      signs.tex.dispose();
      heath.dispose();
      heathMat.dispose();
      [dome.geo, dome.slitGeo, dome.tubeGeo].forEach((g) => g.dispose());
      [dome.mat, dome.slitMat, dome.tubeMat].forEach((m) => m.dispose());
    },
    [geometries, materials, anim, signs, heath, heathMat, dome],
  );

  // Night glow: only when the hour changes.
  const hour = useWorld((s) => Math.floor(s.timeOfDay));
  useEffect(() => {
    applyGlow(materials, signs.material, dome.slitMat, glowForHour(hour));
  }, [hour, materials, signs, dome]);

  const domeRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    tick(anim, domeRef.current, Math.min(delta, 0.1));
  });

  const obs = layout.observatory;
  return (
    <group name="hampstead">
      <mesh geometry={heath} material={heathMat} receiveShadow />
      {groups.map((g) => (
        <Pool key={g.key} parts={g.parts} geometry={geometries[g.pool]} material={materials[g.pool]} cast={g.cast} />
      ))}
      {ANIM_POOLS.map((p) =>
        animsBy[p].length ? <AnimPoolMesh key={p} pool={p} anims={animsBy[p]} material={anim.mats[p]} /> : null,
      )}
      <mesh geometry={signs.geometry} material={signs.material} />
      <group ref={domeRef} position={[obs.x, obs.y, obs.z]}>
        <mesh geometry={dome.geo} material={dome.mat} scale={obs.r} castShadow />
        <mesh geometry={dome.slitGeo} material={dome.slitMat} position={[0, obs.r * 0.55, obs.r * 0.62]} rotation={[-0.75, 0, 0]} scale={[1.4, obs.r * 0.95, 0.5]} />
        <mesh geometry={dome.tubeGeo} material={dome.tubeMat} position={[0, obs.r * 0.75, obs.r * 0.45]} rotation={[0.85, 0, 0]} scale={[1, 6, 1]} />
      </group>
    </group>
  );
}
