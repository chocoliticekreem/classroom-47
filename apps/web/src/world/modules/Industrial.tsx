"use client";
// Module: Industrial. The heavy-industry estate south-east of the ring (ZONES.industrial): a Battersea-style power
// station, steelworks with a live pour, oil refinery with a burning flare, chemical plant + cooling towers, a recycling
// plant, a scrapyard with a magnet crane, rail sidings, warehouses, chain-link fences and sodium yard lights.
// Its smoke drifts over the whole city with WIND: one GPU particle mesh (positions computed in the vertex shader from
// uTime), plus one Points draw for furnace sparks. Roads live in districts/industrial.ts (merged by roads.ts).
// Static layout: ./Industrial/layout.ts, geometry: ./Industrial/scene.ts, smoke math + shaders: ./Industrial/smoke.ts.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useWorld } from "../store";
import { REFINERY, SCRAP, STEEL, aviationOn, craneAt, furnaceFlicker, nightFactor, type CraneState } from "./Industrial/layout";
import { CRANE_BASE_H, buildIndustrial } from "./Industrial/scene";
import {
  FLAME_FRAGMENT,
  FLAME_VERTEX,
  SMOKE_FRAGMENT,
  SMOKE_VERTEX,
  SMOKE_WIND,
  SPARK_FRAGMENT,
  SPARK_VERTEX,
  buildParticles,
  buildSparks,
} from "./Industrial/smoke";
import { beltTexture, chainLinkTexture, gritTexture, hazardTexture, signTexture, smokeTexture } from "./Industrial/textures";

const noRaycast = () => null;

function std(extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...extra });
}

function buildSmokeMesh(map: THREE.Texture) {
  const ps = buildParticles();
  const n = ps.length;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
  const spawn = new Float32Array(n * 3);
  const life = new Float32Array(n * 4);
  const shape = new Float32Array(n * 4);
  const fade = new Float32Array(n * 4);
  const seed = new Float32Array(n * 4);
  const color = new Float32Array(n * 3);
  const haze = new Float32Array(n * 3);
  const c = new THREE.Color();
  ps.forEach((p, i) => {
    spawn.set(p.spawn, i * 3);
    life.set([p.life, p.phase, p.top, p.glow], i * 4);
    shape.set([p.size0, p.growth, p.spread, p.opacity], i * 4);
    fade.set([p.fadeIn, p.fadeOut, 0, 0], i * 4);
    seed.set(p.seed, i * 4);
    c.set(p.color).toArray(color, i * 3);
    c.set(p.haze).toArray(haze, i * 3);
  });
  geo.setAttribute("aSpawn", new THREE.InstancedBufferAttribute(spawn, 3));
  geo.setAttribute("aLife", new THREE.InstancedBufferAttribute(life, 4));
  geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4));
  geo.setAttribute("aFade", new THREE.InstancedBufferAttribute(fade, 4));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
  geo.setAttribute("aHaze", new THREE.InstancedBufferAttribute(haze, 3));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(SMOKE_WIND[0], SMOKE_WIND[1]) },
        uMap: { value: null },
        uDay: { value: 1 },
        uNight: { value: 0 },
      },
    ]),
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.uniforms.uMap.value = map;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // positions come from the shader
  mesh.renderOrder = 20;
  mesh.raycast = noRaycast;
  quad.dispose();
  return { mesh, mat, geo };
}

function buildSparkPoints() {
  const sparks = buildSparks();
  const n = sparks.length;
  const geo = new THREE.BufferGeometry();
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n * 3);
  sparks.forEach((s, i) => {
    vel.set(s.vel, i * 3);
    life.set([s.life, s.phase, s.seed], i * 3);
  });
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERTEX,
    fragmentShader: SPARK_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3(...STEEL.pour) },
      uScale: { value: 2400 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 21;
  pts.raycast = noRaycast;
  return { pts, mat, geo };
}

function createResources() {
  const G = buildIndustrial();
  const tex = {
    smoke: smokeTexture(),
    fence: chainLinkTexture(),
    hazard: hazardTexture(),
    belt: beltTexture(),
    grit: gritTexture(),
    sign: signTexture("HAMYWAY POWER", "#2a1a14", "#f1e6cf", 1024, 128),
  };
  const M = {
    solid: std({ vertexColors: true, flatShading: true }),
    shells: std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 }),
    windows: std({ vertexColors: true, roughness: 0.35, emissive: new THREE.Color("#ffb35c"), emissiveIntensity: 0 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.8, 0.15), toneMapped: false }),
    lampHeads: std({ vertexColors: true, emissive: new THREE.Color("#ffa23a"), emissiveIntensity: 0 }),
    pools: new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
    aviation: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.05, 0.03), toneMapped: false }),
    fence: std({ map: tex.fence, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.6 }),
    hazard: std({ map: tex.hazard }),
    ground: std({
      map: tex.grit,
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    belt: std({ map: tex.belt, roughness: 0.9 }),
    sign: std({ map: tex.sign, emissiveMap: tex.sign, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.05 }),
    flame: new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    crane: std({ vertexColors: true, flatShading: true }),
  };
  const smoke = buildSmokeMesh(tex.smoke);
  const sparks = buildSparkPoints();
  return { G, tex, M, smoke, sparks };
}

type Resources = ReturnType<typeof createResources>;

