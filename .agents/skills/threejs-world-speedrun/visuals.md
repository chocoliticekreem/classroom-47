# Visuals — make the screenshot look insane

Order of impact: **sky + fog + light colour → bloom/tonemap → emissive night → procedural texture detail → water → particles/motion.**

## Sky module (own time of day, light, fog, post)

Module `Sky` owns: time-of-day, sun/moon `DirectionalLight`, `HemisphereLight`, `scene.fog`, background, dome, clouds, post-processing. Nobody else touches `scene.fog` or lights.

Pure `sampleSky(hour)` returns colours — keep it a tested pure function:

```ts
// Sky/skyState.ts — keyframes by hour, lerp between them
const KEYS = [
  { h: 0,  top: "#02040c", horizon: "#0b1530", sun: "#6a7bb8", sunI: 0.05, hemi: 0.15, fog: "#0b1530" },
  { h: 6,  top: "#3b4a7a", horizon: "#ff9a5c", sun: "#ffb27a", sunI: 0.8,  hemi: 0.35, fog: "#d7a58a" },
  { h: 12, top: "#3f86d8", horizon: "#bfdcff", sun: "#fff4e0", sunI: 2.2,  hemi: 0.7,  fog: "#b9d3ee" },
  { h: 18, top: "#38457a", horizon: "#ff7a3c", sun: "#ff9a55", sunI: 1.0,  hemi: 0.4,  fog: "#c88a6a" },
  { h: 24, top: "#02040c", horizon: "#0b1530", sun: "#6a7bb8", sunI: 0.05, hemi: 0.15, fog: "#0b1530" },
];
```

Dome = inverted `SphereGeometry` (`side: BackSide`, `depthWrite: false`, `fog: false`) with a gradient `ShaderMaterial` (uniforms `uTop`, `uHorizon`, sun disc via `pow(max(dot(dir, sunDir),0.), 600.)`). Make it follow the camera so it is always at infinity.

```tsx
useFrame(({ camera }) => { dome.position.copy(camera.position); });
// radius < camera.far (3400 vs far 4000)
```

Fog: `scene.fog = new THREE.Fog(color, near, far)`, lerp colour toward sky horizon colour every frame. `FOG_NEAR ≈ 700, FOG_FAR ≈ 2400` for a 2 km world; pull in for rain/night. **Fog colour must match horizon colour** or the world looks pasted on.

Stars: `Points` with additive blending, opacity = `nightLevel`. Clouds: instanced soft quads/icosahedra drifting with `WIND`.

## Post-processing (react-three-fiber/postprocessing)

```tsx
import { EffectComposer, Bloom, ToneMapping, Vignette, HueSaturation, BrightnessContrast } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

<EffectComposer multisampling={0}>
  <Bloom mipmapBlur intensity={0.6} luminanceThreshold={1} luminanceSmoothing={0.2} />
  <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  <HueSaturation saturation={0.12} />
  <BrightnessContrast contrast={0.08} />
  <Vignette eskil={false} offset={0.2} darkness={0.55} />
</EffectComposer>
```
`luminanceThreshold={1}` + emissive colours > 1 (`color.setRGB(3, .15, .1)`) = only lights bloom (aviation beacons, neon, windows at night, brake lights). Animate bloom intensity with night level.

## Lighting recipe

- 1× `DirectionalLight` sun, shadow `mapSize 2048`, orthographic shadow cam ±150–300 m following camera focus, `shadow.bias -0.0005`, `normalBias 0.5`.
- 1× `HemisphereLight(skyColour, groundColour, 0.4–0.7)` for ambient.
- Night: sun intensity → moon (blue, 0.2). Never go pure black — keep hemi ≥ 0.15.
- Fake point lights with emissive materials + bloom. **Never** use dozens of real `PointLight`s.

## Night windows (the best cheap trick)

1. Paint a facade `CanvasTexture`: grid of windows, ~35% lit, warm/cool variants.
2. Paint a **separate emissive map** with only the lit windows.
3. `MeshStandardMaterial({ map, emissiveMap, emissive: "#fff", emissiveIntensity: 0 })`.
4. Each frame bucket (hourBucket quarter-hours) set `emissiveIntensity = nightLevel * glow`. Touch materials only when the bucket changes, not every frame.
5. Per-instance tiling in the vertex shader so windows keep real size on any box:

