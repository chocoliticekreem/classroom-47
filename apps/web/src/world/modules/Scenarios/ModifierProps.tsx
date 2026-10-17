"use client";
// Visible Reality Test modifiers, layered over a staged scene (same local frame as SceneProps).
import { Html } from "@react-three/drei";
import { useMemo, useRef, type CSSProperties } from "react";
import { Object3D, type Group, type InstancedMesh } from "three";
import type { Modifier } from "../../scenarios";
import { B, Ball, Bob, C, Cyl, GEO, LiveTag, mat, Person, Ring, Show, Tag, useSceneTime } from "./kit";
import { InstancedCluster } from "./SceneProps";

type V3 = [number, number, number];

const bubble = (bg: string, fg = "#111"): CSSProperties => ({
  background: bg,
  color: fg,
  font: "600 11px/1.25 system-ui, sans-serif",
  padding: "4px 7px",
  borderRadius: 8,
  whiteSpace: "nowrap",
  boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
  pointerEvents: "none",
  userSelect: "none",
});

function Bubble({ p, text, bg, fg }: { p: V3; text: string; bg: string; fg?: string }) {
  return (
    <Html position={p} center zIndexRange={[20, 0]}>
      <div style={bubble(bg, fg)}>{text}</div>
    </Html>
  );
}

