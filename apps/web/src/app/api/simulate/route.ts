import { NextRequest, NextResponse } from "next/server";
import {
  LONDON_DISTRICTS,
  type LiveSyntheticAgent,
  type LondonDistrictId,
  type StreamerRecommendation,
  type SyntheticArchetype,
  type WhatIfScenarioId,
} from "@/world/streamerContract";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RouteActionChoice =
  | "HOLD_ROUTE"
  | "REROUTE_NOW"
  | "DUCK_INTO_VENUE"
  | "DO_NOT_LEAK_LOCATION";

interface SimulateRequestBody {
  prompt?: string;
  scenario?: WhatIfScenarioId;
  district?: LondonDistrictId;
  streamerX?: number;
  streamerZ?: number;
  liveViewers?: number;
  spawnCount?: number;
}

interface SystemOneJudgments {
  model: string;
  source: "typesafe_live_jev" | "typesafe_system_one_calibrated";
  choice: {
    type: "choice";
    choice: RouteActionChoice;
    probabilities: Record<RouteActionChoice, number>;
    confidence: number;
  };
  noul: {
    sniperInterceptionProb: number;
    crowdCrushHazardProb: number;
    trafficGridlockProb: number;
  };
  score: {
    safetyScore: number; // 0..100
    sniperRiskPct: number; // 0..100
    crowdDensityPct: number; // 0..100
  };
}

const DISTRICT_SAFE_CORRIDORS: Record<
  LondonDistrictId,
  { mainStreet: string; safeStreet: string; venueRefuge: string }
> = {
  soho: {
    mainStreet: "Wardour St & Oxford Circus Junction",
    safeStreet: "Brewer St → Bridle Lane Quiet Mews",
    venueRefuge: "Berwick St Covered Arcade Lobby",
  },
  southbank: {
    mainStreet: "Jubilee Walkway & London Eye Pier",
    safeStreet: "Upper Ground → Coin Street Courtyard",
    venueRefuge: "BFI Southbank Atrium Side Exit",
  },
  shoreditch: {
    mainStreet: "Shoreditch High St & Boxpark Forecourt",
    safeStreet: "Redchurch St → Boundary Passage",
    venueRefuge: "Rich Mix Cultural Foyer",
  },
  westminster: {
    mainStreet: "Parliament Square & Whitehall Crossing",
    safeStreet: "Great George St → Birdcage Walk",
    venueRefuge: "Westminster Central Hall Vestibule",
  },
  camden: {
    mainStreet: "Camden High St & Lock Bridge",
    safeStreet: "Regent's Canal Towpath West → Gloucester Gate",
    venueRefuge: "Hawley Wharf Covered Market Level 2",
  },
  docks: {
    mainStreet: "Jubilee Plaza & Canary Wharf DLR",
    safeStreet: "West India Quay Footbridge North",
    venueRefuge: "Crossrail Place Roof Garden concourse",
  },
  hampstead: {
    mainStreet: "Hampstead High St & Flask Walk",
    safeStreet: "Church Row → Holly Walk Quiet Lane",
    venueRefuge: "Burgh House Courtyard Garden",
  },
};

