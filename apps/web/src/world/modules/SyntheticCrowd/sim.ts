// Pure TypeScript social-force & parallel-reality crowd simulation engine.
// Zero Three.js allocations inside the tick loop; deterministic and unit-tested with vitest.

import { mulberry32, spawnPersonaBatch } from "../../personas";
import type {
  LiveSyntheticAgent,
  RealityMode,
  SyntheticArchetype,
} from "../../streamerContract";

export const MAX_SYNTHETIC_AGENTS = 240;
export const BASELINE_AGENT_COUNT = 80;
export const STREAMER_PROXIMITY_RADIUS = 85; // metres for situational awareness metrics

export interface SyntheticCrowdMetrics {
  nearbySyntheticCount: number;
  nearbySniperCount: number;
  crowdDensityPct: number; // 0..100
  sniperRiskPct: number; // 0..100
  safetyScore: number; // 0..100
}

export interface SyntheticCrowdSimState {
  agents: LiveSyntheticAgent[];
  seed: number;
  tickCount: number;
  elapsedSimSec: number;
  nextSpawnIndex: number;
  metrics: SyntheticCrowdMetrics;
}

/** Trim agent pool to MAX_SYNTHETIC_AGENTS while preserving newly spawned parallel agents. */
function enforcePoolCap(state: SyntheticCrowdSimState, newlyAdded: LiveSyntheticAgent[]) {
  const combined = [...state.agents, ...newlyAdded];
  if (combined.length <= MAX_SYNTHETIC_AGENTS) {
    state.agents = combined;
    return;
  }
  const excess = combined.length - MAX_SYNTHETIC_AGENTS;
  // Prefer evicting oldest baseline (non-parallel) commuters/tourists first so scenario spawns stay intact.
  const kept: LiveSyntheticAgent[] = [];
  let dropped = 0;
  for (const agent of combined) {
    if (dropped < excess && !agent.spawnedInParallel) {
      dropped++;
      continue;
    }
    kept.push(agent);
  }
  state.agents = kept.slice(-MAX_SYNTHETIC_AGENTS);
}

/** Compute live situational awareness metrics within STREAMER_PROXIMITY_RADIUS (85m) of the streamer. */
export function computeCrowdMetrics(
  agents: readonly LiveSyntheticAgent[],
  streamerX: number,
  streamerZ: number,
  realityMode: RealityMode = "live",
): SyntheticCrowdMetrics {
  const r2 = STREAMER_PROXIMITY_RADIUS * STREAMER_PROXIMITY_RADIUS;
  let nearbySyntheticCount = 0;
  let nearbySniperCount = 0;
  let weightedCrowdLoad = 0;
  let weightedSniperThreat = 0;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    const dx = a.x - streamerX;
    const dz = a.z - streamerZ;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2) {
      nearbySyntheticCount++;
      const dist = Math.sqrt(d2);
      // Closer agents contribute higher density & interception pressure
      const proximityFactor = 1 + Math.max(0, (STREAMER_PROXIMITY_RADIUS - dist) / STREAMER_PROXIMITY_RADIUS) * 0.85;
      weightedCrowdLoad += proximityFactor;

      if (a.archetype === "stream_sniper") {
        nearbySniperCount++;
        weightedSniperThreat += 11 * proximityFactor * (0.55 + a.sniperRisk * 0.45);
      } else if (a.spawnedInParallel && a.attractedToStreamer) {
        weightedSniperThreat += 1.6 * a.sniperRisk * proximityFactor;
      } else if (a.attractedToStreamer) {
        weightedSniperThreat += 0.45 * a.sniperRisk * proximityFactor;
      }
    }
  }

  // Normalize so ~45-55 baseline pedestrians in 85m = ~28% density, while +50-100 surge = 78-96%
  const crowdDensityPct = Math.max(
    5,
    Math.min(100, Math.round((weightedCrowdLoad / 210) * 100)),
  );

  const baseSniper = realityMode === "parallel" ? 12 : 4;
  const sniperRiskPct = Math.max(
    4,
    Math.min(100, Math.round(baseSniper + weightedSniperThreat)),
  );

  const rawSafety = 100 - (crowdDensityPct * 0.38 + sniperRiskPct * 0.48);
  const safetyScore = Math.max(5, Math.min(98, Math.round(rawSafety)));

  return {
    nearbySyntheticCount,
    nearbySniperCount,
    crowdDensityPct,
    sniperRiskPct,
    safetyScore,
  };
}

