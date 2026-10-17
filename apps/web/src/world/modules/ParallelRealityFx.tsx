"use client";
// Module: ParallelRealityFx
// Visualizes the Parallel Reality Branch (realityMode === "parallel") in 3D:
// 1. 140m holographic cyber-candy boundary ring & vertical light pillars around the neighborhood
// 2. Future Ghost Projections running at 3x speed along both the primary route (warning ghost)
//    and the safe detour route (clear-passage green ghost) with NGL Fluffy <Html> callouts
// 3. Volumetric hazard domes (pulsing magenta/red spheres & cylinders) at predicted crowd/sniper bottlenecks
// 4. Subtle ambient safe-zone ring when realityMode === "live".

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  AdditiveBlending,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { useParallelReality } from "../streamerContract";
import {
  planStreamerRoutes,
  routeLength,
  sampleRoute,
} from "./StreamerAvatar/routePlanner";

const BOUNDARY_RADIUS = 140; // metres
const PILLAR_COUNT = 16;
const GHOST_BASE_SPEED_MPS = 12.6; // 3x live streamer walking speed (4.2 * 3)

const ghostBadgeBase: CSSProperties = {
  padding: "7px 13px",
  borderRadius: 20,
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontWeight: 800,
  fontSize: 11,
  lineHeight: 1.35,
  whiteSpace: "nowrap",
  userSelect: "none",
  border: "2px solid rgba(255,255,255,0.88)",
};

const dangerGhostBadgeStyle: CSSProperties = {
  ...ghostBadgeBase,
  background: "linear-gradient(180deg, rgba(255,240,246,0.96) 0%, rgba(254,205,211,0.95) 100%)",
  color: "#9f1239",
  boxShadow:
    "inset 0 3px 6px rgba(255,255,255,0.95), 0 12px 26px -4px rgba(236,17,135,0.45)",
};

const safeGhostBadgeStyle: CSSProperties = {
  ...ghostBadgeBase,
  background: "linear-gradient(180deg, rgba(236,253,245,0.96) 0%, rgba(167,243,208,0.95) 100%)",
  color: "#065f46",
  boxShadow:
    "inset 0 3px 6px rgba(255,255,255,0.95), 0 12px 26px -4px rgba(16,185,129,0.42)",
};

