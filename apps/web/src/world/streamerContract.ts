// Shared contract for the NUMA London Streamer Situational Awareness & Parallel Reality Engine.
// Imported by 3D modules (StreamerAvatar, SyntheticCrowd, ParallelRealityFx), the NGL Fluffy HUD, and API routes.

import { create } from "zustand";

export type RealityMode = "live" | "parallel";

export type LondonDistrictId =
  | "soho"
  | "southbank"
  | "shoreditch"
  | "westminster"
  | "camden"
  | "docks"
  | "hampstead";

export interface LondonDistrictPreset {
  id: LondonDistrictId;
  name: string;
  subtitle: string;
  emoji: string;
  x: number;
  z: number;
  destX: number;
  destZ: number;
  baseViewers: number;
}

export const LONDON_DISTRICTS: LondonDistrictPreset[] = [
  {
    id: "soho",
    name: "Soho & Oxford Circus",
    subtitle: "Wardour St · Carnaby · Piccadilly Neon",
    emoji: "🎡",
    x: 0,
    z: 0,
    destX: 80,
    destZ: -80,
    baseViewers: 54200,
  },
  {
    id: "southbank",
    name: "Southbank & Waterloo",
    subtitle: "London Eye · Skate Space · Thames Path",
    emoji: "🌊",
    x: -240,
    z: 380,
    destX: -140,
    destZ: 300,
    baseViewers: 41800,
  },
  {
    id: "shoreditch",
    name: "Shoreditch High St",
    subtitle: "Boxpark · Brick Lane · Overground Arches",
    emoji: "🎨",
    x: 180,
    z: -360,
    destX: 120,
    destZ: -260,
    baseViewers: 38900,
  },
  {
    id: "westminster",
    name: "Westminster & Whitehall",
    subtitle: "Big Ben · Parliament Sq · Downing St",
    emoji: "🕰️",
    x: 260,
    z: -160,
    destX: 160,
    destZ: -120,
    baseViewers: 62400,
  },
  {
    id: "camden",
    name: "Camden & Old Town",
    subtitle: "Camden Lock · Regent's Canal · Market",
    emoji: "🎸",
    x: -620,
    z: 20,
    destX: -520,
    destZ: -60,
    baseViewers: 33500,
  },
  {
    id: "docks",
    name: "Canary Wharf & Docks",
    subtitle: "Thames Quays · Jubilee Plaza · Cranes",
    emoji: "🚢",
    x: 260,
    z: 0,
    destX: 160,
    destZ: 40,
    baseViewers: 29100,
  },
  {
    id: "hampstead",
    name: "Hampstead & North Heath",
    subtitle: "Parliament Hill · North London Lanes",
    emoji: "🌳",
    x: -180,
    z: -800,
    destX: -60,
    destZ: -720,
    baseViewers: 24700,
  },
];

export type SyntheticArchetype =
  | "fan_swarm"
  | "stream_sniper"
  | "reddit_local"
  | "local_commuter"
  | "tourist"
  | "chaos_instigator";

export type WhatIfScenarioId =
  | "leak_location_50"
  | "crosswalk_surge_50"
  | "sniper_ambush"
  | "junction_accident"
  | "flash_mob_100";

export interface SyntheticPersonaSpec {
  id: string;
  handle: string;
  subreddit: string;
  archetype: SyntheticArchetype;
  headline: string;
  thoughtBubble: string;
  hypeLevel: number; // 0..1
  sniperRisk: number; // 0..1
  walkSpeed: number; // m/s
  attractedToStreamer: boolean;
  redditKarma: number;
  avatarEmoji: string;
}

export interface LiveSyntheticAgent extends SyntheticPersonaSpec {
  x: number;
  z: number;
  vx: number;
  vz: number;
  targetX: number;
  targetZ: number;
  spawnedInParallel: boolean;
  createdAt: number;
}

export interface StreamerRecommendation {
  action: "HOLD_ROUTE" | "REROUTE_NOW" | "DUCK_INTO_VENUE" | "DO_NOT_LEAK_LOCATION";
  headline: string;
  detail: string;
  safeStreet: string;
  etaImpactSec: number;
  confidence: number; // 0..1
  futureOutcomeSummary: string;
}

