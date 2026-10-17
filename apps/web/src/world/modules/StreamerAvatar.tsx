"use client";
// Module: StreamerAvatar
// Renders the live IRL streamer in 3D London with NGL Fluffy Volumetric styling,
// floating selfie-stick camera orb, directional FOV ground cone, pulsing sonar rings,
// overhead NGL Fluffy Bubble HUD tag, and volumetric Primary + Safe Detour route ribbons.

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  AdditiveBlending,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { on } from "../bus";
import { useWorld } from "../store";
import {
  LONDON_DISTRICTS,
  allSyntheticAgents,
  useParallelReality,
} from "../streamerContract";
import {
  planStreamerRoutes,
  routeLength,
  sampleRoute,
  type HazardInput,
} from "./StreamerAvatar/routePlanner";

const WALK_SPEED_MPS = 4.2; // brisk IRL streamer walking pace
const STORE_SYNC_INTERVAL_MS = 250; // ~4Hz Zustand store sync

/** Collect current synthetic crowd / sniper hazard clusters for route planning. */
function gatherHazardsFromAgents(
  startX: number,
  startZ: number,
  destX: number,
  destZ: number,
): HazardInput[] {
  const hazards: HazardInput[] = [];
  for (const agent of allSyntheticAgents()) {
    if (agent.sniperRisk >= 0.6 || agent.archetype === "stream_sniper" || agent.archetype === "fan_swarm") {
      hazards.push({
        x: agent.x,
        z: agent.z,
        radius: 30,
        risk: Math.max(agent.sniperRisk, agent.hypeLevel),
        label:
          agent.archetype === "stream_sniper"
            ? `Stream Sniper (${agent.handle})`
            : `Fan Swarm (${agent.handle})`,
      });
      if (hazards.length >= 6) break;
    }
  }
  if (hazards.length === 0) {
    // Default predicted bottleneck on the direct route midpoint so Safe Route always detours cleanly
    const initial = planStreamerRoutes(startX, startZ, destX, destZ);
    const [mx, mz] = sampleRoute(initial.primaryRoute, 0.5);
    hazards.push({
      x: mx,
      z: mz,
      radius: 30,
      risk: 0.88,
      label: "Swarm Interception Bottleneck",
    });
  }
  return hazards;
}

interface RibbonSegmentSpec {
  key: string;
  cx: number;
  cz: number;
  len: number;
  yaw: number;
  bx: number;
  bz: number;
}

function buildRibbonSegments(route: [number, number][]): RibbonSegmentSpec[] {
  const segs: RibbonSegmentSpec[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i];
    const [bx, bz] = route[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    segs.push({
      key: `${i}:${ax},${az}->${bx},${bz}`,
      cx: (ax + bx) * 0.5,
      cz: (az + bz) * 0.5,
      len,
      yaw: Math.atan2(dx, dz),
      bx,
      bz,
    });
  }
  return segs;
}

interface ChevronMarkerSpec {
  key: string;
  x: number;
  z: number;
  yaw: number;
  phase: number;
}

function buildChevronMarkers(route: [number, number][], stepMetres = 14): ChevronMarkerSpec[] {
  const total = routeLength(route);
  if (total < 1) return [];
  const count = Math.max(3, Math.min(28, Math.floor(total / stepMetres)));
  const markers: ChevronMarkerSpec[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const [x, z, yaw] = sampleRoute(route, t);
    markers.push({
      key: `chev-${i}`,
      x,
      z,
      yaw,
      phase: i * 0.45,
    });
  }
  return markers;
}

// NGL Fluffy Volumetric styles for the floating overhead tag
const pillContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 5,
  padding: "8px 14px 9px",
  borderRadius: 24,
  background: "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(255,240,246,0.95) 100%)",
  boxShadow:
    "inset 0 4px 6px rgba(255,255,255,1), inset 0 -4px 8px rgba(236,17,135,0.18), 0 14px 28px -6px rgba(236,17,135,0.36)",
  border: "2px solid rgba(255,255,255,0.9)",
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  whiteSpace: "nowrap",
  userSelect: "none",
};

