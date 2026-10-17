"use client";
// Module: Scenarios. Acts out every delivery case (scenarios.ts) and Reality Test modifier in the city.
// - Director: stages on `request:scenario`, plus a seeded autoplay that cycles through all 50 cases.
// - Emits `scenario:staged {runId, scenarioId, modifiers, x, z, vehicleId?}`; listens for `scenario:resolved`.
// - Each run gets distinct props (SceneProps), modifier overlays (ModifierProps) and a clickable label card.
// Autoplay can be disabled with `?autoplay=0` in the page URL.
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Group } from "three";
import { autoCasesStatus } from "../autoCases";
import { emit, on } from "../bus";
import { allVehicles, getVehicle } from "../registry";
import { getNode, ROAD_EDGES } from "../roads";
import { getScenario, SCENARIOS, type Modifier, type Scene } from "../scenarios";
import { agentIdle, blockedSet, useWorld } from "../store";
import { Director, rng, type DirectorAction, type Outcome } from "./Scenarios/director";
import { sceneClock } from "./Scenarios/kit";
import { pickLocation, type SceneLoc } from "./Scenarios/location";
import ModifierProps from "./Scenarios/ModifierProps";
import SceneProps from "./Scenarios/SceneProps";
import { MODIFIER_CHIP, OUTCOME_LABEL, SCENES, type SceneSpec } from "./Scenarios/scenes";

interface ActiveRun {
  runId: string;
  scenarioId: string;
  title: string;
  scene: Scene;
  spec: SceneSpec;
  modifiers: Modifier[];
  loc: SceneLoc;
  t0: number;
  outcome: Outcome | null;
  vehicleId?: string;
}

const SEED = 2026;
const STORM_REASON = "Storm: route suspended";
const BREAKDOWN_WAIT_S = 2.5;

export default function Scenarios() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const runsRef = useRef<ActiveRun[]>([]);
  const director = useRef<Director | null>(null);
  const rand = useRef(rng(SEED + 1));
  const cleanups = useRef(new Map<string, () => void>());
  /** breakdowns waiting for the fleet's real incident before we announce them */
  const pending = useRef(new Map<string, { until: number }>());
  const tickRef = useRef<((dt: number) => void) | null>(null);

  useEffect(() => {
    const autoplay = !/[?&]autoplay=0\b/.test(window.location.search);
    const d = new Director(SCENARIOS.map((s) => s.id), SEED, autoplay);
    director.current = d;
    const cleanupMap = cleanups.current;
    const pendingMap = pending.current;

    const commit = (next: ActiveRun[]) => {
      runsRef.current = next;
      setRuns(next);
    };

    const announce = (r: ActiveRun) =>
      emit({ type: "scenario:staged", runId: r.runId, scenarioId: r.scenarioId, modifiers: r.modifiers, x: r.loc.x, z: r.loc.z, vehicleId: r.vehicleId });

    const stage = (runId: string, scenarioId: string, modifiers: Modifier[]) => {
      const sc = getScenario(scenarioId);
      if (!sc) {
        d.remove(runId);
        return;
      }
      const spec = sc.sign ? { ...SCENES[sc.scene], sign: sc.sign } : SCENES[sc.scene];
      const loc = pickLocation(sc.where, {
        rand: rand.current,
        taken: runsRef.current.map((r) => r.loc),
        blocked: blockedSet(),
        onRoad: spec.onRoad,
      });
      const run: ActiveRun = { runId, scenarioId, title: sc.title, scene: sc.scene, spec, modifiers, loc, t0: d.now, outcome: null };
      commit([...runsRef.current, run]);

      if (sc.scene === "severe_weather" && loc.edgeKey) {
        const key = loc.edgeKey;
        const st = useWorld.getState();
        const already = key in st.blocked;
        if (!already) {
          st.blockEdge(key, STORM_REASON);
          emit({ type: "road:blocked", edgeKey: key, reason: STORM_REASON });
          cleanupMap.set(runId, () => {
            const s2 = useWorld.getState();
            if (s2.blocked[key] === STORM_REASON) {
              s2.unblockEdge(key);
              emit({ type: "road:reopened", edgeKey: key });
            }
          });
        }
      }
      if (sc.scene === "vehicle_breakdown") {
        // the fleet owns the real breakdown; we mark it once its incident shows up (or fall back to our own van)
        pendingMap.set(runId, { until: d.now + BREAKDOWN_WAIT_S });
        emit({ type: "request:breakdown" });
        return;
      }
      announce(run);
    };

    const expire = (runId: string) => {
      cleanupMap.get(runId)?.();
      cleanupMap.delete(runId);
      pendingMap.delete(runId);
      if (runsRef.current.some((r) => r.runId === runId)) commit(runsRef.current.filter((r) => r.runId !== runId));
    };

    const apply = (acts: DirectorAction[]) => {
      for (const a of acts) {
        if (a.type === "expire") expire(a.runId);
        else stage(a.runId, a.pick.scenarioId, a.pick.modifiers);
      }
    };

    const attachBreakdown = (incidentId: string) => {
      const [runId] = pendingMap.keys();
      if (!runId) return;
      const inc = useWorld.getState().incidents.find((i) => i.id === incidentId);
      if (!inc || inc.kind !== "breakdown") return;
      pendingMap.delete(runId);
      let vehicleId: string | undefined;
      let best = 12;
      for (const v of allVehicles()) {
        if (v.kind !== "van" && v.kind !== "truck") continue;
        const dd = Math.hypot(v.object.position.x - inc.x, v.object.position.z - inc.z);
        if (dd < best) {
          best = dd;
          vehicleId = v.id;
        }
      }
      const edge = ROAD_EDGES.get(inc.edgeKey);
      let rot = 0;
      if (edge) {
        const a = getNode(edge.a);
        const b = getNode(edge.b);
        rot = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2; // local +x along the road
      }
      const loc: SceneLoc = { x: inc.x, z: inc.z, rot, edgeKey: edge ? edge.key : null, roadX: inc.x, roadZ: inc.z, edgeLen: edge?.length ?? 0, front: 3, vanZ: 0 };
      const next = runsRef.current.map((r) => (r.runId === runId ? { ...r, loc, vehicleId } : r));
      commit(next);
      const run = next.find((r) => r.runId === runId);
      if (run) announce(run);
    };

    const off = on((e) => {
      if (e.type === "request:scenario") apply(d.request({ scenarioId: e.scenarioId, modifiers: e.modifiers }));
      else if (e.type === "scenario:resolved") {
        const r = d.resolve(e.runId, e.outcome);
        if (r) commit(runsRef.current.map((x) => (x.runId === e.runId ? { ...x, outcome: e.outcome } : x)));
      } else if (e.type === "incident:created" && pendingMap.size) attachBreakdown(e.incidentId);
    });

    // expose the per-frame hook
    tickRef.current = (dt: number) => {
      // Pacing: autoplay only stages a new scene when the real agent can take it now (WorkflowDriver queue).
      // The HUD's Auto cases toggle (WorkflowHud/autoCases.tsx) plays real cases instead when it is mounted.
      d.autoplayOn = autoplay && agentIdle() && !autoCasesStatus.driving;
      const acts = d.tick(dt);
      sceneClock.now = d.now;
      if (acts.length) apply(acts);
      for (const [runId, p] of pendingMap) {
        if (d.now < p.until) continue;
        pendingMap.delete(runId);
        const run = runsRef.current.find((r) => r.runId === runId);
        if (run) announce(run); // fleet didn't supply a breakdown: our own van with hazards stays
      }
    };

    return () => {
      off();
      tickRef.current = null;
      for (const c of cleanupMap.values()) c();
      cleanupMap.clear();
      pendingMap.clear();
    };
  }, []);

  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    tickRef.current?.(Math.min(delta, 0.1));
  });

  return (
    <>
      {runs.map((r) => (
        <RunView key={r.runId} run={r} />
      ))}
    </>
  );
}