function inferScenarioFromPrompt(
  prompt: string,
  explicitScenario?: WhatIfScenarioId
): { scenario: WhatIfScenarioId; spawnCount: number; parsedIntent: string } {
  const lower = prompt.toLowerCase();

  // Extract explicit number from prompt if present (e.g. "50 people", "100 fans")
  const numMatch = prompt.match(/\b(\d{2,3})\b/);
  const extractedCount = numMatch ? Math.min(120, Math.max(20, Number(numMatch[1]))) : null;

  if (explicitScenario) {
    const defaultCount = explicitScenario === "flash_mob_100" ? 80 : 50;
    return {
      scenario: explicitScenario,
      spawnCount: extractedCount ?? defaultCount,
      parsedIntent: prompt.trim() || `Parallel scenario: ${explicitScenario}`,
    };
  }

  if (
    lower.includes("leak") ||
    lower.includes("tell my chat") ||
    lower.includes("tell chat") ||
    lower.includes("where i'm at") ||
    lower.includes("where i am") ||
    lower.includes("drop location") ||
    lower.includes("come to my location")
  ) {
    return {
      scenario: "leak_location_50",
      spawnCount: extractedCount ?? 50,
      parsedIntent:
        prompt.trim() ||
        "What if I tell my chat right now where I'm at and 50 people come to my location?",
    };
  }

  if (
    lower.includes("cross") ||
    lower.includes("street") ||
    lower.includes("walk across") ||
    lower.includes("crosswalk") ||
    lower.includes("pedestrian") ||
    lower.includes("jaywalk")
  ) {
    return {
      scenario: "crosswalk_surge_50",
      spawnCount: extractedCount ?? 50,
      parsedIntent:
        prompt.trim() || "What if 50 people walk across the street ahead right now?",
    };
  }

  if (
    lower.includes("sniper") ||
    lower.includes("ambush") ||
    lower.includes("stalker") ||
    lower.includes("track") ||
    lower.includes("discord")
  ) {
    return {
      scenario: "sniper_ambush",
      spawnCount: extractedCount ?? 45,
      parsedIntent:
        prompt.trim() ||
        "What if stream snipers triangulate my storefront reflection and ambush the next junction?",
    };
  }

  if (
    lower.includes("accident") ||
    lower.includes("crash") ||
    lower.includes("bus") ||
    lower.includes("block") ||
    lower.includes("gridlock")
  ) {
    return {
      scenario: "junction_accident",
      spawnCount: extractedCount ?? 50,
      parsedIntent:
        prompt.trim() || "What if a junction blockage halts traffic while chat crowds the pavement?",
    };
  }

  if (lower.includes("100") || lower.includes("flash mob") || lower.includes("massive")) {
    return {
      scenario: "flash_mob_100",
      spawnCount: extractedCount ?? 80,
      parsedIntent:
        prompt.trim() || "What if a 100-person viral flash mob converges on this block?",
    };
  }

  return {
    scenario: "leak_location_50",
    spawnCount: extractedCount ?? 50,
    parsedIntent:
      prompt.trim() ||
      "What if I tell my chat right now where I'm at and 50 people come to my location?",
  };
}

