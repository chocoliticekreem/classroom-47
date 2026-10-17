import { describe, expect, it } from "vitest";
import { LONDON_PERSONA_DATASET, spawnPersonaBatch } from "../../personas";
import {
  BASELINE_AGENT_COUNT,
  MAX_SYNTHETIC_AGENTS,
  createSyntheticCrowdState,
  resetToBaselineCrowd,
  spawnChatLocationLeakSwarm,
  spawnCrosswalkSurge,
  spawnSniperSquad,
  stepSyntheticCrowd,
} from "./sim";

describe("personas.ts — London & UK Streamer Reddit Persona Dataset", () => {
  it("exports at least 40 distinct London & UK streamer personas across all 6 archetypes", () => {
    expect(LONDON_PERSONA_DATASET.length).toBeGreaterThanOrEqual(40);
    const ids = new Set(LONDON_PERSONA_DATASET.map((p) => p.id));
    expect(ids.size).toBe(LONDON_PERSONA_DATASET.length);

    const archetypes = new Set(LONDON_PERSONA_DATASET.map((p) => p.archetype));
    expect(archetypes).toEqual(
      new Set([
        "fan_swarm",
        "stream_sniper",
        "reddit_local",
        "local_commuter",
        "tourist",
        "chaos_instigator",
      ]),
    );
  });

  it("spawns deterministic persona batches and filters by archetype/subreddit", () => {
    const batchA = spawnPersonaBatch(50, 1337, { archetype: "fan_swarm" });
    const batchB = spawnPersonaBatch(50, 1337, { archetype: "fan_swarm" });
    expect(batchA).toEqual(batchB);
    expect(batchA).toHaveLength(50);
    expect(batchA.every((p) => p.archetype === "fan_swarm")).toBe(true);

    const sohoBatch = spawnPersonaBatch(12, 99, { subreddit: "r/Soho" });
    expect(sohoBatch.every((p) => p.subreddit === "r/Soho")).toBe(true);
  });
});