/** Night look: windows, lamps, light pools, sign and the smoke's lighting. Called on timeOfDay change only. */
function applyNight(R: Resources, n: number) {
  R.M.windows.emissiveIntensity = n * 1.3;
  R.M.lampHeads.emissiveIntensity = 0.15 + n * 2.6;
  R.M.pools.opacity = n * 0.32;
  R.M.sign.emissiveIntensity = 0.05 + n * 0.9;
  R.smoke.mat.uniforms.uDay.value = 1 - n * 0.72;
  R.smoke.mat.uniforms.uNight.value = n;
}

/** Per frame: shader clocks, molten glow flicker, aviation blink, conveyor scroll. No allocations. */
function tickMaterials(R: Resources, time: number, flicker: number, dt: number) {
  R.smoke.mat.uniforms.uTime.value = time;
  R.sparks.mat.uniforms.uTime.value = time;
  R.M.flame.uniforms.uTime.value = time;
  R.M.glow.color.setRGB(2.4 * flicker, 0.85 * flicker, 0.15 * flicker);
  R.M.aviation.color.setRGB(aviationOn(time) ? 3 : 0.35, 0.05, 0.03);
  R.tex.belt.offset.y = (R.tex.belt.offset.y - dt * 0.35) % 1;
}

export default function Industrial() {
  const R = useMemo(() => createResources(), []);

  useEffect(
    () => () => {
      Object.values(R.G).forEach((g) => g.dispose());
      Object.values(R.tex).forEach((t) => t.dispose());
      Object.values(R.M).forEach((m) => m.dispose());
      R.smoke.geo.dispose();
      R.smoke.mat.dispose();
      R.sparks.geo.dispose();
      R.sparks.mat.dispose();
    },
    [R],
  );

  // ---- night: update on timeOfDay change only ----
  const night = useRef(0);
  const light = useRef<THREE.PointLight>(null);
  useEffect(() => {
    const apply = (h: number) => {
      night.current = nightFactor(h);
      applyNight(R, night.current);
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s, p) => {
      if (s.timeOfDay !== p.timeOfDay) apply(s.timeOfDay);
    });
  }, [R]);

  // ---- per frame: a few uniforms, one light, the crane ----
  const t = useRef(0);
  const jib = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  const hook = useRef<THREE.Group>(null);
  const wreck = useRef<THREE.Mesh>(null);
  const crane = useRef<CraneState>({ yaw: 0, cable: 3, carrying: false });
  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    const dt = Math.min(delta, 0.1);
    t.current += dt;
    const time = t.current;
    const f = furnaceFlicker(time);
    tickMaterials(R, time, f, dt);
    if (light.current) light.current.intensity = (60 + 340 * night.current) * f;
    const c = craneAt(time, crane.current);
    if (jib.current) jib.current.rotation.y = c.yaw;
    if (cable.current) cable.current.scale.y = c.cable;
    if (hook.current) hook.current.position.y = SCRAP.crane.h - CRANE_BASE_H - c.cable;
    if (wreck.current) wreck.current.visible = c.carrying;
  });

  const { G, M } = R;
  const cr = SCRAP.crane;
  return (
    <group name="Industrial">
      <mesh geometry={G.ground} material={M.ground} renderOrder={1} raycast={noRaycast} />
      <mesh geometry={G.solid} material={M.solid} castShadow receiveShadow />
      <mesh geometry={G.shells} material={M.shells} castShadow />
      <mesh geometry={G.windows} material={M.windows} />
      <mesh geometry={G.glow} material={M.glow} raycast={noRaycast} />
      <mesh geometry={G.lampHeads} material={M.lampHeads} raycast={noRaycast} />
      <mesh geometry={G.pools} material={M.pools} renderOrder={2} raycast={noRaycast} />
      <mesh geometry={G.aviation} material={M.aviation} raycast={noRaycast} />
      <mesh geometry={G.fence} material={M.fence} raycast={noRaycast} />
      <mesh geometry={G.hazard} material={M.hazard} raycast={noRaycast} />
      <mesh geometry={G.belt} material={M.belt} raycast={noRaycast} />
      <mesh geometry={G.sign} material={M.sign} raycast={noRaycast} />
      <mesh
        geometry={G.flame}
        material={M.flame}
        position={[REFINERY.flare.x, REFINERY.flare.h + 0.6, REFINERY.flare.z]}
        renderOrder={22}
        raycast={noRaycast}
      />
      {/* scrapyard magnet crane: slewing upper, cable, magnet, and the wreck it carries */}
      <group ref={jib} position={[cr.x, CRANE_BASE_H, cr.z]}>
        <mesh geometry={G.craneUpper} material={M.crane} castShadow />
        <mesh ref={cable} geometry={G.cable} material={M.crane} position={[0, cr.h - CRANE_BASE_H, cr.jib]} />
        <group ref={hook} position={[0, cr.h - CRANE_BASE_H - 3, cr.jib]}>
          <mesh geometry={G.magnet} material={M.crane} />
          <mesh ref={wreck} geometry={G.wreck} material={M.crane} visible={false} />
        </group>
      </group>
      <pointLight ref={light} position={[STEEL.pour[0] + 2, STEEL.pour[1] + 3, STEEL.pour[2]]} color="#ff7a2a" intensity={0} distance={90} decay={1.5} />
      <primitive object={R.smoke.mesh} />
      <primitive object={R.sparks.pts} />
    </group>
  );
}