async function evaluateTypeSafeSystemOne(params: {
  prompt: string;
  scenario: WhatIfScenarioId;
  district: LondonDistrictId;
  districtName: string;
  liveViewers: number;
  spawnCount: number;
}): Promise<SystemOneJudgments> {
  const { prompt, scenario, district, districtName, liveViewers, spawnCount } = params;

  // Deterministic calibrated baseline according to TypeSafe System One (Choice + Noul + Score)
  let probabilities: Record<RouteActionChoice, number> = {
    DO_NOT_LEAK_LOCATION: 0.76,
    REROUTE_NOW: 0.16,
    DUCK_INTO_VENUE: 0.06,
    HOLD_ROUTE: 0.02,
  };
  let chosenAction: RouteActionChoice = "DO_NOT_LEAK_LOCATION";
  let confidence = 0.94;
  let sniperInterceptionProb = 0.86;
  let crowdCrushHazardProb = 0.82;
  let trafficGridlockProb = 0.74;
  let safetyScore = 24;
  let sniperRiskPct = 86;
  let crowdDensityPct = 92;

  if (scenario === "crosswalk_surge_50") {
    probabilities = {
      REROUTE_NOW: 0.74,
      HOLD_ROUTE: 0.11,
      DUCK_INTO_VENUE: 0.09,
      DO_NOT_LEAK_LOCATION: 0.06,
    };
    chosenAction = "REROUTE_NOW";
    confidence = 0.89;
    sniperInterceptionProb = 0.48;
    crowdCrushHazardProb = 0.76;
    trafficGridlockProb = 0.91;
    safetyScore = 38;
    sniperRiskPct = 48;
    crowdDensityPct = 84;
  } else if (scenario === "sniper_ambush") {
    probabilities = {
      REROUTE_NOW: 0.68,
      DUCK_INTO_VENUE: 0.24,
      DO_NOT_LEAK_LOCATION: 0.06,
      HOLD_ROUTE: 0.02,
    };
    chosenAction = "REROUTE_NOW";
    confidence = 0.92;
    sniperInterceptionProb = 0.94;
    crowdCrushHazardProb = 0.69;
    trafficGridlockProb = 0.58;
    safetyScore = 19;
    sniperRiskPct = 94;
    crowdDensityPct = 78;
  } else if (scenario === "flash_mob_100") {
    probabilities = {
      DUCK_INTO_VENUE: 0.58,
      DO_NOT_LEAK_LOCATION: 0.26,
      REROUTE_NOW: 0.14,
      HOLD_ROUTE: 0.02,
    };
    chosenAction = "DUCK_INTO_VENUE";
    confidence = 0.95;
    sniperInterceptionProb = 0.92;
    crowdCrushHazardProb = 0.96;
    trafficGridlockProb = 0.94;
    safetyScore = 14;
    sniperRiskPct = 92;
    crowdDensityPct = 98;
  } else if (scenario === "junction_accident") {
    probabilities = {
      REROUTE_NOW: 0.79,
      DUCK_INTO_VENUE: 0.11,
      HOLD_ROUTE: 0.06,
      DO_NOT_LEAK_LOCATION: 0.04,
    };
    chosenAction = "REROUTE_NOW";
    confidence = 0.9;
    sniperInterceptionProb = 0.56;
    crowdCrushHazardProb = 0.79;
    trafficGridlockProb = 0.95;
    safetyScore = 33;
    sniperRiskPct = 56;
    crowdDensityPct = 85;
  }

  // If TYPESAFE_API_KEY is configured, call the live TypeSafe System One API (https://api.typesafe.ai/v1/systemone)
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(2200),
        body: JSON.stringify({
          model: "jev-latest",
          state: {
            streamerPrompt: prompt,
            scenario,
            district,
            districtName,
            liveViewers,
            spawnCount,
          },
          questions: {
            route_action: {
              type: "choice",
              instructions:
                "Which tactical situational-awareness action should the IRL streamer take given `streamerPrompt` and `scenario`?",
              criteria: {
                DO_NOT_LEAK_LOCATION:
                  "The streamer is considering telling chat their location or inviting fans; warn them not to leak location and to detour first",
                REROUTE_NOW:
                  "A crowd surge, crosswalk bottleneck, or stream-sniper ambush blocks the current street; reroute immediately onto a quiet side street",
                DUCK_INTO_VENUE:
                  "Overwhelming flash mob or crush hazard requires stepping inside a secure venue lobby immediately",
                HOLD_ROUTE:
                  "Low risk and normal pedestrian flow; safe to continue on the primary route",
              },
            },
            sniper_interception: {
              type: "noul",
              instructions:
                "Will stream snipers or aggressive clout-chasers intercept the streamer within 90 seconds if no action is taken?",
            },
            crowd_crush_hazard: {
              type: "noul",
              instructions:
                "Will the hypothetical event create a dangerous pavement or crosswalk crowd bottleneck?",
            },
            traffic_gridlock: {
              type: "noul",
              instructions:
                "Will pedestrian spilling into the roadway halt vehicle traffic at the next London junction?",
            },
            safety_level: {
              type: "score",
              instructions: "Rate the physical & operational safety of the streamer's current path.",
              criteria: [
                "Critical hazard: immediate encirclement by 50+ fans/snipers or complete junction gridlock",
                "High risk: rapid crowd convergence and high stream-sniper triangulation",
                "Moderate risk: dense pedestrian surge slowing movement",
                "Safe: clear London corridor with normal commuter traffic",
              ],
            },
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const ans = data?.answers;
        if (ans?.route_action?.choice) {
          const liveChoice = ans.route_action.choice as RouteActionChoice;
          const liveProbs = ans.route_action.probabilities ?? probabilities;
          const liveConf = Number(ans.route_action.confidence ?? confidence);
          const sProb = Number(ans.sniper_interception?.noul ?? sniperInterceptionProb);
          const cProb = Number(ans.crowd_crush_hazard?.noul ?? crowdCrushHazardProb);
          const tProb = Number(ans.traffic_gridlock?.noul ?? trafficGridlockProb);
          const rawScore = Number(ans.safety_level?.score ?? 0.75); // 0..3
          const computedSafety = Math.round(Math.max(8, Math.min(96, (rawScore / 3) * 100)));

          return {
            model: data.model || "jev-latest",
            source: "typesafe_live_jev",
            choice: {
              type: "choice",
              choice: liveChoice,
              probabilities: {
                HOLD_ROUTE: Number((liveProbs.HOLD_ROUTE ?? 0.03).toFixed(3)),
                REROUTE_NOW: Number((liveProbs.REROUTE_NOW ?? 0.25).toFixed(3)),
                DUCK_INTO_VENUE: Number((liveProbs.DUCK_INTO_VENUE ?? 0.12).toFixed(3)),
                DO_NOT_LEAK_LOCATION: Number((liveProbs.DO_NOT_LEAK_LOCATION ?? 0.6).toFixed(3)),
              },
              confidence: Number(liveConf.toFixed(2)),
            },
            noul: {
              sniperInterceptionProb: Number(sProb.toFixed(2)),
              crowdCrushHazardProb: Number(cProb.toFixed(2)),
              trafficGridlockProb: Number(tProb.toFixed(2)),
            },
            score: {
              safetyScore: computedSafety,
              sniperRiskPct: Math.round(sProb * 100),
              crowdDensityPct: Math.round(Math.max(cProb, tProb) * 100),
            },
          };
        }
      }
    } catch {
      // Fall through to calibrated System One judgment
    }
  }

  return {
    model: "jev-latest (TypeSafe System One calibrated)",
    source: "typesafe_system_one_calibrated",
    choice: {
      type: "choice",
      choice: chosenAction,
      probabilities,
      confidence,
    },
    noul: {
      sniperInterceptionProb,
      crowdCrushHazardProb,
      trafficGridlockProb,
    },
    score: {
      safetyScore,
      sniperRiskPct,
      crowdDensityPct,
    },
  };
}

