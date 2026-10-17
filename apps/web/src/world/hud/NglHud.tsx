"use client";

import React, { useState } from "react";
import { emit } from "../bus";
import { useWorld } from "../store";
import {
  LONDON_DISTRICTS,
  useParallelReality,
  type LiveSyntheticAgent,
  type LondonDistrictId,
  type SyntheticArchetype,
  type WhatIfScenarioId,
} from "../streamerContract";
import { NglMinimap } from "./NglMinimap";
import { PersonaInspectorModal } from "./PersonaInspectorModal";

const DICE_PROMPTS: {
  text: string;
  scenario: WhatIfScenarioId;
  count: number;
  archetype: SyntheticArchetype;
  crossStreet?: boolean;
}[] = [
  {
    text: "Tell my chat right now I'm at Oxford Circus (+50 people swarm)!",
    scenario: "leak_location_50",
    count: 50,
    archetype: "fan_swarm",
  },
  {
    text: "What if 50 people suddenly surge across the crosswalk ahead?",
    scenario: "crosswalk_surge_50",
    count: 50,
    archetype: "local_commuter",
    crossStreet: true,
  },
  {
    text: "What if a Discord stream sniper squad triangulates my storefront?",
    scenario: "sniper_ambush",
    count: 18,
    archetype: "stream_sniper",
  },
  {
    text: "What if a 3-car pileup blocks the next Soho junction right now?",
    scenario: "junction_accident",
    count: 25,
    archetype: "reddit_local",
  },
  {
    text: "Drop a 100-person giveaway flash mob outside Carnaby Street!",
    scenario: "flash_mob_100",
    count: 100,
    archetype: "fan_swarm",
  },
];

const FALLBACK_PERSONA_FEED: LiveSyntheticAgent[] = [
  {
    id: "seed-sniper-1",
    handle: "@soho_trackr_uk",
    subreddit: "r/ukstreaming",
    archetype: "stream_sniper",
    headline: "Triangulated neon sign reflection on Wardour St",
    thoughtBubble:
      "Wait I recognise that Pret awning on Wardour St!! On my Lime bike right now, 45 seconds away 👀🛴",
    hypeLevel: 0.94,
    sniperRisk: 0.92,
    walkSpeed: 4.4,
    attractedToStreamer: true,
    redditKarma: 14820,
    avatarEmoji: "🕵️",
    x: 28,
    z: -18,
    vx: -1.2,
    vz: 0.8,
    targetX: 0,
    targetZ: 0,
    spawnedInParallel: false,
    createdAt: 1,
  },
  {
    id: "seed-fan-2",
    handle: "@speed_gang_ldn",
    subreddit: "r/ishowspeed",
    archetype: "fan_swarm",
    headline: "Sprinting from Oxford Circus Tube Exit 3",
    thoughtBubble:
      "BRO JUST LEAKED SOHO ON STREAM 😭😭 30 of us running down Regent Street right now SUIIII!!",
    hypeLevel: 0.98,
    sniperRisk: 0.68,
    walkSpeed: 3.9,
    attractedToStreamer: true,
    redditKarma: 6390,
    avatarEmoji: "🔥",
    x: 42,
    z: -34,
    vx: -1.5,
    vz: 1.1,
    targetX: 0,
    targetZ: 0,
    spawnedInParallel: true,
    createdAt: 2,
  },
  {
    id: "seed-local-3",
    handle: "@grumpy_zone1_commuter",
    subreddit: "r/london",
    archetype: "reddit_local",
    headline: "Posting PSA thread on r/london about Soho crowd",
    thoughtBubble:
      "Why are 60 teenagers screaming outside Tottenham Court Road station? Avoid Brewer St if you want to walk at normal speed.",
    hypeLevel: 0.25,
    sniperRisk: 0.08,
    walkSpeed: 1.6,
    attractedToStreamer: false,
    redditKarma: 89410,
    avatarEmoji: "🇬🇧",
    x: -22,
    z: -48,
    vx: 0.4,
    vz: -0.6,
    targetX: -60,
    targetZ: -80,
    spawnedInParallel: false,
    createdAt: 3,
  },
  {
    id: "seed-chaos-4",
    handle: "@clip_farmer_99",
    subreddit: "r/LivestreamFail",
    archetype: "chaos_instigator",
    headline: "Trying to bait a viral clip at the crosswalk",
    thoughtBubble:
      "If he turns left onto Old Compton St the whole intersection is gonna gridlock, camera ready for LSF front page 📱⚡",
    hypeLevel: 0.89,
    sniperRisk: 0.84,
    walkSpeed: 3.5,
    attractedToStreamer: true,
    redditKarma: 31200,
    avatarEmoji: "⚡",
    x: 16,
    z: -52,
    vx: -0.8,
    vz: 1.4,
    targetX: 0,
    targetZ: -20,
    spawnedInParallel: true,
    createdAt: 4,
  },
];