/** Populate ~80 baseline London pedestrians around `(streamerX, streamerZ)`. */
export function resetToBaselineCrowd(
  state: SyntheticCrowdSimState,
  streamerX = 0,
  streamerZ = 0,
): LiveSyntheticAgent[] {
  const rng = mulberry32(state.seed + 101);
  const specs = spawnPersonaBatch(BASELINE_AGENT_COUNT, state.seed + 101);
  const baselineArchetypes: SyntheticArchetype[] = [
    "local_commuter",
    "local_commuter",
    "reddit_local",
    "tourist",
    "reddit_local",
    "local_commuter",
    "fan_swarm",
    "tourist",
  ];

  const agents: LiveSyntheticAgent[] = [];
  for (let i = 0; i < BASELINE_AGENT_COUNT; i++) {
    const baseSpec = specs[i]!;
    // Keep only 1 passive sniper in baseline so live mode feels calm & authentic
    const arch: SyntheticArchetype =
      i === 0
        ? "stream_sniper"
        : baselineArchetypes[i % baselineArchetypes.length]!;

    const angle = rng() * Math.PI * 2;
    const radius = 22 + rng() * 125;
    const x = streamerX + Math.cos(angle) * radius;
    const z = streamerZ + Math.sin(angle) * radius;

    const targetAngle = angle + (rng() - 0.5) * 2.2;
    const targetRadius = 25 + rng() * 110;
    const targetX = streamerX + Math.cos(targetAngle) * targetRadius;
    const targetZ = streamerZ + Math.sin(targetAngle) * targetRadius;

    const attracted = arch === "fan_swarm" || arch === "stream_sniper";
    const walkSpeed =
      arch === "stream_sniper"
        ? 2.2
        : arch === "fan_swarm"
          ? 2.0
          : 1.25 + rng() * 0.65;

    agents.push({
      ...baseSpec,
      id: `live-ped-${state.seed}-${i}`,
      archetype: arch,
      attractedToStreamer: attracted,
      sniperRisk: arch === "stream_sniper" ? 0.85 : arch === "fan_swarm" ? 0.35 : 0.05,
      hypeLevel: arch === "fan_swarm" || arch === "stream_sniper" ? 0.72 : 0.25 + rng() * 0.3,
      walkSpeed: Number(walkSpeed.toFixed(2)),
      x,
      z,
      vx: 0,
      vz: 0,
      targetX,
      targetZ,
      spawnedInParallel: false,
      createdAt: 0,
    });
  }

  state.agents = agents;
  state.tickCount = 0;
  state.elapsedSimSec = 0;
  state.nextSpawnIndex = BASELINE_AGENT_COUNT;
  state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, "live");
  return state.agents;
}

/** Initialize a fresh simulation state with ~80 baseline London pedestrians. */
export function createSyntheticCrowdState(
  streamerX = 0,
  streamerZ = 0,
  seed = 42,
): SyntheticCrowdSimState {
  const state: SyntheticCrowdSimState = {
    agents: [],
    seed,
    tickCount: 0,
    elapsedSimSec: 0,
    nextSpawnIndex: 0,
    metrics: {
      nearbySyntheticCount: 0,
      nearbySniperCount: 0,
      crowdDensityPct: 24,
      sniperRiskPct: 12,
      safetyScore: 88,
    },
  };
  resetToBaselineCrowd(state, streamerX, streamerZ);
  return state;
}

/**
 * Spawns `count` (default 50) synthetic people crossing the street directly ahead of the streamer
 * (`streamerX + 36`, moving across Z from `-28` to `+28` relative to `streamerZ` and vice versa)
 * to simulate: "add 50 people walking across the street".
 */
