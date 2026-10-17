# HANDOFF: repo state and next steps

**Snapshot:** 2026-10-17, 12:25 BST. `main` includes PRs #5–#12:
- Around me;
- the 3D twin and the CCTV compare;
- **the CAMP agent (`services/agent`)**;
- a twin calibrated to the live cameras;
- **Predict (`services/predict`)**;
- Arvin's twin roads, traffic and buildings.

Event facts, rules, CAMP requirements, the **official schedule and judging criteria** (from the organisers' slides) are in [`AGENTS.md`](AGENTS.md). The how-to for the infrastructure is the [`vast-camp` skill](.agents/skills/vast-camp/SKILL.md).

The **official VAST guide and skills** are in `vast-builders-challenge/`, a submodule (`npm run vast:guide`). It has been read in full, and its practices are folded into the skill. Update this file when the state changes.

**Verification:** nothing was installed or built for this snapshot. It comes from reading the code, with `file:line` references so you can check it.

## TL;DR

1. **CAMP is mandatory. The agent code exists, but nothing is confirmed running on VAST yet.** The project has to sit on VAST's stack: Cursor, then an agent on VAST's cluster, then Cosmos/YOLO/W&B on CoreWeave, then VSS/VastDB on VAST.
   - `services/agent` (PRs #8, #10) is that agent, ready to deploy.
   - **Top priority:** get into the VAST lab, re-ingest with our prompt, and **deploy `services/agent` at `/app`** (steps in `services/agent/README.md`).
2. **`apps/stream` works and has grown.** Live / Around me / 3D mirror tabs:
   - real TfL cameras, buses, disruptions and weather;
   - local YOLO counts and tracks;
   - a real-OpenStreetMap 3D twin of Tower Hill at `/twin`.
3. **`apps/web`** (the imported 3D city) is still blocked; details below.

## CAMP status

| Layer | What's required | What we have | Gap |
|---|---|---|---|
| **C**: Cursor | Build on the lab VM over Cursor Remote-SSH | Cursor accounts and credits | Each person: sign in to the lab portal, add an SSH key, connect |
| **A**: VAST agent runtime | Agent and app deployed on the team's Kubernetes namespace at `/app` | **`services/agent/app.py`** (stdlib HTTP + `openai` + `weave`): dashboard `/app/`, `/app/health`, `POST /app/assess` | **Deploy it** with `/deploy-app-no-registry`, using **our Secret key names** (`USERNAME`, `PASSWORD`, `INGRESS_URL`, `WANDB_*`), not the template's `VSS_*`; see `services/agent/README.md`. Then point the front ends at it |
| **M**: NVIDIA + CoreWeave | Cosmos3-Reason, Embed1 and YOLO11 via VSS. W&B inference + Weave for our reasoning | The agent calls W&B (`Qwen/Qwen3.8-27B` by default) inside a `weave.op`. Predict uses W&B + Weave too. Local YOLO on TfL (`services/yolo`) | Our Cosmos prompt through re-ingest. Optional: Canary ASR on the stream's audio to catch the streamer saying where they are |
| **P**: VAST platform | Query our team's VSS index. Re-ingest the pre-loaded footage with our prompt | The agent queries VSS `agent/search-and-answer` + `search`; its evidence carries the Cosmos text and YOLO counts (PR #10) | Pick the packs (F indoor crowds, E SF streets, B Toronto forward-facing drive), write the re-ingest prompt, re-ingest a few clips. Optional: **store the agent's verdicts in our own VastDB table** (`vastdb-write`) |

## `apps/stream` (streaming platform): works locally

- **Live tab:**
  - Player sources: webcam, the nearest TfL JamCam clip, or an upload. Locations are in `src/lib/locations.ts`, with Tower Hill as the default.
  - Mock chat crowd (`src/agents/chat-crowd/`), template lines only.
  - Buttons: **Tell chat my location** and **Mirror**.
- **Around me tab** (`src/components/around/`, `src/platform/around/`):
  - Map with TfL cameras, buses, disruptions and Open-Meteo weather, via `/api/around/*`.
  - People and vehicle flows from YOLO tracks.
  - Publishes real `surroundings.update` (`platform/around/useSurroundings.ts`).
  - The YOLO routes need `npm run yolo`. Without it they return 503 with a hint.
- **3D mirror tab** (PR #6): shows `/twin?lat=…&lon=…` (`stream-shell.tsx:19,141`).
  - The twin is in `src/twin/`: a Tower Hill origin, real OpenStreetMap buildings and roads via `/api/twin/osm`, and live layers for people (YOLO tracks), buses, CCTV frames, disruptions and the streamer.
  - PR #7 added:
    - a **real-vs-simulated CCTV compare**: the real JamCam clip next to the twin rendered from the same camera pose;
    - a **first-person streamer view**;
    - **live weather and sun** from Open-Meteo;
    - a **dev panel** to override weather, time and crowd for demos.
  - Later PRs added:
    - **PR #9:** people and traffic calibrated to the live cameras, time and weather;
    - **PR #12:** a 1:1 CCTV compare with calibrated camera poses (`services/vision/calibrate.py`);
    - **Arvin's `9c355e7`:** a road network with pavements, traffic and pedestrians, 3D buildings, landmarks, boats and GPU water.
  - **It follows only `stream.location` on the bus** (`twin/live/store.ts:128`). `reality:fork` and `streamer:location_leaked` do nothing yet, so there's **no "what if" crowd simulation**.
- **Demo settings** (`src/platform/demo.ts`): live by default. Weather, time and crowd multiplier can be overridden; they sync across tabs.
- **Run:** `npm run dev:stream` → http://localhost:3047.

## `services/` (Python, uv)

- **`services/yolo/server.py`:** YOLO11n + ByteTrack on TfL JamCam clips (port 8047; `GET /counts`, `/tracks`, `/frame`). Start it with `npm run yolo`.
  - This is **not** the CAMP YOLO. It runs locally on internet video, so keep it as a live-London bonus.
- **`services/vision/`:** model clients:
  - YOLO26;
  - Cosmos via build.nvidia.com (`NVIDIA_API_KEY`);
  - W&B inference;
  - a London live-camera catalogue that resolves YouTube streams with yt-dlp.
  - No app uses it yet. YouTube footage must never go into VAST.
- **YOLO variables:** our local server is `JAMCAM_YOLO_URL` (renamed in PR #7). `YOLO_URL` on the VM is the shared YOLO11 GPU endpoint.
- **`services/agent/`: the CAMP agent** (PRs #8, #10).
  - Flow: VSS login (JWT cached) → `agent/search-and-answer` with a streamer-safety query, topped up by `search` → one W&B chat call in a `weave.op` → validated JSON `{level, advice, reasons, evidence[], vss_answer, trace}`.
  - On an upstream failure it returns 502 naming the dependency. CORS is open for `localhost:3047`.
  - It isn't called by `apps/stream` yet, and it doesn't use `tools/*` or VastDB writes yet.
- **`services/predict/`** (PR #11): a MiroFish-style 30-minute forecast of Tower Hill.
  - Seeded from the twin's live field (`/api/twin/field`), with 30–80 persona groups, simulated on the real street graph, plus a report and `/score` against later camera readings.
  - It runs on W&B + Weave, or in rules mode without a key. Port 8048.
  - **This is our "what if" engine.** It could answer `reality:fork`.

## `apps/web` (imported 3D city + console): blocked

- **What it is:** a fictional "Hamyway City" with 40 modules plus a delivery-ops agent desk, all from Arvin's earlier project (`72c4efb`). It's not real London.
- **Build blocker:** `src/console/workflows/api.ts:7` imports `../../../../api/flows/default-incident.json`, but `apps/api` isn't in the repo.
  - Both `/` and `/city` reach it: `CityPage` → `WorkflowHud` → `CasesPanel`.
  - 23 more files import types from `apps/api`.
  - Fix: a stub JSON there, or drop the console imports from `CityPage`.
- **Missing backend:** the agent backend (`localhost:4000`) isn't here, so its HUD shows "Offline".
- **Unused contract:** `src/world/streamerContract.ts` declares streamer events and a `useParallelReality` store that nothing uses. Its default handle `@ishowspeed_ldn` is a real person; rename it.
- **Worth reusing:** the Events module's crowd surge, `emit({ type: "request:event", kind: "concert" })`.

## Integration

- **Stream and its twin share an origin:** the Mirror button now opens `/twin` inside `apps/stream`. Its `classroom-47` BroadcastChannel events (`docs/ARCHITECTURE.md`) reach the twin without a bridge. Today the twin uses only `stream.location`.
- **`apps/web` is still separate:** different port, and the `rivet-city` channel. Linking it means serving both from one origin, or a websocket.
- **The CAMP agent at `/app`** (`services/agent`) is a third piece: the front ends `POST /app/assess` over HTTP, and CORS is already open. Check after the first deploy that the team host is reachable from laptops.
- **Predict** (`services/predict`, :8048) reads the twin's routes. Nothing in `apps/stream` calls it or the agent yet.

## Decisions to make now

1. **Footage:** the VAST-backed part must use the provided corpus, not TfL or YouTube.
   - Proposal: **Pack F (indoor smart spaces, the "Crowds" category)** for crowd density, **Pack E (SF street cams)** for pedestrians crossing once it's indexed, and **Pack B (Toronto forward-facing drives)** as a streamer-like point of view. Re-ingest them with our crowd and approach prompt (in the skill).
   - Also search Explore for "london walk": the official skills mention a `london-luxury-walk` chunk.
   - Uploading our own footage: ask the organisers first.
2. **Which 3D:** the real-OSM `/twin` in `apps/stream` now works on live data and matches the pitch (real Tower Hill). The imported `apps/web` city is fictional and doesn't build. Suggestion: build on `/twin`, and leave `apps/web` out of the demo unless someone needs a piece of it.
3. **"No previous projects" (`CLAUDE.md`):** `apps/web` came from hamyway-city (e2e report dated 2026-10-10, settings link to the old repo).
   - The organisers' slides don't mention this rule, so it's still unconfirmed.
   - Ask on Discord, then keep `apps/web` and say so openly, trim it, or drop it.
4. **Who gives the demos:** a 2-minute demo at 16:45, then 3 minutes at 18:00 if we're in the top 5.

## Next steps (in order)

1. **Everyone: get VAST lab access** (`AGENTS.md`, "Getting access"). Pick the team number once, then run the health check.
2. **Run the organisers' Test Drive loop** with `/build-day-quickstart` on the VM:
   1. Look at what's indexed.
   2. Search for our idea.
   3. Ask a question instead.
   4. Search for a gap.
   5. Re-ingest with our crowd prompt (one person, a few clips).
   6. Search again.

   Save the exact prompt text in the repo, because VSS doesn't store it anywhere you can read back.
3. **Deploy `services/agent` on the cluster:**
   - Follow `services/agent/README.md`: `/deploy-app-no-registry`, Secret with our key names, check `/app/health` returns `vss: true, wandb: true`.
   - Open it from the portal's App button and check one `POST /app/assess`.
   - Optional upgrades: use the VSS `tools/*` (for example `tools/detections`), and write each verdict to our own VastDB table.
4. **Connect the front ends:** the stream page and twin call `POST /app/assess` and show the verdict as `surroundings.update`, next to live London data.
5. **The "what if" in the twin:** on `reality:fork` / `streamer:location_leaked`, call **Predict** (`services/predict`) with a "streamer reveals location" intervention. Show the crowd converging and the danger, then the safer spot.
6. **Judging needs** (`AGENTS.md`, "Judging criteria"):
   - **README:** add the inputs, outputs and evaluation section.
   - **A small evaluation run:** 5–10 test queries with expected clips, hit@k before and after our re-ingest prompt, logged in Weave (method in the `vast-camp` skill).
   - **Demos:** rehearse a **2-minute** live demo for round 1, and a **3-minute** version for the 18:00 finals.
7. **Record the backup demo by 15:30, freeze code at 15:45, and submit before 16:30, with every teammate on the submission** (checklist in `AGENTS.md`). The demo should name each CAMP layer.

## Owners (from `CLAUDE.md`)

- **Sonion (+ Claude):** `apps/stream`.
- **Chris:** data, meaning live London sources and `services/`.
- **Arvin:** the 3D city and sim.
- **The CAMP agent** (`services/agent`) and **Predict** were authored in PRs #8, #10 and #11 (Anson). **Who deploys the agent on the VM (step 3)? Assign it now.**

## Housekeeping

- **Root `package.json`:** `dev:stream`, `yolo` and `vast:guide` work. `dev`, `build` and `lint` call a missing `api` workspace, and about 19 scripts point at a `scripts/` folder that doesn't exist.
- **Branch flow:** feature branch → PR → `main` (PRs #1–#12). Pull before you push.