const card: CSSProperties = {
  background: "rgba(17, 20, 26, 0.86)",
  color: "#fff",
  font: "500 11px/1.3 system-ui, -apple-system, sans-serif",
  padding: "6px 8px",
  borderRadius: 8,
  borderLeft: "3px solid #ff6a1a",
  maxWidth: 220,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
  userSelect: "none",
};
const chip = (bg: string, fg = "#fff"): CSSProperties => ({
  display: "inline-block",
  background: bg,
  color: fg,
  borderRadius: 999,
  padding: "1px 6px",
  marginRight: 3,
  marginTop: 3,
  fontSize: 10,
  fontWeight: 600,
});

function RunView({ run }: { run: ActiveRun }) {
  const g = useRef<Group>(null);
  const { loc, spec, t0 } = run;
  const isOffice = spec.kit === "office";
  const follow = run.vehicleId;
  useFrame(() => {
    if (!follow || !g.current) return;
    const v = getVehicle(follow);
    if (!v) return;
    g.current.position.set(v.object.position.x, 0, v.object.position.z);
    g.current.rotation.y = v.object.rotation.y - Math.PI / 2;
  });
  const mid = (loc.front + loc.vanZ) / 2;
  const resolved = run.outcome !== null;
  const out = run.outcome ? OUTCOME_LABEL[run.outcome] : null;
  const labelY = isOffice ? 52 : run.scene === "severe_weather" ? 22 : 7.4;
  const focus = () => useWorld.getState().setFocus({ x: g.current?.position.x ?? loc.x, z: g.current?.position.z ?? loc.z });
  return (
    <group ref={g} position={[loc.x, 0, loc.z]} rotation={[0, loc.rot, 0]}>
      <SceneProps scene={run.scene} spec={spec} loc={loc} t0={t0} resolved={resolved} externalVehicle={!!follow} />
      <ModifierProps modifiers={run.modifiers} t0={t0} resolved={resolved} mid={mid} high={isOffice ? 4 : run.scene === "severe_weather" ? 4 : 0} />
      <Html position={[0, labelY, 0]} center zIndexRange={[30, 0]}>
        <div style={{ ...card, borderLeftColor: spec.accent }} onClick={focus}>
          <div style={{ opacity: 0.7, fontSize: 10, letterSpacing: 0.3 }}>
            {run.scenarioId.replace("delivery-", "CASE ")} · {run.runId}
          </div>
          <div style={{ fontWeight: 650 }}>{run.title}</div>
          <div>
            {run.modifiers.map((m) => (
              <span key={m} style={chip("#3a3f4b")}>{MODIFIER_CHIP[m]}</span>
            ))}
            {out ? <span style={chip(out.color)}>✓ {out.text}</span> : <span style={chip("#ff6a1a")}>agent working…</span>}
          </div>
        </div>
      </Html>
    </group>
  );
}
