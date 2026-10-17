# CLAUDE.md — Real-Time Video Agents Hack (London)

Hackathon project. This file overrides global PR/CI discipline: there's one deadline, no reviewers, no prod.
Speed and a demo that works live matter more than process.

## The event
- **VAST Builders Challenge — Real-Time Video Agents Hack, London.** Sat 2026-10-17.
- Venue: Halkin, 1–2 Paris Garden, London SE1 8ND.
- Hosts: VAST Data, with NVIDIA, SpaceXAI (Cursor), CoreWeave, Weights & Biases.
- Theme: **build an AI system that unlocks the value of video.** Most video sits in storage
  unwatched because it's hard to search and analyze. Agents that make it searchable, queryable
  and actionable are the brief.

## Hard deadline and timeline (BST)
| Time | What |
|---|---|
| 09:30 | Build starts |
| 12:30 | Lunch |
| **16:30** | **Hacking ends, submissions cut off. Late = rejected.** |
| 16:30 | Demos |
| 18:30 | Closing + awards |

The invite says "9:30 AM ET". That's a typo; the event runs on London time.
Plan for code freeze at **~15:45** so the demo recording and submission are done by 16:30.

## Submission requirements (non-negotiable)
- **Use at least 3 sponsor tools** (list below). Make each one visible in the demo and README.
- **Public GitHub repo** submitted: `chocoliticekreem/classroom-47`.
- **No previous projects.** Everything gets built today.
- **3-minute demo, recorded**, and ready to present live.
- Team size: max 4.

## Sponsor stack (pick ≥3, more is better)
| Tool | Use it for |
|---|---|
| **NVIDIA Cosmos** | Video understanding: reasoning over a clip (what's happening, why, what's next) |
| **Semantic video search** | Natural-language search for moments across hours of footage |
| **YOLO** | Real-time object detection and tracking across frames |
| **Weights & Biases** (serverless inference, models from W&B / CoreWeave) | LLMs for app and agent logic. W&B Weave for tracing agent calls (an easy extra sponsor tick) |
| **VAST AI OS** | Video ingestion and the data/orchestration layer. Hosted environment, no local setup |
| **CoreWeave GPUs** | Model serving |
| **Cursor** | Dev environment (credits on the registration email) |

Video assets are provided by the organisers. Access goes through the Cosmos Community / VAST
environment, and build-environment access is limited to the first 100 attendees.

## Judges: build for them
- Abubakr Karali, Senior Solutions Architect @ NVIDIA → wants Cosmos used for real reasoning, not as a captioner.
- Ram B., Sr. Developer Advocate @ VAST Data → wants VAST as the data layer, not a side detail.
- Brian Verkley, Director, AI Data Platform @ VAST Data → wants video moving from storage to value at scale.
- Junaid Butt, AI Solutions Engineer @ W&B → wants a real agent loop on W&B inference, ideally traced in Weave.

Prizes: 1st place NVIDIA DGX Spark, plus HuggingFace Microduck, Cursor credits and cash gift cards.

## North star: flashy but robust
The goal is something that **looks crazy** on stage and **never breaks** during the 3 minutes.

**Flashy**
- Visual-first UI: live video with YOLO boxes and tracks drawn on top, an agent "thinking"
  stream beside it, and timeline scrubbing that jumps straight to the moments it found.
- The wow moment is a natural-language question over hours of footage that lands on the exact
  clip in seconds, with Cosmos explaining *why*.
- Real-time beats batch. Show the agent reacting as the video plays.
- Polished dark UI, smooth motion, big readable text from the back of the room.

**Robust**
- **Demo path first.** Get one end-to-end happy path working before adding any features.
- **Pre-compute and cache.** Index the demo videos ahead of time (embeddings, detections, Cosmos
  outputs) so the live demo never waits on a cold GPU or a slow API.
- **Fallbacks for every network call.** If a sponsor endpoint is slow or down, serve the cached
  result. The demo can't depend on venue wifi.
- **Record a backup demo video by ~15:30.** If the live demo dies, play the recording.
- Hardcode the demo queries and rehearse them. No improvising on stage.
- Timeouts on every external call. No unbounded spinners.

## How we work today
- Ship the vertical slice first (ingest → detect/understand → search → agent answer → UI), then polish.
- Keep scope small. One killer flow beats five half-working ones.
- Secrets go in `.env` (gitignored), never in the repo. The repo is public.
- Keep the README current: what it does, which sponsor tools and where, how to run it, demo GIF/video.
- **Don't commit or push unless Sonion asks.**

