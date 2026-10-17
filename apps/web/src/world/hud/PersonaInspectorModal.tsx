"use client";

import React from "react";
import { emit } from "../bus";
import { useWorld } from "../store";
import {
  useParallelReality,
  type SyntheticArchetype,
} from "../streamerContract";

function getArchetypeBadge(archetype: SyntheticArchetype): {
  label: string;
  emoji: string;
  bgClass: string;
  textClass: string;
} {
  switch (archetype) {
    case "stream_sniper":
      return {
        label: "Stream Sniper",
        emoji: "🕵️",
        bgClass: "bg-gradient-to-r from-[#FF0055] to-[#FF5500]",
        textClass: "text-white",
      };
    case "fan_swarm":
      return {
        label: "Fan Swarm",
        emoji: "🔥",
        bgClass: "bg-gradient-to-r from-[#EC1187] to-[#FF8D10]",
        textClass: "text-white",
      };
    case "chaos_instigator":
      return {
        label: "Chaos Instigator",
        emoji: "⚡",
        bgClass: "bg-gradient-to-r from-[#7928CA] to-[#FF0080]",
        textClass: "text-white",
      };
    case "reddit_local":
      return {
        label: "Reddit Local",
        emoji: "🇬🇧",
        bgClass: "bg-gradient-to-r from-[#2563EB] to-[#06B6D4]",
        textClass: "text-white",
      };
    case "tourist":
      return {
        label: "London Tourist",
        emoji: "📸",
        bgClass: "bg-gradient-to-r from-[#F59E0B] to-[#EC4899]",
        textClass: "text-white",
      };
    case "local_commuter":
    default:
      return {
        label: "Local Commuter",
        emoji: "🚇",
        bgClass: "bg-gradient-to-r from-[#10B981] to-[#059669]",
        textClass: "text-white",
      };
  }
}