export interface ParallelRealityState {
  realityMode: RealityMode;
  activeScenario: WhatIfScenarioId | null;
  scenarioLabel: string | null;
  simSpeed: 1 | 2 | 5 | 15;
  simHorizonSec: number; // 0..180 seconds into the simulated future
  streamerHandle: string;
  district: LondonDistrictId;
  streamerX: number;
  streamerZ: number;
  streamerHeading: number;
  destX: number;
  destZ: number;
  primaryRoute: [number, number][];
  safeRoute: [number, number][];
  usingSafeRoute: boolean;
  liveViewers: number;
  locationLeaked: boolean;
  safetyScore: number; // 0..100
  sniperRiskPct: number; // 0..100
  crowdDensityPct: number; // 0..100
  nearbySyntheticCount: number;
  nearbySniperCount: number;
  selectedPersonaId: string | null;
  selectedPersona: LiveSyntheticAgent | null;
  recentPersonaFeed: LiveSyntheticAgent[];
  recommendation: StreamerRecommendation;

  // Actions
  setRealityMode: (mode: RealityMode) => void;
  setSimSpeed: (speed: 1 | 2 | 5 | 15) => void;
  setSimHorizonSec: (sec: number) => void;
  setStreamerPos: (x: number, z: number, heading?: number) => void;
  setDestination: (x: number, z: number) => void;
  setDistrict: (district: LondonDistrictId) => void;
  setRoutes: (primary: [number, number][], safe: [number, number][]) => void;
  applySafeRoute: () => void;
  triggerWhatIf: (scenario: WhatIfScenarioId, label: string) => void;
  resetToLive: () => void;
  updateMetrics: (patch: Partial<Pick<ParallelRealityState, "safetyScore" | "sniperRiskPct" | "crowdDensityPct" | "nearbySyntheticCount" | "nearbySniperCount" | "liveViewers" | "recommendation" | "simHorizonSec">>) => void;
  selectPersona: (persona: LiveSyntheticAgent | null) => void;
  pushPersonaFeed: (agents: LiveSyntheticAgent[]) => void;
}

const DEFAULT_RECOMMENDATION: StreamerRecommendation = {
  action: "HOLD_ROUTE",
  headline: "Route Clear through Soho Square",
  detail: "Pedestrian flow normal (18 peds/min). 1 passive stream watcher spotted 95m east on Wardour St.",
  safeStreet: "Brewer St → Soho Sq Corridor",
  etaImpactSec: 0,
  confidence: 0.92,
  futureOutcomeSummary: "Live trajectory holds 88% safety margin over the next 3 minutes.",
};

