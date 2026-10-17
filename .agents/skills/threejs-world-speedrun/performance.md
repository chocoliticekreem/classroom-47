# Performance (60 fps on a laptop with a huge world)

Budget thinking: **draw calls and CPU per frame**, not triangles. Target < 400 draw calls, 0 allocations in `useFrame`, ≤ 1 shadow-casting light.

## Checklist

- [ ] Repeated things are `InstancedMesh` (buildings, trees, lamps, cars, crowd, bricks). Set `instanceMatrix.needsUpdate = true` only when changed; `frustumCulled = false` on instanced meshes spanning the world (or set a correct bounding sphere with `computeBoundingSphere()`).
- [ ] Static geometry merged: `BufferGeometryUtils.mergeGeometries([...])` (set per-geometry vertex colours first so one material works).
- [ ] Few materials. Share them. Prefer vertex colours + one `MeshStandardMaterial` over 50 materials.
- [ ] Textures are procedural canvases ≤ 512² (≤ 1024² hero), `anisotropy = 8`, mipmaps on, `colorSpace = SRGBColorSpace` for colour maps.
- [ ] No `new Vector3/Color/Matrix4` inside `useFrame` — module-level scratch objects.
- [ ] `useFrame` throttled for slow stuff (`acc += dt; if (acc < 0.25) return`).
- [ ] State out of React: refs / registry. Zustand writes ≤ 4×/s.
- [ ] Shadows: one `DirectionalLight` with a **tight shadow camera that follows the camera target**, `mapSize 2048`, snap to texels (see `snapToTexel` idea: round light position to shadow-texel size to stop shimmer). Only big things cast; small props receive nothing.
- [ ] `AdaptiveDpr` + `PerformanceMonitor` (drop to dpr 1 on decline).
- [ ] `flatShading: true` low-poly look hides low tessellation and is cheap.
- [ ] Fog hides far pop-in (and lets you cull aggressively).
- [ ] LOD by distance: swap detail with `<Detailed>` (drei) or hide small props beyond N metres in a throttled loop.
- [ ] Dispose in `useEffect` cleanup: geometries, materials, textures, render targets.
- [ ] `stencil: false` on the renderer unless you need it. `powerPreference: "high-performance"`.
- [ ] Post-processing: **one** `EffectComposer`; Bloom with `mipmapBlur`, `luminanceThreshold ≈ 1` (only emissive > 1 blooms); skip SSAO/DoF unless needed.

## Log-depth buffer (large worlds)

Use `gl={{ logarithmicDepthBuffer: true }}` with `near: 1, far: 4000`. Built-in three materials support it. **Custom `ShaderMaterial`s don't** → patch them once at startup:

```ts
import { ShaderMaterial, type WebGLProgramParametersWithUniforms } from "three";
const VERT_PARS = `#ifdef USE_LOGDEPTHBUF\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n`;
const VERT_BODY = `#ifdef USE_LOGDEPTHBUF\nvFragDepth = 1.0 + gl_Position.w;\nvIsPerspective = float(projectionMatrix[2][3] == -1.0);\n#endif\n`;
const FRAG_PARS = `#ifdef USE_LOGDEPTHBUF\nuniform float logDepthBufFC;\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n`;
const FRAG_BODY = `#ifdef USE_LOGDEPTHBUF\ngl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;\n#endif\n`;
const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/;

export function addLogDepth(vertex: string, fragment: string) {
  if (vertex.includes("logdepthbuf") || fragment.includes("logdepthbuf") || vertex.includes("vFragDepth")) return { vertex, fragment };
  const vm = vertex.search(MAIN), fm = fragment.search(MAIN), vEnd = vertex.lastIndexOf("}");
  if (vm < 0 || fm < 0 || vEnd < vm) return { vertex, fragment };
  const v = vertex.slice(0, vm) + VERT_PARS + vertex.slice(vm, vEnd) + VERT_BODY + vertex.slice(vEnd);
  const fOpen = fm + fragment.match(MAIN)![0].length;
  const f = fragment.slice(0, fm) + FRAG_PARS + fragment.slice(fm, fOpen) + FRAG_BODY + fragment.slice(fOpen);
  return { vertex: v, fragment: f };
}
let installed = false;
export function installLogDepthPatch() {
  if (installed) return; installed = true;
  (ShaderMaterial.prototype as any).onBeforeCompile = function (s: WebGLProgramParametersWithUniforms) {
    const o = addLogDepth(s.vertexShader, s.fragmentShader); s.vertexShader = o.vertex; s.fragmentShader = o.fragment;
  };
}
```
Call `installLogDepthPatch()` at module top of `World.tsx`. Skip all of this if the world is < ~1 km.

## PerfProbe (works with the tab hidden)

```tsx
"use client";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
export function PerfProbe() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    (window as any).__world = {
      gl, scene, camera,
      bench(n = 20) {
        gl.info.autoReset = false; gl.info.reset();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) gl.render(scene, camera);
        gl.getContext().finish();
        const ms = (performance.now() - t0) / n;
        const out = { msPerFrame: +ms.toFixed(2), drawCalls: Math.round(gl.info.render.calls / n),
          triangles: Math.round(gl.info.render.triangles / n), geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures, programs: gl.info.programs?.length };
        gl.info.autoReset = true; return out;
      },
    };
  }, [gl, scene, camera]);
  return null;
}
```

Workflow: `?stats=1` to eyeball → `__world.bench(30)` for numbers → `?skip=Module` bisect → fix the worst offender → repeat.

## Instancing recipe

```ts
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
const mesh = new THREE.InstancedMesh(geo, mat, count);
specs.forEach((b, i) => {
  _p.set(b.x, b.h / 2, b.z); _q.setFromAxisAngle(UP, b.rot); _s.set(b.w, b.h, b.d);
  mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  mesh.setColorAt(i, _c.set(b.color));            // per-instance tint, free
});
mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
mesh.computeBoundingSphere(); mesh.castShadow = true; mesh.receiveShadow = true;
```
Unit-box geometry (`BoxGeometry(1,1,1)`) scaled per instance = infinite building shapes from one geometry. Per-instance window UVs: derive tiling from `length(instanceMatrix[i].xyz)` in the vertex shader (`onBeforeCompile`, see visuals.md).

## Animate thousands of things cheaply

- CPU sim on typed arrays, write matrices into the instance buffer, flag `needsUpdate` once.
- Or move it to the GPU: vertex-shader animation with a `uTime` uniform (birds flapping, grass sway, water waves, flags). Zero CPU per instance.
- Sleep what's off-screen / far: skip sim updates beyond N metres.

## Memory

`gl.info.memory` shows leaked geometries/textures after navigating away — if they climb, you forgot `dispose()`. drei `useGLTF`/`useTexture` cache and dispose themselves; hand-built objects don't.
