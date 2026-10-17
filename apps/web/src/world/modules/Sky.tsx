"use client";
// Module: Sky. Owns time of day, weather (clouds, rain, lightning), the sky dome (gradient, sun, moon, stars,
// smog haze), scene lighting, fog and post-processing (bloom, tone mapping, colour grade, vignette).
import { useFrame, useThree } from "@react-three/fiber";
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type IUniform,
} from "three";
import { WIND } from "../config";
import { useWorld } from "../store";
import { CLEAR_CLOUDS, CLOUD_COUNT, CLOUD_SPAN, buildClouds } from "./Sky/clouds";
import {
  cloudProjectVertex,
  cloudVertexDecl,
  domeFragment,
  domeVertex,
  rainFragment,
  rainVertex,
} from "./Sky/shaders";
import { advanceHour, createGrade, createSkyState, gradeFor, sampleSky } from "./Sky/skyState";
import {
  applyWeather,
  blendToward,
  buildSchedule,
  createWeatherState,
  easeFactor,
  followCycle,
  sampleWeather,
  snapToTexel,
  type Weather,
} from "./Sky/weather";

/** Current weather, for other modules to read (e.g. wipers, umbrellas, wet roads). Updated every frame. */
export const skyStatus: { weather: Weather; rainIntensity: number } = { weather: "clear", rainIntensity: 0 };
function publishStatus(weather: Weather, rain: number) {
  skyStatus.weather = weather;
  skyStatus.rainIntensity = rain;
}

const DOME_RADIUS = 3400; // camera far is 4000; the dome follows the camera
const FOG_NEAR = 700;
const FOG_FAR = 2400;
const FOG_NEAR_RAIN = 300;
const FOG_FAR_RAIN = 1500;
const STORE_PUSH_MS = 250; // setTimeOfDay at most 4x per second
const SHADOW_MAP = 2048;
const LIGHT_DISTANCE = 900;
const WEATHER_SEED = 2026;
const WEATHER_EASE_S = 2; // seconds to ease into a forced weather (or back onto the cycle)
const CLOUD_WIND = 4; // clouds move faster than ground smoke (wind aloft)
const RAIN_DROPS = 9000;
const RAIN_BOX = new Vector3(150, 110, 150);
const TONE_MAPPING_ACES_FILMIC = 6; // postprocessing ToneMappingMode.ACES_FILMIC

const noRaycast = () => null;

type Uniforms = Record<string, IUniform>;

// ---------- factories (module-level so hooks only memoise) ----------
function makeDomeMaterial() {
  return new ShaderMaterial({
    vertexShader: domeVertex,
    fragmentShader: domeFragment,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, -1, 0) },
      uSunColor: { value: new Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: 0 },
      uSmog: { value: 0 },
      uFlash: { value: 0 },
    },
  });
}