export function PersonaInspectorModal() {
  const selectedPersona = useParallelReality((s) => s.selectedPersona);
  const selectPersona = useParallelReality((s) => s.selectPersona);
  const streamerX = useParallelReality((s) => s.streamerX);
  const streamerZ = useParallelReality((s) => s.streamerZ);

  if (!selectedPersona) return null;

  const badge = getArchetypeBadge(selectedPersona.archetype);
  const distMeters = Math.round(
    Math.hypot(selectedPersona.x - streamerX, selectedPersona.z - streamerZ)
  );
  const hypePct = Math.round(selectedPersona.hypeLevel * 100);
  const sniperPct = Math.round(selectedPersona.sniperRisk * 100);

  const handleFollow3D = () => {
    useWorld.getState().setFocus({
      x: selectedPersona.x,
      z: selectedPersona.z,
    });
    emit({ type: "persona:select", agentId: selectedPersona.id });
  };

  const handleClose = () => {
    selectPersona(null);
    emit({ type: "persona:select", agentId: null });
  };

  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-40 w-[92vw] max-w-[430px] -translate-x-1/2 select-none">
      {/* Tilted Floating CAMEL-AI Sticker Badge */}
      <div className="mb-2 flex items-center justify-between px-2">
        <div className="-rotate-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-xs font-black tracking-tight text-black shadow-[inset_0_3px_6px_rgba(255,255,255,1),inset_0_-3px_6px_rgba(236,17,135,0.18),0_10px_20px_rgba(0,0,0,0.25)]">
          <span>🐪</span>
          <span>CAMEL-AI × REDDIT SYNTHETIC PERSONA</span>
          {selectedPersona.spawnedInParallel && (
            <span className="ml-1 rounded-full bg-[#EC1187] px-2 py-0.5 text-[10px] font-extrabold text-white">
              🔮 PARALLEL
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close persona inspector"
          className="ngl-pill-white flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-black shadow-md cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Signature Two-Part NGL Split Bubble Card */}
      <div className="ngl-bubble w-full overflow-hidden">
        {/* Solid White Volumetric Top Cap */}
        <div className="ngl-bubble-header flex items-center justify-between gap-3 px-5 pt-4 pb-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="-rotate-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#EC1187] to-[#FF8D10] p-0.5 shadow-[0_6px_16px_rgba(236,17,135,0.32)]">
              <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-2xl">
                {selectedPersona.avatarEmoji || badge.emoji}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-extrabold text-black">
                  {selectedPersona.handle.startsWith("@") ||
                  selectedPersona.handle.startsWith("u/")
                    ? selectedPersona.handle
                    : `@${selectedPersona.handle}`}
                </span>
                <span className="rounded-full bg-[#FF4500]/12 px-2 py-0.5 text-[11px] font-extrabold text-[#FF4500]">
                  {selectedPersona.subreddit.startsWith("r/")
                    ? selectedPersona.subreddit
                    : `r/${selectedPersona.subreddit}`}
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold text-black/60">
                  ⬆️ {selectedPersona.redditKarma.toLocaleString()} karma
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs font-bold text-black/75">
                {selectedPersona.headline}
              </p>
            </div>
          </div>

          <span
            className={`rotate-2 shrink-0 rounded-full px-3 py-1 text-xs font-extrabold shadow-sm ${badge.bgClass} ${badge.textClass}`}
          >
            {badge.emoji} {badge.label}
          </span>
        </div>

        {/* Frosted Volumetric Glass Lower Body */}
        <div className="ngl-bubble-body space-y-3.5 px-5 pt-4 pb-5">
          {/* Scraped / Synthesized Reddit Thought Bubble */}
          <div className="relative rounded-[22px] bg-white/85 px-4 py-3 shadow-[inset_0_3px_6px_rgba(255,255,255,0.95),inset_0_-4px_8px_rgba(236,17,135,0.1),0_8px_18px_rgba(0,0,0,0.08)]">
            <div className="mb-1 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-[#EC1187]">
              <span>💬 Live Inner Monologue / Reddit Thread</span>
              <span className="text-black/50">{distMeters}m from streamer</span>
            </div>
            <p className="text-sm font-extrabold leading-snug text-black">
              “{selectedPersona.thoughtBubble}”
            </p>
          </div>

          {/* CAMEL-AI Persona Traits Pill Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl bg-white/75 px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between font-bold text-black/60">
                <span>🔥 Hype Level</span>
                <span className="font-black text-[#EC1187]">{hypePct}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#EC1187] to-[#FF8D10]"
                  style={{ width: `${Math.min(100, Math.max(6, hypePct))}%` }}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white/75 px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between font-bold text-black/60">
                <span>🕵️ Sniper Risk</span>
                <span
                  className={`font-black ${
                    sniperPct >= 60 ? "text-red-600" : "text-black"
                  }`}
                >
                  {sniperPct}%
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/10">
                <div
                  className={`h-full rounded-full ${
                    sniperPct >= 60
                      ? "bg-gradient-to-r from-red-600 to-orange-500"
                      : "bg-gradient-to-r from-emerald-500 to-teal-400"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(6, sniperPct))}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-white/75 px-3 py-2 font-bold shadow-sm">
              <span className="text-black/60">🏃 Walk Speed</span>
              <span className="font-black text-black">
                {selectedPersona.walkSpeed.toFixed(1)} m/s
              </span>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-white/75 px-3 py-2 font-bold shadow-sm">
              <span className="text-black/60">🧲 Stream Magnet</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                  selectedPersona.attractedToStreamer
                    ? "bg-[#EC1187]/15 text-[#EC1187]"
                    : "bg-black/10 text-black/65"
                }`}
              >
                {selectedPersona.attractedToStreamer ? "Attracted YES" : "Passive"}
              </span>
            </div>
          </div>

          {/* Chunky Action Pills */}
          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleFollow3D}
              className="ngl-pill-candy flex-1 py-3 px-4 text-sm font-extrabold text-white cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>Follow in 3D 🎯</span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="ngl-pill-black py-3 px-5 text-sm font-extrabold text-white cursor-pointer flex items-center justify-center gap-1"
            >
              <span>Close ✕</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PersonaInspectorModal;
