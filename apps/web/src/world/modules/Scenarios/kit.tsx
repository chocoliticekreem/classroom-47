"use client";
// Reusable prop kit for staged scenes. Shared unit geometries + cached materials and text textures,
// so every scene is composed of cheap meshes that reuse the same GPU resources.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  type Group,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
} from "three";

// ---------------------------------------------------------------------------------------------
// Scene clock: director seconds (stops while the world is paused). Written by Scenarios.tsx.
export const sceneClock = { now: 0 };

/** Run `fn(t)` every frame with t = seconds since the scene was staged. */
export function useSceneTime(t0: number, fn: (t: number) => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useFrame(() => ref.current(sceneClock.now - t0));
}

// ---------------------------------------------------------------------------------------------
// Shared geometry (unit sized; scale per mesh)
export const GEO = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 12),
  sph: new SphereGeometry(0.5, 12, 8),
  cone: new ConeGeometry(0.5, 1, 10),
  plane: new PlaneGeometry(1, 1),
  disc: new CircleGeometry(0.5, 24).rotateX(-Math.PI / 2),
  torus: new TorusGeometry(0.5, 0.09, 6, 18),
  tetra: new ConeGeometry(0.5, 1, 3),
};

const mats = new Map<string, Material>();
interface MatOpts {
  emissive?: number; // emissive intensity using the base colour
  opacity?: number;
  additive?: boolean;
  basic?: boolean;
  double?: boolean;
}
export function mat(color: string, o: MatOpts = {}): Material {
  const key = `${color}|${o.emissive ?? 0}|${o.opacity ?? 1}|${o.additive ? 1 : 0}|${o.basic ? 1 : 0}|${o.double ? 1 : 0}`;
  let m = mats.get(key);
  if (!m) {
    const transparent = (o.opacity ?? 1) < 1 || !!o.additive;
    if (o.basic || o.additive) {
      m = new MeshBasicMaterial({
        color,
        transparent,
        opacity: o.opacity ?? 1,
        blending: o.additive ? AdditiveBlending : undefined,
        depthWrite: !transparent,
        side: o.double ? DoubleSide : undefined,
        toneMapped: false,
      });
    } else {
      m = new MeshStandardMaterial({
        color,
        roughness: 0.8,
        flatShading: true,
        emissive: o.emissive ? color : "#000000",
        emissiveIntensity: o.emissive ?? 0,
        transparent,
        opacity: o.opacity ?? 1,
        depthWrite: !transparent,
        side: o.double ? DoubleSide : undefined,
      });
    }
    mats.set(key, m);
  }
  return m;
}

export const C = {
  cardboard: "#c8955a",
  tape: "#e9d3a6",
  van: "#f4f4f2",
  orange: "#ff6a1a",
  tyre: "#262626",
  glass: "#2b3c4e",
  brick: "#a8553e",
  door: "#2f5d8a",
  wall: "#e8dccb",
  steel: "#8f99a3",
  dark: "#3b3f45",
  wood: "#a87b4f",
  skin: "#f0c7a0",
  red: "#e5383b",
  amber: "#f4a261",
  green: "#2a9d8f",
  blue: "#3a86ff",
  white: "#ffffff",
  yellow: "#ffd23f",
};

type V3 = [number, number, number];

interface PrimProps {
  p?: V3;
  s?: V3;
  r?: V3;
  c: string;
  e?: number;
  o?: number;
  add?: boolean;
  basic?: boolean;
  shadow?: boolean;
  mref?: RefObject<import("three").Mesh | null>;
}

function prim(geo: keyof typeof GEO) {
  return function Prim({ p = [0, 0, 0], s = [1, 1, 1], r, c, e, o, add, basic, shadow, mref }: PrimProps) {
    return (
      <mesh
        ref={mref}
        geometry={GEO[geo]}
        material={mat(c, { emissive: e, opacity: o, additive: add, basic })}
        position={p}
        scale={s}
        rotation={r}
        castShadow={shadow}
      />
    );
  };
}
export const B = prim("box");
export const Cyl = prim("cyl");
export const Ball = prim("sph");
export const ConeM = prim("cone");
export const Disc = prim("disc");
export const Ring = prim("torus");
export const Shard = prim("tetra");

