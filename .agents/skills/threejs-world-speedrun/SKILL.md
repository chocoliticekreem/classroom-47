---
name: threejs-world-speedrun
description: Hackathon speed-run playbook for building a huge, good-looking, performant 3D world with three.js + react-three-fiber + drei (Next.js). Use when asked to make a 3D scene, city, world, game map, or "crazy 3D thing" fast. Encodes the module-per-zone architecture, shared-contract files, instancing, procedural textures, sky/post-processing, perf rules and a time-boxed build order proven in arvin-shafiei/hamyway-city.
---

# Three.js World Speed-Run

Goal: a jaw-dropping, 60fps 3D world in hours, built by many people/agents in parallel without stepping on each other. Everything below is lifted from the hamyway-city `/city` (40+ modules, 2200 m world, traffic, rail, river, weather, events) — it works.

**Stack:** Next.js (App Router) · `three` · `@react-three/fiber` · `@react-three/drei` · `@react-three/postprocessing` · `zustand` · `vitest`.

```bash
npm i three @react-three/fiber @react-three/drei @react-three/postprocessing zustand
npm i -D @types/three vitest
```

## The 7 rules (read these, skip the rest if rushed)

1. **Module per zone.** One file per feature in `world/modules/<Name>.tsx`, helpers in `world/modules/<Name>/`. Each module owns a **zone box** from `config.ts` and never draws outside it. No overlaps → parallel work → no merge conflicts.
2. **A tiny shared-contract layer** every module imports and nobody casually changes: `config.ts` (units, zone boxes), `store.ts` (zustand, *rare* state), `registry.ts` (per-frame mutable data), `bus.ts` (one-off events), `roads.ts`/graph (if things move on paths).
3. **Wrap every module** in `<ModuleBoundary><Suspense>`. A crashing module vanishes; the world lives. Add `?only=A,B` / `?skip=A,B` query toggles in `World.tsx` for instant perf bisecting.
4. **Never put per-frame data in zustand.** Mutate refs / a plain registry `Map` inside `useFrame`. Zustand is for things that change a few times a second at most (selection, time-of-day bucket, incidents).
5. **Instance everything repeated.** One `InstancedMesh` per archetype (buildings, trees, cars, crowd). Draw calls are the budget, not triangles. Merge static geometry. Reuse scratch `Matrix4/Vector3/Quaternion` — **zero allocation in `useFrame`**.
6. **Procedural over assets.** Canvas textures, vertex colours, shader tricks, seeded layouts. No asset pipeline, no downloads, same world every reload (seeded RNG). Only use GLB when it is the thing itself (hero object) and then `useGLTF.preload`.
7. **Pure logic in plain `.ts`, rendering in `.tsx`.** Layout generators, sims, pathfinding are pure functions of a seed → unit-test with vitest in milliseconds. The scene is just a view of them.

## Build order (time-boxed speed run)

| Time | Do | Done when |
|---|---|---|
| 0:00–0:20 | Scaffold Next + R3F canvas, `config.ts`, `World.tsx` with `ModuleBoundary`, `Ground`, fallback `hemisphereLight`, orbit camera | You see a flat world and can fly |
| 0:20–1:00 | `Sky` (gradient dome + sun light + fog + bloom/tonemap), `Buildings`/main set-piece via instancing | It already looks good in a screenshot |
| 1:00–2:00 | `Roads`/paths graph + `Traffic`/agents moving along it, `CameraRig` with cinematic presets | Things move, camera has 3 shots |
| 2:00–4:00 | Parallel districts/zones, one agent/person each, from `config.ts` boxes | `?only=` shows each in isolation |
| 4:00+ | Life (birds, crowds), weather, day/night, events, HUD, minimap, `PerfProbe` | Stable ≥50fps, demo path rehearsed |

Rule: **make it look incredible first (sky, fog, bloom, colour grade), add features second.** Judges see a screenshot before they see a feature.

## Reference docs (load only what you need)

- [architecture.md](architecture.md) — folder layout, the contract files with code, `World.tsx`, `ModuleBoundary`, module template, parallel-agent split.
- [performance.md](performance.md) — instancing, merging, log-depth, adaptive DPR, shadows, dispose, perf probe, budgets & checklist.
- [visuals.md](visuals.md) — sky dome, fog, lighting, post-processing, procedural textures, emissive night windows, water, smoke, shader injection.
- [recipes.md](recipes.md) — copy-paste code: seeded RNG, instanced field, road graph + pathfinding, vehicle agent, camera rig, bus, texture painter, HUD overlay.
- [pitfalls.md](pitfalls.md) — the bugs that cost hours (SSR, z-fighting, Next 16, leaks, R3F gotchas) and the demo-day checklist.

## Ground rules when using this skill

- Units are **metres, y is up, ground y = 0.** Declare handedness conventions (e.g. drive on left) once in `config.ts`.
- Three.js canvas is client-only: `"use client"` + `dynamic(() => import("./World"), { ssr: false })`.
- Check the installed versions' docs/types before using an API you "remember" (three, R3F v9, drei v10, Next 16 are newer than most training data; R3F v9 pairs with React 19).
- Verify visually: run the dev server, load the page, screenshot, read FPS with `?stats=1`. Never claim a scene "looks good" without looking.
- Commit small and often on a branch; never push unless the user says so.