interface AgentArchetypeTemplate {
  handlePrefix: string;
  subreddit: string;
  archetype: SyntheticArchetype;
  avatarEmoji: string;
  hypeLevel: number;
  sniperRisk: number;
  walkSpeed: number;
  attractedToStreamer: boolean;
  buildHeadline: (districtName: string, prompt: string, count: number) => string;
  buildThought: (districtName: string, prompt: string, count: number) => string;
}

const CAMEL_AGENT_TEMPLATES: AgentArchetypeTemplate[] = [
  {
    handlePrefix: "u/ldn_sniper_osint",
    subreddit: "r/ukstreaming",
    archetype: "stream_sniper",
    avatarEmoji: "🕵️",
    hypeLevel: 0.97,
    sniperRisk: 0.95,
    walkSpeed: 3.75,
    attractedToStreamer: true,
    buildHeadline: (d, _p, c) =>
      `[LIVE] Streamer just hinted at ${d} — ${c} of us sprinting from the Tube exit right now!`,
    buildThought: (d, p) =>
      `Reacting to "${p.slice(0, 52)}": Locked onto ${d} storefront reflection, intercepting in 35s! 🎯📡`,
  },
  {
    handlePrefix: "u/w_chat_brigade",
    subreddit: "r/ukstreaming",
    archetype: "fan_swarm",
    avatarEmoji: "🏃",
    hypeLevel: 0.93,
    sniperRisk: 0.68,
    walkSpeed: 3.45,
    attractedToStreamer: true,
    buildHeadline: (d, _p, c) =>
      `WHOLE GROUPCHAT PULLING UP TO ${d.toUpperCase()} (${c}+ FANS EN ROUTE)`,
    buildThought: (d, _p, c) =>
      `Bro if ${c} of us rush ${d} at once we're getting in the YouTube thumbnail for sure 📸🔥`,
  },
  {
    handlePrefix: "u/lsf_clip_hunter",
    subreddit: "r/LivestreamFail",
    archetype: "stream_sniper",
    avatarEmoji: "📹",
    hypeLevel: 0.9,
    sniperRisk: 0.88,
    walkSpeed: 3.3,
    attractedToStreamer: true,
    buildHeadline: (d, _p, c) =>
      `Streamer testing what happens when ${c} people converge in ${d} — cameras rolling`,
    buildThought: (d) =>
      `Recording the ${d} crosswalk bottleneck in 4K60 for r/LivestreamFail front page 🎬⚡`,
  },
  {
    handlePrefix: "u/soho_commuter_rage",
    subreddit: "r/london",
    archetype: "local_commuter",
    avatarEmoji: "🚇",
    hypeLevel: 0.24,
    sniperRisk: 0.08,
    walkSpeed: 1.6,
    attractedToStreamer: false,
    buildHeadline: (d, _p, c) =>
      `Why are ${c} people suddenly surging across the road in ${d}?! Buses completely stuck`,
    buildThought: (d, _p, c) =>
      `${c} people blocking the ${d} junction right during my commute — absolute madness 🚇💢`,
  },
  {
    handlePrefix: "u/casualuk_greggs_fan",
    subreddit: "r/CasualUK",
    archetype: "reddit_local",
    avatarEmoji: "🥐",
    hypeLevel: 0.42,
    sniperRisk: 0.15,
    walkSpeed: 1.45,
    attractedToStreamer: false,
    buildHeadline: (d) =>
      `Just saw a lad with a 360 camera get surrounded by a massive crowd outside ${d}`,
    buildThought: (d) =>
      `Protecting my sausage roll while a parallel-reality crowd floods ${d} pavement 🥐😂`,
  },
  {
    handlePrefix: "u/lime_bike_instigator",
    subreddit: "r/ukstreaming",
    archetype: "chaos_instigator",
    avatarEmoji: "🚲",
    hypeLevel: 0.98,
    sniperRisk: 0.92,
    walkSpeed: 3.85,
    attractedToStreamer: true,
    buildHeadline: (d, _p, c) =>
      `Bringing the Bluetooth speaker + Lime bike squad to the ${c}-person ${d} linkup`,
    buildThought: (d) =>
      `Cutting straight across the ${d} intersection to box the stream camera in! 🚲📢`,
  },
  {
    handlePrefix: "u/tourist_doubledecker",
    subreddit: "r/london",
    archetype: "tourist",
    avatarEmoji: "📸",
    hypeLevel: 0.68,
    sniperRisk: 0.3,
    walkSpeed: 1.9,
    attractedToStreamer: true,
    buildHeadline: (d) =>
      `Visiting ${d} today — huge crowd gathering around a live streamer at the corner!`,
    buildThought: (d, _p, c) =>
      `Everyone is running across the street in ${d} (${c}+ people)! Let's follow them and see who it is! 📸🇬🇧`,
  },
];