export default function StreamerAvatar() {
  const realityMode = useParallelReality((s) => s.realityMode);
  const streamerHandle = useParallelReality((s) => s.streamerHandle);
  const liveViewers = useParallelReality((s) => s.liveViewers);
  const safetyScore = useParallelReality((s) => s.safetyScore);
  const usingSafeRoute = useParallelReality((s) => s.usingSafeRoute);
  const primaryRoute = useParallelReality((s) => s.primaryRoute);
  const safeRoute = useParallelReality((s) => s.safeRoute);
  const destX = useParallelReality((s) => s.destX);
  const destZ = useParallelReality((s) => s.destZ);

  // Refs for 60fps zero-allocation animation
  const avatarGroupRef = useRef<Group>(null);
  const bodyBobRef = useRef<Group>(null);
  const selfieOrbRef = useRef<Mesh>(null);
  const sonarRefs = useRef<(Mesh | null)[]>([]);
  const destBeaconRef = useRef<Group>(null);
  const safeChevronGroupRef = useRef<Group>(null);

  // Mutable walker state (never allocates inside useFrame)
  const walkerRef = useRef({
    x: useParallelReality.getState().streamerX,
    z: useParallelReality.getState().streamerZ,
    heading: useParallelReality.getState().streamerHeading,
    progressDist: 0,
    lastStoreSyncMs: 0,
  });

  // Shared geometries & materials with clean unmount disposal
  const assets = useMemo(() => {
    const torsoGeo = new CapsuleGeometry(0.95, 1.5, 12, 24);
    const headGeo = new SphereGeometry(0.85, 24, 24);
    const visorGeo = new CapsuleGeometry(0.32, 0.65, 8, 16);
    const hoodieRimGeo = new TorusGeometry(0.78, 0.22, 12, 24);
    const stickGeo = new CylinderGeometry(0.06, 0.08, 2.6, 10);
    const cameraOrbGeo = new SphereGeometry(0.42, 20, 20);
    const cameraRingGeo = new TorusGeometry(0.58, 0.06, 12, 24);
    const fovConeGeo = new ConeGeometry(5.5, 14, 24, 1, true);
    const sonarRingGeo = new RingGeometry(1.1, 1.55, 36);
    const routeNodeGeo = new SphereGeometry(0.75, 14, 14);
    const safeOrbGeo = new SphereGeometry(0.85, 16, 16);
    const destPillarGeo = new CylinderGeometry(0.35, 1.1, 14, 20, 1, true);
    const destRingGeo = new TorusGeometry(2.6, 0.22, 14, 32);

    // Puffy clay/candy materials
    const torsoMat = new MeshStandardMaterial({
      color: "#ec1187",
      emissive: "#ff4079",
      emissiveIntensity: 0.32,
      roughness: 0.68,
      metalness: 0.05,
    });
    const headMat = new MeshStandardMaterial({
      color: "#fff0f6",
      emissive: "#ff8d10",
      emissiveIntensity: 0.14,
      roughness: 0.65,
      metalness: 0,
    });
    const visorMat = new MeshStandardMaterial({
      color: "#111827",
      emissive: "#00f5d4",
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.2,
    });
    const accentMat = new MeshStandardMaterial({
      color: "#ff8d10",
      emissive: "#ff5500",
      emissiveIntensity: 0.35,
      roughness: 0.65,
      metalness: 0,
    });
    const cameraOrbMat = new MeshStandardMaterial({
      color: "#ffffff",
      emissive: "#ff1e56",
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.1,
    });
    const fovConeMat = new MeshBasicMaterial({
      color: "#ff9ce3",
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sonarMats = [0, 1, 2].map(
      () =>
        new MeshBasicMaterial({
          color: "#ec1187",
          transparent: true,
          opacity: 0.5,
          side: DoubleSide,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
    );

    const primaryRibbonMat = new MeshStandardMaterial({
      color: "#ff5500",
      emissive: "#ff2a6d",
      emissiveIntensity: 0.65,
      roughness: 0.5,
      metalness: 0,
      transparent: true,
      opacity: 0.82,
    });
    const safeRibbonMat = new MeshStandardMaterial({
      color: "#10b981",
      emissive: "#00ffcc",
      emissiveIntensity: 0.75,
      roughness: 0.45,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
    });
    const safeBeaconMat = new MeshBasicMaterial({
      color: "#00ffcc",
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const destPillarMat = new MeshBasicMaterial({
      color: "#00ffcc",
      transparent: true,
      opacity: 0.32,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    return {
      torsoGeo,
      headGeo,
      visorGeo,
      hoodieRimGeo,
      stickGeo,
      cameraOrbGeo,
      cameraRingGeo,
      fovConeGeo,
      sonarRingGeo,
      routeNodeGeo,
      safeOrbGeo,
      destPillarGeo,
      destRingGeo,
      torsoMat,
      headMat,
      visorMat,
      accentMat,
      cameraOrbMat,
      fovConeMat,
      sonarMats,
      primaryRibbonMat,
      safeRibbonMat,
      safeBeaconMat,
      destPillarMat,
    };
  }, []);

  // Dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      assets.torsoGeo.dispose();
      assets.headGeo.dispose();
      assets.visorGeo.dispose();
      assets.hoodieRimGeo.dispose();
      assets.stickGeo.dispose();
      assets.cameraOrbGeo.dispose();
      assets.cameraRingGeo.dispose();
      assets.fovConeGeo.dispose();
      assets.sonarRingGeo.dispose();
      assets.routeNodeGeo.dispose();
      assets.safeOrbGeo.dispose();
      assets.destPillarGeo.dispose();
      assets.destRingGeo.dispose();
      assets.torsoMat.dispose();
      assets.headMat.dispose();
      assets.visorMat.dispose();
      assets.accentMat.dispose();
      assets.cameraOrbMat.dispose();
      assets.fovConeMat.dispose();
      assets.sonarMats.forEach((m) => m.dispose());
      assets.primaryRibbonMat.dispose();
      assets.safeRibbonMat.dispose();
      assets.safeBeaconMat.dispose();
      assets.destPillarMat.dispose();
    };
  }, [assets]);

  // Initial route computation + bus event subscriptions
  useEffect(() => {
    const recomputeRoutesFrom = (sx: number, sz: number, dx: number, dz: number) => {
      const hazards = gatherHazardsFromAgents(sx, sz, dx, dz);
      const plan = planStreamerRoutes(sx, sz, dx, dz, hazards);
      useParallelReality.getState().setRoutes(plan.primaryRoute, plan.safeRoute);
    };

    const init = useParallelReality.getState();
    recomputeRoutesFrom(init.streamerX, init.streamerZ, init.destX, init.destZ);

    const off = on((e) => {
      const state = useParallelReality.getState();
      if (e.type === "streamer:teleport") {
        let nextDestX = state.destX;
        let nextDestZ = state.destZ;
        if (e.district) {
          const preset = LONDON_DISTRICTS.find((d) => d.id === e.district);
          if (preset) {
            state.setDistrict(e.district);
            nextDestX = preset.destX;
            nextDestZ = preset.destZ;
          }
        }
        walkerRef.current.x = e.x;
        walkerRef.current.z = e.z;
        walkerRef.current.progressDist = 0;
        state.setStreamerPos(e.x, e.z, walkerRef.current.heading);
        recomputeRoutesFrom(e.x, e.z, nextDestX, nextDestZ);
        useWorld.getState().setFocus({ x: e.x, z: e.z });
      } else if (e.type === "streamer:set_destination") {
        walkerRef.current.progressDist = 0;
        state.setDestination(e.x, e.z);
        recomputeRoutesFrom(walkerRef.current.x, walkerRef.current.z, e.x, e.z);
      } else if (e.type === "reality:apply_safe_route") {
        walkerRef.current.progressDist = 0;
        state.applySafeRoute();
      } else if (e.type === "reality:fork") {
        state.triggerWhatIf(e.scenario, e.label);
        recomputeRoutesFrom(walkerRef.current.x, walkerRef.current.z, state.destX, state.destZ);
      } else if (e.type === "reality:reset_to_live") {
        state.resetToLive();
        recomputeRoutesFrom(walkerRef.current.x, walkerRef.current.z, state.destX, state.destZ);
      }
    });

    return () => off();
  }, []);

  // Sync walker if district/streamerX was changed directly via store action
  useEffect(() => {
    const unsub = useParallelReality.subscribe((state, prev) => {
      if (state.district !== prev.district) {
        walkerRef.current.x = state.streamerX;
        walkerRef.current.z = state.streamerZ;
        walkerRef.current.progressDist = 0;
        const hazards = gatherHazardsFromAgents(
          state.streamerX,
          state.streamerZ,
          state.destX,
          state.destZ,
        );
        const plan = planStreamerRoutes(
          state.streamerX,
          state.streamerZ,
          state.destX,
          state.destZ,
          hazards,
        );
        state.setRoutes(plan.primaryRoute, plan.safeRoute);
        useWorld.getState().setFocus({ x: state.streamerX, z: state.streamerZ });
      }
    });
    return () => unsub();
  }, []);

  const primarySegments = useMemo(() => buildRibbonSegments(primaryRoute), [primaryRoute]);
  const safeSegments = useMemo(() => buildRibbonSegments(safeRoute), [safeRoute]);
  const safeChevrons = useMemo(() => buildChevronMarkers(safeRoute, 14), [safeRoute]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const dt = Math.min(delta, 0.1);
    const state = useParallelReality.getState();
    const activeRoute = state.usingSafeRoute ? state.safeRoute : state.primaryRoute;
    const totalLen = routeLength(activeRoute);

    const w = walkerRef.current;
    if (totalLen > 1) {
      const speedMultiplier = state.realityMode === "parallel" ? 1.35 : 1.0;
      w.progressDist = (w.progressDist + dt * WALK_SPEED_MPS * speedMultiplier) % totalLen;
      const normT = w.progressDist / totalLen;
      const [nx, nz, nh] = sampleRoute(activeRoute, normT);
      w.x = nx;
      w.z = nz;
      w.heading = nh;
    } else {
      // Gentle patrol orbit if start === dest
      const angle = t * 0.6;
      w.x = state.destX + Math.cos(angle) * 4;
      w.z = state.destZ + Math.sin(angle) * 4;
      w.heading = angle + Math.PI * 0.5;
    }

    // Move 3D group at 60fps with zero allocations
    if (avatarGroupRef.current) {
      avatarGroupRef.current.position.set(w.x, 0, w.z);
      avatarGroupRef.current.rotation.y = w.heading;
    }

    // Bouncy NGL fluffy bobbing motion on the character body
    if (bodyBobRef.current) {
      bodyBobRef.current.position.y = Math.abs(Math.sin(t * 5.2)) * 0.28;
      bodyBobRef.current.rotation.z = Math.sin(t * 2.6) * 0.06;
    }

    // Floating selfie-stick camera orb hover
    if (selfieOrbRef.current) {
      selfieOrbRef.current.position.y = 4.3 + Math.sin(t * 3.8) * 0.16;
    }

    // Animate pulsing ground sonar rings
    for (let i = 0; i < 3; i++) {
      const mesh = sonarRefs.current[i];
      if (!mesh) continue;
      const phase = (t * 0.65 + i / 3) % 1;
      const scale = 1 + phase * 6.5;
      mesh.scale.set(scale, scale, 1);
      const mat = assets.sonarMats[i];
      mat.opacity = (1 - phase) * 0.55;
      mat.color.set(state.usingSafeRoute ? "#10b981" : state.safetyScore < 45 ? "#ff1e56" : "#ec1187");
    }

    // Animate safe route chevron beacons
    if (safeChevronGroupRef.current) {
      const children = safeChevronGroupRef.current.children;
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        c.position.y = 0.35 + Math.sin(t * 4 - i * 0.5) * 0.14;
      }
    }

    // Animate destination beacon
    if (destBeaconRef.current) {
      destBeaconRef.current.rotation.y = t * 1.2;
      const pulse = 1 + Math.sin(t * 3.2) * 0.12;
      destBeaconRef.current.scale.set(pulse, 1, pulse);
    }

    // Throttled ~4Hz update to Zustand store for HUD / minimap / synthetic crowd attraction
    const nowMs = performance.now();
    if (nowMs - w.lastStoreSyncMs >= STORE_SYNC_INTERVAL_MS) {
      w.lastStoreSyncMs = nowMs;
      state.setStreamerPos(w.x, w.z, w.heading);
    }
  });

  const viewersFormatted = `${(liveViewers / 1000).toFixed(1)}K`;
  const isDanger = safetyScore < 50 && !usingSafeRoute;

  return (
    <group name="StreamerAvatar">
      {/* Primary Route on ground (y = 0.22): candy-orange/red volumetric path ribbons */}
      <group name="PrimaryRouteRibbon">
        {primarySegments.map((seg) => (
          <group key={seg.key}>
            <mesh
              position={[seg.cx, 0.22, seg.cz]}
              rotation={[0, seg.yaw, 0]}
              material={assets.primaryRibbonMat}
            >
              <boxGeometry args={[usingSafeRoute ? 1.1 : 1.9, 0.18, seg.len]} />
            </mesh>
            <mesh
              position={[seg.bx, 0.28, seg.bz]}
              geometry={assets.routeNodeGeo}
              material={assets.primaryRibbonMat}
              scale={usingSafeRoute ? 0.65 : 1}
            />
          </group>
        ))}
      </group>

      {/* Safe Detour Route on ground (y = 0.26): glowing emerald-mint (#10b981 / #00ffcc) ribbons & orb chevrons */}
      <group name="SafeRouteRibbon">
        {safeSegments.map((seg) => (
          <mesh
            key={seg.key}
            position={[seg.cx, 0.26, seg.cz]}
            rotation={[0, seg.yaw, 0]}
            material={assets.safeRibbonMat}
          >
            <boxGeometry args={[usingSafeRoute ? 2.2 : 1.4, 0.22, seg.len]} />
          </mesh>
        ))}
        <group ref={safeChevronGroupRef}>
          {safeChevrons.map((m) => (
            <mesh
              key={m.key}
              position={[m.x, 0.35, m.z]}
              rotation={[0, m.yaw, 0]}
              geometry={assets.safeOrbGeo}
              material={assets.safeBeaconMat}
            />
          ))}
        </group>
      </group>

      {/* Pulsing Destination Beacon at (destX, destZ) */}
      <group position={[destX, 0.2, destZ]} ref={destBeaconRef}>
        <mesh
          position={[0, 7, 0]}
          geometry={assets.destPillarGeo}
          material={assets.destPillarMat}
        />
        <mesh
          position={[0, 0.3, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          geometry={assets.destRingGeo}
          material={assets.safeRibbonMat}
        />
        <Html position={[0, 15, 0]} center distanceFactor={40} zIndexRange={[25, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              padding: "5px 12px",
              borderRadius: 9999,
              background: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              fontWeight: 800,
              fontSize: 11,
              fontFamily: "Inter, system-ui, sans-serif",
              boxShadow: "0 8px 20px rgba(16,185,129,0.45), inset 0 2px 4px rgba(255,255,255,0.6)",
              whiteSpace: "nowrap",
            }}
          >
            🏁 SAFE DESTINATION ({Math.round(destX)}, {Math.round(destZ)})
          </div>
        </Html>
      </group>

      {/* Live Streamer 3D Volumetric Avatar */}
      <group ref={avatarGroupRef}>
        {/* Pulsing Ground Sonar Rings */}
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              sonarRefs.current[i] = el;
            }}
            position={[0, 0.16, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            geometry={assets.sonarRingGeo}
            material={assets.sonarMats[i]}
          />
        ))}

        {/* Directional Camera FOV Light Cone on the ground facing +Z */}
        <mesh
          position={[0, 0.18, 7.2]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={assets.fovConeGeo}
          material={assets.fovConeMat}
        />

        {/* Puffy Volumetric Character Body */}
        <group ref={bodyBobRef}>
          {/* Candy Pink/Orange Puffy Hoodie Torso */}
          <mesh
            position={[0, 1.8, 0]}
            geometry={assets.torsoGeo}
            material={assets.torsoMat}
            castShadow
          />
          {/* Puffy Hoodie Collar Rim */}
          <mesh
            position={[0, 2.75, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            geometry={assets.hoodieRimGeo}
            material={assets.accentMat}
          />
          {/* Puffy Head */}
          <mesh
            position={[0, 3.55, 0]}
            geometry={assets.headGeo}
            material={assets.headMat}
            castShadow
          />
          {/* Glowing Cyber Visor facing +Z */}
          <mesh
            position={[0, 3.6, 0.68]}
            rotation={[0, 0, Math.PI / 2]}
            geometry={assets.visorGeo}
            material={assets.visorMat}
          />
          {/* Selfie Stick Arm extending forward & up */}
          <mesh
            position={[0.85, 3.35, 1.15]}
            rotation={[0.55, 0, -0.35]}
            geometry={assets.stickGeo}
            material={assets.accentMat}
          />
        </group>

        {/* Floating Selfie-Stick Camera Orb */}
        <mesh
          ref={selfieOrbRef}
          position={[1.35, 4.3, 2.1]}
          geometry={assets.cameraOrbGeo}
          material={assets.cameraOrbMat}
        >
          <mesh
            rotation={[Math.PI / 2, 0, 0]}
            geometry={assets.cameraRingGeo}
            material={assets.safeBeaconMat}
          />
        </mesh>

        {/* Floating NGL Fluffy Bubble Overhead Tag */}
        <Html
          position={[0, 6.5, 0]}
          center
          distanceFactor={35}
          zIndexRange={[30, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div style={pillContainerStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 9999,
                  background:
                    realityMode === "parallel"
                      ? "linear-gradient(135deg, #8b5cf6 0%, #ec1187 100%)"
                      : "linear-gradient(135deg, #ff1e56 0%, #ff8d10 100%)",
                  color: "#ffffff",
                  fontWeight: 900,
                  fontSize: 10,
                  letterSpacing: 0.4,
                }}
              >
                {realityMode === "parallel" ? "🔮 PARALLEL SIM" : "🔴 LIVE"}
              </span>
              <span style={{ fontWeight: 900, fontSize: 13, color: "#111111" }}>
                {streamerHandle}
              </span>
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 9999,
                  background: "rgba(236,17,135,0.12)",
                  color: "#ec1187",
                  fontWeight: 800,
                  fontSize: 11,
                }}
              >
                👁️ {viewersFormatted}
              </span>
            </div>

            <div
              style={{
                padding: "3px 10px",
                borderRadius: 9999,
                background: isDanger
                  ? "linear-gradient(180deg, #ffe4e6 0%, #fecdd3 100%)"
                  : "linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%)",
                color: isDanger ? "#be123c" : "#047857",
                fontWeight: 900,
                fontSize: 11,
                boxShadow: "inset 0 2px 3px rgba(255,255,255,0.8)",
              }}
            >
              {isDanger
                ? `🚨 ${safetyScore}% DANGER — REROUTE!`
                : `🛡️ ${safetyScore}% SAFE${usingSafeRoute ? " · DETOUR ACTIVE" : ""}`}
            </div>
          </div>
        </Html>
      </group>
    </group>
  );
}
