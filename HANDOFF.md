# HANDOFF: repo state and next steps

**Snapshot:** 2026-10-17, 11:20 BST, `main` at `0b0abe4`.

Event facts, rules and the submission checklist are in [`AGENTS.md`](AGENTS.md). Update this file when the state changes.

**Verification:** nothing was installed or built for this snapshot. Everything below comes from reading the code, with `file:line` references so you can check it.

## TL;DR

- **`apps/stream` works on its own.** The streaming page is self-contained and needs no backend.
- **`apps/web` is a large 3D city carried over from Arvin's earlier project, hamyway-city.** It's a delivery-ops agent desk.
  - It most likely **won't compile** right now.
  - Its agent backend isn't in this repo.
  - Nothing connects it to the stream page.
- **No sponsor tool is wired in yet** (YOLO, Cosmos, W&B/Weave or VAST). The docs mention them, but no code calls them.

## `apps/stream` (streaming platform): works

- **Player:**
  - Sources: webcam, the nearest TfL JamCam clip (9 London spots, Tower Hill by default, `src/lib/locations.ts`), or an uploaded video.
  - Shows a LIVE pill, the viewer count and a location chip.
- **Mock chat crowd** (`src/agents/chat-crowd/`):
  - About 70 personas in 6 archetypes, with London slang lines.
  - The message rate scales with the viewer count.
  - After "Tell chat my location", a 45 s surge of "OMW" messages flagged as location signals.
  - All template lines; no LLM yet.
- **Buttons:**
  - **Tell chat my location** publishes `streamer:location_leaked`.
  - **Mirror** opens `NEXT_PUBLIC_MIRROR_URL` (default `http://localhost:3000/city?scenario=leak_location_50&location=…&viewers=…`) and publishes `reality:fork`.
- **Surroundings card:** shows up only after something publishes `surroundings.update`. **Nothing publishes it yet.**
- **Bus:** BroadcastChannel `classroom-47` (`src/platform/bus.ts`). The contract is in `docs/ARCHITECTURE.md`.

## `apps/web` (3D city + console): imported, blocked

**What it is.**
- A fictional "Hamyway City" with London landmarks: a Shard, a Big Ben-style tower, the Thames bridges.
- 40 3D modules: traffic, buses, rail, river, ships, an airport, crashes and responders, weather, events.
- Plus a delivery-ops AI "desk": workflows, cases, human review, ElevenLabs voice.
- It all arrived in one commit (`72c4efb`) from `github.com/arvin-shafiei/hamyway-city`.
- It isn't real London, and **Tower Hill isn't in it**.

**Blockers**

1. **Build.** `src/console/workflows/api.ts:7` imports `../../../../api/flows/default-incident.json`.
   - `apps/api` has never been in this repo.
   - Both `/` and `/city` reach this import: `world/CityPage` → `modules/WorkflowHud` → `WorkflowHud/CasesPanel` → `console/workflows/api`.
   - A missing module breaks the bundle; the per-module error boundaries can't catch it.
   - 23 more files import types from `apps/api/src/...`, which will break `next build` type-checking.
   - Fix: add a stub JSON there, or cut the console imports out of the city HUD.
2. **The agent backend is missing.**
   - The city and console send cases to `AGENT_API_URL` / `NEXT_PUBLIC_API_URL`, default `http://localhost:4000`.
   - So the HUD shows "Offline" and cases wait in the queue forever.
   - The background simulation and visuals don't need the backend.
3. **The streamer features are only declared.** `src/world/streamerContract.ts`:
   - declares the events and a `useParallelReality` store, but **nothing listens to or uses them**;
   - `triggerWhatIf()` sets hard-coded numbers and advice text and doesn't run a simulation;
   - its default handle is `@ishowspeed_ldn`, a real person's name. Our rule is archetypes only, so rename it.
4. **The README listed files that don't exist** (StreamerAvatar, SyntheticCrowd, NglHud, `api/simulate`, …). The README now marks that layout as planned.
5. **The console UI isn't mounted on any route** (`console/Shell.tsx`), but its `/api/console/*` routes still exist.

