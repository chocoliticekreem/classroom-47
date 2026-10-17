# Pitfalls & demo-day checklist

## Bugs that cost hours

| Symptom | Cause | Fix |
|---|---|---|
| `window is not defined` / hydration error | Canvas rendered on server | `"use client"` + `dynamic(() => import("./World"), { ssr: false })`; read `window` only in effects/`useState` lazy init guarded by `typeof window` |
| Next 16 build fails on fetching/`useSearchParams` | Cache Components/PPR: dynamic data outside `<Suspense>` | Wrap in `<Suspense>`; read `node_modules/next/dist/docs/` before writing Next code |
| Flickering / z-fighting on roads, far geometry | Depth precision | `logarithmicDepthBuffer: true` (+ patch custom ShaderMaterials), `near ≥ 1`, lift road meshes 0.02–0.05 m, `polygonOffset` on decals |
| Custom shader disappears/z-sorts wrong with log depth | ShaderMaterial lacks log-depth chunks | `installLogDepthPatch()` |
| FPS collapses after hot reload | Leaked geometries/materials/listeners | `useEffect` cleanup disposes; `on()` returns unsubscribe; check `gl.info.memory` |
| Whole screen goes white/black on one bug | Uncaught error in R3F tree | `ModuleBoundary` around every module |
| Shadow shimmer when camera moves | Shadow cam moving in non-texel steps | Snap light target to shadow texel size |
| Everything re-renders at 60 fps | Per-frame data in zustand/React state | Refs/registry + `useFrame`; zustand ≤ 4×/s; select narrow slices `useWorld(s => s.x)` |
| Cars teleport after alt-tab | Huge `dt` | `dt = Math.min(dt, 0.05)` |
| Instanced mesh invisible | Wrong/zero bounding sphere culls it | `frustumCulled = false` or `computeBoundingSphere()` after setting matrices |
| Colours washed out / too dark | Colour space | colour textures `SRGBColorSpace`; data textures (normal/roughness) linear; use `ToneMapping` once (renderer OR composer, not both fighting) |
| Transparent things draw in wrong order | Sorting | `depthWrite:false` for glass/particles/water, `renderOrder`, avoid large intersecting transparents |
| Bloom blows out everything | Threshold too low | `luminanceThreshold={1}` and only emissive > 1 glows |
| `useFrame` allocations → GC stutter | `new Vector3` per frame | module-level scratch objects |
| Text/labels over HUD | z-index stacking | Canvas wrapper `isolate z-0`; drei `Html zIndexRange` below HUD |
| Mac laptop slow | Integrated GPU / dpr 2+ | `powerPreference: "high-performance"`, `AdaptiveDpr`, cap dpr 1.5, `stencil:false` |
| Pathing agents pile up | No following distance | `vehiclesAhead()` + speed matching; re-path on closure |
| Merge conflicts everywhere | Agents editing shared files | Zones + contracts; modules own their files; add-only edits to contract files |

## Hackathon discipline

- **Screenshot-first:** after every module, load the page and look. Take a screenshot; fix the ugliest thing next.
- **Time-box each module** (20–40 min). Ship the 70% version, move on, polish at the end.
- **Fake it:** painted textures, billboards, fog and bloom hide a lot. Distant things can be single boxes.
- **Seeded randomness only** so teammates and the demo see the same world and bugs reproduce.
- **Demo path rehearsed:** pick 3 camera shots and 1 interactive "wow" button (crash, fireworks, storm, time-lapse). Add `?embed=1`-style flag to hide chrome for recording.
- **Auto-quality:** `PerformanceMonitor` so the demo laptop never chugs.
- **Fallbacks:** every module can be skipped with `?skip=`; keep a known-good URL for the demo.
- **Mock backends:** drive the world from a `WorkflowDriver`-style module with fake events first; wire real data after (same `bus` contract).

## Final checklist (before freeze)

- [ ] `npm run build` and `npm run lint` pass; vitest green
- [ ] Opens cold (no cache) in < 5 s, no console errors
- [ ] ≥ 50 fps at demo resolution; `__world.bench(30)` draw calls sane
- [ ] Day, dusk and night all look good (check bloom/windows)
- [ ] All HUD buttons work and don't leak listeners on re-click
- [ ] Camera presets rehearsed; auto-orbit on idle
- [ ] No API keys committed; `.env.example` updated
- [ ] README: how to run, `?only= ?skip= ?stats=` flags, architecture diagram
- [ ] Demo recording done early, not at the freeze minute