describe("SyntheticCrowd/sim.ts — Parallel Reality Simulation Engine", () => {
  it("initializes 80 deterministic baseline pedestrians around the streamer", () => {
    const state1 = createSyntheticCrowdState(10, -20, 42);
    const state2 = createSyntheticCrowdState(10, -20, 42);

    expect(state1.agents).toHaveLength(BASELINE_AGENT_COUNT);
    expect(state1.agents).toEqual(state2.agents);
    expect(state1.metrics.safetyScore).toBeGreaterThan(50);
  });

  it("spawns +50 crosswalk surge ahead of the streamer (streamerX + 36, crossing Z -28..+28)", () => {
    const streamerX = 0;
    const streamerZ = 0;
    const state = createSyntheticCrowdState(streamerX, streamerZ, 42);

    const surged = spawnCrosswalkSurge(state, streamerX, streamerZ, 50);
    expect(surged).toHaveLength(50);
    expect(state.agents).toHaveLength(BASELINE_AGENT_COUNT + 50);

    for (const agent of surged) {
      // Positioned on the crosswalk corridor around streamerX + 36
      expect(agent.x).toBeGreaterThanOrEqual(streamerX + 36 - 5);
      expect(agent.x).toBeLessThanOrEqual(streamerX + 36 + 5);
      // Within Z [-28, +28] relative to streamerZ
      expect(agent.z).toBeGreaterThanOrEqual(streamerZ - 28);
      expect(agent.z).toBeLessThanOrEqual(streamerZ + 28);
      expect(Math.abs(agent.targetZ - streamerZ)).toBe(28);
      expect(agent.spawnedInParallel).toBe(true);
    }

    // Step forward and verify crosswalk pedestrians actively move across Z
    const initialZs = surged.map((a) => a.z);
    stepSyntheticCrowd(state, 0.05, streamerX, streamerZ, "parallel", 5);
    const movedCount = surged.filter((a, idx) => Math.abs(a.z - initialZs[idx]!) > 0.05).length;
    expect(movedCount).toBe(50);
  });

  it("spawns +50 chat location leak swarm in a 45m-110m ring that converges on the streamer", () => {
    const streamerX = 40;
    const streamerZ = -40;
    const state = createSyntheticCrowdState(streamerX, streamerZ, 100);

    const baselineSafety = state.metrics.safetyScore;
    const baselineDensity = state.metrics.crowdDensityPct;

    const swarm = spawnChatLocationLeakSwarm(state, streamerX, streamerZ, 50);
    expect(swarm).toHaveLength(50);

    const initialMeanDist =
      swarm.reduce((acc, a) => acc + Math.hypot(a.x - streamerX, a.z - streamerZ), 0) /
      swarm.length;

    for (const agent of swarm) {
      const dist = Math.hypot(agent.x - streamerX, agent.z - streamerZ);
      expect(dist).toBeGreaterThanOrEqual(44.9);
      expect(dist).toBeLessThanOrEqual(110.1);
      expect(agent.walkSpeed).toBeGreaterThanOrEqual(3.2);
      expect(agent.walkSpeed).toBeLessThanOrEqual(4.8);
      expect(agent.attractedToStreamer).toBe(true);
    }

    // Advance 40 steps at 5x speed (~10s simulated future)
    for (let step = 0; step < 40; step++) {
      stepSyntheticCrowd(state, 0.05, streamerX, streamerZ, "parallel", 5);
    }

    const convergedMeanDist =
      swarm.reduce((acc, a) => acc + Math.hypot(a.x - streamerX, a.z - streamerZ), 0) /
      swarm.length;

    // Swarm must significantly converge toward streamer position
    expect(convergedMeanDist).toBeLessThan(initialMeanDist - 22);

    // Social-force separation prevents agents from collapsing onto the exact same coordinate
    for (let i = 0; i < swarm.length; i++) {
      for (let j = i + 1; j < swarm.length; j++) {
        const d = Math.hypot(swarm[i]!.x - swarm[j]!.x, swarm[i]!.z - swarm[j]!.z);
        expect(d).toBeGreaterThan(0.05);
      }
    }

    // Metrics reflect elevated crowd density and lower safety score
    expect(state.metrics.crowdDensityPct).toBeGreaterThan(baselineDensity);
    expect(state.metrics.safetyScore).toBeLessThan(baselineSafety);
  });

  it("spawns high-risk stream sniper squad (sniperRisk >= 0.9) and updates sniper metrics", () => {
    const state = createSyntheticCrowdState(0, 0, 77);
    const initialSnipers = state.metrics.nearbySniperCount;
    const initialRisk = state.metrics.sniperRiskPct;

    const snipers = spawnSniperSquad(state, 0, 0, 12);
    expect(snipers).toHaveLength(12);
    for (const s of snipers) {
      expect(s.archetype).toBe("stream_sniper");
      expect(s.sniperRisk).toBeGreaterThanOrEqual(0.9);
      expect(s.attractedToStreamer).toBe(true);
    }

    stepSyntheticCrowd(state, 0.05, 0, 0, "parallel", 5);
    expect(state.metrics.nearbySniperCount).toBeGreaterThan(initialSnipers);
    expect(state.metrics.sniperRiskPct).toBeGreaterThan(initialRisk);
  });

  it("caps total pool at MAX_SYNTHETIC_AGENTS (240) and resets cleanly to baseline", () => {
    const state = createSyntheticCrowdState(0, 0, 12);
    spawnChatLocationLeakSwarm(state, 0, 0, 100);
    spawnCrosswalkSurge(state, 0, 0, 100);
    expect(state.agents.length).toBeLessThanOrEqual(MAX_SYNTHETIC_AGENTS);

    resetToBaselineCrowd(state, -240, 380);
    expect(state.agents).toHaveLength(BASELINE_AGENT_COUNT);
    expect(state.agents.every((a) => !a.spawnedInParallel)).toBe(true);
  });
});