// ---------------------------------------------------------------------------------------------
// Text on a canvas (no font fetches): cached CanvasTexture + SpriteMaterial per (text, colours).
const textCache = new Map<string, { tex: CanvasTexture; aspect: number; sprite: SpriteMaterial }>();
export function textTexture(text: string, fg = "#ffffff", bg = "#e5383b") {
  const key = `${text}|${fg}|${bg}`;
  let hit = textCache.get(key);
  if (!hit) {
    const font = "bold 56px system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d")!;
    ctx.font = font;
    const w = Math.max(96, Math.ceil(ctx.measureText(text).width) + 48);
    const h = 88;
    cv.width = w;
    cv.height = h;
    ctx.font = font;
    if (bg !== "transparent") {
      ctx.fillStyle = bg;
      const r = 18;
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, h - 4, r);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 3);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    hit = { tex, aspect: w / h, sprite };
    textCache.set(key, hit);
  }
  return hit;
}

/** Camera-facing text badge. `h` is its world height. */
export function Tag({ text, p = [0, 0, 0], h = 1, fg = "#ffffff", bg = C.red, sref }: { text: string; p?: V3; h?: number; fg?: string; bg?: string; sref?: RefObject<Sprite | null> }) {
  const t = useMemo(() => textTexture(text, fg, bg), [text, fg, bg]);
  return <sprite ref={sref} material={t.sprite} position={p} scale={[h * t.aspect, h, 1]} />;
}

/** Flat sign panel fixed in the scene; by default it faces the road (local -z). */
export function Panel({ text, p = [0, 0, 0], h = 0.8, fg = "#ffffff", bg = C.red, r = [0, Math.PI, 0], post = false, glow = false }: { text: string; p?: V3; h?: number; fg?: string; bg?: string; r?: V3; post?: boolean; glow?: boolean }) {
  const t = useMemo(() => textTexture(text, fg, bg), [text, fg, bg]);
  const m = useMemo(() => {
    const key = `panel|${text}|${fg}|${bg}|${glow}`;
    let mm = mats.get(key);
    if (!mm) {
      mm = glow
        ? new MeshBasicMaterial({ map: t.tex, transparent: true, opacity: 0.9, toneMapped: false, side: DoubleSide, depthWrite: false })
        : new MeshStandardMaterial({ map: t.tex, transparent: true, roughness: 0.6, side: DoubleSide, emissive: "#ffffff", emissiveMap: t.tex, emissiveIntensity: 0.35 });
      mats.set(key, mm);
    }
    return mm;
  }, [t, text, fg, bg, glow]);
  const w = h * t.aspect;
  return (
    <group position={p} rotation={r}>
      <mesh geometry={GEO.plane} material={m} scale={[w, h, 1]} />
      {post && <B p={[0, -p[1] / 2, -0.03]} s={[0.12, p[1], 0.12]} c={C.dark} />}
    </group>
  );
}

interface LiveRes {
  cv: HTMLCanvasElement;
  tex: CanvasTexture;
  m: SpriteMaterial;
}
function makeLive(): LiveRes | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 96;
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  const m = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  return { cv, tex, m };
}
function drawLive(res: LiveRes, s: string, fg: string, bg: string) {
  const ctx = res.cv.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 96);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(2, 2, 252, 92, 18);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = "bold 58px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, 128, 51);
  res.tex.needsUpdate = true;
}
function disposeLive(res: LiveRes | null) {
  res?.tex.dispose();
  res?.m.dispose();
}

/** A sign whose text changes (countdowns). Owns its canvas; redraws only when `text(t)` changes. */
export function LiveTag({ t0, text, p = [0, 0, 0], h = 1, fg = "#ffffff", bg = C.red }: { t0: number; text: (t: number) => string; p?: V3; h?: number; fg?: string; bg?: string }) {
  const res = useMemo(() => makeLive(), []);
  const last = useRef("");
  useEffect(() => () => disposeLive(res), [res]);
  useSceneTime(t0, (t) => {
    if (!res) return;
    const s = text(t);
    if (s === last.current) return;
    last.current = s;
    drawLive(res, s, fg, bg);
  });
  if (!res) return null;
  return <sprite material={res.m} position={p} scale={[h * (256 / 96), h, 1]} />;
}

// ---------------------------------------------------------------------------------------------
// Props

export function Parcel({ p = [0, 0, 0], s = [0.7, 0.5, 0.6], c = C.cardboard, r }: { p?: V3; s?: V3; c?: string; r?: V3 }) {
  return (
    <group position={p} rotation={r}>
      <B p={[0, s[1] / 2, 0]} s={s} c={c} />
      <B p={[0, s[1] + 0.005, 0]} s={[s[0] * 1.01, 0.02, 0.12]} c={C.tape} />
    </group>
  );
}