## Project: Classroom 47 (working name)
**One line:** situational awareness for IRL streamers in London, plus a parallel London where they rehearse a decision before they make it.
**Tagline:** *Know what's around you. Rehearse the future before you cause it.*

### Problem (sourced)
- **IRL streaming is growing fast.** 36.4B hours watched in 2025 (+6% YoY). IRL streams grew +19% on Twitch, Kick grew +131% YoY, and TikTok Live's growth is mostly IRL streams.
- **One message can summon a crowd.**
  - Kai Cenat's Union Square giveaway (4 Aug 2023): 3,000–5,000 people showed up, a riot followed, 65+ were arrested, and he was charged with inciting a riot. The crowd went from 300 to thousands in minutes.
  - London, Aug 2023: TikTok and Snapchat posts ("Oxford Circus JD robbery, 3pm") pulled hundreds of teenagers onto Oxford Street. 34 dispersal orders, 9 arrests.
- **Being findable is dangerous.** Stream snipers locate creators from visual clues.
  - Valkyrae, Cinna and Emiru were threatened at the Santa Monica Pier.
  - IShowSpeed was mobbed in Oslo and the Netherlands.
  - Tokyo streamer Airi Sato was tracked through her stream and killed on air.
- **The gap:** streamers broadcast their location live to thousands with zero awareness of what's around them, and no way to predict what one message to chat will set off.

### Team
- **Sonion (+ Claude):** streaming platform (this repo's UI, chat, bus).
- **Chris:** data sourcing (JamCams, TfL, Reddit, etc.) and linking feeds into the stream + city over the bus.
- **Arvin:** 3D city / parallel-reality sim.

### Product (three layers)
1. **Streaming platform (this repo, Sonion):** a polished IRL stream page.
   - Player sources: webcam, a TfL JamCam, or an uploaded video.
   - A mock chat crowd built from personas.
   - Streamer controls: **"Tell chat my location"** and **"Simulate first"**.
2. **Awareness layer:** what's around me right now.
   - The nearest TfL JamCams (890, each geotagged) with YOLO crowd counts.
   - TfL disruptions, and Cosmos reasoning over nearby clips for incidents.
   - An advisor agent turns it into suggestions ("crowd building at Leicester Sq, take Charing Cross Rd").
3. **Parallel reality (Arvin):** a 3D twin of London seeded with *live* crowd counts.
   - A "what if I tell chat?" triggers synthetic personas: Reddit-derived archetypes (superfan, opportunist, hater, local) decide who comes, from where and how fast.
   - The sim shows density over time and crush risk, then suggests a safer spot and re-runs.
   - Video grounds the sim in "right now". That's the bridge the judges need to see.

### Demo arc (3 min)
1. **Hook:** Union Square plus Oxford Street. "Both started with one message."
2. **Live stream:** walking through the West End, with chat flowing and the surroundings card showing crowd, incidents and a reroute.
3. **"Should I tell chat?" → Simulate first.** The camera flies into the twin, personas flood in, and a red crush warning fires.
4. **The agent suggests a safer spot.** The re-run stays green, and the tagline closes.

### Sponsors
- **YOLO:** crowd counts.
- **Cosmos:** incident reasoning.
- **W&B:** persona and advisor agents, with Weave traces.
- **VAST:** clip ingest and search.
- **CoreWeave and Cursor** come with the stack.

### Structure and integration
- **Layout:** CAMP-layered (VAST's stack: Coding agents, Agent runtimes, Model services, Platform). Code lives in `apps/stream/src/agents`, `apps/stream/src/platform`, `apps/stream/src/components` and `apps/stream/src/lib`. See `docs/ARCHITECTURE.md`.
- **Integration:** the stream page and the city talk over the `classroom-47` BroadcastChannel (`apps/stream/src/platform/bus.ts`). The city listens for `location.reveal` and `sim.request`, and publishes `surroundings.update`.
- **To-dos:** `TODO.md`.
- **Run:** `npm install && npm run dev -w stream`.
- **No unit tests:** it's a hackathon. Gate is typecheck, lint and build.
- **Monorepo:** npm workspaces. `apps/stream` = streaming platform (Sonion). `apps/web` = 3D city + console (Arvin, see `/city`). `apps/api` = Arvin's agent API.
- **Contract alignment needed:** Arvin's city bus (`apps/web/src/world/bus.ts` + `streamerContract.ts`: `streamer:teleport`, `reality:fork`, `sim:spawn_synthetic_crowd`…) and the stream bus (`apps/stream/src/platform/bus.ts`) are separate today and run on different ports, so BroadcastChannel won't bridge them. Next step: a shared contract + a websocket or a same-origin route.