export default function ParallelRealityFx() {
  const realityMode = useParallelReality((s) => s.realityMode);
  const simSpeed = useParallelReality((s) => s.simSpeed);
  const streamerX = useParallelReality((s) => s.streamerX);
  const streamerZ = useParallelReality((s) => s.streamerZ);
  const destX = useParallelReality((s) => s.destX);
  const destZ = useParallelReality((s) => s.destZ);
  const primaryRoute = useParallelReality((s) => s.primaryRoute);
  const safeRoute = useParallelReality((s) => s.safeRoute);

  // Refs for 60fps animation
  const liveRingRef = useRef<Mesh>(null);
  const boundaryGroupRef = useRef<Group>(null);
  const dangerGhostRef = useRef<Group>(null);
  const safeGhostRef = useRef<Group>(null);
  const domeGroupRef = useRef<Group>(null);

  const ghostProgressRef = useRef({
    dangerDist: 0,
    safeDist: 0,
  });

  // Compute hazard zones along primary route
  const hazardZones = useMemo(() => {
    const [mx, mz] = sampleRoute(primaryRoute, 0.52);
    const plan = planStreamerRoutes(streamerX, streamerZ, destX, destZ, [
      {
        x: mx,
        z: mz,
        radius: 30,
        risk: 0.92,
        label: "Swarm Interception Point",
      },
    ]);
    return plan.hazardZones;
  }, [primaryRoute, streamerX, streamerZ, destX, destZ]);

  // Pillar angles around the 140m boundary circle
  const pillarPositions = useMemo(() => {
    const pts: { key: string; x: number; z: number; rotY: number }[] = [];
    for (let i = 0; i < PILLAR_COUNT; i++) {
      const angle = (i / PILLAR_COUNT) * Math.PI * 2;
      pts.push({
        key: `pillar-${i}`,
        x: Math.cos(angle) * BOUNDARY_RADIUS,
        z: Math.sin(angle) * BOUNDARY_RADIUS,
        rotY: -angle,
      });
    }
    return pts;
  }, []);

  // Shared geometries & materials with unmount disposal
  const assets = useMemo(() => {
    const liveRingGeo = new RingGeometry(4.2, 4.8, 48);
    const boundaryTorusGeo = new TorusGeometry(BOUNDARY_RADIUS, 0.9, 12, 96);
    const boundaryGroundRingGeo = new RingGeometry(BOUNDARY_RADIUS - 2.2, BOUNDARY_RADIUS + 2.2, 96);
    const pillarGeo = new CylinderGeometry(0.65, 1.4, 52, 12, 1, true);

    const ghostTorsoGeo = new CapsuleGeometry(1.0, 1.6, 10, 18);
    const ghostHeadGeo = new SphereGeometry(0.88, 18, 18);
    const ghostAuraGeo = new RingGeometry(1.4, 2.3, 32);

    const domeSphereGeo = new SphereGeometry(1, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const domeCylinderGeo = new CylinderGeometry(1, 1, 18, 32, 1, true);
    const domeBaseRingGeo = new RingGeometry(0.92, 1.06, 48);

    const liveRingMat = new MeshBasicMaterial({
      color: "#10b981",
      transparent: true,
      opacity: 0.28,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const boundaryRingMat = new MeshBasicMaterial({
      color: "#ec1187",
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const pillarMat = new MeshBasicMaterial({
      color: "#ff6ac1",
      transparent: true,
      opacity: 0.28,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const dangerGhostMat = new MeshBasicMaterial({
      color: "#ff1e56",
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const safeGhostMat = new MeshBasicMaterial({
      color: "#00ffcc",
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const domeSphereMat = new MeshBasicMaterial({
      color: "#ec1187",
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const domeCylinderMat = new MeshBasicMaterial({
      color: "#ff1e56",
      transparent: true,
      opacity: 0.3,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    return {
      liveRingGeo,
      boundaryTorusGeo,
      boundaryGroundRingGeo,
      pillarGeo,
      ghostTorsoGeo,
      ghostHeadGeo,
      ghostAuraGeo,
      domeSphereGeo,
      domeCylinderGeo,
      domeBaseRingGeo,
      liveRingMat,
      boundaryRingMat,
      pillarMat,
      dangerGhostMat,
      safeGhostMat,
      domeSphereMat,
      domeCylinderMat,
    };
  }, []);

  // Dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      assets.liveRingGeo.dispose();
      assets.boundaryTorusGeo.dispose();
      assets.boundaryGroundRingGeo.dispose();
      assets.pillarGeo.dispose();
      assets.ghostTorsoGeo.dispose();
      assets.ghostHeadGeo.dispose();
      assets.ghostAuraGeo.dispose();
      assets.domeSphereGeo.dispose();
      assets.domeCylinderGeo.dispose();
      assets.domeBaseRingGeo.dispose();
      assets.liveRingMat.dispose();
      assets.boundaryRingMat.dispose();
      assets.pillarMat.dispose();
      assets.dangerGhostMat.dispose();
      assets.safeGhostMat.dispose();
      assets.domeSphereMat.dispose();
      assets.domeCylinderMat.dispose();
    };
  }, [assets]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const dt = Math.min(delta, 0.1);
    const state = useParallelReality.getState();

    // Keep live ambient ring synced to current streamer position
    if (liveRingRef.current) {
      liveRingRef.current.position.set(state.streamerX, 0.14, state.streamerZ);
      const s = 1 + Math.sin(t * 2.2) * 0.08;
      liveRingRef.current.scale.set(s, s, 1);
      assets.liveRingMat.opacity = state.realityMode === "live" ? 0.28 + Math.sin(t * 2.2) * 0.08 : 0.15;
    }

    if (state.realityMode !== "parallel") return;

    // 1. Rotate & pulse the 140m neighborhood parallel-reality boundary ring
    if (boundaryGroupRef.current) {
      boundaryGroupRef.current.position.set(state.streamerX, 0, state.streamerZ);
      boundaryGroupRef.current.rotation.y = t * 0.14;
      assets.boundaryRingMat.opacity = 0.42 + Math.sin(t * 2.8) * 0.16;
      assets.pillarMat.opacity = 0.2 + Math.sin(t * 3.4) * 0.1;
    }

    // 2. Advance Future Ghost Projections at 3x speed along primaryRoute and safeRoute
    const speedFactor = GHOST_BASE_SPEED_MPS * Math.max(1, Math.min(3, simSpeed * 0.45));
    const pLen = routeLength(state.primaryRoute);
    const sLen = routeLength(state.safeRoute);

    if (pLen > 1 && dangerGhostRef.current) {
      ghostProgressRef.current.dangerDist =
        (ghostProgressRef.current.dangerDist + dt * speedFactor) % pLen;
      const [gx, gz, gh] = sampleRoute(
        state.primaryRoute,
        ghostProgressRef.current.dangerDist / pLen,
      );
      dangerGhostRef.current.position.set(gx, Math.abs(Math.sin(t * 7)) * 0.35, gz);
      dangerGhostRef.current.rotation.y = gh;
    }

    if (sLen > 1 && safeGhostRef.current) {
      ghostProgressRef.current.safeDist =
        (ghostProgressRef.current.safeDist + dt * speedFactor) % sLen;
      const [sx, sz, sh] = sampleRoute(
        state.safeRoute,
        ghostProgressRef.current.safeDist / sLen,
      );
      safeGhostRef.current.position.set(sx, Math.abs(Math.cos(t * 7)) * 0.35, sz);
      safeGhostRef.current.rotation.y = sh;
    }

    // 3. Pulse volumetric hazard domes
    if (domeGroupRef.current) {
      const pulse = 1 + Math.sin(t * 4.2) * 0.08;
      const children = domeGroupRef.current.children;
      for (let i = 0; i < children.length; i++) {
        children[i].scale.set(pulse, 1 + Math.sin(t * 3.1) * 0.06, pulse);
      }
      assets.domeSphereMat.opacity = 0.18 + Math.sin(t * 4.2) * 0.08;
      assets.domeCylinderMat.opacity = 0.25 + Math.cos(t * 4.2) * 0.1;
    }
  });

  return (
    <group name="ParallelRealityFx">
      {/* Subtle ambient safe-zone ring around streamer (always mounted, lightweight in live mode) */}
      <mesh
        ref={liveRingRef}
        position={[streamerX, 0.14, streamerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={assets.liveRingGeo}
        material={assets.liveRingMat}
      />

      {realityMode === "parallel" && (
        <>
          {/* 1. 140m Translucent Holographic Cyber-Candy Boundary Ring & Light Pillars */}
          <group ref={boundaryGroupRef} position={[streamerX, 0, streamerZ]}>
            <mesh
              position={[0, 1.2, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              geometry={assets.boundaryTorusGeo}
              material={assets.boundaryRingMat}
            />
            <mesh
              position={[0, 0.18, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              geometry={assets.boundaryGroundRingGeo}
              material={assets.boundaryRingMat}
            />
            {pillarPositions.map((p) => (
              <mesh
                key={p.key}
                position={[p.x, 26, p.z]}
                rotation={[0, p.rotY, 0]}
                geometry={assets.pillarGeo}
                material={assets.pillarMat}
              />
            ))}
          </group>

          {/* 2A. Future Danger Ghost Projection (3x speed along Primary Route into hazard zone) */}
          <group ref={dangerGhostRef}>
            <mesh
              position={[0, 0.2, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              geometry={assets.ghostAuraGeo}
              material={assets.dangerGhostMat}
            />
            <mesh
              position={[0, 1.85, 0]}
              geometry={assets.ghostTorsoGeo}
              material={assets.dangerGhostMat}
            />
            <mesh
              position={[0, 3.65, 0]}
              geometry={assets.ghostHeadGeo}
              material={assets.dangerGhostMat}
            />
            <Html
              position={[0, 5.6, 0]}
              center
              distanceFactor={38}
              zIndexRange={[28, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div style={dangerGhostBadgeStyle}>
                ⚠️ T+42s FUTURE: Swarm Interception Point — 50 synthetic peds block junction
              </div>
            </Html>
          </group>

          {/* 2B. Future Safe Timeline Ghost Projection (3x speed along Safe Detour Route) */}
          <group ref={safeGhostRef}>
            <mesh
              position={[0, 0.2, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              geometry={assets.ghostAuraGeo}
              material={assets.safeGhostMat}
            />
            <mesh
              position={[0, 1.85, 0]}
              geometry={assets.ghostTorsoGeo}
              material={assets.safeGhostMat}
            />
            <mesh
              position={[0, 3.65, 0]}
              geometry={assets.ghostHeadGeo}
              material={assets.safeGhostMat}
            />
            <Html
              position={[0, 5.6, 0]}
              center
              distanceFactor={38}
              zIndexRange={[28, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div style={safeGhostBadgeStyle}>
                ✅ T+42s SAFE TIMELINE: Clear passage
              </div>
            </Html>
          </group>

          {/* 3. Volumetric Hazard Domes at predicted crowd bottleneck / stream sniper interception coords */}
          <group ref={domeGroupRef}>
            {hazardZones.map((hz, idx) => (
              <group key={`hazard-dome-${idx}`} position={[hz.x, 0.15, hz.z]}>
                {/* Translucent Pulsing Magenta Hemisphere Dome */}
                <mesh
                  scale={[hz.radius, hz.radius * 0.65, hz.radius]}
                  geometry={assets.domeSphereGeo}
                  material={assets.domeSphereMat}
                />
                {/* Outer Holographic Containment Cylinder */}
                <mesh
                  position={[0, 9, 0]}
                  scale={[hz.radius, 1, hz.radius]}
                  geometry={assets.domeCylinderGeo}
                  material={assets.domeCylinderMat}
                />
                {/* Ground Danger Ring */}
                <mesh
                  position={[0, 0.1, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  scale={[hz.radius, hz.radius, 1]}
                  geometry={assets.domeBaseRingGeo}
                  material={assets.boundaryRingMat}
                />
                <Html
                  position={[0, hz.radius * 0.65 + 4, 0]}
                  center
                  distanceFactor={42}
                  zIndexRange={[26, 0]}
                  style={{ pointerEvents: "none" }}
                >
                  <div
                    style={{
                      padding: "4px 10px",
                      borderRadius: 9999,
                      background: "rgba(190,18,60,0.92)",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: 10,
                      fontFamily: "Inter, system-ui, sans-serif",
                      letterSpacing: 0.4,
                      boxShadow: "0 6px 18px rgba(236,17,135,0.5)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🚨 {hz.label.toUpperCase()} · RISK {Math.round(hz.risk * 100)}%
                  </div>
                </Html>
              </group>
            ))}
          </group>
        </>
      )}
    </group>
  );
}