/** Person: body + head. Origin at the feet. */
export function Person({ p = [0, 0, 0], c = C.orange, head = C.skin, gref, children, r }: { p?: V3; c?: string; head?: string; gref?: RefObject<Group | null>; children?: ReactNode; r?: V3 }) {
  return (
    <group ref={gref} position={p} rotation={r}>
      <B p={[0, 0.75, 0]} s={[0.55, 1.0, 0.35]} c={c} />
      <B p={[0, 0.14, 0]} s={[0.45, 0.28, 0.3]} c={C.dark} />
      <Ball p={[0, 1.5, 0]} s={[0.42, 0.42, 0.42]} c={head} />
      {children}
    </group>
  );
}

/** Hamyway van, long axis along local +x (so it parks along the road). Not registered as traffic. */
export function Van({ p = [0, 0, 0], r = 0, hazard = false, t0 = 0 }: { p?: V3; r?: number; hazard?: boolean; t0?: number }) {
  const l1 = useRef<import("three").Mesh>(null);
  const l2 = useRef<import("three").Mesh>(null);
  useSceneTime(t0, (t) => {
    if (!hazard) return;
    const on = Math.floor(t * 2.5) % 2 === 0;
    if (l1.current) l1.current.visible = on;
    if (l2.current) l2.current.visible = on;
  });
  return (
    <group position={p} rotation={[0, r, 0]}>
      <B p={[-0.4, 1.25, 0]} s={[3.6, 1.9, 1.9]} c={C.van} shadow />
      <B p={[1.85, 0.95, 0]} s={[1.1, 1.3, 1.85]} c={C.van} />
      <B p={[2.3, 1.25, 0]} s={[0.25, 0.6, 1.6]} c={C.glass} />
      <B p={[-0.4, 1.1, 0]} s={[3.62, 0.32, 1.92]} c={C.orange} />
      <B p={[0.2, 0.32, 0]} s={[4.6, 0.5, 1.7]} c={C.tyre} />
      {hazard && (
        <>
          <B mref={l1} p={[2.42, 0.75, 0.75]} s={[0.1, 0.2, 0.3]} c={C.amber} e={3} />
          <B mref={l2} p={[2.42, 0.75, -0.75]} s={[0.1, 0.2, 0.3]} c={C.amber} e={3} />
        </>
      )}
    </group>
  );
}

/** Rigid truck (reefer when `reefer`), long axis along +x. */
export function Truck({ p = [0, 0, 0], r = 0, reefer = false, box = C.van }: { p?: V3; r?: number; reefer?: boolean; box?: string }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <B p={[-1, 1.9, 0]} s={[6, 2.8, 2.4]} c={box} shadow />
      <B p={[3, 1.3, 0]} s={[1.8, 2.0, 2.3]} c={reefer ? "#2a6fb0" : C.orange} />
      <B p={[3.85, 1.7, 0]} s={[0.15, 0.8, 2.0]} c={C.glass} />
      <B p={[0.4, 0.4, 0]} s={[7.4, 0.6, 2.1]} c={C.tyre} />
      {reefer && <B p={[2.05, 2.7, 0]} s={[0.6, 1.0, 1.6]} c={C.steel} />}
    </group>
  );
}

/** House/shop frontage segment with a door, facing -z (towards the road). Origin at the wall foot. */
export function Frontage({ p = [0, 0, 0], w = 5, h = 3.6, c = C.wall, door = C.door, glow = false, shop = false }: { p?: V3; w?: number; h?: number; c?: string; door?: string; glow?: boolean; shop?: boolean }) {
  return (
    <group position={p}>
      <B p={[0, h / 2, 0.3]} s={[w, h, 0.6]} c={c} />
      <B p={[0, 1.1, -0.02]} s={[1.1, 2.2, 0.1]} c={door} e={glow ? 1.4 : 0} />
      <B p={[0, 0.08, -0.4]} s={[1.6, 0.16, 0.6]} c={C.steel} />
      {shop && <B p={[1.7, 1.4, -0.02]} s={[1.6, 1.4, 0.06]} c={C.glass} />}
    </group>
  );
}

export function TrafficCone({ p = [0, 0, 0] }: { p?: V3 }) {
  return (
    <group position={p}>
      <ConeM p={[0, 0.38, 0]} s={[0.4, 0.75, 0.4]} c={C.orange} />
      <B p={[0, 0.03, 0]} s={[0.5, 0.06, 0.5]} c={C.dark} />
    </group>
  );
}

