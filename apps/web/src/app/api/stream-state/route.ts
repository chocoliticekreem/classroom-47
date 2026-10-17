import { NextRequest, NextResponse } from "next/server";
import {
  LONDON_DISTRICTS,
  type LondonDistrictId,
  type RealityMode,
  type StreamerRecommendation,
  type WhatIfScenarioId,
} from "@/world/streamerContract";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Streamer-Platform",
};

export interface StreamPlatformTelemetry {
  streamerHandle: string;
  realityMode: RealityMode;
  activeScenario: WhatIfScenarioId | null;
  district: LondonDistrictId;
  districtName: string;
  streamerX: number;
  streamerZ: number;
  streamerHeading: number;
  destX: number;
  destZ: number;
  liveViewers: number;
  chatVelocityMsgsPerMin: number;
  locationLeaked: boolean;
  usingSafeRoute: boolean;
  safetyScore: number;
  sniperRiskPct: number;
  crowdDensityPct: number;
  nearbySyntheticCount: number;
  nearbySniperCount: number;
  latestChatSamples: string[];
  recommendation: StreamerRecommendation;
  updatedAt: string;
}

// Server-side shared telemetry state bridged with external streaming platform
let currentStreamTelemetry: StreamPlatformTelemetry = {
  streamerHandle: "@ishowspeed_ldn",
  realityMode: "live",
  activeScenario: null,
  district: "soho",
  districtName: "Soho & Oxford Circus",
  streamerX: 0,
  streamerZ: 0,
  streamerHeading: 0,
  destX: 80,
  destZ: -80,
  liveViewers: 54200,
  chatVelocityMsgsPerMin: 420,
  locationLeaked: false,
  usingSafeRoute: false,
  safetyScore: 88,
  sniperRiskPct: 14,
  crowdDensityPct: 26,
  nearbySyntheticCount: 32,
  nearbySniperCount: 1,
  latestChatSamples: [
    "W STREAM IN SOHO 🔥🔥",
    "WAIT IS THAT WARDOUR STREET?!",
    "DO NOT LEAK LOCATION BRO SNIPERS ARE OUT",
    "TURN LEFT AT SOHO SQUARE!!",
  ],
  recommendation: {
    action: "HOLD_ROUTE",
    headline: "Route Clear through Soho Square",
    detail:
      "Pedestrian flow normal (18 peds/min). 1 passive stream watcher spotted 95m east on Wardour St.",
    safeStreet: "Brewer St → Soho Sq Corridor",
    etaImpactSec: 0,
    confidence: 0.92,
    futureOutcomeSummary:
      "Live trajectory holds 88% safety margin over the next 3 minutes.",
  },
  updatedAt: new Date().toISOString(),
};

