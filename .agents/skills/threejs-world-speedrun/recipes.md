# Recipes (copy-paste)

## Seeded RNG + noise (same world every reload, testable)

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix: number, iy: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t);
};
export function valueNoise(x: number, y: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export const fbm = (x: number, y: number, seed = 0, oct = 4) => {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * valueNoise(x * f, y * f, seed + i); amp /= 2; f *= 2; }
  return v;
};
```

## Layout generator (pure) → instanced build

```ts
// layout.ts (pure, vitest-able)
export interface BoxSpec { x: number; z: number; w: number; d: number; h: number; rot: number; kind: "glass" | "brick" | "office" }
export function generate(seed: number, zone: Box): BoxSpec[] {
  const rng = mulberry32(seed), out: BoxSpec[] = [];
  const block = 40, road = 8, lot = block - road;
  for (let x = zone.minX + block / 2; x < zone.maxX; x += block)
    for (let z = zone.minZ + block / 2; z < zone.maxZ; z += block) {
      const dist = Math.hypot(x, z);                    // taller near centre
      const h = 10 + Math.max(0, 140 - dist) * (0.4 + rng()) ;
      out.push({ x, z, w: lot * (0.6 + rng() * 0.4), d: lot * (0.6 + rng() * 0.4), h, rot: 0, kind: dist < 80 ? "glass" : rng() < 0.5 ? "office" : "brick" });
    }
  return out;
}
```
```ts
// test
it("stays inside the zone", () => {
  for (const b of generate(1, ZONES.downtown)) expect(inBox(ZONES.downtown, b.x, b.z)).toBe(true);
});
it("is deterministic", () => expect(generate(7, Z)).toEqual(generate(7, Z)));
```

## Scatter instanced field (trees, rocks, lamps)

```tsx
function Field({ count, zone, seed }: { count: number; zone: Box; seed: number }) {
  const mesh = useMemo(() => {
    const rng = mulberry32(seed);
    const m = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 4, 6).translate(0, 2, 0),
      new THREE.MeshStandardMaterial({ color: "#2f6b3a", flatShading: true }), count);
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      o.position.set(zone.minX + rng() * (zone.maxX - zone.minX), 0, zone.minZ + rng() * (zone.maxZ - zone.minZ));
      o.scale.setScalar(0.7 + rng() * 1.2); o.rotation.y = rng() * 6.28; o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.castShadow = true; m.computeBoundingSphere(); return m;
  }, [count, zone, seed]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}