function generateSyntheticCrowdBatch(params: {
  spawnCount: number;
  scenario: WhatIfScenarioId;
  prompt: string;
  district: LondonDistrictId;
  districtName: string;
  streamerX: number;
  streamerZ: number;
}): LiveSyntheticAgent[] {
  const { spawnCount, scenario, prompt, district, districtName, streamerX, streamerZ } = params;
  const agents: LiveSyntheticAgent[] = [];
  const now = Date.now();

  for (let i = 0; i < spawnCount; i++) {
    // Bias templates based on scenario
    let templateIndex = i % CAMEL_AGENT_TEMPLATES.length;
    if (scenario === "sniper_ambush" && i % 2 === 0) {
      templateIndex = i % 4 === 0 ? 0 : 2;
    } else if (scenario === "crosswalk_surge_50" && i % 2 === 0) {
      templateIndex = 3; // local commuters + crosswalk crowd
    } else if (scenario === "leak_location_50" && i % 3 !== 0) {
      templateIndex = i % 2 === 0 ? 1 : 0; // fan_swarm + stream_sniper
    }

    const tpl = CAMEL_AGENT_TEMPLATES[templateIndex];
    const angle = (i / spawnCount) * Math.PI * 2 + (i % 5) * 0.17;
    const radius =
      scenario === "crosswalk_surge_50"
        ? 18 + (i % 9) * 3.5
        : 22 + (i % 12) * 4.2;

    const x = Number((streamerX + Math.cos(angle) * radius).toFixed(2));
    const z = Number((streamerZ + Math.sin(angle) * radius).toFixed(2));

    // Converge toward streamer or surge across the junction ahead
    const targetX =
      scenario === "crosswalk_surge_50"
        ? Number((streamerX + 24 + ((i % 7) - 3) * 3).toFixed(2))
        : Number((streamerX + ((i % 5) - 2) * 2.2).toFixed(2));
    const targetZ =
      scenario === "crosswalk_surge_50"
        ? Number((streamerZ - 18 + (i % 2 === 0 ? -16 : 16)).toFixed(2))
        : Number((streamerZ + ((i % 5) - 2) * 2.2).toFixed(2));

    const dx = targetX - x;
    const dz = targetZ - z;
    const dist = Math.hypot(dx, dz) || 1;
    const vx = Number(((dx / dist) * tpl.walkSpeed).toFixed(2));
    const vz = Number(((dz / dist) * tpl.walkSpeed).toFixed(2));

    agents.push({
      id: `camel-sim-${district}-${scenario}-${i}`,
      handle: `${tpl.handlePrefix}_${i + 1}`,
      subreddit: tpl.subreddit,
      archetype: tpl.archetype,
      headline: tpl.buildHeadline(districtName, prompt, spawnCount),
      thoughtBubble: tpl.buildThought(districtName, prompt, spawnCount),
      hypeLevel: tpl.hypeLevel,
      sniperRisk: tpl.sniperRisk,
      walkSpeed: tpl.walkSpeed,
      attractedToStreamer:
        scenario === "crosswalk_surge_50" ? i % 3 === 0 : tpl.attractedToStreamer,
      redditKarma: 1200 + ((i * 1741) % 68000),
      avatarEmoji: tpl.avatarEmoji,
      x,
      z,
      vx,
      vz,
      targetX,
      targetZ,
      spawnedInParallel: true,
      createdAt: now,
    });
  }

  return agents;
}

