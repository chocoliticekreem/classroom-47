"use client";

import { PerformanceMonitor, Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import * as THREE from "three";
import { DevPanel } from "@/components/DevPanel";
import { useConditions, useDemoSettings, type Conditions } from "@/platform/demo";
import { ORIGIN } from "./config";
import { LiveHud, LiveLayers } from "./live";
import { Pedestrians } from "./live/Pedestrians";
import { Traffic } from "./live/Traffic";
import { ModuleBoundary } from "./ModuleBoundary";
import { Bankside } from "./scene/Bankside";
import { Buildings } from "./scene/Buildings";
import { CameraRig } from "./scene/CameraRig";
import { PRESETS, useCameraStore, type CameraPreset } from "./scene/cameraStore";
import { Ground } from "./scene/Ground";
import { Lights } from "./scene/Lights";
import { CAMERA_FAR } from "./scene/palette";
import { Parks } from "./scene/Parks";
import { perf, readRenderer, stepTier } from "./scene/perf";
import { Post } from "./scene/Post";
import { Probe } from "./scene/Probe";
import { Pavements } from "./scene/Pavements";
import { Roads } from "./scene/Roads";
import { Sky } from "./scene/Sky";
import { GeometryContext, useGeometryLoader } from "./scene/useGeometry";
import { Water } from "./scene/Water";
import { Atmosphere, Rain } from "./scene/Weather";

interface Toggles {
  only: Set<string> | null;
  skip: Set<string>;
  stats: boolean;
}

function readToggles(): Toggles {
  const q = new URLSearchParams(window.location.search);
  const list = (key: string) =>
    (q.get(key) ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const only = list("only");
  return { only: only.length ? new Set(only) : null, skip: new Set(list("skip")), stats: q.get("stats") === "1" };
}

function Module({ name, toggles, children }: { name: string; toggles: Toggles; children: ReactNode }) {
  const key = name.toLowerCase();
  if (toggles.skip.has(key)) return null;
  if (toggles.only && !toggles.only.has(key)) return null;
  return (
    <ModuleBoundary name={name}>
      <Suspense fallback={null}>{children}</Suspense>
    </ModuleBoundary>
  );
}

const PRESET_ORDER: CameraPreset[] = ["aerial", "street", "skyline"];

function PresetButtons() {
  const preset = useCameraStore((s) => s.preset);
  const fly = useCameraStore((s) => s.fly);
  return (
    <div className="pointer-events-auto absolute bottom-16 left-5 flex gap-1 rounded-full border border-white/10 bg-black/50 p-1 backdrop-blur-md">
      {PRESET_ORDER.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => fly(p)}
          className={`rounded-full px-4 py-1.5 text-xs font-medium tracking-wide transition ${
            preset === p ? "bg-white text-black" : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          {PRESETS[p].label}
        </button>
      ))}
    </div>
  );
}

const WEATHER_LABEL: Record<Conditions["weather"], string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  fog: "Fog",
  storm: "Storm",
};
const TIME_LABEL: Record<Conditions["time"], string> = { day: "Day", dusk: "Dusk", night: "Night" };

function ConditionsChip({ conditions }: { conditions: Conditions }) {
  const temp = conditions.live ? ` · ${Math.round(conditions.live.temperatureC)} °C` : "";
  const text = `${WEATHER_LABEL[conditions.weather]}${temp} · ${TIME_LABEL[conditions.time]}`;
  return (
    <div
      className={`absolute right-5 top-5 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur-md ${
        conditions.isLive
          ? "border-white/10 bg-black/50 text-white/85"
          : "border-warn/40 bg-black/60 text-warn"
      }`}
    >
      <span className={`size-1.5 rounded-full ${conditions.isLive ? "bg-ok" : "bg-warn"}`} />
      {conditions.isLive ? `Live · ${text}` : `Demo override · ${text}`}
    </div>
  );
}

export function World() {
  const [toggles] = useState(readToggles);
  const conditions = useConditions(ORIGIN);
  const settings = useDemoSettings();
  const geometry = useGeometryLoader();
  const [dpr, setDpr] = useState(perf.dprCap);
  const [gpu, setGpu] = useState("");
  const camera = useMemo(
    () => ({ position: PRESETS.aerial.pos, fov: 50, near: 2, far: CAMERA_FAR }),
    [],
  );

  return (
    <div className="relative h-full w-full bg-[#1c2546]">
      <Canvas
        dpr={dpr}
        camera={camera}
        performance={{ min: 0.5 }}
        gl={{
          // Why: Post renders the scene into its own offscreen targets, so native MSAA on the canvas buys nothing.
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          preserveDrawingBuffer: false,
          toneMapping: THREE.NoToneMapping,
        }}
        onCreated={({ gl }) => setGpu(readRenderer(gl.getContext()))}
        className="isolate z-0"
      >
        <PerformanceMonitor
          bounds={(refreshRate) => (refreshRate > 100 ? [55, 100] : [48, 58])}
          onDecline={() => !document.hidden && setDpr(stepTier(-1))}
          onIncline={() => !document.hidden && setDpr(stepTier(1))}
        />
        {toggles.stats && <Stats />}
        <Probe />
        <Module name="Sky" toggles={toggles}>
          <Atmosphere conditions={conditions} timeOverridden={settings.time !== null} />
          <Sky />
        </Module>
        <Module name="Weather" toggles={toggles}>
          <Rain />
        </Module>
        <Module name="Lights" toggles={toggles}>
          <Lights />
        </Module>
        <Module name="Ground" toggles={toggles}>
          <Ground />
        </Module>
        <Module name="CameraRig" toggles={toggles}>
          <CameraRig />
        </Module>
        {geometry.status === "ready" && (
          <GeometryContext.Provider value={geometry.data}>
            <Module name="Buildings" toggles={toggles}>
              <Buildings />
            </Module>
            <Module name="Roads" toggles={toggles}>
              <Roads />
            </Module>
            <Module name="Pavements" toggles={toggles}>
              <Pavements />
            </Module>
            <Module name="Water" toggles={toggles}>
              <Water />
            </Module>
            <Module name="Parks" toggles={toggles}>
              <Parks />
            </Module>
            <Module name="Traffic" toggles={toggles}>
              <Traffic />
            </Module>
            <Module name="Pedestrians" toggles={toggles}>
              <Pedestrians />
            </Module>
          </GeometryContext.Provider>
        )}
        <Module name="Bankside" toggles={toggles}>
          <Bankside />
        </Module>
        <Module name="Live" toggles={toggles}>
          <LiveLayers />
        </Module>
        <Module name="Post" toggles={toggles}>
          <Post />
        </Module>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute left-5 top-5 flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/50">Digital twin</span>
          <span className="text-lg font-semibold text-white">Tower Hill, London</span>
        </div>
        {geometry.status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-5 py-2.5 text-sm text-white/85 backdrop-blur-md">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              Loading Tower Hill…
            </div>
          </div>
        )}
        {geometry.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm rounded-2xl border border-red-400/30 bg-black/70 px-5 py-4 text-sm text-white/85 backdrop-blur-md">
              <p className="font-medium text-red-300">Could not load Tower Hill</p>
              <p className="mt-1 text-white/60">{geometry.message}</p>
            </div>
          </div>
        )}
        <ConditionsChip conditions={conditions} />
        {toggles.stats && gpu && (
          <div
            title={gpu}
            className="absolute right-5 top-14 flex max-w-[420px] items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1 font-mono text-[10px] text-white/70 backdrop-blur-md"
          >
            <span className={`size-1.5 shrink-0 rounded-full ${perf.software ? "bg-warn" : "bg-ok"}`} />
            <span className="truncate">{gpu}</span>
            <span className="shrink-0 text-white/40">
              {perf.tier} · dpr {dpr}
            </span>
          </div>
        )}
        <PresetButtons />
        <LiveHud />
        <DevPanel />
      </div>
    </div>
  );
}