/** 8-12 small parcels with a red "!" over each (two instanced meshes). */
function Cascade({ t0, n }: { t0: number; n: number }) {
  const boxes = useRef<InstancedMesh>(null);
  const bangs = useRef<InstancedMesh>(null);
  const pts = useMemo(
    () => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const d = 4.2 + (i % 3) * 1.1;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, ph: i * 0.7 };
    }),
    [n],
  );
  const d = useMemo(() => new Object3D(), []);
  useSceneTime(t0, (t) => {
    const b = boxes.current;
    const k = bangs.current;
    if (!b || !k) return;
    const grow = Math.min(1, t / 1.5);
    pts.forEach((q, i) => {
      const pop = Math.min(1, Math.max(0, grow * n - i));
      d.position.set(q.x, 0.25 * pop, q.z);
      d.rotation.set(0, q.ph, 0);
      d.scale.set(0.6 * pop, 0.5 * pop, 0.5 * pop);
      d.updateMatrix();
      b.setMatrixAt(i, d.matrix);
      d.position.set(q.x, 1.1 + Math.abs(Math.sin(t * 3 + q.ph)) * 0.3, q.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.12 * pop, 0.5 * pop, 0.12 * pop);
      d.updateMatrix();
      k.setMatrixAt(i, d.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    k.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={boxes} args={[GEO.box, mat(C.cardboard), n]} frustumCulled={false} />
      <instancedMesh ref={bangs} args={[GEO.box, mat(C.red, { emissive: 1.5 }), n]} frustumCulled={false} />
    </>
  );
}

/** Red ✗ that glitches, then a green retry ✓ once the retry lands (or the run resolves). */
function FailedAction({ t0, p, resolved }: { t0: number; p: V3; resolved: boolean }) {
  const g = useRef<Group>(null);
  useSceneTime(t0, (t) => {
    if (!g.current) return;
    const glitch = Math.sin(t * 37) > 0.6;
    g.current.position.set(p[0] + (glitch ? 0.12 : 0), p[1] + (glitch ? -0.06 : 0), p[2]);
  });
  const retried = (t: number) => resolved || t > 9;
  return (
    <>
      <group ref={g} position={p}>
        <Show t0={t0} when={(t) => !retried(t) && Math.floor(t * 8) % 5 !== 0}>
          <Tag text="✗ 503" h={0.9} bg={C.red} />
        </Show>
      </group>
      <Show t0={t0} when={retried}>
        <Bob t0={t0} p={p}>
          <Tag text="✓ RETRY OK" h={0.7} bg={C.green} />
        </Bob>
      </Show>
    </>
  );
}

function OneModifier({ m, t0, p, resolved }: { m: Modifier; t0: number; p: V3; resolved: boolean }) {
  switch (m) {
    case "conflicting_stories":
      return (
        <>
          <Bubble p={[p[0] - 1.2, p[1] + 0.6, p[2]]} text="Driver: delivered, photo taken" bg="#e7f0ff" />
          <Bubble p={[p[0] + 1.2, p[1] - 0.2, p[2]]} text="Customer: nobody came!" bg="#ffe3e3" fg="#9b1c1c" />
        </>
      );
    case "failed_action":
      return <FailedAction t0={t0} p={p} resolved={resolved} />;
    case "missing_context":
      return (
        <group position={p}>
          <B p={[0, -1.4, 0]} s={[0.8, 0.6, 0.7]} c="#ffffff" />
          <Bob t0={t0} p={[0, 0.2, 0]} amp={0.2}>
            <Tag text="?" h={1.6} bg={C.amber} />
          </Bob>
        </group>
      );
    case "noise":
      return (
        <group position={[p[0], p[1] - 1.5, p[2]]}>
          <InstancedCluster n={9} seed={7} radius={3} geo="plane" c="#f8f9fa" size={0.6} y={0.6} spin={0.8} t0={t0} float={1.6} />
          <Tag text="junk" p={[0, 2.4, 0]} h={0.35} bg="#adb5bd" />
        </group>
      );
    case "needs_human":
      return (
        <group position={[p[0], 0, p[2]]}>
          <Cyl p={[0, 6, 0]} s={[1.6, 12, 1.6]} c={C.amber} add o={0.22} />
          <Person c="#1d1f24" head={C.skin}>
            <B p={[0.3, 1.45, 0.15]} s={[0.12, 0.3, 0.06]} c={C.dark} />
          </Person>
          <Bob t0={t0} p={[0, 2.5, 0]} pulse={5}>
            <Tag text="☎ MANAGER" h={0.5} bg={C.amber} fg="#1b1b1b" />
          </Bob>
        </group>
      );
    case "out_of_policy":
      return <Bubble p={p} text="£500 NOW!! 😡" bg="#e5383b" fg="#fff" />;
    case "prompt_injection":
      return (
        <group position={p}>
          <Ball p={[0, -1, 0]} s={[3.4, 3.4, 3.4]} c={C.red} add o={0.18} />
          <Ring p={[0, -1, 0]} r={[Math.PI / 2, 0, 0]} s={[3.4, 3.4, 3.4]} c={C.red} add o={0.6} />
          <Bob t0={t0} p={[0, 0.9, 0]}>
            <Tag text="⚠ INJECTION BLOCKED" h={0.5} bg="#7a0c0c" />
          </Bob>
        </group>
      );
    case "privacy_request":
      return (
        <Bob t0={t0} p={p}>
          <B s={[0.9, 0.7, 0.35]} c="#d4a017" e={0.5} />
          <Ring p={[0, 0.48, 0]} s={[0.6, 0.65, 0.65]} c={C.steel} />
          <Tag text="PRIVATE" p={[0, -0.75, 0]} h={0.35} bg={C.dark} />
        </Bob>
      );
    case "repeat_complaint":
      return (
        <Bob t0={t0} p={p} pulse={4}>
          <Tag text="3RD TIME" h={0.6} bg="#9d0208" />
        </Bob>
      );
    case "cascade":
      return (
        <>
          <Cascade t0={t0} n={10} />
          <Tag text="×12 SAME ROUTE" p={[p[0], p[1] + 0.5, p[2]]} h={0.45} bg={C.red} />
        </>
      );
    case "time_pressure":
      return (
        <group position={p}>
          <LiveTag t0={t0} h={0.7} bg="#9d0208" text={(t) => {
            const s = Math.max(0, 7200 - Math.floor(t * 120));
            return `⏱ ${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
          }} />
        </group>
      );
    case "do_nothing":
      return (
        <Bob t0={t0} p={p}>
          <Tag text="✓ ALREADY HANDLED" h={0.55} bg={C.green} />
        </Bob>
      );
  }
}

/** Up to a few modifiers, spread left/right above the scene. */
export default function ModifierProps({ modifiers, t0, resolved, mid, high = 0 }: { modifiers: Modifier[]; t0: number; resolved: boolean; mid: number; high?: number }) {
  const slots: V3[] = [
    [-3.4, 3.4 + high, mid],
    [3.4, 3.4 + high, mid],
    [0, 6.4 + high, mid],
  ];
  return (
    <>
      {modifiers.map((m, i) => (
        <OneModifier key={m} m={m} t0={t0} p={slots[i % slots.length]} resolved={resolved} />
      ))}
    </>
  );
}