```
Reject points on roads/water with `if (isRoad(x,z) || inWater(x,z)) continue;` and loop `while (placed < count)`.

## Road graph + pathfinding with closures

```ts
export interface Node { id: string; x: number; z: number }
export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const nodes = new Map<string, Node>(); const adj = new Map<string, string[]>();
export function addRoad(a: Node, b: Node) {
  nodes.set(a.id, a); nodes.set(b.id, b);
  (adj.get(a.id) ?? adj.set(a.id, []).get(a.id)!).push(b.id);
  (adj.get(b.id) ?? adj.set(b.id, []).get(b.id)!).push(a.id);
}
const dist = (a: Node, b: Node) => Math.hypot(a.x - b.x, a.z - b.z);
/** A* on the road graph; `blocked` = Set of edgeKeys (roadworks / crashes) to route around. */
export function findPath(from: string, to: string, blocked: Set<string> = new Set()): string[] | null {
  const open = new Set([from]), g = new Map([[from, 0]]), prev = new Map<string, string>();
  const f = (id: string) => (g.get(id) ?? Infinity) + dist(nodes.get(id)!, nodes.get(to)!);
  while (open.size) {
    let cur = [...open].reduce((a, b) => (f(a) < f(b) ? a : b));
    if (cur === to) { const p = [cur]; while (prev.has(cur)) p.unshift((cur = prev.get(cur)!)); return p; }
    open.delete(cur);
    for (const n of adj.get(cur) ?? []) {
      if (blocked.has(edgeKey(cur, n))) continue;
      const ng = g.get(cur)! + dist(nodes.get(cur)!, nodes.get(n)!);
      if (ng < (g.get(n) ?? Infinity)) { g.set(n, ng); prev.set(n, cur); open.add(n); }
    }
  }
  return null;
}
```
Closures: Roadworks/Crashes add edge keys to a `blocked` set in the store; vehicles **re-path when their next edge becomes blocked**; owner module reopens the road. Lane offset: shift position perpendicular to heading by `LANE_OFFSET` (drive on the side you declared).

## Vehicle agent (registry + useFrame, no React state)

```tsx
function Cars({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null!);
  const cars = useMemo(() => Array.from({ length: count }, () => ({
    id: nextId("car"), path: [] as string[], i: 0, t: 0, speed: 8 + Math.random() * 6,
    obj: new THREE.Group(),
  })), [count]);
  useEffect(() => { const offs = cars.map((c) => registerVehicle({ id: c.id, object: c.obj, speed: c.speed, stopped: false })); return () => offs.forEach((o) => o()); }, [cars]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);              // clamp: tab-switch spikes must not teleport cars
    for (const c of cars) {
      // advance t along edge, follow vehicle ahead (vehiclesAhead), stop at red (signalFor), re-path if blocked
      // write c.obj.position / rotation.y — mutate, never allocate
    }
  });
  return <group ref={group}>{cars.map((c) => <primitive key={c.id} object={c.obj} />)}</group>;
}
```
Always clamp `dt`. Use a global clock (`performance.now()`) for traffic lights so all agree.

## Camera rig with presets + focus jump

```tsx
const PRESETS = { overview: { pos: [0, 260, 320], look: [0, 0, 0] }, street: { pos: [30, 6, 60], look: [0, 4, 0] } } as const;
export default function CameraRig() {
  const target = useRef(new THREE.Vector3()), desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  useFrame(({ camera }, dt) => {
    const f = useWorld.getState().cameraFocus;
    if (f) { desired.current.set(f.x + 40, 60, f.z + 60); look.current.set(f.x, 0, f.z); }
    camera.position.lerp(desired.current, 1 - Math.exp(-3 * dt));   // frame-rate independent damping
    target.current.lerp(look.current, 1 - Math.exp(-3 * dt)); camera.lookAt(target.current);
  });
  return null;
}
```
(When using OrbitControls, drive `controls.target` instead of `lookAt`, or disable controls while a cinematic runs.)

## Procedural window facade texture

```ts
export function makeFacade(size = 256, cols = 8, rows = 8, lit = 0.35, rng: () => number) {
  const [c, ctx] = makeCanvas(size), [ce, ectx] = makeCanvas(size);
  ctx.fillStyle = "#5b6470"; ctx.fillRect(0, 0, size, size); ectx.fillStyle = "#000"; ectx.fillRect(0, 0, size, size);
  const w = size / cols, h = size / rows;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const on = rng() < lit;
    ctx.fillStyle = on ? "#ffe9a8" : "#1c2431"; ctx.fillRect(q * w + w * 0.2, r * h + h * 0.2, w * 0.6, h * 0.6);
    if (on) { ectx.fillStyle = rng() < 0.8 ? "#ffd27a" : "#9fd0ff"; ectx.fillRect(q * w + w * 0.2, r * h + h * 0.2, w * 0.6, h * 0.6); }
  }
  return { map: finish(c), emissive: finish(ce) };
}
```

## HUD overlay (DOM) + bus

```tsx
// HUD.tsx — pure DOM, mounted next to the canvas, talks only via bus/store
export function Hud() {
  const tod = useWorld((s) => s.timeOfDay);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="pointer-events-auto absolute left-4 top-4 flex gap-2 rounded-xl bg-black/50 p-2 backdrop-blur">
        <button onClick={() => emit({ type: "request:fireworks" })}>🎆</button>
        <span>{tod.toFixed(1)}h</span>
      </div>
    </div>
  );
}
```
Glass UI (`backdrop-blur`, translucent black) matches 3D far better than opaque panels.

## Minimap

Render a top-down orthographic view to a small `<canvas>` from registry + `ZONES` (draw zone boxes + dots for vehicles) with `requestAnimationFrame` at 10 Hz. Cheaper than a second WebGL scene.

## Day/night → store (throttled)

```ts
let last = 0;
useFrame((_, dt) => {
  hour = (hour + dt * HOURS_PER_SEC) % 24;
  const now = performance.now();
  if (now - last > 250) { last = now; useWorld.getState().setTimeOfDay(hour); }   // ≤4×/s into zustand
  // everything visual reads `hour` locally every frame
});
```

## vitest config (world logic is pure → test it)

```ts
// vitest.config.ts: environment 'node' is enough for layout/sim/pathfinding tests
export default { test: { include: ["src/**/*.test.ts"] } };
```
Test: determinism, zone containment, no overlapping lots, path avoids blocked edges, sim never produces NaN, vehicles never exceed speed.
