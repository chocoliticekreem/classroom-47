"use client";
// Module: Shoreditch (north-east, ZONES.shoreditch). Converted Victorian warehouses with wall cranes, gable murals,
// rooftop bars with festoon lights, railway arches under a brick viaduct (with an overground train), a glass tech
// campus, a container-box market, the lit Silicon Roundabout sculpture, and a seafront boardwalk with a marina.
// Roads live in districts/shoreditch.ts. Layout is pure and seeded (Shoreditch/layout.ts); every window is drawn by
// one facade shader; crowds, boats, bulbs, neon and the sculpture animate on the GPU with a single uTime uniform.
// ~22 draw calls. Night glow updates only when the quarter-hour changes.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SH_ROUNDABOUT } from "../districts/shoreditch";
import { useWorld } from "../store";
import { makePoolGeometries, personBodyGeometry, personHeadGeometry, sculptureGeometry, trainCarGeometry } from "./Shoreditch/geometries";
import { buildLayout, nightLevel, VIADUCT, viaductLength, viaductPoint, type Layout, type Part, type PoolName } from "./Shoreditch/layout";
import {
  boatMaterial,
  bulbMaterial,
  FACADE_SINK,
  facadeMaterial,
  makeUniforms,
  neonMaterial,
  peopleMaterial,
  sculptureMaterial,
  type Uniforms,
} from "./Shoreditch/materials";
import { muralAtlas, muralUv, neonAtlas } from "./Shoreditch/textures";

const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#5c3a21"];
const TALL = 14; // facades taller than this cast shadows
const TRAIN_CARS = 3;
const CAR_LEN = 16.5;
const TRAIN_SPEED = 9;
const TRAIN_DWELL = 7;

interface Built {
  objects: THREE.Object3D[];
  train: THREE.InstancedMesh;
  sculpture: THREE.Mesh;
  mats: { lampHead: THREE.MeshStandardMaterial; mural: THREE.MeshStandardMaterial };
  dispose: () => void;
}

const _o = new THREE.Object3D();
const _c = new THREE.Color();

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
  write: (i: number, o: THREE.Object3D, c: THREE.Color) => void,
  cast = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) {
    _o.position.set(0, 0, 0);
    _o.rotation.set(0, 0, 0);
    _o.scale.set(1, 1, 1);
    _c.set("#ffffff");
    write(i, _o, _c);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    mesh.setColorAt(i, _c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

const std = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ roughness: 0.82, ...o });