**Useful parts for our demo**

- **Events module** (`src/world/modules/Events/`): a "stadium concert surge" and a protest march.
  - Each sends GPU crowds along a route and closes roads.
  - Trigger: `emit({ type: "request:event", kind: "concert" })` on the city's bus (`src/world/bus.ts`).
  - This is the closest existing thing to "fans flood the streamer's street".
- **`CityRemote` module** (`src/world/modules/CityRemote.tsx`) already listens on a BroadcastChannel (`rivet-city`) and applies commands. A `classroom-47` listener could sit next to it.
- **URL flags:** `?only=A,B`, `?skip=A,B`, `?stats`, `?embed=1`, `?autoplay=0`.
- **Benchmark:** run `window.__city.bench(30)` in the browser console.

## Integration: stream ↔ city (not connected)

| | Stream (`apps/stream`) | City (`apps/web`) |
|---|---|---|
| Channel | BroadcastChannel `classroom-47` | In-memory bus `world/bus.ts` + BroadcastChannel `rivet-city` |
| Port | 3000 by default | 3000 by default (run one of them on 3001) |
| `reality:fork` | `{ scenario, label, location, viewers }` | `{ scenario, label }`, never consumed |
| `streamer:location_leaked` | published | not declared |
| `surroundings.update` | consumed | doesn't exist |

**BroadcastChannel only works between pages on the same origin** (same host *and* port). To connect the two:
- serve the city inside the stream app, or the stream page inside `apps/web`; or
- put both behind one dev proxy; or
- use a websocket.

## Repo housekeeping

- **Root `package.json`:**
  - It is still named `delivery-ops-agent`.
  - `dev`, `build` and `lint` call `-w api`, which doesn't exist.
  - About 19 scripts point at a `scripts/` folder that doesn't exist.
- **`node_modules`:** none installed yet. Run `npm install` at the root.
- **Branches:** `feat/stream-app`, `feat/streaming-platform`, `feat/stream-ui`, `feat/mirror-button` and `fix/location-cams-and-type` are already merged into `main` (PRs #1–#4).

## Decisions the team needs to make now

1. **"No previous projects."** If the organisers enforce this, the imported `apps/web` is a risk:
   - its e2e report is dated 2026-10-10;
   - its Settings page links to hamyway-city.

   Options: keep it and say so openly, trim it down to what we use, or rebuild only the pieces we need. Confirm the rule on Discord.
2. **Which 3+ sponsor tools we actually ship.** Proposal:
   - YOLO crowd counts on a JamCam clip, cached.
   - Cosmos via the VSS Blueprint on the nearest clips.
   - W&B inference for chat and the advisor, with Weave traces.
   - VAST for clip ingest and search.

## Suggested next steps (in order, time-boxed)

1. **Unblock the `apps/web` build** (stub JSON, or drop the console imports from `CityPage`). Then run `npm install && npm run dev -w web` to confirm.
2. **Connect stream and city.** Add a `classroom-47` listener in the city:
   - on `reality:fork` / `streamer:location_leaked`, call `useParallelReality.getState().triggerWhatIf(...)` and fire a crowd `request:event`;
   - publish `surroundings.update` back with the recommendation.
3. **Make the demo arc play end to end** with cached data: the calm surroundings card, then Mirror, then the crowd surge with a danger warning, then a safer spot, then green.
4. **Wire one real sponsor call at a time, with caching and timeouts:**
   - YOLO (crowd counts)
   - Cosmos/VSS (incident reasoning)
   - W&B + Weave (chat and advisor)
   - VAST (ingest and search)
5. **Record the backup demo by 15:30, freeze code at 15:45, and submit before 16:30** (checklist in `AGENTS.md`).

## Owners (from `CLAUDE.md`)

- **Sonion (+ Claude):** the streaming platform (`apps/stream`).
- **Chris:** data sourcing (JamCams, TfL, Reddit) and feeding it into the stream and the city.
- **Arvin:** the 3D city and parallel-reality sim (`apps/web`).