export function spawnCrosswalkSurge(
  state: SyntheticCrowdSimState,
  streamerX: number,
  streamerZ: number,
  count = 50,
  options?: { archetype?: SyntheticArchetype; subreddit?: string },
): LiveSyntheticAgent[] {
  const callSeed = state.seed + state.nextSpawnIndex * 31 + 701;
  const rng = mulberry32(callSeed);
  const specs = spawnPersonaBatch(count, callSeed, options);
  const crosswalkX = streamerX + 36;
  const spawned: LiveSyntheticAgent[] = [];

  for (let i = 0; i < count; i++) {
    const spec = specs[i]!;
    const idx = state.nextSpawnIndex++;
    // Stratified lanes across the crosswalk so all 50 pedestrians march across Z without initial overlap
    const southBound = i % 2 === 0;
    const col = i % 5; // 5 lanes across X (-4m .. +4m)
    const row = Math.floor(i / 5); // 10 rows along Z
    const laneOffsetX = (col - 2) * 1.9 + (rng() - 0.5) * 0.35;
    const rowOffsetZ = row * 2.1 + rng() * 0.4;
    const startZRel = southBound ? -26 + rowOffsetZ : 26 - rowOffsetZ;
    const endZRel = southBound ? 28 : -28;

    const x = crosswalkX + laneOffsetX;
    const z = streamerZ + startZRel;
    const targetX = crosswalkX + (rng() - 0.5) * 6;
    const targetZ = streamerZ + endZRel;

    const walkSpeed = Math.max(1.55, Math.min(2.6, 1.65 + rng() * 0.8));
    const dirZ = southBound ? 1 : -1;

    spawned.push({
      ...spec,
      id: `surge-crosswalk-${idx}`,
      archetype: options?.archetype ?? (i % 5 === 0 ? "reddit_local" : i % 3 === 0 ? "tourist" : "local_commuter"),
      thoughtBubble:
        i % 3 === 0
          ? "Green man at Oxford Circus crossing—all 50 of us surging across the junction now! 🚶‍♂️🚦"
          : spec.thoughtBubble,
      attractedToStreamer: false,
      walkSpeed: Number(walkSpeed.toFixed(2)),
      x,
      z,
      vx: 0,
      vz: dirZ * walkSpeed,
      targetX,
      targetZ,
      spawnedInParallel: true,
      createdAt: state.elapsedSimSec,
    });
  }

  enforcePoolCap(state, spawned);
  state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, "parallel");
  return spawned;
}

/**
 * Spawns `count` (default 50) excited fans + stream snipers in a ring (radius 45m–110m)
 * around `(streamerX, streamerZ)` who sprint (`walkSpeed: 3.2..4.8`) directly toward the streamer:
 * "if I tell my chat right now where I'm at, maybe 50 people will come to that location".
 */
export function spawnChatLocationLeakSwarm(
  state: SyntheticCrowdSimState,
  streamerX: number,
  streamerZ: number,
  count = 50,
  options?: { archetype?: SyntheticArchetype; subreddit?: string },
): LiveSyntheticAgent[] {
  const callSeed = state.seed + state.nextSpawnIndex * 37 + 1307;
  const rng = mulberry32(callSeed);
  const specs = spawnPersonaBatch(count, callSeed, options);
  const spawned: LiveSyntheticAgent[] = [];

  for (let i = 0; i < count; i++) {
    const spec = specs[i]!;
    const idx = state.nextSpawnIndex++;
    // Golden-angle spiral + jitter in a 45m..110m ring around the streamer
    const angle = i * ((Math.PI * 2) / Math.max(1, count)) + (rng() - 0.5) * 0.25;
    const radius = 45 + rng() * 65; // strictly within [45, 110]
    const x = streamerX + Math.cos(angle) * radius;
    const z = streamerZ + Math.sin(angle) * radius;

    const isSniper = options?.archetype
      ? options.archetype === "stream_sniper"
      : i % 6 === 0;
    const isChaos = !options?.archetype && !isSniper && i % 7 === 0;
    const archetype: SyntheticArchetype =
      options?.archetype ?? (isSniper ? "stream_sniper" : isChaos ? "chaos_instigator" : "fan_swarm");

    const walkSpeed = Number((3.2 + rng() * 1.6).toFixed(2)); // 3.2..4.8 m/s sprint
    const dx = streamerX - x;
    const dz = streamerZ - z;
    const dist = Math.hypot(dx, dz) || 1;

    spawned.push({
      ...spec,
      id: `leak-swarm-${idx}`,
      archetype,
      hypeLevel: Number((0.86 + rng() * 0.14).toFixed(2)),
      sniperRisk: isSniper
        ? Number((0.9 + rng() * 0.09).toFixed(2))
        : Number((0.55 + rng() * 0.3).toFixed(2)),
      walkSpeed,
      attractedToStreamer: true,
      x,
      z,
      vx: (dx / dist) * walkSpeed,
      vz: (dz / dist) * walkSpeed,
      targetX: streamerX,
      targetZ: streamerZ,
      spawnedInParallel: true,
      createdAt: state.elapsedSimSec,
    });
  }

  enforcePoolCap(state, spawned);
  state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, "parallel");
  return spawned;
}

