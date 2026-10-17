# HANDOFF: repo state and next steps

**Snapshot:** 2026-10-17, 11:50 BST. `main` includes PR #5 (Around me), PR #6 (the 3D twin) and Chris's `services/`.

Event facts, rules and the CAMP requirements are in [`AGENTS.md`](AGENTS.md). The how-to for the infrastructure is the [`vast-camp` skill](.agents/skills/vast-camp/SKILL.md). Update this file when the state changes.

**Verification:** nothing was installed or built for this snapshot. It comes from reading the code, with `file:line` references so you can check it.

## TL;DR

1. **CAMP is mandatory, and nothing runs on it yet.** The project has to sit on VAST's stack: Cursor, then an agent on VAST's cluster, then Cosmos/YOLO/W&B on CoreWeave, then VSS/VastDB on VAST.
   - Everything we have runs on laptops, on internet video.
   - **Top priority:** get into the VAST lab, then deploy a small agent at `/app` that queries our team's VSS index and reasons on W&B.
2. **`apps/stream` works and has grown.** Live / Around me / 3D mirror tabs:
   - real TfL cameras, buses, disruptions and weather;
   - local YOLO counts and tracks;
   - a real-OpenStreetMap 3D twin of Tower Hill at `/twin`.
3. **`apps/web`** (the imported 3D city) is still blocked; details below.

## CAMP status

| Layer | What's required | What we have | Gap |
|---|---|---|---|
| **C**: Cursor | Build on the lab VM over Cursor Remote-SSH | Cursor accounts and credits | Each person: sign in to the lab portal, add an SSH key, connect |
| **A**: VAST agent runtime | Agent and app deployed on the team's Kubernetes namespace at `/app` | Nothing | **Build a small Python agent plus a dashboard and deploy it** with `/deploy-app-no-registry` |
| **M**: NVIDIA + CoreWeave | Cosmos3-Reason, Embed1 and YOLO11 via VSS. W&B inference + Weave for our reasoning | Local YOLO on TfL (`services/yolo`). W&B and Cosmos clients (`services/vision`, not wired into any app) | Agent reasoning on W&B with Weave traces. Our Cosmos prompt through re-ingest |
| **P**: VAST platform | Query our team's VSS index. Re-ingest the pre-loaded footage with our prompt | Nothing | Pick the footage (the dashcam pedestrian crossings fit best), write the re-ingest prompt, re-ingest a few clips |

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
  - **It follows only `stream.location` on the bus** (`twin/live/store.ts:99`). `reality:fork` and `streamer:location_leaked` do nothing yet, so there's **no "what if" crowd simulation**.
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
- **Name clash:** in `apps/stream`, `YOLO_URL` means our local server. On the VM, `YOLO_URL` is the shared YOLO11 GPU endpoint, with a different API. Rename ours if the two ever meet.

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
- **The CAMP agent at `/app` will be a third piece:** front ends would poll it over HTTP, if it's reachable from laptops. Check that after the first deploy.

## Decisions to make now

1. **Footage:** the VAST-backed part must use the provided footage, not TfL or YouTube. Proposal: the dashcam pedestrian-crossing clips, re-ingested with a crowd and approach prompt (the prompt is in the skill).
2. **Which 3D:** the real-OSM `/twin` in `apps/stream` now works on live data and matches the pitch (real Tower Hill). The imported `apps/web` city is fictional and doesn't build. Suggestion: build on `/twin`, and leave `apps/web` out of the demo unless someone needs a piece of it.
3. **"No previous projects" (`CLAUDE.md`):** `apps/web` came from hamyway-city (e2e report dated 2026-10-10, settings link to the old repo). Confirm the rule on Discord, then keep it and say so openly, trim it, or drop it.

## Next steps (in order)

1. **Everyone: get VAST lab access** (`AGENTS.md`, "Getting access"). Pick the team number once, then run the health check.
2. **Look at the indexed footage in the VSS UI**, write the re-ingest prompt, and re-ingest a few clips (one person).
3. **Agent on the cluster:** a Python service that does VSS `search-and-answer`, adds YOLO counts, reasons on W&B with Weave tracing, and returns `calm | busy | danger` plus advice. Deploy it with `/deploy-app-no-registry`, then open it from the portal's App button.
4. **Connect the front ends:** the stream page and twin show the agent's verdict (`surroundings.update`) alongside live London data.
5. **The "what if" in the twin:** on `reality:fork` / `streamer:location_leaked`, spawn the crowd converging on the streamer and show the danger, then the safer spot.
6. **Record the backup demo by 15:30, freeze code at 15:45, submit before 16:30** (checklist in `AGENTS.md`). The demo should name each CAMP layer.

## Owners (from `CLAUDE.md`)

- **Sonion (+ Claude):** `apps/stream`.
- **Chris:** data, meaning live London sources and `services/`.
- **Arvin:** the 3D city and sim.
- **The CAMP agent (step 3) has no owner yet.** Assign it now.

## Housekeeping

- **Root `package.json`:** `dev:stream` and `yolo` work. `dev`, `build` and `lint` call a missing `api` workspace, and about 19 scripts point at a `scripts/` folder that doesn't exist.
- **Branch flow:** feature branch → PR → `main` (PRs #1–#5). Pull before you push.