function makeCloudMaterial() {
  const uniforms: Uniforms = {
    uDrift: { value: new Vector2() },
    uSpan: { value: CLOUD_SPAN },
    uPuff: { value: 1 },
  };
  const mat = new MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0, flatShading: true });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${cloudVertexDecl}`)
      .replace("#include <project_vertex>", cloudProjectVertex);
  };
  mat.customProgramCacheKey = () => "sky-clouds-v1";
  return mat;
}

function makeRainGeometry() {
  const pos = new Float32Array(RAIN_DROPS * 2 * 3);
  const end = new Float32Array(RAIN_DROPS * 2);
  const idx = new Float32Array(RAIN_DROPS * 2);
  let s = 9173;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = rnd();
    const y = rnd();
    const z = rnd();
    const k = rnd();
    for (let v = 0; v < 2; v++) {
      const j = i * 2 + v;
      pos[j * 3] = x;
      pos[j * 3 + 1] = y;
      pos[j * 3 + 2] = z;
      end[j] = v;
      idx[j] = k;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aEnd", new BufferAttribute(end, 1));
  g.setAttribute("aIdx", new BufferAttribute(idx, 1));
  return g;
}

function makeRainMaterial() {
  return new ShaderMaterial({
    vertexShader: rainVertex,
    fragmentShader: rainFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: {
      uCenter: { value: new Vector3() },
      uBox: { value: RAIN_BOX.clone() },
      uOffset: { value: new Vector3() },
      uDir: { value: new Vector3(0, -1, 0) },
      uLen: { value: 2.5 },
      uRain: { value: 0 },
      uColor: { value: new Color("#b8c6d8") },
      uOpacity: { value: 0.5 },
    },
  });
}

// ---------- scratch (no per-frame allocation) ----------
const _target = new Vector3();
const _snap = new Vector3();
const _fwd = new Vector3();
const _vel = new Vector3();
const _smogTint = new Color(1, 0.93, 0.84);
const _white = new Color(1, 1, 1);
const _tmpColor = new Color();
const _flashColor = new Color(0.8, 0.85, 1);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function Sky() {
  const scene = useThree((s) => s.scene);
  const sky = useMemo(() => createSkyState(), []);
  const weather = useMemo(() => createWeatherState(), []); // what we render (eased)
  const cycle = useMemo(() => createWeatherState(), []); // the looping schedule's weather
  const schedule = useMemo(() => buildSchedule(WEATHER_SEED), []);
  const grade = useMemo(() => createGrade(), []);

  const hourRef = useRef(useWorld.getState().timeOfDay);
  const lastPushed = useRef(useWorld.getState().timeOfDay);
  const lastPushT = useRef(0);
  const weatherT = useRef(0); // seconds of unpaused weather time
  const flashT = useRef(99); // seconds since the last lightning strike
  const shadowHalf = useRef(0);
  const cloudDrift = useRef(new Vector2());
  const rainOffset = useRef(new Vector3());

  const domeRef = useRef<Mesh>(null);
  const sunRef = useRef<DirectionalLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const cloudsRef = useRef<InstancedMesh>(null);
  const rainRef = useRef<LineSegments>(null);
  const fogRef = useRef<Fog>(null);
  const bloomRef = useRef<ComponentRef<typeof Bloom>>(null);
  const hueRef = useRef<ComponentRef<typeof HueSaturation>>(null);
  const bcRef = useRef<ComponentRef<typeof BrightnessContrast>>(null);
  const vignetteRef = useRef<ComponentRef<typeof Vignette>>(null);

  const domeGeo = useMemo(() => new SphereGeometry(DOME_RADIUS, 48, 24), []);
  const domeMat = useMemo(() => makeDomeMaterial(), []);
  const clouds = useMemo(() => buildClouds(), []);
  const cloudGeo = useMemo(() => {
    const g = new IcosahedronGeometry(1, 1);
    g.setAttribute("aAnchor", clouds.anchors);
    return g;
  }, [clouds]);
  const cloudMat = useMemo(() => makeCloudMaterial(), []);
  const rainGeo = useMemo(() => makeRainGeometry(), []);
  const rainMat = useMemo(() => makeRainMaterial(), []);

  // Fill the static cloud instance matrices once.
  useEffect(() => {
    const inst = cloudsRef.current;
    if (!inst) return;
    inst.instanceMatrix.array.set(clouds.matrices);
    inst.instanceMatrix.needsUpdate = true;
  }, [clouds]);

  // World.tsx mounts a constant white fallback hemisphere light. Sky drives its own hemisphere light, so
  // mute the fallback while Sky is alive (otherwise night can never get moody) and restore it on unmount.
  useEffect(() => {
    const muted: { light: HemisphereLight; intensity: number }[] = [];
    scene.traverse((o) => {
      if ((o as HemisphereLight).isHemisphereLight && o !== hemiRef.current) {
        const l = o as HemisphereLight;
        muted.push({ light: l, intensity: l.intensity });
        l.intensity = 0;
      }
    });
    return () => muted.forEach((m) => (m.light.intensity = m.intensity));
  }, [scene]);

  useEffect(
    () => () => {
      domeGeo.dispose();
      domeMat.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
    },
    [domeGeo, domeMat, cloudGeo, cloudMat, rainGeo, rainMat],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const world = useWorld.getState();
    const paused = world.paused;
    const now = performance.now();
    const cam = state.camera;

    // ---- time of day ----
    if (world.timeOfDay !== lastPushed.current) {
      hourRef.current = world.timeOfDay; // someone else (UI) changed the time: adopt it
      lastPushed.current = world.timeOfDay;
    }
    if (!paused) {
      hourRef.current = advanceHour(hourRef.current, dt, world.timeScale);
      weatherT.current += dt;
      if (now - lastPushT.current >= STORE_PUSH_MS) {
        lastPushT.current = now;
        lastPushed.current = hourRef.current;
        world.setTimeOfDay(hourRef.current);
      }
    }

    // ---- palette + weather ----
    sampleSky(hourRef.current, sky);
    // The cycle always runs; a HUD/console override eases the rendered weather to a fixed kind over ~2 s and
    // holds it, and "auto" eases back onto the cycle (no snap either way).
    sampleWeather(schedule, weatherT.current, cycle);
    const ease = easeFactor(dt, WEATHER_EASE_S);
    if (world.weatherOverride !== "auto") blendToward(weather, world.weatherOverride, ease);
    else followCycle(weather, cycle, ease);
    applyWeather(sky, weather);
    publishStatus(weather.weather, weather.rain);
    const rain = weather.rain;
    const smog = 0.6 * (1 - 0.75 * rain) * (1 - 0.35 * weather.cover);

    // ---- lightning: random strikes while stormy, double flicker ----
    if (!paused) {
      flashT.current += dt;
      if (weather.storm > 0.6 && flashT.current > 2.5 && Math.random() < dt * 0.18) flashT.current = 0;
    }
    const ft = flashT.current;
    const flash = ft < 0.8 ? Math.exp(-ft * 14) + (ft > 0.16 ? 0.75 * Math.exp(-(ft - 0.16) * 10) : 0) : 0;

    // ---- dome ----
    const dome = domeRef.current;
    if (dome) {
      dome.position.copy(cam.position);
      const u = (dome.material as ShaderMaterial).uniforms;
      (u.uZenith.value as Color).copy(sky.zenith);
      (u.uHorizon.value as Color).copy(sky.horizon);
      (u.uSunDir.value as Vector3).copy(sky.sunDir);
      (u.uMoonDir.value as Vector3).copy(sky.moonDir);
      (u.uSunColor.value as Color).copy(sky.keyColor);
      u.uStars.value = sky.stars;
      u.uTime.value = now / 1000;
      u.uCover.value = weather.cover;
      u.uSmog.value = smog;
      u.uFlash.value = flash;
    }

    // ---- fog: horizon colour with a touch of smog; closer in rain ----
    const fog = fogRef.current;
    if (fog) {
      _tmpColor.copy(_white).lerp(_smogTint, smog * 0.6);
      fog.color.copy(sky.horizon).multiply(_tmpColor);
      const wet = Math.max(rain, (weather.cover - 0.5) * 0.4);
      fog.near = lerp(FOG_NEAR, FOG_NEAR_RAIN, wet);
      fog.far = lerp(FOG_FAR, FOG_FAR_RAIN, wet);
    }

    // ---- where the camera looks (shadows + rain follow it) ----
    const controls = state.controls as unknown as { target?: Vector3 } | null;
    if (controls?.target) _target.copy(controls.target);
    else {
      cam.getWorldDirection(_fwd);
      const t = _fwd.y < -0.01 ? Math.min(-cam.position.y / _fwd.y, 3000) : 400;
      _target.copy(cam.position).addScaledVector(_fwd, t);
    }
    _target.y = 0;

    // ---- key light (sun / moon), shadow camera follows the view, snapped to texels ----
    const sun = sunRef.current;
    if (sun) {
      const dist = cam.position.distanceTo(_target);
      const half = Math.min(700, Math.max(220, Math.round((dist * 0.55) / 60) * 60));
      const sc = sun.shadow.camera;
      if (half !== shadowHalf.current) {
        shadowHalf.current = half;
        sc.left = -half;
        sc.right = half;
        sc.top = half;
        sc.bottom = -half;
        sc.updateProjectionMatrix();
      }
      snapToTexel(_target, sky.keyDir, (2 * half) / SHADOW_MAP, _snap);
      sun.target.position.copy(_snap);
      sun.target.updateMatrixWorld();
      sun.position.copy(_snap).addScaledVector(sky.keyDir, LIGHT_DISTANCE);
      sun.color.copy(sky.keyColor);
      sun.intensity = sky.keyIntensity;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(sky.hemiSky).lerp(_flashColor, Math.min(1, flash * 0.6));
      hemi.groundColor.copy(sky.hemiGround);
      hemi.intensity = sky.hemiIntensity + flash * 2.2;
    }

    // ---- clouds: thicker with cover, drifting with WIND (shader does the wrap) ----
    const inst = cloudsRef.current;
    if (inst) {
      const mat = inst.material as MeshStandardMaterial;
      mat.color.copy(sky.cloud);
      mat.emissive.copy(sky.cloud).multiplyScalar(0.3 + flash * 0.6);
      const u = mat.userData.uniforms as Uniforms;
      const drift = cloudDrift.current;
      if (!paused) {
        drift.x = (drift.x + WIND[0] * CLOUD_WIND * dt) % CLOUD_SPAN;
        drift.y = (drift.y + WIND[1] * CLOUD_WIND * dt) % CLOUD_SPAN;
      }
      (u.uDrift.value as Vector2).copy(drift);
      u.uPuff.value = 1 + 0.45 * weather.cover;
      const n = Math.round(lerp(CLEAR_CLOUDS, CLOUD_COUNT, Math.min(1, weather.cover / 0.85)));
      inst.count = clouds.puffEnd[n];
    }

    // ---- rain streaks around the camera ----
    const rainMesh = rainRef.current;
    if (rainMesh) {
      rainMesh.visible = rain > 0.01;
      if (rainMesh.visible) {
        const u = (rainMesh.material as ShaderMaterial).uniforms;
        const speed = lerp(9, 30, rain);
        _vel.set(WIND[0] * 1.5, -speed, WIND[1] * 1.5);
        const off = rainOffset.current;
        if (!paused) {
          off.addScaledVector(_vel, dt);
          off.set(off.x % RAIN_BOX.x, off.y % RAIN_BOX.y, off.z % RAIN_BOX.z);
        }
        cam.getWorldDirection(_fwd);
        (u.uCenter.value as Vector3).copy(cam.position).addScaledVector(_fwd, 55);
        (u.uOffset.value as Vector3).copy(off);
        (u.uDir.value as Vector3).copy(_vel).normalize();
        u.uLen.value = lerp(1.2, 4, rain);
        u.uRain.value = rain;
        // brightness follows the ambient light so rain doesn't glow at night
        (u.uColor.value as Color).copy(sky.hemiSky).multiplyScalar(0.55 * sky.hemiIntensity + flash);
        u.uOpacity.value = lerp(0.35, 0.6, rain);
      }
    }

    // ---- post: bloom + cinematic grade ----
    gradeFor(hourRef.current, sky.stars, weather.cover, grade);
    if (bloomRef.current) bloomRef.current.intensity = sky.bloom + flash * 0.8;
    if (hueRef.current) hueRef.current.saturation = grade.saturation;
    if (bcRef.current) {
      bcRef.current.contrast = grade.contrast;
      bcRef.current.brightness = grade.brightness;
    }
    if (vignetteRef.current) vignetteRef.current.darkness = grade.vignette;
  });

  return (
    <>
      <mesh
        ref={domeRef}
        geometry={domeGeo}
        material={domeMat}
        renderOrder={-1000}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <instancedMesh
        ref={cloudsRef}
        args={[cloudGeo, cloudMat, clouds.puffs]}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <lineSegments
        ref={rainRef}
        geometry={rainGeo}
        material={rainMat}
        frustumCulled={false}
        renderOrder={10}
        raycast={noRaycast}
        visible={false}
      />

      <directionalLight
        ref={sunRef}
        castShadow
        position={[300, 500, 250]}
        intensity={2.5}
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-camera-near={10}
        shadow-camera-far={LIGHT_DISTANCE * 2}
        shadow-bias={-0.0004}
        shadow-normalBias={0.5}
      />
      <fog ref={fogRef} attach="fog" args={["#a9c7e8", FOG_NEAR, FOG_FAR]} />
      <hemisphereLight ref={hemiRef} args={["#d6e8ff", "#606a55", 1]} />

      <EffectComposer multisampling={4}>
        <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={0.8} radius={0.7} />
        <ToneMapping mode={TONE_MAPPING_ACES_FILMIC} />
        <HueSaturation ref={hueRef} saturation={0.08} />
        <BrightnessContrast ref={bcRef} contrast={0.04} />
        <Vignette ref={vignetteRef} offset={0.28} darkness={0.4} />
      </EffectComposer>
    </>
  );
}