const SHORT_DISTRICT_NAMES: Record<LondonDistrictId, string> = {
  soho: "Soho",
  southbank: "Southbank",
  shoreditch: "Shoreditch",
  westminster: "Westminster",
  camden: "Camden",
  docks: "Docks",
  hampstead: "Hampstead",
};

function getArchetypePill(archetype: SyntheticArchetype) {
  switch (archetype) {
    case "stream_sniper":
      return {
        text: "🕵️ Sniper",
        cls: "bg-red-500 text-white",
      };
    case "fan_swarm":
      return {
        text: "🔥 Fan Swarm",
        cls: "bg-[#EC1187] text-white",
      };
    case "chaos_instigator":
      return {
        text: "⚡ Chaos",
        cls: "bg-purple-600 text-white",
      };
    case "reddit_local":
    default:
      return {
        text: "🇬🇧 Local",
        cls: "bg-sky-600 text-white",
      };
  }
}

export function NglHud({ showMinimap = true }: { showMinimap?: boolean }) {
  const [promptIndex, setPromptIndex] = useState(0);
  const [customWhatIf, setCustomWhatIf] = useState(DICE_PROMPTS[0].text);
  const [simulatingApi, setSimulatingApi] = useState(false);

  const realityMode = useParallelReality((s) => s.realityMode);
  const activeScenario = useParallelReality((s) => s.activeScenario);
  const scenarioLabel = useParallelReality((s) => s.scenarioLabel);
  const simSpeed = useParallelReality((s) => s.simSpeed);
  const simHorizonSec = useParallelReality((s) => s.simHorizonSec);
  const streamerHandle = useParallelReality((s) => s.streamerHandle);
  const district = useParallelReality((s) => s.district);
  const streamerX = useParallelReality((s) => s.streamerX);
  const streamerZ = useParallelReality((s) => s.streamerZ);
  const usingSafeRoute = useParallelReality((s) => s.usingSafeRoute);
  const liveViewers = useParallelReality((s) => s.liveViewers);
  const safetyScore = useParallelReality((s) => s.safetyScore);
  const nearbySyntheticCount = useParallelReality(
    (s) => s.nearbySyntheticCount
  );
  const nearbySniperCount = useParallelReality((s) => s.nearbySniperCount);
  const recentPersonaFeed = useParallelReality((s) => s.recentPersonaFeed);
  const recommendation = useParallelReality((s) => s.recommendation);

  const setDistrict = useParallelReality((s) => s.setDistrict);
  const setSimSpeed = useParallelReality((s) => s.setSimSpeed);
  const applySafeRoute = useParallelReality((s) => s.applySafeRoute);
  const triggerWhatIf = useParallelReality((s) => s.triggerWhatIf);
  const resetToLive = useParallelReality((s) => s.resetToLive);
  const selectPersona = useParallelReality((s) => s.selectPersona);
  const updateMetrics = useParallelReality((s) => s.updateMetrics);
  const pushPersonaFeed = useParallelReality((s) => s.pushPersonaFeed);

  const timeOfDay = useWorld((s: { timeOfDay: number }) => s.timeOfDay);

  const personasToShow =
    recentPersonaFeed.length > 0
      ? recentPersonaFeed.slice(0, 5)
      : FALLBACK_PERSONA_FEED.slice(0, 4);

  const handleDiceCycle = () => {
    const nextIdx = (promptIndex + 1) % DICE_PROMPTS.length;
    setPromptIndex(nextIdx);
    setCustomWhatIf(DICE_PROMPTS[nextIdx].text);
  };

  const runParallelScenario = async (
    scenario: WhatIfScenarioId,
    label: string,
    spawnOpts?: {
      count: number;
      archetype: SyntheticArchetype;
      crossStreet?: boolean;
      subreddit?: string;
    }
  ) => {
    // 1. Optimistic immediate parallel fork in state + 3D world bus
    triggerWhatIf(scenario, label);
    emit({ type: "reality:fork", scenario, label });

    if (spawnOpts) {
      emit({
        type: "sim:spawn_synthetic_crowd",
        count: spawnOpts.count,
        archetype: spawnOpts.archetype,
        nearStreamer: true,
        crossStreet: spawnOpts.crossStreet,
        subreddit: spawnOpts.subreddit ?? "r/london",
      });
    }

    if (scenario === "junction_accident") {
      emit({ type: "request:crash", kind: "pileup" });
    }

    // Focus 3D camera on the streamer
    const { streamerX: sx, streamerZ: sz } = useParallelReality.getState();
    useWorld.getState().setFocus({ x: sx, z: sz });

    // 2. Call POST /api/simulate with graceful instant fallback if offline
    setSimulatingApi(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          prompt: label,
          district,
          streamerX: sx,
          streamerZ: sz,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.recommendation) {
          updateMetrics({
            recommendation: data.recommendation,
            ...(typeof data.safetyScore === "number"
              ? { safetyScore: data.safetyScore }
              : {}),
            ...(typeof data.sniperRiskPct === "number"
              ? { sniperRiskPct: data.sniperRiskPct }
              : {}),
          });
        }
        if (Array.isArray(data?.personas) && data.personas.length > 0) {
          pushPersonaFeed(data.personas);
        }
      }
    } catch {
      // Offline / local optimistic mode already applied
    } finally {
      setSimulatingApi(false);
    }
  };

  const handleCustomSubmit = () => {
    const text = customWhatIf.trim() || DICE_PROMPTS[promptIndex].text;
    const lower = text.toLowerCase();
    let scenario: WhatIfScenarioId = "leak_location_50";
    let archetype: SyntheticArchetype = "fan_swarm";
    let count = 50;
    let crossStreet = false;

    if (lower.includes("cross") || lower.includes("street")) {
      scenario = "crosswalk_surge_50";
      archetype = "local_commuter";
      count = 50;
      crossStreet = true;
    } else if (lower.includes("sniper") || lower.includes("ambush")) {
      scenario = "sniper_ambush";
      archetype = "stream_sniper";
      count = 18;
    } else if (
      lower.includes("crash") ||
      lower.includes("accident") ||
      lower.includes("junction")
    ) {
      scenario = "junction_accident";
      archetype = "reddit_local";
      count = 25;
    } else if (lower.includes("100") || lower.includes("flash")) {
      scenario = "flash_mob_100";
      archetype = "fan_swarm";
      count = 100;
    }

    void runParallelScenario(scenario, text, {
      count,
      archetype,
      crossStreet,
      subreddit: "r/ukstreaming",
    });
  };

  const handleResetToLive = () => {
    resetToLive();
    emit({ type: "reality:reset_to_live" });
  };

  const handleToggleRealityMode = () => {
    if (realityMode === "parallel") {
      handleResetToLive();
    } else {
      void runParallelScenario(
        "leak_location_50",
        "Tell Chat My Location (+50 Swarm)",
        { count: 50, archetype: "fan_swarm" }
      );
    }
  };

  const handleApplySafeRoute = () => {
    applySafeRoute();
    emit({ type: "reality:apply_safe_route" });
    const { streamerX: sx, streamerZ: sz } = useParallelReality.getState();
    useWorld.getState().setFocus({ x: sx, z: sz });
  };

  const handleDistrictTeleport = (d: (typeof LONDON_DISTRICTS)[number]) => {
    setDistrict(d.id);
    useWorld.getState().setFocus({ x: d.x, z: d.z });
    emit({ type: "streamer:teleport", x: d.x, z: d.z, district: d.id });
  };

  const handlePersonaClick = (agent: LiveSyntheticAgent) => {
    selectPersona(agent);
    useWorld.getState().setFocus({ x: agent.x, z: agent.z });
    emit({ type: "persona:select", agentId: agent.id });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-4 select-none overflow-hidden">
      {/* Parallel Future Ambient Glow Rim when in Parallel Mode */}
      {realityMode === "parallel" && (
        <div className="pointer-events-none fixed inset-0 z-0 border-[5px] border-[#EC1187]/65 shadow-[inset_0_0_70px_rgba(236,17,135,0.35)]" />
      )}

      {/* ==================== TOP FLOATING BAR ==================== */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Brand Pill + Reality Mode Switcher Pill */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="-rotate-1 flex items-center gap-2.5 rounded-full bg-white px-4 py-1.5 shadow-[inset_0_4px_6px_rgba(255,255,255,1),inset_0_-4px_8px_rgba(236,17,135,0.16),0_12px_24px_rgba(0,0,0,0.25)]">
            <span className="ngl-sticker-text text-xl tracking-tight">
              NUMA 🇬🇧
            </span>
            <span className="hidden xl:inline-block rounded-full bg-gradient-to-r from-[#EC1187]/15 to-[#FF8D10]/15 px-2.5 py-0.5 text-[11px] font-extrabold text-[#EC1187]">
              London IRL Streamer Parallel Reality
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleRealityMode}
            className={`cursor-pointer px-4 py-2 text-xs sm:text-sm font-extrabold tracking-tight flex items-center gap-1.5 ${
              realityMode === "parallel"
                ? "ngl-pill-candy ngl-wobble"
                : "ngl-pill-white"
            }`}
          >
            {realityMode === "parallel" ? (
              <>
                <span>🔮 PARALLEL FUTURE (WHAT-IF)</span>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px]">
                  +{simHorizonSec}s · Tap to Reset
                </span>
              </>
            ) : (
              <>
                <span>🟢 LIVE REALITY</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                  REAL-TIME
                </span>
              </>
            )}
          </button>
        </div>

        {/* Center: London District Teleport Pills */}
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto rounded-full bg-white/75 p-1.5 backdrop-blur-xl shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_12px_24px_rgba(0,0,0,0.22)] max-w-full">
          {LONDON_DISTRICTS.map((d) => {
            const active = district === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => handleDistrictTeleport(d)}
                title={`${d.name} — ${d.subtitle}`}
                className={`cursor-pointer shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold transition-all ${
                  active
                    ? "bg-gradient-to-r from-[#EC1187] to-[#FF8D10] text-white shadow-[0_6px_14px_rgba(236,17,135,0.45)] scale-105"
                    : "bg-white/80 text-black/80 hover:bg-white hover:scale-105"
                }`}
              >
                {d.emoji} {SHORT_DISTRICT_NAMES[d.id]}
              </button>
            );
          })}
        </div>

        {/* Right: Time & Weather Quick Orbs + Sim Speed + Focus Streamer */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {/* Time of Day Orbs */}
          <div className="flex items-center gap-1 rounded-full bg-white/80 p-1 backdrop-blur-xl shadow-md">
            {[
              { label: "☀️ Day", h: 13 },
              { label: "🌅 Sunset", h: 18.2 },
              { label: "🌙 Night", h: 22.5 },
            ].map((t) => {
              const isSelected = Math.abs(timeOfDay - t.h) < 2.2;
              return (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => useWorld.getState().setTimeOfDay(t.h)}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-transform hover:scale-105 active:scale-95 ${
                    isSelected
                      ? "bg-black text-white shadow-sm"
                      : "text-black/75 hover:bg-black/5"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Sim Speed Pills */}
          <div className="flex items-center gap-1 rounded-full bg-white/80 p-1 backdrop-blur-xl shadow-md">
            {([1, 5, 15] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => {
                  setSimSpeed(spd);
                  useWorld.getState().setTimeScale(spd);
                }}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-black transition-transform hover:scale-105 active:scale-95 ${
                  simSpeed === spd
                    ? "bg-gradient-to-r from-[#EC1187] to-[#FF8D10] text-white shadow-sm"
                    : "text-black/75 hover:bg-black/5"
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Focus Streamer Pill */}
          <button
            type="button"
            onClick={() =>
              useWorld.getState().setFocus({ x: streamerX, z: streamerZ })
            }
            className="ngl-pill-black cursor-pointer px-3.5 py-2 text-xs font-extrabold text-white flex items-center gap-1"
          >
            <span>🎥 Focus Streamer</span>
          </button>
        </div>
      </div>

      {/* ==================== MAIN LEFT & RIGHT NGL BUBBLE COLUMNS ==================== */}
      <div className="relative z-10 my-auto flex flex-col lg:flex-row items-start justify-between gap-4 py-2 max-h-[calc(100dvh-92px)] overflow-y-auto lg:overflow-visible">
        {/* ---------- LEFT COLUMN: Parallel Reality Lab (Create a Future) ---------- */}
        <div className="pointer-events-auto w-full max-w-[385px] shrink-0">
          {/* Tilted Floating Sticker Header */}
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="-rotate-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-black text-black shadow-[inset_0_3px_6px_rgba(255,255,255,1),0_8px_18px_rgba(236,17,135,0.28)]">
              <span>🔮 Parallel Reality Lab (Create a Future)</span>
            </span>
            {activeScenario && (
              <span className="rotate-2 rounded-full bg-[#EC1187] px-2.5 py-0.5 text-[10px] font-black text-white shadow">
                FORK ACTIVE
              </span>
            )}
          </div>

          <div className="ngl-bubble w-full">
            {/* Solid White Top Cap */}
            <div className="ngl-bubble-header flex items-center gap-3 px-5 pt-4 pb-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#EC1187] to-[#FF8D10] p-0.5 shadow-md">
                <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-xl">
                  🐣
                </div>
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-bold text-black/55">
                  {streamerHandle}
                </span>
                <span className="text-[15px] font-black text-black">
                  what happens if I do this right now?
                </span>
              </div>
            </div>

            {/* Frosted Volumetric Lower Body */}
            <div className="ngl-bubble-body space-y-3 px-4 pt-3.5 pb-4">
              {/* Custom What-If Input Box + Floating Corner 🎲 Orb */}
              <div className="relative rounded-[22px] bg-white/85 p-3.5 shadow-[inset_0_2px_4px_rgba(255,255,255,0.95),inset_0_-4px_8px_rgba(236,17,135,0.1)]">
                <textarea
                  rows={2}
                  value={customWhatIf}
                  onChange={(e) => setCustomWhatIf(e.target.value)}
                  placeholder="e.g. Tell my chat right now I'm at Oxford Circus (+50 people)..."
                  className="w-full resize-none border-none bg-transparent pr-10 text-sm font-extrabold leading-snug text-black placeholder:text-black/35 outline-none"
                />
                <button
                  type="button"
                  onClick={handleDiceCycle}
                  title="Roll a realistic London streamer What-If prompt!"
                  className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-[#EC1187]/20 to-[#FF8D10]/25 text-base shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_4px_10px_rgba(0,0,0,0.12)] transition-transform hover:scale-110 hover:rotate-12 active:scale-90 cursor-pointer"
                >
                  🎲
                </button>
              </div>

              {/* Chunky Black Pill CTA */}
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={simulatingApi}
                className="ngl-pill-black w-full py-3.5 px-5 text-sm sm:text-base font-extrabold text-white cursor-pointer flex items-center justify-center gap-2"
              >
                <span>
                  {simulatingApi
                    ? "Forking Parallel Timeline... ⚡"
                    : "Simulate Parallel Future! 🔮"}
                </span>
              </button>

              {/* Quick 1-Tap What-If Pills */}
              <div className="pt-1">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-black/60 px-1">
                  <span>⚡ 1-Tap Parallel Futures</span>
                  <span>CAMEL-AI × OASIS</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void runParallelScenario(
                        "leak_location_50",
                        "Tell Chat My Location (+50 Swarm)",
                        {
                          count: 50,
                          archetype: "fan_swarm",
                          subreddit: "r/ishowspeed",
                        }
                      )
                    }
                    className={`cursor-pointer rounded-full px-3.5 py-2 text-left text-xs font-extrabold transition-transform hover:scale-[1.02] active:scale-95 flex items-center justify-between ${
                      activeScenario === "leak_location_50"
                        ? "ngl-pill-candy"
                        : "ngl-pill-white"
                    }`}
                  >
                    <span>📢 Tell Chat My Location (+50 Swarm)</span>
                    <span className="text-[10px] opacity-80">+50 fans</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void runParallelScenario(
                        "crosswalk_surge_50",
                        "+50 People Cross Street Ahead",
                        {
                          count: 50,
                          archetype: "local_commuter",
                          crossStreet: true,
                          subreddit: "r/london",
                        }
                      )
                    }
                    className={`cursor-pointer rounded-full px-3.5 py-2 text-left text-xs font-extrabold transition-transform hover:scale-[1.02] active:scale-95 flex items-center justify-between ${
                      activeScenario === "crosswalk_surge_50"
                        ? "ngl-pill-candy"
                        : "ngl-pill-white"
                    }`}
                  >
                    <span>🚶‍♂️ +50 People Cross Street Ahead</span>
                    <span className="text-[10px] opacity-80">Surge</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void runParallelScenario(
                        "sniper_ambush",
                        "Stream Sniper Squad Ambush",
                        {
                          count: 18,
                          archetype: "stream_sniper",
                          subreddit: "r/ukstreaming",
                        }
                      )
                    }
                    className={`cursor-pointer rounded-full px-3.5 py-2 text-left text-xs font-extrabold transition-transform hover:scale-[1.02] active:scale-95 flex items-center justify-between ${
                      activeScenario === "sniper_ambush"
                        ? "ngl-pill-candy"
                        : "ngl-pill-white"
                    }`}
                  >
                    <span>🕵️ Stream Sniper Squad Ambush</span>
                    <span className="text-[10px] opacity-80">18 snipers</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void runParallelScenario(
                        "junction_accident",
                        "Junction Accident + Blockade",
                        {
                          count: 24,
                          archetype: "reddit_local",
                          subreddit: "r/london",
                        }
                      )
                    }
                    className={`cursor-pointer rounded-full px-3.5 py-2 text-left text-xs font-extrabold transition-transform hover:scale-[1.02] active:scale-95 flex items-center justify-between ${
                      activeScenario === "junction_accident"
                        ? "ngl-pill-candy"
                        : "ngl-pill-white"
                    }`}
                  >
                    <span>🚧 Junction Accident + Blockade</span>
                    <span className="text-[10px] opacity-80">Pileup</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void runParallelScenario(
                        "flash_mob_100",
                        "100-Person Soho Flash Mob",
                        {
                          count: 100,
                          archetype: "fan_swarm",
                          subreddit: "r/LivestreamFail",
                        }
                      )
                    }
                    className={`cursor-pointer rounded-full px-3.5 py-2 text-left text-xs font-extrabold transition-transform hover:scale-[1.02] active:scale-95 flex items-center justify-between ${
                      activeScenario === "flash_mob_100"
                        ? "ngl-pill-candy"
                        : "ngl-pill-white"
                    }`}
                  >
                    <span>🔥 100-Person Soho Flash Mob</span>
                    <span className="text-[10px] opacity-80">100 swarm</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- RIGHT COLUMN: Streamer Radar & Future Decision ---------- */}
        <div className="pointer-events-auto w-full max-w-[395px] shrink-0">
          {/* Tilted Floating Sticker Header */}
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="rotate-1 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-black text-black shadow-[inset_0_3px_6px_rgba(255,255,255,1),0_8px_18px_rgba(236,17,135,0.28)]">
              <span>🛡️ Streamer Radar &amp; Future Decision</span>
            </span>
            {scenarioLabel && (
              <span className="-rotate-1 truncate max-w-[165px] rounded-full bg-black/80 px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                {scenarioLabel}
              </span>
            )}
          </div>

          <div className="ngl-bubble w-full">
            {/* Solid White Top Cap: Live Status Pills */}
            <div className="ngl-bubble-header flex flex-wrap items-center justify-between gap-1.5 px-4 pt-3.5 pb-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-black shadow-sm ${
                  safetyScore < 45
                    ? "bg-red-600 text-white animate-pulse"
                    : safetyScore < 75
                      ? "bg-amber-500 text-white"
                      : "bg-emerald-500 text-white"
                }`}
              >
                {safetyScore < 45 ? "🚨" : "🛡️"} Safety: {safetyScore}%
              </span>

              <span className="rounded-full bg-[#EC1187]/12 px-2.5 py-1 text-xs font-extrabold text-[#EC1187]">
                👁️ {(liveViewers / 1000).toFixed(1)}K watching
              </span>

              <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-extrabold text-black/75">
                👥 {nearbySyntheticCount} Crowd · 🕵️ {nearbySniperCount} Snipers
              </span>
            </div>

            {/* Frosted Volumetric Lower Body */}
            <div className="ngl-bubble-body space-y-3 px-4 pt-3.5 pb-4">
              {/* AI Decision & Future Outcome Banner */}
              <div
                className={`rounded-[22px] p-3.5 shadow-[inset_0_2px_6px_rgba(255,255,255,0.9),0_8px_20px_rgba(0,0,0,0.08)] ${
                  usingSafeRoute
                    ? "bg-emerald-50/95"
                    : safetyScore < 45
                      ? "bg-rose-50/95"
                      : "bg-white/90"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-black px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                    {recommendation.action.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] font-extrabold text-black/55">
                    {Math.round(recommendation.confidence * 100)}% AI Conf
                  </span>
                </div>

                <h3 className="mt-1.5 text-sm font-black leading-snug text-black">
                  {recommendation.headline}
                </h3>
                <p className="mt-1 text-xs font-bold leading-relaxed text-black/75">
                  {recommendation.detail}
                </p>

                <div className="mt-2 rounded-xl bg-gradient-to-r from-[#EC1187]/12 to-[#FF8D10]/12 px-3 py-1.5 text-[11px] font-extrabold text-[#B80965]">
                  🔮 {recommendation.futureOutcomeSummary}
                </div>
              </div>

              {/* Two Chunky Action Pills */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleApplySafeRoute}
                  className="ngl-pill-candy ngl-wobble w-full py-3 px-4 text-xs sm:text-sm font-extrabold text-white cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>
                    {usingSafeRoute
                      ? `✅ Safe Detour Active (${recommendation.safeStreet})`
                      : `✅ Take Safe Detour (${recommendation.safeStreet})`}
                  </span>
                </button>

                {realityMode === "parallel" && (
                  <button
                    type="button"
                    onClick={handleResetToLive}
                    className="ngl-pill-white w-full py-2.5 px-4 text-xs font-extrabold text-black cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>⏪ Abort Future &amp; Return to Live</span>
                  </button>
                )}
              </div>

              {/* Scraped Reddit Synthetic Crowd Feed */}
              <div className="pt-1">
                <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-black uppercase tracking-wider text-black/65">
                  <span>👽 Scraped Reddit Synthetic Crowd</span>
                  <span className="text-[#EC1187]">Tap to Inspect 3D</span>
                </div>

                <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-0.5">
                  {personasToShow.map((agent) => {
                    const archPill = getArchetypePill(agent.archetype);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => handlePersonaClick(agent)}
                        className="w-full cursor-pointer rounded-[18px] bg-white/85 px-3 py-2 text-left transition-transform hover:scale-[1.015] hover:bg-white active:scale-98 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm">
                              {agent.avatarEmoji || "🧑"}
                            </span>
                            <span className="truncate text-xs font-extrabold text-black">
                              {agent.handle.startsWith("@") ||
                              agent.handle.startsWith("u/")
                                ? agent.handle
                                : `@${agent.handle}`}
                            </span>
                            <span className="shrink-0 rounded-full bg-[#FF4500]/12 px-1.5 py-0.5 text-[10px] font-extrabold text-[#FF4500]">
                              {agent.subreddit.startsWith("r/")
                                ? agent.subreddit
                                : `r/${agent.subreddit}`}
                            </span>
                          </div>

                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${archPill.cls}`}
                          >
                            {archPill.text}
                          </span>
                        </div>

                        <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-snug text-black/75">
                          “{agent.thoughtBubble}”
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Persona Inspector Modal (shown when a synthetic persona is selected) */}
      <PersonaInspectorModal />

      {/* Bottom-Right Radar Minimap */}
      {showMinimap && <NglMinimap />}
    </div>
  );
}

export default NglHud;
