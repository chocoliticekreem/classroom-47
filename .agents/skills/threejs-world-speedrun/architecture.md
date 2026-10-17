# Architecture (hamyway-city pattern)

## Folder layout

```
apps/web/src/
  app/world/page.tsx          # thin: renders <WorldPage/>
  world/
    WorldPage.tsx             # DOM shell: dynamic(World,{ssr:false}) + HUD overlays
    World.tsx                 # <Canvas> + MODULES map + toggles + perf
    ModuleBoundary.tsx        # error isolation per module
    PerfProbe.tsx             # window.__world.bench(n)
    config.ts                 # SHARED: units, ZONES boxes, world size, wind
    store.ts                  # SHARED: zustand, low-frequency state
    registry.ts               # SHARED: per-frame mutable Maps (vehicles etc.)
    bus.ts                    # SHARED: one-off typed events emit()/on()
    roads.ts                  # SHARED (optional): graph, findPath, lanePosition
    modules/
      Sky.tsx  Ground.tsx  Buildings.tsx  Traffic.tsx  CameraRig.tsx ...
      Buildings/              # helpers for that module only
        layout.ts             # pure: seed -> specs      (+ layout.test.ts)
        build.ts              # specs -> InstancedMesh
        textures.ts           # canvas textures
        sim.ts                # pure sim step            (+ sim.test.ts)
```

Pairs: `X.tsx` (thin R3F component) + `X/layout.ts` (pure) + `X/build.ts` (three objects) + `X/textures.ts` + `X/*.test.ts`.

## config.ts — the zone contract

```ts
// Units: metres, y up, ground y = 0. Every module stays inside its own box.
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

export const ZONES = {
  downtown: { minX: -160, maxX: 160, minZ: -160, maxZ: 160 },
  docks:    { minX: 240,  maxX: 340, minZ: -80,  maxZ: 80 },
  // one entry per module/district/agent
} satisfies Record<string, Box>;
export type ZoneName = keyof typeof ZONES;

export const WORLD_SIZE = 2200;          // ground is WORLD_SIZE² centred on 0
export const WIND: [number, number] = [-2.2, -3.0]; // smoke/clouds/flags/birds drift with this
export const inBox = (b: Box, x: number, z: number, m = 0) =>
  x >= b.minX - m && x <= b.maxX + m && z >= b.minZ - m && z <= b.maxZ + m;
```

Plan zones on a **sheet of paper first**: a 3×3 grid of districts around a hero centre, water on one edge, a highway ring. Leave 10–30 m gaps for roads/transition.

## World.tsx

```tsx
"use client";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor, Stats } from "@react-three/drei";
import { Suspense, useState } from "react";
import { ModuleBoundary } from "./ModuleBoundary";
import { PerfProbe } from "./PerfProbe";
import Sky from "./modules/Sky";
import Ground from "./modules/Ground";
// ...import modules

const MODULES = { Sky, Ground /* , Buildings, Traffic, ... */ };

export default function World() {
  const [dpr, setDpr] = useState(1.5);
  // ?skip=Rail,OldTown   ?only=Sky,Ground   ?stats=1
  const [enabled] = useState(() => {
    if (typeof window === "undefined") return Object.keys(MODULES);
    const q = new URLSearchParams(window.location.search);
    const list = (k: string) => (q.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const only = list("only"), skip = new Set(list("skip"));
    return Object.keys(MODULES).filter((m) => (only.length ? only.includes(m) : true) && !skip.has(m));
  });
  const [showStats] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stats"));
  return (
    <Canvas
      shadows
      dpr={dpr}
      camera={{ position: [0, 260, 320], fov: 45, near: 1, far: 4000 }}
      gl={{ antialias: true, powerPreference: "high-performance", stencil: false, logarithmicDepthBuffer: true }}
    >
      <PerformanceMonitor onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))} onDecline={() => setDpr(1)} />
      <AdaptiveDpr pixelated />
      <PerfProbe />
      {showStats && <Stats />}
      <color attach="background" args={["#a9c7e8"]} />
      <hemisphereLight args={["#ffffff", "#556655", 0.6]} /> {/* fallback until Sky mounts */}
      {Object.entries(MODULES).filter(([n]) => enabled.includes(n)).map(([name, M]) => (
        <ModuleBoundary key={name} name={name}>
          <Suspense fallback={null}><M /></Suspense>
        </ModuleBoundary>
      ))}
    </Canvas>
  );
}
```