function build(L: Layout, u: Uniforms, bright: { bulbs: { value: number }; neon: { value: number } }): Built {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const objects: THREE.Object3D[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g);
  const M = <T extends THREE.Material>(m: T) => (mats.push(m), m);

  // ---- facades (two meshes so only the tall ones cast shadows)
  const facadeMat = M(facadeMaterial(u));
  for (const tall of [true, false]) {
    const list = L.facades.filter((f) => f.y + f.h > TALL === tall);
    if (!list.length) continue;
    const geo = G(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    const style = new Float32Array(list.length * 4);
    list.forEach((f, i) => style.set([f.kind, f.seed, f.floorH, f.bayW], i * 4));
    geo.setAttribute("aStyle", new THREE.InstancedBufferAttribute(style, 4));
    objects.push(
      instanced(geo, facadeMat, list.length, (i, o, c) => {
        const f = list[i];
        o.position.set(f.x, f.y - FACADE_SINK, f.z);
        o.rotation.y = f.ry;
        o.scale.set(f.w, f.h + FACADE_SINK, f.d);
        c.set(f.color);
      }, tall),
    );
  }

  // ---- prop pools
  const pg = makePoolGeometries();
  new Set(Object.values(pg)).forEach((g) => geos.push(g));
  const lampHead = M(std({ color: "#fff1cf", emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0.2 }));
  const bulbMat = M(bulbMaterial(u, bright.bulbs));
  const boatMat = M(boatMaterial(u));
  const poolMat: Record<PoolName, THREE.Material> = {
    box: M(std()),
    prism: M(std({ flatShading: true })),
    cyl: M(std()),
    cone: M(std({ flatShading: true })),
    rock: M(std({ flatShading: true, roughness: 0.95 })),
    tree: M(std({ vertexColors: true, flatShading: true, roughness: 0.9 })),
    lamp: M(std({ vertexColors: true, metalness: 0.3, roughness: 0.6 })),
    lampHead,
    crane: M(std({ vertexColors: true, metalness: 0.35, roughness: 0.55 })),
    car: M(std({ vertexColors: true, roughness: 0.5 })),
    bulb: bulbMat,
    glow: bulbMat,
    sailboat: boatMat,
    motorboat: boatMat,
    arch: M(std({ roughness: 0.92 })),
  };
  const CAST: Partial<Record<PoolName, boolean>> = { arch: true, prism: true, tree: true };
  const byPool = new Map<PoolName, Part[]>();
  for (const p of L.parts) {
    const pool = p.pool === "glow" ? "bulb" : p.pool;
    if (!byPool.has(pool)) byPool.set(pool, []);
    byPool.get(pool)!.push(p);
  }
  for (const [pool, list] of byPool) {
    objects.push(
      instanced(pg[pool], poolMat[pool], list.length, (i, o, c) => {
        const p = list[i];
        o.position.set(p.x, p.y, p.z);
        o.rotation.y = p.ry;
        o.scale.set(p.sx, p.sy, p.sz);
        c.set(p.color);
      }, !!CAST[pool]),
    );
  }

  // ---- people (body coloured per instance, skin-tone heads), walking on the GPU
  const walk = new Float32Array(L.people.length * 3);
  L.people.forEach((p, i) => walk.set([p.range, p.speed, p.phase], i * 3));
  const bodyGeo = G(personBodyGeometry());
  const headGeo = G(personHeadGeometry());
  bodyGeo.setAttribute("aWalk", new THREE.InstancedBufferAttribute(walk, 3));
  headGeo.setAttribute("aWalk", new THREE.InstancedBufferAttribute(walk, 3));
  const place = (i: number, o: THREE.Object3D) => {
    const p = L.people[i];
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = p.ry;
  };
  objects.push(
    instanced(bodyGeo, M(peopleMaterial(u, { vertexColors: true })), L.people.length, (i, o, c) => {
      place(i, o);
      c.set(L.people[i].color);
    }),
    instanced(headGeo, M(peopleMaterial(u, {})), L.people.length, (i, o, c) => {
      place(i, o);
      c.set(SKIN[i % SKIN.length]);
    }),
  );
  // walkers move up to `range` m from their anchor: widen the culling spheres a little
  for (const m of objects.slice(-2)) if (m instanceof THREE.InstancedMesh && m.boundingSphere) m.boundingSphere.radius += 25;

  // ---- neon signs: one merged mesh over a canvas atlas
  const neon = neonAtlas(L.signs);
  texs.push(neon.texture);
  const signPlanes = L.signs.map((s, i) => {
    const g = new THREE.PlaneGeometry(s.w, s.h);
    const [u0, v0, u1, v1] = neon.uvs[i];
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) > 0.5 ? u1 : u0, uv.getY(k) > 0.5 ? v1 : v0);
    const fl = new Float32Array(uv.count).fill(s.flicker ? 0.1 + ((i * 0.618) % 1) : 0);
    g.setAttribute("aFlick", new THREE.BufferAttribute(fl, 1));
    g.rotateY(s.ry);
    g.translate(s.x, s.y, s.z);
    return g;
  });
  if (signPlanes.length) {
    const sg = G(mergeGeometries(signPlanes)!);
    signPlanes.forEach((g) => g.dispose());
    objects.push(new THREE.Mesh(sg, M(neonMaterial(u, neon.texture, bright.neon))));
  }

  // ---- murals: merged planes over the procedural graffiti atlas
  const muralTex = muralAtlas();
  texs.push(muralTex);
  const muralMat = M(
    std({ map: muralTex, emissiveMap: muralTex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  const muralPlanes = L.murals.map((m) => {
    const g = new THREE.PlaneGeometry(m.w, m.h);
    const [u0, v0, u1, v1] = muralUv(m.design);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) > 0.5 ? u1 : u0, uv.getY(k) > 0.5 ? v1 : v0);
    g.rotateY(m.ry);
    g.translate(m.x, m.y, m.z);
    return g;
  });
  if (muralPlanes.length) {
    const mg = G(mergeGeometries(muralPlanes)!);
    muralPlanes.forEach((g) => g.dispose());
    objects.push(new THREE.Mesh(mg, muralMat));
  }

  // ---- overground train on the viaduct (3 instanced carriages, moved per frame)
  const train = new THREE.InstancedMesh(G(trainCarGeometry()), M(std({ vertexColors: true, roughness: 0.45 })), TRAIN_CARS);
  train.frustumCulled = false;
  train.castShadow = true;
  objects.push(train);

  // ---- Silicon Roundabout sculpture
  const sculpture = new THREE.Mesh(G(sculptureGeometry()), M(sculptureMaterial(u)));
  sculpture.position.set(SH_ROUNDABOUT.x, 0.25, SH_ROUNDABOUT.z);
  sculpture.castShadow = true;
  objects.push(sculpture);

  return {
    objects,
    train,
    sculpture,
    mats: { lampHead, mural: muralMat },
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      for (const o of objects) if (o instanceof THREE.InstancedMesh) o.dispose();
    },
  };
}