export const useParallelReality = create<ParallelRealityState>((set) => ({
  realityMode: "live",
  activeScenario: null,
  scenarioLabel: null,
  simSpeed: 1,
  simHorizonSec: 0,
  streamerHandle: "@ishowspeed_ldn",
  district: "soho",
  streamerX: 0,
  streamerZ: 0,
  streamerHeading: 0,
  destX: 80,
  destZ: -80,
  primaryRoute: [
    [0, 0],
    [40, 0],
    [40, -40],
    [80, -40],
    [80, -80],
  ],
  safeRoute: [
    [0, 0],
    [0, -40],
    [0, -80],
    [40, -80],
    [80, -80],
  ],
  usingSafeRoute: false,
  liveViewers: 54200,
  locationLeaked: false,
  safetyScore: 88,
  sniperRiskPct: 14,
  crowdDensityPct: 26,
  nearbySyntheticCount: 32,
  nearbySniperCount: 1,
  selectedPersonaId: null,
  selectedPersona: null,
  recentPersonaFeed: [],
  recommendation: DEFAULT_RECOMMENDATION,

  setRealityMode: (realityMode) => set({ realityMode }),
  setSimSpeed: (simSpeed) => set({ simSpeed }),
  setSimHorizonSec: (simHorizonSec) => set({ simHorizonSec }),
  setStreamerPos: (streamerX, streamerZ, streamerHeading) =>
    set((s) => ({
      streamerX,
      streamerZ,
      streamerHeading: streamerHeading ?? s.streamerHeading,
    })),
  setDestination: (destX, destZ) => set({ destX, destZ, usingSafeRoute: false }),
  setDistrict: (district) => {
    const preset = LONDON_DISTRICTS.find((d) => d.id === district) ?? LONDON_DISTRICTS[0];
    set({
      district,
      streamerX: preset.x,
      streamerZ: preset.z,
      destX: preset.destX,
      destZ: preset.destZ,
      liveViewers: preset.baseViewers,
      usingSafeRoute: false,
    });
  },
  setRoutes: (primaryRoute, safeRoute) => set({ primaryRoute, safeRoute }),
  applySafeRoute: () =>
    set((s) => ({
      usingSafeRoute: true,
      safetyScore: Math.min(96, s.safetyScore + 38),
      sniperRiskPct: Math.max(8, Math.round(s.sniperRiskPct * 0.28)),
      recommendation: {
        action: "HOLD_ROUTE",
        headline: "Safe Detour Locked In ✨",
        detail: "Bypassing high-density swarm zone via quiet side street corridor. Stream snipers misdirected.",
        safeStreet: "Quiet Side-Alley Detour Active",
        etaImpactSec: 24,
        confidence: 0.95,
        futureOutcomeSummary: "Parallel simulation confirms 94% avoidance of crowd bottleneck.",
      },
    })),
  triggerWhatIf: (activeScenario, scenarioLabel) =>
    set((s) => {
      const isLeak = activeScenario === "leak_location_50" || activeScenario === "flash_mob_100";
      const isSniper = activeScenario === "sniper_ambush";
      return {
        realityMode: "parallel",
        activeScenario,
        scenarioLabel,
        simSpeed: 5,
        simHorizonSec: 45,
        locationLeaked: isLeak || s.locationLeaked,
        usingSafeRoute: false,
        safetyScore: isLeak ? 24 : isSniper ? 19 : 38,
        sniperRiskPct: isLeak ? 86 : isSniper ? 94 : 52,
        crowdDensityPct: isLeak ? 92 : 78,
        liveViewers: s.liveViewers + (isLeak ? 18400 : 6200),
        recommendation: isLeak
          ? {
              action: "DO_NOT_LEAK_LOCATION",
              headline: "🚨 CRITICAL: 50+ Chat Swarm in 42s if Leaked!",
              detail:
                "CAMEL-AI + Reddit simulation predicts 50 synthetic fans & 6 stream snipers converging on your exact street within 42 seconds, blocking the main intersection.",
              safeStreet: "Take West Detour via Quiet Mews (+24s)",
              etaImpactSec: 24,
              confidence: 0.94,
              futureOutcomeSummary:
                "DO NOT LEAK LOCATION YET: Parallel branch shows 86% interception probability on current route. Reroute first!",
            }
          : isSniper
            ? {
                action: "REROUTE_NOW",
                headline: "🕵️ Stream Sniper Ambush Detected Ahead!",
                detail:
                  "Synthetic Reddit/Discord trackers triangulated your camera angle from storefront signs. 8 snipers sprinting toward your next junction.",
                safeStreet: "Cut North through Arcade Passage",
                etaImpactSec: 18,
                confidence: 0.91,
                futureOutcomeSummary:
                  "Continuing straight leads to direct stream-sniper encirclement in 30s. Safe detour avoids 100% of interceptors.",
              }
            : {
                action: "REROUTE_NOW",
                headline: "🚶‍♂️ 50-Person Crosswalk Surge + Bottleneck!",
                detail:
                  "Simulated pedestrian surge of 50 people crossing ahead halts traffic and traps foot movement at the junction.",
                safeStreet: "Bypass via Parallel Backstreet",
                etaImpactSec: 15,
                confidence: 0.89,
                futureOutcomeSummary:
                  "Parallel timeline shows a 78% crowd density bottleneck ahead. Taking the green safe route saves 90s of gridlock.",
              },
      };
    }),
  resetToLive: () =>
    set({
      realityMode: "live",
      activeScenario: null,
      scenarioLabel: null,
      simSpeed: 1,
      simHorizonSec: 0,
      locationLeaked: false,
      usingSafeRoute: false,
      safetyScore: 88,
      sniperRiskPct: 14,
      crowdDensityPct: 26,
      recommendation: DEFAULT_RECOMMENDATION,
    }),
  updateMetrics: (patch) => set((s) => ({ ...s, ...patch })),
  selectPersona: (selectedPersona) =>
    set({
      selectedPersona,
      selectedPersonaId: selectedPersona?.id ?? null,
    }),
  pushPersonaFeed: (agents) =>
    set((s) => ({
      recentPersonaFeed: [...agents, ...s.recentPersonaFeed].slice(0, 24),
    })),
}));

// Per-frame mutable registry of synthetic agents for 60fps 3D rendering, radar minimap, and proximity checks.
const syntheticAgents = new Map<string, LiveSyntheticAgent>();

export function registerSyntheticAgent(a: LiveSyntheticAgent) {
  syntheticAgents.set(a.id, a);
  return () => syntheticAgents.delete(a.id);
}

export function clearSyntheticAgents() {
  syntheticAgents.clear();
}

export function allSyntheticAgents(): IterableIterator<LiveSyntheticAgent> {
  return syntheticAgents.values();
}

export function getSyntheticAgentCount(): number {
  return syntheticAgents.size;
}
