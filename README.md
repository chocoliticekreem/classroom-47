# NUMA // London Streamer Parallel Reality Engine 🇬🇧✨

> **Live Situational Awareness + Parallel-Future 3D Simulation for IRL Streamers in London.**
> Built with the **CAMP / Speedrun 3D Stack** (`Next.js` · `Three.js` · `@react-three/fiber` · `@react-three/drei` · `Zustand` · `CAMEL-AI Synthetic Crowd Personas` · `TypeSafe System One Judgments` · `NGL Fluffy Volumetric UI`).

---

## Hackathon

Built at the **[Real-Time Video Agents Hack, London](https://luma.com/vastlondon)** (VAST Builders Challenge, organised by [tokens&](https://tokensand.com/vastlondon)), Saturday 17 October 2026.

- **Brief:** build agents that unlock the value of video. They should make footage searchable and queryable, and act on it.
- **Deadline:** **16:30 BST**, submitted at [tokensand.com/vastlondon/submit](https://tokensand.com/vastlondon/submit). Our own code freeze is 15:45.
- **Infrastructure:** VAST's **CAMP** stack, required by the challenge.
  - **C**ursor (SpaceXAI) is the coding agent.
  - **A**: the agent runs on the VAST cluster.
  - **M**: NVIDIA Cosmos and YOLO on CoreWeave, plus W&B inference + Weave.
  - **P**: the VAST platform, with the NVIDIA VSS Blueprint, DataEngine and VastDB.
- **Team docs:**
  - [`AGENTS.md`](AGENTS.md): event facts, rules, CAMP requirements and access, submission checklist.
  - The [`vast-camp` skill](.agents/skills/vast-camp/SKILL.md): how to build on and deploy to CAMP.
  - [`HANDOFF.md`](HANDOFF.md): what works today, what's broken, next steps.
  - [`TODO.md`](TODO.md): to-dos.
  - [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the stream ↔ city event bus.

---

## What This Is

When an IRL streamer is broadcasting live in **London**, every movement and word to chat changes the physical world around them. **NUMA** gives the streamer:

1. **Real-Time London Situational Awareness (`LIVE REALITY`)**
   - Maps the streamer's live GPS/zone location across central London districts (**Soho / Piccadilly**, **Westminster & Whitehall**, **Southbank & London Eye**, **The City / Bank**, **Shoreditch**, **Camden**, and the **River Thames**).
   - Displays live pedestrian flow, vehicle traffic, roadworks/accidents, and nearby **stream sniper** risk vectors.
   - Suggests optimal safe routes and live crowd-avoidance paths.

2. **Parallel Reality Forking (`PARALLEL FUTURE SIMULATOR`)**
   - Branches a **3D Parallel Reality** of the surrounding London neighborhood so the streamer can test **"What-If" futures before they happen**:
     - *"What if I tell chat where I am right now and 50 people rush my street?"*
     - *"What if 50 pedestrians surge across the junction ahead?"*
     - *"What if a stream-sniper squad converges while a road accident blocks the bridge?"*
   - Simulates the next 2–5 minutes at high speed, computing **Crowd Crush Risk**, **Sniper Interception Time**, **Traffic Gridlock**, and **Safe Escape Routes** so the streamer can decide whether to let that future happen or reroute immediately.

3. **Synthetic People Powered by Scraped Reddit Data & CAMEL-AI Personas**
   - Every simulated pedestrian/fan/stream-sniper in the parallel reality is hydrated from scraped London & streaming Reddit threads (`r/london`, `r/ukstreaming`, `r/casualuk`, `r/livestreamfail`) with CAMEL-AI persona traits (`archetype`, `subreddit`, `thoughtBubble`, `sniperRisk`, `hypeLevel`, `walkSpeed`).
   - Clicking or inspecting synthetic agents reveals their live thought bubbles and behavioral intent in **NGL Fluffy Volumetric Bubble Cards**.

---

## Team Split & Integration Contract

- **3D City & Parallel Reality Simulation (`apps/web/src/world/`)** — *This repo / branch track*
  - Owns the 60fps 3D London world, district modules, road/sidewalk graph, real-time traffic & crowd boids, CAMEL-AI/Reddit synthetic crowd spawner, parallel reality time-branching engine, and NGL Fluffy HUD controls.
- **Streaming Platform & Live Telemetry Feed** — *Companion track*
  - Pushes live streamer coordinates, chat hype spikes, and stream events via the shared typed event bus (`emit({ type: "streamer:move", x, z })`, `emit({ type: "sim:spawn_crowd", count: 50, archetype: "fan_swarm" })`) or REST/WebSocket endpoint (`/api/stream-state`).

---

## Architecture (Module-per-Zone Speedrun Pattern)

> **This is the planned layout.** Several files below don't exist yet. See [`HANDOFF.md`](HANDOFF.md) for what is actually in the repo today.

```text
apps/web/src/
  app/
    page.tsx                    # Entry -> London Parallel Reality WorldPage
    api/
      simulate/route.ts         # CAMEL-AI + Reddit synthetic persona & future prediction API
      reddit-personas/route.ts  # Scraped London/Streamer Reddit dataset & persona hydration
  world/
    WorldPage.tsx               # Client shell: 3D Canvas + NGL Fluffy Volumetric HUD overlays
    World.tsx                   # <Canvas> + MODULES registry + ?only= / ?skip= / ?stats=1
    ModuleBoundary.tsx          # Per-module error isolation
    PerfProbe.tsx               # window.__world.bench(30) performance telemetry
    config.ts                   # SHARED CONTRACT: London ZONES, world units, landmarks
    store.ts                    # SHARED CONTRACT: Zustand (realityMode, streamerPos, riskMetrics)
    registry.ts                 # SHARED CONTRACT: 60fps per-frame vehicles & synthetic crowd agents
    bus.ts                      # SHARED CONTRACT: Typed events (sim:fork, sim:spawn_crowd, etc.)
    roads.ts                    # SHARED CONTRACT: London street network & A* safe-route pathfinding
    personas.ts                 # Reddit-scraped London & chat personas + CAMEL-AI traits
    modules/
      Sky.tsx                   # London sky dome, dusk/night bloom, weather & fog
      Ground.tsx                # London terrain, parks (Hyde/Soho Sq), street grid
      RiverThames.tsx           # River Thames, bridges (Westminster, Waterloo, Tower), boats
      LondonLandmarks.tsx       # Big Ben, London Eye, The Shard, Gherkin, Soho Neon
      Buildings.tsx             # Instanced London districts with procedural night windows
      Roads.tsx                 # London road network, roundabouts, zebras & closures
      Traffic.tsx               # Red double-decker London buses, black cabs & cars
      StreamerAvatar.tsx        # Live streamer beacon, FOV cone, safe-route hologram & radar
      SyntheticCrowd.tsx        # 60fps instanced crowd + "+50 Chat Swarm" / stream sniper sim
      AccidentsAndHazards.tsx   # Live accidents, police cordons, crowd bottlenecks
      ParallelRealityFx.tsx     # Visual glitch/grid shift + timeline holographic ghosting
      CameraRig.tsx             # Cinematic presets (Aerial London, Streamer Chase, Tactical Drone)
    hud/
      NglHud.tsx                # NGL Fluffy Volumetric HUD: Reality Switcher, +50 Crowd Trigger,
                                # Reddit Persona Inspector, Safe Route Advisor & Minimap
```

---

## Quick Start

```bash
npm install          # once, at the repo root (npm workspaces)
npm run dev:stream   # streaming page: http://localhost:3047 (Live / Around me / 3D mirror)
npm run yolo         # local YOLO for "Around me": http://127.0.0.1:8047 (needs uv)
npm run dev -w web   # 3D city: http://localhost:3000 (/ and /city)
```

The CAMP parts (VSS, Cosmos, the agent on the VAST cluster) run on the event's lab VM. See the [`vast-camp` skill](.agents/skills/vast-camp/SKILL.md).

Don't use the root `npm run dev`; it expects an `apps/api` workspace that isn't in this repo. The `apps/web` build is currently blocked; [`HANDOFF.md`](HANDOFF.md) has the details.

### URL Debug Flags
- `?only=Sky,Ground,StreamerAvatar,SyntheticCrowd` — Render specific modules in isolation
- `?skip=Traffic` — Skip modules for bisecting
- `?stats=1` — Show live FPS / frame-time monitor
- `window.__city.bench(30)` — Run deterministic 30-frame GPU/draw-call benchmark in console