const _p = { x: 0, z: 0, heading: 0 };

interface Live {
  built: Built;
  uniforms: Uniforms;
  bright: { bulbs: { value: number }; neon: { value: number } };
  trainLen: number;
}

function applyNight(L: Live, hour: number) {
  const k = nightLevel(hour);
  L.uniforms.uNight.value = k;
  L.bright.bulbs.value = 0.85 + k * 2.4;
  L.bright.neon.value = 1 + k * 2.0;
  L.built.mats.lampHead.emissiveIntensity = 0.15 + k * 2.8;
  L.built.mats.mural.emissiveIntensity = k * 0.3;
}

function tick(L: Live, t: number) {
  L.uniforms.uTime.value = t;
  L.built.sculpture.rotation.y = t * 0.15;
  // train: shuttle between the west end and the station, easing in and out, dwelling at each end
  const half = (TRAIN_CARS * CAR_LEN) / 2;
  const s0 = half + 2;
  const s1 = L.trainLen - half - 1;
  const travel = (s1 - s0) / TRAIN_SPEED;
  const period = 2 * (travel + TRAIN_DWELL);
  const ph = t % period;
  let k: number;
  if (ph < TRAIN_DWELL) k = 0;
  else if (ph < TRAIN_DWELL + travel) k = (ph - TRAIN_DWELL) / travel;
  else if (ph < 2 * TRAIN_DWELL + travel) k = 1;
  else k = 1 - (ph - 2 * TRAIN_DWELL - travel) / travel;
  const e = k * k * (3 - 2 * k);
  const sc = s0 + (s1 - s0) * e;
  const train = L.built.train;
  for (let i = 0; i < TRAIN_CARS; i++) {
    viaductPoint(sc + (i - (TRAIN_CARS - 1) / 2) * CAR_LEN, _p);
    _o.position.set(_p.x, VIADUCT.deckY + 0.46, _p.z);
    _o.rotation.set(0, _p.heading, 0);
    _o.scale.set(1, 1, 1);
    _o.updateMatrix();
    train.setMatrixAt(i, _o.matrix);
  }
  train.instanceMatrix.needsUpdate = true;
}

export default function Shoreditch() {
  const live = useMemo<Live>(() => {
    const layout = buildLayout();
    const uniforms = makeUniforms();
    const bright = { bulbs: { value: 1 }, neon: { value: 1 } };
    return { built: build(layout, uniforms, bright), uniforms, bright, trainLen: viaductLength() };
  }, []);
  useEffect(() => () => live.built.dispose(), [live]);

  // Night glow: only when the quarter-hour bucket changes.
  useEffect(() => {
    let last = -1;
    const apply = (hour: number) => {
      const b = Math.floor(hour * 4) / 4;
      if (b === last) return;
      last = b;
      applyNight(live, b);
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [live]);

  const clock = useRef(0);
  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    clock.current += Math.min(delta, 0.1);
    tick(live, clock.current);
  });

  return (
    <group name="shoreditch">
      {live.built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