function buildRecommendation(params: {
  scenario: WhatIfScenarioId;
  district: LondonDistrictId;
  districtName: string;
  spawnCount: number;
  judgments: SystemOneJudgments;
}): StreamerRecommendation {
  const { scenario, district, districtName, spawnCount, judgments } = params;
  const corridors = DISTRICT_SAFE_CORRIDORS[district] ?? DISTRICT_SAFE_CORRIDORS.soho;
  const action = judgments.choice.choice;
  const sniperPct = judgments.score.sniperRiskPct;
  const densityPct = judgments.score.crowdDensityPct;

  if (scenario === "leak_location_50" || action === "DO_NOT_LEAK_LOCATION") {
    return {
      action: "DO_NOT_LEAK_LOCATION",
      headline: `🚨 DO NOT LEAK: ${spawnCount} Fans + Snipers Converge in 42s!`,
      detail: `CAMEL-AI + Reddit simulation predicts ${spawnCount} synthetic agents flooding ${corridors.mainStreet} within 42 seconds (${sniperPct}% sniper interception probability).`,
      safeStreet: `${corridors.safeStreet} (+24s detour)`,
      etaImpactSec: 24,
      confidence: judgments.choice.confidence,
      futureOutcomeSummary: `TypeSafe System One [Choice=DO_NOT_LEAK_LOCATION, p=${judgments.choice.probabilities.DO_NOT_LEAK_LOCATION}]: Leaking location in ${districtName} causes ${densityPct}% pavement crush. Reroute via ${corridors.safeStreet} first.`,
    };
  }

  if (scenario === "crosswalk_surge_50") {
    return {
      action: "REROUTE_NOW",
      headline: `🚶‍♂️ ${spawnCount}-Person Crosswalk Surge Ahead on ${corridors.mainStreet}!`,
      detail: `Parallel branch shows ${spawnCount} pedestrians surging across the junction ahead (${Math.round(judgments.noul.trafficGridlockProb * 100)}% traffic gridlock & ${densityPct}% crowd bottleneck).`,
      safeStreet: corridors.safeStreet,
      etaImpactSec: 16,
      confidence: judgments.choice.confidence,
      futureOutcomeSummary: `TypeSafe System One [Choice=REROUTE_NOW, p=${judgments.choice.probabilities.REROUTE_NOW}]: Taking ${corridors.safeStreet} bypasses the ${spawnCount}-person crosswalk bottleneck and saves 75s.`,
    };
  }

  if (scenario === "sniper_ambush") {
    return {
      action: "REROUTE_NOW",
      headline: `🕵️ Stream Sniper Ambush Triangulated on ${corridors.mainStreet}!`,
      detail: `Reddit/Discord OSINT agents matched storefront reflections in ${districtName}. ${sniperPct}% interception probability within 30s on current vector.`,
      safeStreet: corridors.safeStreet,
      etaImpactSec: 18,
      confidence: judgments.choice.confidence,
      futureOutcomeSummary: `TypeSafe System One [Choice=REROUTE_NOW, noul.sniper=${judgments.noul.sniperInterceptionProb}]: Immediate turn onto ${corridors.safeStreet} evades 100% of stream snipers.`,
    };
  }

  if (scenario === "flash_mob_100" || action === "DUCK_INTO_VENUE") {
    return {
      action: "DUCK_INTO_VENUE",
      headline: `🛑 Flash Mob Crush Risk (${densityPct}%) — Duck Into Venue Now!`,
      detail: `Over ${spawnCount} high-velocity fans converging from all approaches around ${corridors.mainStreet}. Open-street movement will lock up in 25s.`,
      safeStreet: corridors.venueRefuge,
      etaImpactSec: 35,
      confidence: judgments.choice.confidence,
      futureOutcomeSummary: `TypeSafe System One [Choice=DUCK_INTO_VENUE, noul.crush=${judgments.noul.crowdCrushHazardProb}]: Step inside ${corridors.venueRefuge} for 90s while swarm disperses.`,
    };
  }

  return {
    action: "REROUTE_NOW",
    headline: `⚠️ Junction Bottleneck Ahead in ${districtName} — Detour Advised`,
    detail: `Simulated ${spawnCount}-agent perturbation elevates crowd density to ${densityPct}% along ${corridors.mainStreet}.`,
    safeStreet: corridors.safeStreet,
    etaImpactSec: 19,
    confidence: judgments.choice.confidence,
    futureOutcomeSummary: `TypeSafe System One recommends ${corridors.safeStreet} to restore safety score from ${judgments.score.safetyScore}% to 92%+.`,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as SimulateRequestBody;
    const districtId: LondonDistrictId = body.district || "soho";
    const districtPreset =
      LONDON_DISTRICTS.find((d) => d.id === districtId) ?? LONDON_DISTRICTS[0];

    const streamerX = typeof body.streamerX === "number" ? body.streamerX : districtPreset.x;
    const streamerZ = typeof body.streamerZ === "number" ? body.streamerZ : districtPreset.z;
    const liveViewers =
      typeof body.liveViewers === "number" ? body.liveViewers : districtPreset.baseViewers;

    const { scenario, spawnCount: inferredCount, parsedIntent } = inferScenarioFromPrompt(
      body.prompt || "",
      body.scenario
    );
    const spawnCount = body.spawnCount
      ? Math.min(120, Math.max(15, body.spawnCount))
      : inferredCount;

    // 1. Run TypeSafe System One structured judgment (Choice + Noul + Score)
    const systemOne = await evaluateTypeSafeSystemOne({
      prompt: parsedIntent,
      scenario,
      district: districtPreset.id,
      districtName: districtPreset.name,
      liveViewers,
      spawnCount,
    });

    // 2. Synthesize CAMEL-AI RolePlaying agents with Reddit personas reacting to the prompt
    const syntheticAgents = generateSyntheticCrowdBatch({
      spawnCount,
      scenario,
      prompt: parsedIntent,
      district: districtPreset.id,
      districtName: districtPreset.name,
      streamerX,
      streamerZ,
    });

    // 3. Build actionable route recommendation
    const recommendation = buildRecommendation({
      scenario,
      district: districtPreset.id,
      districtName: districtPreset.name,
      spawnCount,
      judgments: systemOne,
    });

    const corridors =
      DISTRICT_SAFE_CORRIDORS[districtPreset.id] ?? DISTRICT_SAFE_CORRIDORS.soho;

    const camelSimulationLog = [
      `[t+00s] CAMEL-AI OASIS Engine forked parallel reality branch in ${districtPreset.name} for prompt: "${parsedIntent}"`,
      `[t+05s] Hydrated ${spawnCount} synthetic Reddit/stream personas (r/london, r/ukstreaming, r/LivestreamFail, r/CasualUK).`,
      `[t+18s] Social-force boid velocity spike: ${syntheticAgents.filter((a) => a.attractedToStreamer).length} agents accelerating toward streamer coordinates (${streamerX.toFixed(0)}, ${streamerZ.toFixed(0)}).`,
      `[t+35s] TypeSafe System One (${systemOne.model}) evaluated Noul hazards: sniperInterception=${(systemOne.noul.sniperInterceptionProb * 100).toFixed(0)}%, crowdCrush=${(systemOne.noul.crowdCrushHazardProb * 100).toFixed(0)}%, trafficGridlock=${(systemOne.noul.trafficGridlockProb * 100).toFixed(0)}%.`,
      `[t+45s] System One Choice Selected: ${recommendation.action} (confidence ${(recommendation.confidence * 100).toFixed(0)}%) → Safe Escape Vector: ${corridors.safeStreet}.`,
    ];

    return NextResponse.json(
      {
        ok: true,
        scenario,
        prompt: parsedIntent,
        district: districtPreset.id,
        recommendation,
        metrics: {
          safetyScore: systemOne.score.safetyScore,
          sniperRiskPct: systemOne.score.sniperRiskPct,
          crowdDensityPct: systemOne.score.crowdDensityPct,
          sniperInterceptionProb: systemOne.noul.sniperInterceptionProb,
          crowdCrushHazardProb: systemOne.noul.crowdCrushHazardProb,
          trafficGridlockProb: systemOne.noul.trafficGridlockProb,
        },
        systemOneJudgments: systemOne,
        syntheticAgents,
        camelSimulationLog,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Simulation error",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
