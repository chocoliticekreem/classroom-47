"use client";
// Module: SyntheticCrowd. Renders up to 240 CAMEL-AI & Reddit-derived synthetic agents at 60fps
// using 3 InstancedMeshes (capsule bodies, spherical heads, glowing ground rings) plus 5 floating
// NGL Fluffy Volumetric thought-bubbles above the highest-hype / closest agents near the streamer.

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { on } from "../bus";
import { ARCHETYPE_COLORS, ARCHETYPE_LABELS } from "../personas";
import { useWorld } from "../store";
import {
  clearSyntheticAgents,
  registerSyntheticAgent,
  useParallelReality,
  type LiveSyntheticAgent,
  type SyntheticArchetype,
} from "../streamerContract";
import {
  MAX_SYNTHETIC_AGENTS,
  createSyntheticCrowdState,
  resetToBaselineCrowd,
  spawnChatLocationLeakSwarm,
  spawnCrosswalkSurge,
  spawnJunctionRubberneckers,
  spawnSniperSquad,
  stepSyntheticCrowd,
  type SyntheticCrowdSimState,
} from "./SyntheticCrowd/sim";

// Module-level scratch objects — zero allocation inside useFrame
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _altFanColor = new THREE.Color("#ff8d10");
const _skinColor = new THREE.Color("#ffdfc4");
const _sniperHeadColor = new THREE.Color("#ff5252");

function getAgentBodyColor(archetype: SyntheticArchetype, index: number, target: THREE.Color): THREE.Color {
  if (archetype === "fan_swarm" && index % 2 === 1) {
    return target.copy(_altFanColor);
  }
  return target.set(ARCHETYPE_COLORS[archetype] ?? "#f8fafc");
}

function syncRegistry(agents: readonly LiveSyntheticAgent[]) {
  clearSyntheticAgents();
  for (let i = 0; i < agents.length; i++) {
    registerSyntheticAgent(agents[i]!);
  }
}