```glsl
#include <uv_vertex>
#ifdef USE_INSTANCING
{
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec2 face = abs(normal.x) > 0.5 ? vec2(s.z, s.y) : vec2(s.x, s.y);
  float cols = max(1.0, floor(face.x / uGrid.x + 0.5));
  float floors = max(1.0, floor(face.y / uGrid.y + 0.5));
  vec2 fUv = uv * vec2(cols, floors);
  #ifdef USE_MAP
  vMapUv = fUv;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = fUv;
  #endif
}
#endif
```
Inject by `material.onBeforeCompile = (sh) => { sh.uniforms.uGrid = {value: …}; sh.vertexShader = sh.vertexShader.replace("#include <uv_vertex>", FACADE_UV).replace("void main() {", "uniform vec4 uGrid;\nvoid main() {"); }`.

## Procedural tiling textures

```ts
function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas"); c.width = c.height = size;
  return [c, c.getContext("2d")!];
}
function finish(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
// draw each blotch at x±size, y±size so it wraps → seamless tiles
function wrapped(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    if (x + dx + r < 0 || x + dx - r > size || y + dy + r < 0 || y + dy - r > size) continue;
    draw(x + dx, y + dy);
  }
}
```
Use **world-space UVs** (`uv = worldXZ / tileMetres`) so textures line up across meshes. Layer: base colour → big soft blotches (mottling) → small noise speckle → details (cracks, lane markings). Roads: asphalt noise + dashed centre line + kerb strip.

## Terrain & coast

Value-noise heightfield on a `PlaneGeometry` (segments 256–512), displaced in JS once; vertex-colour by height/slope (grass → rock → snow, sand near water). Flatten under zones via `smoothstep` falloff from zone boxes. Coastline function `shoreX(z)` shared between JS and the water GLSL.

## Water

`ShaderMaterial` on a big plane: two scrolling normal-ish sine layers, fresnel (`pow(1 - dot(N,V), 3)`) mix deep/shallow colour, sun glint `pow(max(dot(R, sunDir),0), 200)`, depth-fade foam near shore from `shoreX`. Needs `transparent: true`, `depthWrite: false`, and the log-depth patch if using log depth. Cheap alternative: drei `<MeshReflectorMaterial>` for a small pond/puddle.

## Smoke / fire / particles

Instanced billboards or `Points` with additive blend; shared geometry; per-particle age in a typed array; drift with `WIND`; fade by age; recycle ring-buffer style (no spawn/destroy). Chimneys, crashes, fireworks, rain streaks (instanced thin quads following camera) all use the same pattern.

## Animation & life (cheap wow)

Birds (GPU flap), pedestrian crowds (instanced capsules with sim), cyclists, trains on splines, boats on a river path, helicopters on orbit paths, traffic lights on a global clock (`phase(nodeId, timeMs)`), flags with wind shader, fireworks events. Life makes a static city feel real — add 3 kinds minimum.

## Camera = presentation

`CameraRig` module: presets (overview, street-level chase, orbit-landmark, fly-through along a spline), smooth lerp with `damp`, `useWorld.cameraFocus` to jump somewhere on click. Drei `<OrbitControls makeDefault maxPolarAngle={Math.PI/2.1} />` for free exploration. Auto-orbit when idle for the demo recording.

## drei shortcuts worth knowing

`Html` (labels; `zIndexRange`), `Text` (SDF text), `Billboard`, `Detailed`, `Instances/Instance` (small counts), `useGLTF`+`useTexture` (+preload), `Environment` (HDR lighting for hero objects), `Sky` (quick physical sky if no time to write your own), `Stars`, `Cloud`, `Float`, `Line`, `Trail`, `PerformanceMonitor`, `AdaptiveDpr`, `Stats`, `CameraControls`, `ContactShadows`, `Sparkles`.

**Fastest path if truly out of time:** drei `<Sky>` + `<Environment preset="city">` + `<fog>` + Bloom + instanced boxes + OrbitControls. Still looks good.