/**
 * Spawns `count` (default 12) high-risk stream snipers (`archetype: "stream_sniper"`, `sniperRisk: 0.9+`)
 * converging on the streamer's forward path.
 */
export function spawnSniperSquad(
  state: SyntheticCrowdSimState,
  streamerX: number,
  streamerZ: number,
  count = 12,
): LiveSyntheticAgent[] {
  const callSeed = state.seed + state.nextSpawnIndex * 43 + 2903;
  const rng = mulberry32(callSeed);
  const specs = spawnPersonaBatch(count, callSeed, { archetype: "stream_sniper" });
  const spawned: LiveSyntheticAgent[] = [];

  for (let i = 0; i < count; i++) {
    const spec = specs[i]!;
    const idx = state.nextSpawnIndex++;
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (rng() - 0.5) * 0.2;
    const radius = 32 + rng() * 48; // 32m..80m tactical encirclement ring
    const x = streamerX + 18 + Math.cos(angle) * radius;
    const z = streamerZ + Math.sin(angle) * radius;
    const walkSpeed = Number((4.0 + rng() * 0.8).toFixed(2));
    const sniperRisk = Number((0.91 + rng() * 0.08).toFixed(2)); // strictly >= 0.91

    const dx = streamerX - x;
    const dz = streamerZ - z;
    const dist = Math.hypot(dx, dz) || 1;

    spawned.push({
      ...spec,
      id: `sniper-squad-${idx}`,
      archetype: "stream_sniper",
      hypeLevel: Number((0.92 + rng() * 0.08).toFixed(2)),
      sniperRisk,
      walkSpeed,
      attractedToStreamer: true,
      x,
      z,
      vx: (dx / dist) * walkSpeed,
      vz: (dz / dist) * walkSpeed,
      targetX: streamerX,
      targetZ: streamerZ,
      spawnedInParallel: true,
      createdAt: state.elapsedSimSec,
    });
  }

  enforcePoolCap(state, spawned);
  state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, "parallel");
  return spawned;
}

/** Spawns a rubbernecking crowd around a junction incident ahead of the streamer (`streamerX + 40, streamerZ`). */
export function spawnJunctionRubberneckers(
  state: SyntheticCrowdSimState,
  junctionX: number,
  junctionZ: number,
  count = 40,
): LiveSyntheticAgent[] {
  const callSeed = state.seed + state.nextSpawnIndex * 53 + 4001;
  const rng = mulberry32(callSeed);
  const specs = spawnPersonaBatch(count, callSeed);
  const spawned: LiveSyntheticAgent[] = [];

  for (let i = 0; i < count; i++) {
    const spec = specs[i]!;
    const idx = state.nextSpawnIndex++;
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const radius = 14 + rng() * 38;
    const x = junctionX + Math.cos(angle) * radius;
    const z = junctionZ + Math.sin(angle) * radius;
    const walkSpeed = Number((1.8 + rng() * 1.1).toFixed(2));
    const arch: SyntheticArchetype =
      i % 4 === 0 ? "chaos_instigator" : i % 3 === 0 ? "reddit_local" : "tourist";

    spawned.push({
      ...spec,
      id: `junction-crowd-${idx}`,
      archetype: arch,
      thoughtBubble: "Junction blocked ahead!! Everyone's filming the pileup on r/london 🚨📱",
      attractedToStreamer: false,
      walkSpeed,
      x,
      z,
      vx: 0,
      vz: 0,
      targetX: junctionX + Math.cos(angle) * 6,
      targetZ: junctionZ + Math.sin(angle) * 6,
      spawnedInParallel: true,
      createdAt: state.elapsedSimSec,
    });
  }

  enforcePoolCap(state, spawned);
  return spawned;
}

/**
 * Advances the synthetic crowd simulation by `dt` seconds (scaled by `simSpeed`).
 * Pure TypeScript, zero object allocations in the inner force loop.
 */