function pickTopCalloutAgents(
  agents: readonly LiveSyntheticAgent[],
  streamerX: number,
  streamerZ: number,
  maxCount = 5,
): LiveSyntheticAgent[] {
  // Rank agents within 95m by hype, parallel-spawn priority, sniper risk, and closeness to streamer
  const scored: { agent: LiveSyntheticAgent; score: number }[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    const dist = Math.hypot(a.x - streamerX, a.z - streamerZ);
    if (dist > 95) continue;
    const closeness = Math.max(0, 1 - dist / 95);
    const parallelBonus = a.spawnedInParallel ? 0.55 : 0;
    const sniperBonus = a.archetype === "stream_sniper" ? 0.45 : 0;
    const score = a.hypeLevel * 1.2 + closeness * 1.1 + parallelBonus + sniperBonus;
    scored.push({ agent: a, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((s) => s.agent);
}

export default function SyntheticCrowd() {
  const simRef = useRef<SyntheticCrowdSimState | null>(null);
  if (!simRef.current) {
    const init = useParallelReality.getState();
    simRef.current = createSyntheticCrowdState(init.streamerX, init.streamerZ, 42);
  }

  const [calloutAgents, setCalloutAgents] = useState<LiveSyntheticAgent[]>(() => {
    const st = useParallelReality.getState();
    return pickTopCalloutAgents(simRef.current!.agents, st.streamerX, st.streamerZ, 5);
  });
  const selectedPersonaId = useParallelReality((s) => s.selectedPersonaId);

  const lastHudSyncRef = useRef(0);

  // Build 3 InstancedMeshes once: capsule bodies, spherical heads, and glowing ground rings
  const meshes = useMemo(() => {
    const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.92, 6, 12);
    bodyGeo.translate(0, 0.85, 0);
    const bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.08,
    });
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_SYNTHETIC_AGENTS);
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.frustumCulled = false;

    const headGeo = new THREE.SphereGeometry(0.28, 12, 10);
    headGeo.translate(0, 1.66, 0);
    const headMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.05,
    });
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, MAX_SYNTHETIC_AGENTS);
    headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    headMesh.castShadow = false;
    headMesh.receiveShadow = false;
    headMesh.frustumCulled = false;

    const ringGeo = new THREE.RingGeometry(0.48, 0.88, 20);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.translate(0, 0.06, 0);
    const ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_SYNTHETIC_AGENTS);
    ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ringMesh.frustumCulled = false;

    // Pre-initialize instanceColor buffers
    for (let i = 0; i < MAX_SYNTHETIC_AGENTS; i++) {
      bodyMesh.setColorAt(i, _color.set("#ffffff"));
      headMesh.setColorAt(i, _skinColor);
      ringMesh.setColorAt(i, _color.set("#ec1187"));
    }

    return { bodyMesh, headMesh, ringMesh, bodyGeo, bodyMat, headGeo, headMat, ringGeo, ringMat };
  }, []);

  // Subscribe to bus events and manage lifecycle cleanup
  useEffect(() => {
    const sim = simRef.current!;
    syncRegistry(sim.agents);
    useParallelReality.getState().pushPersonaFeed(sim.agents.slice(0, 12));

    const pushNewlySpawned = (spawned: LiveSyntheticAgent[]) => {
      syncRegistry(sim.agents);
      const pr = useParallelReality.getState();
      pr.pushPersonaFeed(spawned.slice(0, 12));
      pr.updateMetrics(sim.metrics);
      setCalloutAgents(pickTopCalloutAgents(sim.agents, pr.streamerX, pr.streamerZ, 5));
    };

    const off = on((e) => {
      const pr = useParallelReality.getState();
      const sx = pr.streamerX;
      const sz = pr.streamerZ;

      if (e.type === "reality:fork") {
        if (e.scenario === "leak_location_50") {
          const spawned = spawnChatLocationLeakSwarm(sim, sx, sz, 50);
          pushNewlySpawned(spawned);
        } else if (e.scenario === "crosswalk_surge_50") {
          const spawned = spawnCrosswalkSurge(sim, sx, sz, 50);
          pushNewlySpawned(spawned);
        } else if (e.scenario === "sniper_ambush") {
          const spawned = spawnSniperSquad(sim, sx, sz, 18);
          pushNewlySpawned(spawned);
        } else if (e.scenario === "flash_mob_100") {
          const spawned = spawnChatLocationLeakSwarm(sim, sx, sz, 100);
          pushNewlySpawned(spawned);
        } else if (e.scenario === "junction_accident") {
          const spawned = spawnJunctionRubberneckers(sim, sx + 40, sz, 40);
          pushNewlySpawned(spawned);
        }
      } else if (e.type === "sim:spawn_synthetic_crowd") {
        const opts = { archetype: e.archetype, subreddit: e.subreddit };
        let spawned: LiveSyntheticAgent[];
        if (e.crossStreet) {
          spawned = spawnCrosswalkSurge(sim, sx, sz, e.count, opts);
        } else if (e.archetype === "stream_sniper" && e.nearStreamer) {
          spawned = spawnSniperSquad(sim, sx, sz, e.count);
        } else {
          spawned = spawnChatLocationLeakSwarm(sim, sx, sz, e.count, opts);
        }
        pushNewlySpawned(spawned);
      } else if (e.type === "reality:reset_to_live") {
        const reset = resetToBaselineCrowd(sim, sx, sz);
        pushNewlySpawned(reset.slice(0, 8));
      } else if (e.type === "streamer:teleport") {
        const reset = resetToBaselineCrowd(sim, e.x, e.z);
        pushNewlySpawned(reset.slice(0, 8));
      } else if (e.type === "persona:select") {
        const found = e.agentId ? sim.agents.find((a) => a.id === e.agentId) ?? null : null;
        useParallelReality.getState().selectPersona(found);
      }
    });

    return () => {
      off();
      clearSyntheticAgents();
      meshes.bodyGeo.dispose();
      meshes.bodyMat.dispose();
      meshes.bodyMesh.dispose();
      meshes.headGeo.dispose();
      meshes.headMat.dispose();
      meshes.headMesh.dispose();
      meshes.ringGeo.dispose();
      meshes.ringMat.dispose();
      meshes.ringMesh.dispose();
    };
  }, [meshes]);

  useFrame((state, delta) => {
    if (useWorld.getState().paused) return;
    const sim = simRef.current;
    if (!sim) return;

    const pr = useParallelReality.getState();
    const metrics = stepSyntheticCrowd(
      sim,
      delta,
      pr.streamerX,
      pr.streamerZ,
      pr.realityMode,
      pr.simSpeed,
    );

    const agents = sim.agents;
    const count = Math.min(agents.length, MAX_SYNTHETIC_AGENTS);
    const elapsed = state.clock.elapsedTime;

    meshes.bodyMesh.count = count;
    meshes.headMesh.count = count;
    meshes.ringMesh.count = count;

    for (let i = 0; i < count; i++) {
      const a = agents[i]!;
      const speed = Math.hypot(a.vx, a.vz);
      const bob = Math.abs(Math.sin(elapsed * (3.5 + speed * 1.4) + i * 0.7)) * 0.14;
      const heading = speed > 0.05 ? Math.atan2(a.vx, a.vz) : (i * 1.3) % (Math.PI * 2);
      const isHighlighted =
        a.archetype === "stream_sniper" ||
        a.archetype === "fan_swarm" ||
        a.archetype === "chaos_instigator" ||
        a.spawnedInParallel;

      const scaleBoost = a.archetype === "stream_sniper" ? 1.18 : a.spawnedInParallel ? 1.08 : 1.0;

      // Body transform
      _dummy.position.set(a.x, bob, a.z);
      _dummy.rotation.set(0, heading, 0);
      _dummy.scale.set(scaleBoost, scaleBoost, scaleBoost);
      _dummy.updateMatrix();
      meshes.bodyMesh.setMatrixAt(i, _dummy.matrix);
      meshes.bodyMesh.setColorAt(i, getAgentBodyColor(a.archetype, i, _color));

      // Head transform
      meshes.headMesh.setMatrixAt(i, _dummy.matrix);
      meshes.headMesh.setColorAt(
        i,
        a.archetype === "stream_sniper" ? _sniperHeadColor : _skinColor,
      );

      // Glowing ground ring under stream snipers, hyped fans, and parallel agents
      if (isHighlighted || a.hypeLevel >= 0.65) {
        const pulse = 1 + 0.22 * Math.sin(elapsed * 5.2 + i);
        const ringScale = (a.archetype === "stream_sniper" ? 1.45 : 1.1) * pulse;
        _dummy.position.set(a.x, 0.06, a.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(ringScale, 1, ringScale);
        _dummy.updateMatrix();
        meshes.ringMesh.setMatrixAt(i, _dummy.matrix);
        meshes.ringMesh.setColorAt(i, getAgentBodyColor(a.archetype, i, _color));
      } else {
        _dummy.position.set(a.x, -10, a.z);
        _dummy.scale.set(0.001, 0.001, 0.001);
        _dummy.updateMatrix();
        meshes.ringMesh.setMatrixAt(i, _dummy.matrix);
      }
    }

    meshes.bodyMesh.instanceMatrix.needsUpdate = true;
    if (meshes.bodyMesh.instanceColor) meshes.bodyMesh.instanceColor.needsUpdate = true;
    meshes.headMesh.instanceMatrix.needsUpdate = true;
    if (meshes.headMesh.instanceColor) meshes.headMesh.instanceColor.needsUpdate = true;
    meshes.ringMesh.instanceMatrix.needsUpdate = true;
    if (meshes.ringMesh.instanceColor) meshes.ringMesh.instanceColor.needsUpdate = true;

    // Throttle Zustand HUD metrics + floating callout updates to ~4x/sec (every 250ms)
    const now = performance.now();
    if (now - lastHudSyncRef.current >= 250) {
      lastHudSyncRef.current = now;
      pr.updateMetrics({
        nearbySyntheticCount: metrics.nearbySyntheticCount,
        nearbySniperCount: metrics.nearbySniperCount,
        crowdDensityPct: metrics.crowdDensityPct,
        sniperRiskPct: metrics.sniperRiskPct,
        safetyScore: metrics.safetyScore,
        simHorizonSec:
          pr.realityMode === "parallel"
            ? Math.min(180, Math.round(sim.elapsedSimSec))
            : 0,
      });
      setCalloutAgents(pickTopCalloutAgents(agents, pr.streamerX, pr.streamerZ, 5));
    }
  });

  return (
    <group name="SyntheticCrowd">
      <primitive object={meshes.bodyMesh} />
      <primitive object={meshes.headMesh} />
      <primitive object={meshes.ringMesh} />

      {/* 5 Floating NGL Fluffy Volumetric mini-thought-bubbles above top nearby personas */}
      {calloutAgents.map((agent, idx) => {
        const isSniper = agent.archetype === "stream_sniper";
        const isSelected = selectedPersonaId === agent.id;
        const accentColor = ARCHETYPE_COLORS[agent.archetype];
        const headerGrad = isSniper
          ? "linear-gradient(135deg, #FF1744 0%, #FF6B00 100%)"
          : "linear-gradient(135deg, #EC1187 0%, #FF8D10 100%)";

        return (
          <group key={agent.id} position={[agent.x, 2.85 + (idx % 2) * 0.45, agent.z]}>
            <Html center distanceFactor={28} zIndexRange={[20, 0]}>
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  useParallelReality.getState().selectPersona(agent);
                }}
                style={{
                  cursor: "pointer",
                  border: isSelected ? "3px solid #ffffff" : "none",
                  padding: 0,
                  background: "transparent",
                  width: 224,
                  textAlign: "left",
                  borderRadius: 24,
                  fontFamily:
                    '"Plus Jakarta Sans", "Fredoka", "Avenir Next", "Inter", system-ui, sans-serif',
                  boxShadow:
                    "inset 0 3px 6px rgba(255,255,255,0.9), inset 0 -4px 8px rgba(236,17,135,0.16), 0 14px 28px -6px rgba(0,0,0,0.34)",
                  transform: `rotate(${idx % 2 === 0 ? "-1.5deg" : "1.5deg"}) scale(${isSelected ? 1.07 : 1})`,
                  transition: "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  userSelect: "none",
                }}
              >
                {/* NGL Split Bubble Card — Top Crisp White Cap */}
                <div
                  style={{
                    background: "#FFFFFF",
                    borderRadius: "22px 22px 0 0",
                    padding: "7px 11px 6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    boxShadow: "inset 0 3px 5px rgba(255,255,255,0.95)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 9999,
                        background: headerGrad,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        flexShrink: 0,
                        boxShadow: "0 3px 8px rgba(236,17,135,0.35)",
                      }}
                    >
                      {agent.avatarEmoji}
                    </span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: 11,
                        color: "#111827",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {agent.handle}
                    </span>
                  </div>
                  <span
                    style={{
                      background: accentColor,
                      color:
                        agent.archetype === "tourist" ||
                        agent.archetype === "local_commuter" ||
                        agent.archetype === "reddit_local"
                          ? "#0f172a"
                          : "#ffffff",
                      fontWeight: 800,
                      fontSize: 9,
                      padding: "2px 7px",
                      borderRadius: 9999,
                      letterSpacing: 0.3,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {agent.subreddit}
                  </span>
                </div>

                {/* NGL Split Bubble Card — Frosted Candy Volumetric Body */}
                <div
                  style={{
                    background: isSniper
                      ? "linear-gradient(135deg, rgba(255,23,68,0.92) 0%, rgba(185,28,28,0.92) 100%)"
                      : "linear-gradient(135deg, rgba(236,17,135,0.90) 0%, rgba(255,141,16,0.90) 100%)",
                    backdropFilter: "blur(16px)",
                    borderRadius: "0 0 22px 22px",
                    padding: "7px 11px 9px",
                    color: "#FFFFFF",
                    boxShadow:
                      "inset 0 2px 4px rgba(255,255,255,0.45), inset 0 -4px 8px rgba(0,0,0,0.22)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      lineHeight: 1.28,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    “{agent.thoughtBubble}”
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 9,
                      fontWeight: 800,
                      opacity: 0.92,
                    }}
                  >
                    <span>{ARCHETYPE_LABELS[agent.archetype]}</span>
                    <span>⚡ {Math.round(agent.hypeLevel * 100)}% HYPE</span>
                  </div>
                </div>
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
