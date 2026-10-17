"use client";
// Closed roads: pulsing red/amber hatch, glowing edges and "ROAD CLOSED" boards with blinking lamps.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, InstancedMesh, MeshBasicMaterial } from "three";
import { ROAD_EDGES, getNode } from "../../roads";
import { useWorld } from "../../store";
import { FlatBuilder, boxAlong, type BoxInst } from "./geometry";
import { HALF, Y, closureTrim } from "./layout";
import { closedBoardTexture, hatchTexture } from "./textures";
import { setBoxMatrix } from "./Boxes";

const MAX_BOARDS = 96;
const POP_MS = 450;

interface Built {
  hatch: FlatBuilder;
  glow: FlatBuilder;
  boards: { key: string; box: BoxInst }[];
  legs: { key: string; box: BoxInst }[];
  lamps: { key: string; box: BoxInst }[];
}

function build(keys: string[]): Built {
  const out: Built = { hatch: new FlatBuilder(), glow: new FlatBuilder(), boards: [], legs: [], lamps: [] };
  for (const key of keys) {
    const e = ROAD_EDGES.get(key)!;
    const a = getNode(e.a);
    const b = getNode(e.b);
    const half = HALF[e.kind];
    const s0 = closureTrim(e.a, e.kind);
    const s1 = e.length - closureTrim(e.b, e.kind);
    if (s1 - s0 < 2) continue;
    out.hatch.strip(a.x, a.z, b.x, b.z, s0, s1, half + 0.3, Y.closure);
    for (const o of [half + 0.3, -(half + 0.3)]) out.glow.strip(a.x, a.z, b.x, b.z, s0, s1, 0.35, 0.06, o);
    for (const [c0, c1] of [[s0, s0 + 0.6], [s1 - 0.6, s1]]) out.glow.strip(a.x, a.z, b.x, b.z, c0, c1, half + 0.65, 0.06);
    const w = half * 2 - 1.2;
    for (const s of [s0 + 1.2, s1 - 1.2]) {
      out.boards.push({ key, box: boxAlong(a.x, a.z, b.x, b.z, s - 0.06, s + 0.06, 0, w, 0.85, 0.4) });
      for (const off of [w / 2 - 0.35, -(w / 2 - 0.35)]) {
        out.legs.push({ key, box: boxAlong(a.x, a.z, b.x, b.z, s - 0.05, s + 0.05, off, 0.1, 1.35, 0) });
        out.lamps.push({ key, box: boxAlong(a.x, a.z, b.x, b.z, s - 0.14, s + 0.14, off, 0.28, 0.28, 1.35) });
      }
    }
  }
  return out;
}

export default function Closures() {
  const blocked = useWorld((s) => s.blocked);
  const keys = useMemo(() => Object.keys(blocked).filter((k) => ROAD_EDGES.has(k)).sort(), [blocked]);
  const built = useMemo(() => build(keys), [keys]);
  const hatchGeo = useMemo(() => built.hatch.build(), [built]);
  const glowGeo = useMemo(() => built.glow.build(), [built]);
  useEffect(() => () => hatchGeo.dispose(), [hatchGeo]);
  useEffect(() => () => glowGeo.dispose(), [glowGeo]);

  const hatchTex = useMemo(() => {
    const t = hatchTexture();
    t.repeat.set(1 / 3, 1 / 3);
    return t;
  }, []);
  const boardTex = useMemo(() => closedBoardTexture(), []);
  useEffect(() => () => { hatchTex.dispose(); boardTex.dispose(); }, [hatchTex, boardTex]);

  const hatchMat = useRef<MeshBasicMaterial>(null);
  const glowMat = useRef<MeshBasicMaterial>(null);
  const lampMat = useRef<MeshBasicMaterial>(null);
  const boardsRef = useRef<InstancedMesh>(null);
  const legsRef = useRef<InstancedMesh>(null);
  const lampsRef = useRef<InstancedMesh>(null);
  const since = useRef(new Map<string, number>());
  const settled = useRef(false);

  const builtRef = useRef(built);
  useEffect(() => {
    builtRef.current = built;
    const live = new Set(keys);
    for (const k of since.current.keys()) if (!live.has(k)) since.current.delete(k);
    settled.current = false;
  }, [keys, built]);

  const lampOn = useMemo(() => new Color("#ffb300"), []);
  const lampOff = useMemo(() => new Color("#4a2a00"), []);

  useFrame(() => {
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    if (hatchMat.current) {
      hatchMat.current.opacity = 0.5 + 0.35 * pulse;
      if (hatchMat.current.map) hatchMat.current.map.offset.x = -((now * 0.0004) % 1);
    }
    if (glowMat.current) glowMat.current.opacity = 0.45 + 0.55 * pulse;
    if (lampMat.current) lampMat.current.color.copy(Math.floor(now / 350) % 2 ? lampOn : lampOff);

    if (settled.current) return;
    let animating = false;
    const scaleFor = (key: string) => {
      let t0 = since.current.get(key);
      if (t0 === undefined) {
        t0 = now;
        since.current.set(key, now);
      }
      const t = Math.min(1, (now - t0) / POP_MS);
      if (t < 1) animating = true;
      const c = 1.70158; // easeOutBack
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    };
    const apply = (mesh: InstancedMesh | null, list: { key: string; box: BoxInst }[], cap: number) => {
      if (!mesh) return;
      const n = Math.min(list.length, cap);
      for (let i = 0; i < n; i++) setBoxMatrix(mesh, i, list[i].box, Math.max(0.001, scaleFor(list[i].key)));
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    const cur = builtRef.current;
    apply(boardsRef.current, cur.boards, MAX_BOARDS * 2);
    apply(legsRef.current, cur.legs, MAX_BOARDS * 4);
    apply(lampsRef.current, cur.lamps, MAX_BOARDS * 4);
    if (!animating) settled.current = true;
  });

  if (!keys.length) return null;
  return (
    <group>
      <mesh geometry={hatchGeo} renderOrder={2}>
        <meshBasicMaterial
          ref={hatchMat}
          map={hatchTex}
          transparent
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-12}
        />
      </mesh>
      <mesh geometry={glowGeo} renderOrder={3}>
        <meshBasicMaterial
          ref={glowMat}
          color="#ff2222"
          transparent
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-7}
          polygonOffsetUnits={-14}
        />
      </mesh>
      <instancedMesh ref={boardsRef} args={[undefined, undefined, MAX_BOARDS * 2]} count={0} castShadow>
        <boxGeometry />
        <meshStandardMaterial map={boardTex} emissiveMap={boardTex} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={legsRef} args={[undefined, undefined, MAX_BOARDS * 4]} count={0}>
        <boxGeometry />
        <meshStandardMaterial color="#d8d8d8" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={lampsRef} args={[undefined, undefined, MAX_BOARDS * 4]} count={0}>
        <boxGeometry />
        <meshBasicMaterial ref={lampMat} color="#ffb300" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