export function stepSyntheticCrowd(
  state: SyntheticCrowdSimState,
  dt: number,
  streamerX: number,
  streamerZ: number,
  realityMode: RealityMode = "live",
  simSpeed = 1,
): SyntheticCrowdMetrics {
  const clampedDt = Math.min(Math.max(dt, 0), 0.05) * Math.max(0.1, simSpeed);
  if (clampedDt <= 0) {
    state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, realityMode);
    return state.metrics;
  }

  const agents = state.agents;
  const n = agents.length;
  const minSep = 1.65; // metres personal space radius
  const minSepSq = minSep * minSep;

  for (let i = 0; i < n; i++) {
    const a = agents[i]!;

    // 1. Goal / attraction vector
    let goalX = a.targetX;
    let goalZ = a.targetZ;
    if (a.attractedToStreamer) {
      goalX = streamerX;
      goalZ = streamerZ;
      a.targetX = streamerX;
      a.targetZ = streamerZ;
    }

    const toGoalX = goalX - a.x;
    const toGoalZ = goalZ - a.z;
    const distToGoal = Math.hypot(toGoalX, toGoalZ);

    let desiredVx = 0;
    let desiredVz = 0;

    if (a.attractedToStreamer) {
      // Orbit/surround at ~2.6m personal ring around streamer instead of collapsing to 0m
      if (distToGoal > 2.6) {
        const speedBoost = realityMode === "parallel" ? 1.12 : 1.0;
        const speed = a.walkSpeed * speedBoost;
        desiredVx = (toGoalX / distToGoal) * speed;
        desiredVz = (toGoalZ / distToGoal) * speed;
      } else if (distToGoal > 0.01) {
        // Gentle tangential swirl when right next to streamer
        desiredVx = (-toGoalZ / distToGoal) * 0.65;
        desiredVz = (toGoalX / distToGoal) * 0.65;
      }
    } else {
      // Crosswalk surge / commuter waypoint navigation
      if (distToGoal > 1.8) {
        desiredVx = (toGoalX / distToGoal) * a.walkSpeed;
        desiredVz = (toGoalZ / distToGoal) * a.walkSpeed;
      } else {
        // Flip patrol/crosswalk target across the street so crosswalk & sidewalk flow stays continuous
        const dxFromStreamer = a.x - streamerX;
        const dzFromStreamer = a.z - streamerZ;
        a.targetX = streamerX + dxFromStreamer;
        a.targetZ = streamerZ - dzFromStreamer;
        const flipX = a.targetX - a.x;
        const flipZ = a.targetZ - a.z;
        const flipD = Math.hypot(flipX, flipZ) || 1;
        desiredVx = (flipX / flipD) * a.walkSpeed;
        desiredVz = (flipZ / flipD) * a.walkSpeed;
      }
    }

    // 2. Social-force separation from nearby agents so agents never stack on the same point
    let sepX = 0;
    let sepZ = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = agents[j]!;
      const rx = a.x - b.x;
      const rz = a.z - b.z;
      const dSq = rx * rx + rz * rz;
      if (dSq < minSepSq) {
        if (dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          const push = ((minSep - d) / minSep) * 3.8;
          sepX += (rx / d) * push;
          sepZ += (rz / d) * push;
        } else {
          // Deterministic tie-breaker if two agents ever share exact coordinates
          const angle = ((i * 73 + j * 31) % 360) * (Math.PI / 180);
          sepX += Math.cos(angle) * 3.2;
          sepZ += Math.sin(angle) * 3.2;
        }
      }
    }

    const steerBlend = Math.min(1, clampedDt * 6.5);
    const targetVx = desiredVx + sepX;
    const targetVz = desiredVz + sepZ;
    a.vx = a.vx + (targetVx - a.vx) * steerBlend;
    a.vz = a.vz + (targetVz - a.vz) * steerBlend;

    // Clamp max velocity magnitude
    const vMag = Math.hypot(a.vx, a.vz);
    const maxV = a.walkSpeed * (realityMode === "parallel" ? 1.25 : 1.1);
    if (vMag > maxV && vMag > 0.001) {
      a.vx = (a.vx / vMag) * maxV;
      a.vz = (a.vz / vMag) * maxV;
    }

    a.x += a.vx * clampedDt;
    a.z += a.vz * clampedDt;
  }

  state.tickCount += 1;
  state.elapsedSimSec = Number((state.elapsedSimSec + clampedDt).toFixed(3));
  state.metrics = computeCrowdMetrics(state.agents, streamerX, streamerZ, realityMode);
  return state.metrics;
}