export function Pallet({ p = [0, 0, 0], load = true, c = C.cardboard }: { p?: V3; load?: boolean; c?: string }) {
  return (
    <group position={p}>
      <B p={[0, 0.07, 0]} s={[1.2, 0.14, 1.0]} c={C.wood} />
      {load && <B p={[0, 0.7, 0]} s={[1.1, 1.1, 0.95]} c={c} />}
    </group>
  );
}

export function Container({ p = [0, 0, 0], c = "#2e86ab", r = 0 }: { p?: V3; c?: string; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <B p={[0, 1.3, 0]} s={[6.1, 2.6, 2.44]} c={c} shadow />
      <B p={[-3.06, 1.3, 0]} s={[0.04, 2.4, 2.2]} c={C.dark} />
    </group>
  );
}

export function Shelf({ p = [0, 0, 0], w = 3 }: { p?: V3; w?: number }) {
  return (
    <group position={p}>
      <B p={[0, 1.1, 0]} s={[w, 0.08, 0.8]} c={C.steel} />
      <B p={[0, 2.0, 0]} s={[w, 0.08, 0.8]} c={C.steel} />
      <B p={[-w / 2, 1.2, 0]} s={[0.08, 2.4, 0.8]} c={C.blue} />
      <B p={[w / 2, 1.2, 0]} s={[0.08, 2.4, 0.8]} c={C.blue} />
      <Parcel p={[-0.8, 1.14, 0]} />
      <Parcel p={[0.5, 1.14, 0]} s={[0.9, 0.6, 0.6]} />
      <Parcel p={[-0.2, 2.04, 0]} s={[0.6, 0.4, 0.5]} />
    </group>
  );
}

export function Conveyor({ p = [0, 0, 0], len = 6, c = C.dark }: { p?: V3; len?: number; c?: string }) {
  return (
    <group position={p}>
      <B p={[0, 0.85, 0]} s={[len, 0.12, 1.0]} c={c} />
      <B p={[0, 0.45, 0.45]} s={[len, 0.8, 0.08]} c={C.steel} />
      <B p={[0, 0.45, -0.45]} s={[len, 0.8, 0.08]} c={C.steel} />
    </group>
  );
}

/** Courier that walks from `a` to `b` over `dur` seconds starting at `start`, carrying a parcel. */
export function WalkingCourier({ t0, a, b, start = 0.6, dur = 4, carry = true, c = C.orange, back = false, onArrive }: { t0: number; a: V3; b: V3; start?: number; dur?: number; carry?: boolean; c?: string; back?: boolean; onArrive?: (t: number, g: Group) => void }) {
  const g = useRef<Group>(null);
  const heading = Math.atan2(b[0] - a[0], b[2] - a[2]);
  useSceneTime(t0, (t) => {
    const n = g.current;
    if (!n) return;
    let u = Math.min(1, Math.max(0, (t - start) / dur));
    if (back && t > start + dur + 4) u = Math.max(0, 1 - (t - start - dur - 4) / dur);
    n.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    const walking = u > 0 && u < 1;
    n.position.y += walking ? Math.abs(Math.sin(t * 9)) * 0.08 : 0;
    if (u >= 1 && onArrive) onArrive(t - start - dur, n);
  });
  return (
    <Person gref={g} p={a} c={c} r={[0, heading, 0]}>
      {carry && <Parcel p={[0, 0.9, 0.35]} s={[0.6, 0.45, 0.45]} />}
    </Person>
  );
}

/** Bobbing sprite group (for icons). */
export function Bob({ t0, children, p = [0, 0, 0], amp = 0.15, speed = 2.2, pulse = 0 }: { t0: number; children: ReactNode; p?: V3; amp?: number; speed?: number; pulse?: number }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (!g.current) return;
    g.current.position.y = p[1] + Math.sin(t * speed) * amp;
    if (pulse) g.current.scale.setScalar(1 + Math.max(0, Math.sin(t * pulse)) * 0.18);
  });
  return (
    <group ref={g} position={p}>
      {children}
    </group>
  );
}

/** Shows children only while `when(t)` is true (blinks, beats). */
export function Show({ t0, when, children }: { t0: number; when: (t: number) => boolean; children: ReactNode }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (g.current) g.current.visible = when(t);
  });
  return <group ref={g} visible={false}>{children}</group>;
}

/** Spins around y. */
export function Spin({ t0, children, p = [0, 0, 0], speed = 1 }: { t0: number; children: ReactNode; p?: V3; speed?: number }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (g.current) g.current.rotation.y = t * speed;
  });
  return (
    <group ref={g} position={p}>
      {children}
    </group>
  );
}