function recomputeRecommendationFromTelemetry(
  state: StreamPlatformTelemetry
): StreamerRecommendation {
  if (state.usingSafeRoute) {
    return {
      action: "HOLD_ROUTE",
      headline: "Safe Detour Locked In ✨",
      detail:
        "Bypassing high-density swarm zone via quiet side street corridor. Stream snipers misdirected.",
      safeStreet: "Quiet Side-Alley Detour Active",
      etaImpactSec: 24,
      confidence: 0.95,
      futureOutcomeSummary:
        "Parallel simulation confirms 94% avoidance of crowd bottleneck.",
    };
  }

  if (state.locationLeaked || state.sniperRiskPct >= 75) {
    return {
      action: "DO_NOT_LEAK_LOCATION",
      headline: "🚨 LOCATION LEAK DETECTED: 50+ Chat Swarm Converging!",
      detail: `Chat velocity spiked to ${state.chatVelocityMsgsPerMin} msgs/min in ${state.districtName}. CAMEL-AI predicts stream-sniper encirclement within 42s.`,
      safeStreet: `Take Quiet Side Mews off ${state.districtName} (+24s)`,
      etaImpactSec: 24,
      confidence: 0.94,
      futureOutcomeSummary:
        "High interception risk on primary route; immediately switch to safe detour.",
    };
  }

  if (state.crowdDensityPct >= 70) {
    return {
      action: "REROUTE_NOW",
      headline: `🚶‍♂️ High Crowd Density (${state.crowdDensityPct}%) Ahead in ${state.districtName}`,
      detail:
        "Pedestrian surge detected at next crosswalk junction. Rerouting prevents 90s of gridlock.",
      safeStreet: "Parallel Backstreet Bypass",
      etaImpactSec: 16,
      confidence: 0.89,
      futureOutcomeSummary:
        "Taking the green detour route restores safety score above 90%.",
    };
  }

  return state.recommendation;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      engine: "NUMA London Parallel Reality & Situational Awareness Engine",
      state: currentStreamTelemetry,
      endpoints: {
        pushTelemetry: "POST /api/stream-state",
        runParallelWhatIf: "POST /api/simulate",
        fetchRedditPersonas: "GET /api/reddit-personas?district=soho&limit=25",
      },
    },
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  try {
    const patch = await req.json().catch(() => ({}));

    // Resolve district preset if district changed
    let districtPreset = LONDON_DISTRICTS.find(
      (d) => d.id === (patch.district ?? currentStreamTelemetry.district)
    );
    if (!districtPreset) {
      districtPreset = LONDON_DISTRICTS[0];
    }

    const locationLeaked =
      typeof patch.locationLeaked === "boolean"
        ? patch.locationLeaked
        : currentStreamTelemetry.locationLeaked;

    const chatVelocityMsgsPerMin =
      typeof patch.chatVelocityMsgsPerMin === "number"
        ? patch.chatVelocityMsgsPerMin
        : typeof patch.chatVelocity === "number"
          ? patch.chatVelocity
          : locationLeaked
            ? 1450
            : currentStreamTelemetry.chatVelocityMsgsPerMin;

    const sniperRiskPct =
      typeof patch.sniperRiskPct === "number"
        ? patch.sniperRiskPct
        : locationLeaked
          ? 86
          : currentStreamTelemetry.sniperRiskPct;

    const crowdDensityPct =
      typeof patch.crowdDensityPct === "number"
        ? patch.crowdDensityPct
        : locationLeaked
          ? 92
          : currentStreamTelemetry.crowdDensityPct;

    const safetyScore =
      typeof patch.safetyScore === "number"
        ? patch.safetyScore
        : locationLeaked
          ? 24
          : Math.max(
              12,
              Math.min(98, Math.round(100 - sniperRiskPct * 0.55 - crowdDensityPct * 0.3))
            );

    currentStreamTelemetry = {
      ...currentStreamTelemetry,
      streamerHandle: patch.streamerHandle ?? currentStreamTelemetry.streamerHandle,
      realityMode:
        patch.realityMode ?? (locationLeaked ? "parallel" : currentStreamTelemetry.realityMode),
      activeScenario:
        patch.activeScenario !== undefined
          ? patch.activeScenario
          : locationLeaked
            ? "leak_location_50"
            : currentStreamTelemetry.activeScenario,
      district: districtPreset.id,
      districtName: districtPreset.name,
      streamerX:
        typeof patch.streamerX === "number"
          ? patch.streamerX
          : typeof patch.x === "number"
            ? patch.x
            : currentStreamTelemetry.streamerX,
      streamerZ:
        typeof patch.streamerZ === "number"
          ? patch.streamerZ
          : typeof patch.z === "number"
            ? patch.z
            : currentStreamTelemetry.streamerZ,
      streamerHeading:
        typeof patch.streamerHeading === "number"
          ? patch.streamerHeading
          : currentStreamTelemetry.streamerHeading,
      destX:
        typeof patch.destX === "number" ? patch.destX : currentStreamTelemetry.destX,
      destZ:
        typeof patch.destZ === "number" ? patch.destZ : currentStreamTelemetry.destZ,
      liveViewers:
        typeof patch.liveViewers === "number"
          ? patch.liveViewers
          : currentStreamTelemetry.liveViewers,
      chatVelocityMsgsPerMin,
      locationLeaked,
      usingSafeRoute:
        typeof patch.usingSafeRoute === "boolean"
          ? patch.usingSafeRoute
          : currentStreamTelemetry.usingSafeRoute,
      safetyScore,
      sniperRiskPct,
      crowdDensityPct,
      nearbySyntheticCount:
        typeof patch.nearbySyntheticCount === "number"
          ? patch.nearbySyntheticCount
          : locationLeaked
            ? 82
            : currentStreamTelemetry.nearbySyntheticCount,
      nearbySniperCount:
        typeof patch.nearbySniperCount === "number"
          ? patch.nearbySniperCount
          : locationLeaked
            ? 7
            : currentStreamTelemetry.nearbySniperCount,
      latestChatSamples: Array.isArray(patch.latestChatSamples)
        ? patch.latestChatSamples.slice(0, 10)
        : currentStreamTelemetry.latestChatSamples,
      updatedAt: new Date().toISOString(),
    };

    currentStreamTelemetry.recommendation =
      patch.recommendation ?? recomputeRecommendationFromTelemetry(currentStreamTelemetry);

    return NextResponse.json(
      {
        ok: true,
        state: currentStreamTelemetry,
        recommendation: currentStreamTelemetry.recommendation,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid stream-state payload",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
