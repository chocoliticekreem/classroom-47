"use client";

import React, { useEffect, useRef, useState } from "react";
import { emit } from "../bus";
import { allVehicles } from "../registry";
import { ROAD_EDGES, ROAD_NODES } from "../roads";
import { useWorld } from "../store";
import {
  allSyntheticAgents,
  LONDON_DISTRICTS,
  useParallelReality,
} from "../streamerContract";

const CANVAS_SIZE = 210;

// Approximate River Thames polyline in world coordinates (west -> southbank -> westminster -> docks)
const THAMES_CURVE: [number, number][] = [
  [-750, 420],
  [-480, 390],
  [-240, 340],
  [-60, 280],
  [120, 210],
  [260, 120],
  [440, 90],
  [720, 110],
];

let minimapMountedCount = 0;

export function NglMinimap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [overviewMode, setOverviewMode] = useState(false);
  const [isPrimaryInstance, setIsPrimaryInstance] = useState(true);

  const realityMode = useParallelReality((s) => s.realityMode);
  const setDestination = useParallelReality((s) => s.setDestination);
  const nearbySniperCount = useParallelReality((s) => s.nearbySniperCount);

  useEffect(() => {
    minimapMountedCount += 1;
    if (minimapMountedCount > 1) {
      setIsPrimaryInstance(false);
    }
    return () => {
      minimapMountedCount = Math.max(0, minimapMountedCount - 1);
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastDraw = 0;
    const FRAME_INTERVAL_MS = 1000 / 12; // ~12 Hz radar refresh

    const renderRadar = (now: number) => {
      rafId = requestAnimationFrame(renderRadar);
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      lastDraw = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const state = useParallelReality.getState();
      const worldState = useWorld.getState();
      const {
        streamerX,
        streamerZ,
        streamerHeading,
        destX,
        destZ,
        primaryRoute,
        safeRoute,
        usingSafeRoute,
        realityMode: mode,
      } = state;

      // Radar scale: local mode shows ~240m radius around streamer; overview shows ~900m radius
      const worldRadius = overviewMode ? 820 : 220;
      const centerX = overviewMode ? 0 : streamerX;
      const centerZ = overviewMode ? -40 : streamerZ;
      const scale = (CANVAS_SIZE * 0.5) / worldRadius;

      const toScreen = (wx: number, wz: number): [number, number] => [
        CANVAS_SIZE * 0.5 + (wx - centerX) * scale,
        CANVAS_SIZE * 0.5 + (wz - centerZ) * scale,
      ];

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // 1. Background stage (dark candy violet in parallel mode, deep radar navy in live mode)
      const bgGrad = ctx.createRadialGradient(
        CANVAS_SIZE * 0.5,
        CANVAS_SIZE * 0.5,
        12,
        CANVAS_SIZE * 0.5,
        CANVAS_SIZE * 0.5,
        CANVAS_SIZE * 0.65
      );
      if (mode === "parallel") {
        bgGrad.addColorStop(0, "#2b0838");
        bgGrad.addColorStop(1, "#12031a");
      } else {
        bgGrad.addColorStop(0, "#131c31");
        bgGrad.addColorStop(1, "#090d18");
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // 2. Concentric radar rings
      ctx.strokeStyle =
        mode === "parallel"
          ? "rgba(236, 17, 135, 0.18)"
          : "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      for (const r of [35, 70, 100]) {
        ctx.beginPath();
        ctx.arc(CANVAS_SIZE * 0.5, CANVAS_SIZE * 0.5, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3. River Thames curve
      ctx.save();
      ctx.beginPath();
      THAMES_CURVE.forEach(([tx, tz], idx) => {
        const [sx, sy] = toScreen(tx, tz);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = "rgba(14, 165, 233, 0.38)";
      ctx.lineWidth = overviewMode ? 7 : 14;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();

      // 4. London Street Grid & Road Edges
      ctx.save();
      for (const edge of ROAD_EDGES.values()) {
        const na = ROAD_NODES.get(edge.a);
        const nb = ROAD_NODES.get(edge.b);
        if (!na || !nb) continue;
        const [ax, ay] = toScreen(na.x, na.z);
        const [bx, by] = toScreen(nb.x, nb.z);
        if (
          (ax < -20 && bx < -20) ||
          (ax > CANVAS_SIZE + 20 && bx > CANVAS_SIZE + 20) ||
          (ay < -20 && by < -20) ||
          (ay > CANVAS_SIZE + 20 && by > CANVAS_SIZE + 20)
        ) {
          continue;
        }
        const isBlocked = Boolean(worldState.blocked[edge.key]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        if (isBlocked) {
          ctx.strokeStyle = "rgba(244, 63, 94, 0.85)";
          ctx.lineWidth = 2.4;
        } else if (edge.kind === "highway") {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1.2;
        }
        ctx.stroke();
      }
      ctx.restore();

      // 5. Primary Route (dashed orange/pink)
      if (primaryRoute && primaryRoute.length >= 2) {
        ctx.save();
        ctx.beginPath();
        primaryRoute.forEach(([rx, rz], idx) => {
          const [sx, sy] = toScreen(rx, rz);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = usingSafeRoute
          ? "rgba(255, 141, 16, 0.42)"
          : "#FF6A1A";
        ctx.lineWidth = usingSafeRoute ? 2 : 3;
        ctx.stroke();
        ctx.restore();
      }

      // 6. Safe Route (bright mint green)
      if (safeRoute && safeRoute.length >= 2) {
        ctx.save();
        ctx.beginPath();
        safeRoute.forEach(([rx, rz], idx) => {
          const [sx, sy] = toScreen(rx, rz);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        if (!usingSafeRoute) {
          ctx.setLineDash([3, 3]);
        }
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = usingSafeRoute ? 3.5 : 2.4;
        ctx.shadowColor = "rgba(16, 185, 129, 0.7)";
        ctx.shadowBlur = usingSafeRoute ? 8 : 3;
        ctx.stroke();
        ctx.restore();
      }

      // 7. District pins in overview mode
      if (overviewMode) {
        for (const d of LONDON_DISTRICTS) {
          const [dx, dy] = toScreen(d.x, d.z);
          ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
          ctx.beginPath();
          ctx.arc(dx, dy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 8. Live Vehicles from allVehicles()
      ctx.save();
      for (const v of allVehicles()) {
        const vx = v.object.position.x;
        const vz = v.object.position.z;
        const [sx, sy] = toScreen(vx, vz);
        if (sx < 0 || sx > CANVAS_SIZE || sy < 0 || sy > CANVAS_SIZE) continue;
        ctx.fillStyle =
          v.kind === "police" || v.kind === "ambulance" || v.kind === "fire"
            ? "#FBBF24"
            : "rgba(255, 255, 255, 0.45)";
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
      ctx.restore();

      // 9. Synthetic Crowd & Stream Snipers from allSyntheticAgents()
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      ctx.save();
      for (const agent of allSyntheticAgents()) {
        const [sx, sy] = toScreen(agent.x, agent.z);
        if (sx < -6 || sx > CANVAS_SIZE + 6 || sy < -6 || sy > CANVAS_SIZE + 6)
          continue;

        if (agent.archetype === "stream_sniper") {
          // Red pulsing ring + core for stream snipers
          ctx.beginPath();
          ctx.arc(sx, sy, 4 + pulse * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 30, 80, ${0.28 + pulse * 0.25})`;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = "#FF1E50";
          ctx.fill();
        } else if (
          agent.archetype === "fan_swarm" ||
          agent.archetype === "chaos_instigator"
        ) {
          // Candy pink dots for fan swarm
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#FF40A0";
          ctx.fill();
        } else {
          // Cyan dots for local commuters / reddit locals / tourists
          ctx.beginPath();
          ctx.arc(sx, sy, 2.1, 0, Math.PI * 2);
          ctx.fillStyle = "#22D3EE";
          ctx.fill();
        }
      }
      ctx.restore();

      // 10. Destination Pin
      const [destSx, destSy] = toScreen(destX, destZ);
      ctx.save();
      ctx.beginPath();
      ctx.arc(destSx, destSy, 5, 0, Math.PI * 2);
      ctx.fillStyle = usingSafeRoute ? "#10B981" : "#FF8D10";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
      ctx.restore();

      // 11. Streamer Icon at Center with FOV Cone
      const [stSx, stSy] = toScreen(streamerX, streamerZ);
      ctx.save();
      ctx.translate(stSx, stSy);
      ctx.rotate(streamerHeading || 0);

      // FOV cone
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 28, -Math.PI * 0.72, -Math.PI * 0.28);
      ctx.closePath();
      const fovGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
      fovGrad.addColorStop(0, "rgba(236, 17, 135, 0.55)");
      fovGrad.addColorStop(1, "rgba(255, 141, 16, 0.0)");
      ctx.fillStyle = fovGrad;
      ctx.fill();

      // Streamer beacon dot
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#EC1187";
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
      ctx.restore();
    };

    rafId = requestAnimationFrame(renderRadar);
    return () => cancelAnimationFrame(rafId);
  }, [overviewMode]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const { streamerX, streamerZ } = useParallelReality.getState();
    const worldRadius = overviewMode ? 820 : 220;
    const centerX = overviewMode ? 0 : streamerX;
    const centerZ = overviewMode ? -40 : streamerZ;
    const scale = (CANVAS_SIZE * 0.5) / worldRadius;

    const worldX = Math.round(centerX + (clickX - CANVAS_SIZE * 0.5) / scale);
    const worldZ = Math.round(centerZ + (clickY - CANVAS_SIZE * 0.5) / scale);

    setDestination(worldX, worldZ);
    emit({ type: "streamer:set_destination", x: worldX, z: worldZ });
  };

  if (!isPrimaryInstance) return null;

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-30 select-none">
      <div className="rounded-[28px] bg-white/85 p-2.5 backdrop-blur-xl shadow-[inset_0_4px_8px_rgba(255,255,255,0.95),inset_0_-5px_10px_rgba(236,17,135,0.14),0_18px_36px_-8px_rgba(140,0,70,0.35)]">
        {/* Header Bar */}
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📡</span>
            <span className="text-xs font-black tracking-tight text-black">
              {realityMode === "parallel" ? "FUTURE RADAR" : "LIVE RADAR"}
            </span>
            {nearbySniperCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white animate-pulse">
                {nearbySniperCount} 🕵️
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOverviewMode((v) => !v)}
            className="rounded-full bg-black/10 px-2.5 py-0.5 text-[10px] font-extrabold text-black transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            {overviewMode ? "🔍 Local 220m" : "🗺️ London Map"}
          </button>
        </div>

        {/* Radar Canvas */}
        <div className="relative overflow-hidden rounded-[22px] border-2 border-white shadow-inner">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onClick={handleCanvasClick}
            title="Tap anywhere on the radar to set streamer destination"
            className="block cursor-crosshair"
          />

          {/* Legend Overlay Pill */}
          <div className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between rounded-full bg-black/65 px-2.5 py-1 text-[9px] font-extrabold text-white backdrop-blur-md">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-[#FF1E50]" />
              Sniper
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-[#FF40A0]" />
              Swarm
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-[#10B981]" />
              Safe Route
            </span>
          </div>
        </div>

        <div className="mt-1 text-center text-[10px] font-bold text-black/55">
          👆 Tap radar to set streamer walk target
        </div>
      </div>
    </div>
  );
}

export default NglMinimap;
