---
name: camel-ai
description: >-
  Build multi-agent simulations, synthetic personas, and parallel-reality crowd behaviors using CAMEL-AI (Communicative Agents for Mind Exploration of Large Language Model Society) and OASIS social simulation patterns. Use when creating synthetic people from scraped social data (Reddit/X), simulating crowd swarm reactions to live streamer events, or running parallel-future what-if scenarios.
---

# CAMEL-AI & OASIS Synthetic Crowd Simulation Skill

Goal: Turn scraped social/community data (e.g. London Reddit threads, live stream chat, local neighborhood sentiment) into **autonomous synthetic agents** with distinct personas, memories, and behavioral drives that inhabit and react inside the 3D London Parallel Reality city.

---

## Core Architecture

1. **Persona Hydration (Reddit + Stream Chat -> CAMEL RolePlaying Agent)**
   - Every synthetic pedestrian/viewer agent is initialized from a **Persona Seed**:
     - `archetype`: `"stream_sniper" | "fan_swarm" | "local_commuter" | "tourist" | "chaos_instigator" | "responder"`
     - `redditSubreddits`: e.g. `["r/london", "r/ukstreaming", "r/casualuk"]`
     - `traits`: curiosity, herd-following, speed, proximity target, hostility/hype score (`0..1`)
     - `sampleQuote`: authentic scraped/synthesized inner monologue shown in NGL Fluffy Bubble callouts when clicked or hovered in 3D.

2. **Parallel Reality Forking ("What-If" Future Branches)**
   - **Live Reality (`mode: "live"`)**: Reflects current streamer GPS location in London (Soho, Piccadilly, Southbank, Shoreditch, Camden, Westminster), real-time pedestrian flow, traffic, and active alerts.
   - **Simulated Future (`mode: "parallel"`)**: Forks the city state at $t_0$ and injects a hypothetical trigger:
     - *"What if I leak my location to chat right now? (+50 synthetic fans/stream snipers converge)"*
     - *"What if 50 people rush across Oxford Circus / Soho Square?"*
     - *"What if an accident blocks Shaftesbury Ave while chat swarms?"*
   - Runs fast tick-accelerated agent simulation ($1\times, 5\times, 20\times$) to preview crowd crush risk, road blockages, stream-sniper interception vectors, and safe escape routes **before** the streamer makes the decision in real life.

3. **Two-Tier Intelligence Loop**
   - **Fast Reactive Tick (60 FPS in `useFrame` / pure `.ts` sim)**: Social-force boids + A* road/sidewalk graph + attraction/repulsion vectors toward the streamer's position. Zero allocation per frame.
   - **Cognitive Agent Judgment (CAMEL-AI / TypeSafe System One)**: Evaluates scenario risk score, crowd density hazard, sniper interception probability, and recommends concrete route decisions (e.g., *"REROUTE NORTH via Wardour St — 78% sniper swarm probability within 90s if location leaked"*).

---

## Standard Agent Contract (`SyntheticAgentSpec`)

```ts
export type AgentArchetype =
  | "fan_swarm"
  | "stream_sniper"
  | "local_commuter"
  | "reddit_local"
  | "tourist"
  | "chaos_instigator";

export interface SyntheticPersona {
  id: string;
  handle: string;
  archetype: AgentArchetype;
  subreddit: string;
  headline: string;
  thoughtBubble: string;
  hypeLevel: number;       // 0..1
  sniperRisk: number;      // 0..1
  walkSpeed: number;       // m/s (1.4 normal, 3.5+ running swarm)
  attractedToStreamer: boolean;
}
```