Notes: `logarithmicDepthBuffer: true` kills z-fighting at 2 km+ scale with `near: 1, far: 4000` (see performance.md for the ShaderMaterial patch). Drop it for small worlds.

## ModuleBoundary.tsx

```tsx
"use client";
import { Component, type ReactNode } from "react";
export class ModuleBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(`[world] module ${this.props.name} crashed`, e); }
  render() { return this.state.failed ? null : this.props.children; }
}
```

## Page shell (client-only canvas)

```tsx
"use client";
import dynamic from "next/dynamic";
const World = dynamic(() => import("./World"), { ssr: false, loading: () => <p className="p-4">Loading…</p> });
export default function WorldPage() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {/* isolate = own stacking context so drei <Html> labels stay under the HUD */}
      <div className="absolute inset-0 isolate z-0"><World /></div>
      {/* DOM overlays (HUD, minimap) go here at z-10 / z-20 */}
    </div>
  );
}
```

## store.ts (zustand — rare state only)

```ts
import { create } from "zustand";
interface WorldState {
  timeOfDay: number;                 // 0..24, pushed ≤4×/s by Sky
  setTimeOfDay: (h: number) => void;
  cameraFocus: { x: number; z: number } | null;
  setCameraFocus: (f: WorldState["cameraFocus"]) => void;
}
export const useWorld = create<WorldState>((set) => ({
  timeOfDay: 14, setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  cameraFocus: null, setCameraFocus: (cameraFocus) => set({ cameraFocus }),
}));
// outside React / inside useFrame: useWorld.getState().timeOfDay  (no re-render)
```

## registry.ts (per-frame, never reactive)

```ts
import type { Object3D } from "three";
export interface VehicleEntry { id: string; object: Object3D; speed: number; stopped: boolean; /* … */ }
const vehicles = new Map<string, VehicleEntry>();
export const registerVehicle = (v: VehicleEntry) => { vehicles.set(v.id, v); return () => vehicles.delete(v.id); };
export const allVehicles = () => vehicles.values();
let seq = 0; export const nextId = (p: string) => `${p}-${++seq}`;
```

Other modules read the registry in their own `useFrame` (e.g. Crashes finds a victim, Responders chases it). Return the unregister fn from `useEffect` cleanup.

## bus.ts (one-off typed events)

```ts
export type WorldEvent =
  | { type: "incident:created"; id: string }
  | { type: "request:fireworks" }
  | { type: "ui:select"; id: string };
type H = (e: WorldEvent) => void;
const handlers = new Set<H>();
export const emit = (e: WorldEvent) => { for (const h of handlers) h(e); };
export const on = (h: H) => { handlers.add(h); return () => handlers.delete(h); };
export type EventOf<T extends WorldEvent["type"]> = Extract<WorldEvent, { type: T }>;
```

HUD button → `emit({type:"request:fireworks"})` → owning module `on(...)` in `useEffect`. UI never reaches into 3D, 3D never imports UI.

## Module template

```tsx
"use client";
// Module: <Name>. One-line what it draws + which ZONE it owns + who reads/writes shared state.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { ZONES } from "../config";
import { generate } from "./Name/layout";   // pure, seeded, tested
import { build } from "./Name/build";       // -> { group, dispose, update }

const SEED = 20261010;

export default function Name() {
  const built = useMemo(() => build(generate(SEED, ZONES.downtown)), []);
  useEffect(() => () => built.dispose(), [built]);        // free GPU memory
  useFrame((_, dt) => built.update(dt));                   // no allocation here
  return <primitive object={built.group} />;
}
```

## Splitting work across parallel agents/people

1. One person writes the **contract layer** (config, store, registry, bus, World, ModuleBoundary) in the first 20 minutes and merges it.
2. Hand each agent: *"You own `modules/X.tsx` + `modules/X/` and `ZONES.x`. Do not edit contract files except to add your zone/event. Keep it ≥ 60 fps standalone via `?only=Sky,Ground,X`."*
3. Every module header comment states: purpose, zone, shared state it reads/writes.
4. Integrate by adding one line to `MODULES`. Bisect problems with `?skip=`.
5. Use git worktrees per agent; merge small, often.
