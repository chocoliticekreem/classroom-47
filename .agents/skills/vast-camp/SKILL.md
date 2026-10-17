---
name: vast-camp
description: >-
  Use when building, wiring or deploying any Mirrorverse feature for the VAST Builders Challenge.
  Every feature must run on the event's CAMP stack: Cursor coding agent, VAST agent runtime,
  NVIDIA + CoreWeave model services, VAST platform. This skill covers the layer map, how to reach
  the team's VSS backend, GPU models and W&B inference from the lab VM, how to deploy our app on
  the cluster, the organisers' judging criteria (including a small evaluation run), the rules
  (pre-ingested footage only, no internet video into VAST), and a map of the official VAST guide
  and skills, which are vendored as the `vast-builders-challenge/` submodule.
---

# VAST CAMP stack for Mirrorverse

The organisers' rule for the day is that the project must be built on **CAMP**. Each layer is a sponsor:

| Layer | Sponsor | What's already running | What we build or use |
|---|---|---|---|
| **C**: coding agent | SpaceXAI (Cursor) | Cursor credits. A lab VM `bc-<username>`, reached by Cursor Remote-SSH, with the official repo `vast-builders-challenge` and its `.cursor/skills` | Build everything in Cursor connected to the VM. Start with `/build-day-quickstart` |
| **A**: agent runtime | VAST | A Kubernetes namespace per team, plus the `/deploy-app-no-registry` skill | Our agent and app, deployed on the cluster at path `/app`. People open it at workshop.thecosmoslabs.com → **App** |
| **M**: model services | NVIDIA + CoreWeave | On CoreWeave GPUs: Cosmos3-Reason, Cosmos Embed1, YOLO11, Canary-1B ASR. W&B serverless LLM inference | The agent's reasoning on W&B inference, traced in Weave. Cosmos and YOLO results come through VSS search and re-ingest |
| **P**: platform | VAST | NVIDIA VSS Blueprint on VAST: S3 buckets, then DataEngine (Segmenter → Detector/YOLO → Reasoner/Cosmos → Embedder → VastDB writer), then VastDB. The VSS UI and API | Query the team's index. Re-ingest pre-loaded footage with our own Cosmos prompt |

## The official guide is in this repo

`vast-builders-challenge/` at the repo root is a **git submodule** of
https://github.com/vast-data/vast-builders-challenge, which is the source of truth.
- **Fetch it:** `npm run vast:guide`, or `git submodule update --init vast-builders-challenge`.
- **Why a submodule:** the guide has no licence, so we link to it instead of copying it.
- **Read first:** `README.md` (the build-day flow), `ARCHITECTURE_REFERENCE.md` (models, the DataEngine pipeline, the **video packs**) and `.cursor/rules/build-day.mdc` (the organisers' agent rules).

The same repo is **pre-cloned on the lab VM**, with team credentials in `/config/`. Run the official skills **there**; read them here.

| Need | Official skill (`vast-builders-challenge/.cursor/skills/…`) |
|---|---|
| Guided first hour | `build-day-quickstart` (the Test Drive loop) |
| Stuck or unsure | `ask-cosmos` (health check plus a redacted help note; never posts anything) |
| JWT login | `retrieval/login` |
| Moments | `retrieval/search` (`POST /api/v1/search`) |
| Answers with evidence | `retrieval/agent-qa` (`/agent/ask`, `/agent/search-and-answer`, `/tools/*`) |
| Play, inspect or summarise one video | `retrieval/videos` (`/videos/stream?token=`, `/videos/detections`, `POST /videos/synthesize`) |
| Valid filters and ingest options | `retrieval/list-metadata` (`/metadata/schema`, `/metadata/values`, `/metadata/ingest-config`) |
| Ingest health and object stats | `retrieval/dashboard` (`/dashboard/stats`) |
| Suggested queries | `retrieval/suggest-prompts` (`/suggestions`) |
| Re-ingest with our prompt | `ingest/reingest-videos`, `ingest/reingest-chunk` (`POST /api/v1/dashboard/reingest`) |
| New local video | `ingest/upload-video` (`POST /api/v1/videos/upload`; see the footage rule) |
| Our own tables in VastDB | `vast-database/vastdb-write`, `vastdb-read` (vastdb SDK on the data VIP) |
| Model health and direct calls | `gpu/README`, `gpu/model-health`, `gpu/model-smoke-test` |
| Deploy our app | `deployment/deploy-app-no-registry` (the other deployment skills are for the VSS stack itself; don't use them) |

## Rules (break these and it doesn't count)

1. **Footage:**
   - Build on the **pre-ingested corpus** and re-ingest it with our own prompt.
   - **Never ingest internet video** (YouTube, TfL clips, etc.). The organisers chose the corpus for its licensing.
   - An `upload-video` skill exists, but `ARCHITECTURE_REFERENCE.md` says the challenge path is re-ingest only. **Ask in the Cosmos workshop before uploading anything, even our own phone footage.**
2. **The agent and app must run on the cluster** (Ingress path `/app`). A server on a laptop doesn't count as the agent runtime.
3. **Don't rebuild or redeploy the DataEngine pipeline or the VSS stack.** Use the skills. Don't drop `vss-collection` or `vss-prompts-events`.
4. **Pick the team number once**, and only the one the organisers assigned. Everyone on the team shares one pipeline, one index and one set of credentials.
5. **Only 1–2 people run big re-ingests.** Try a few clips first.
6. **Never print, commit or paste credentials.** They live in `/config/<team>.config` on the VM, and this repo is public.
   - List variable names only: `env | cut -d= -f1 | sort`. Never run bare `env` or `printenv`.
   - Don't hardcode credentials, and don't edit `/etc/hosts`.
7. **Use a matching official skill before writing raw REST calls** (`build-day.mdc`).
8. **Build a web app, CLI or script.** Not a native or mobile app; the VM can't demo one.
9. **Stay in our team's namespace, buckets and credentials.**

## How we're judged (organisers' slides) and what to build for it

| Criterion | Judges ask | Build or show |
|---|---|---|
| **Idea** | A compelling use of the **video search and summary stack provided**? | VSS search and Q&A at the heart of the agent, not a side call |
| **Technical implementation** | High quality, easy to follow, reproduce and evaluate. **Inputs, outputs and evaluation steps documented**? | A README section on inputs, outputs and evaluation, and a small evaluation run (below) |
| **Design** | Intuitive UX? | One flow: stream → "should I tell chat?" → verdict → safer spot |
| **Impact** | Used **at least 3 sponsor tools** effectively? | Name and show each one: Cursor, VAST (VSS, VastDB, cluster), NVIDIA Cosmos and YOLO, W&B + Weave, CoreWeave |
| **Presentation** | A **2-minute** live demo (demos > slides). The top 5 give 3 minutes at 18:00 | Rehearse both lengths, and keep a backup recording |

**A minimal evaluation run** (covers the Technical criterion):
1. Pick 5–10 test questions, for example "crowd gathering at the crossing", each paired with the clip or segment you expect it to find.
2. Run them through VSS `/api/v1/search` before and after our re-ingest prompt.
3. Record hit@k and the agent's verdicts.
4. Log the whole run in **Weave** (`weave.Evaluation`, or traced calls plus a results table).
5. Put the table and the command that reproduces it in the README.

## CAMP principles from the organisers' slides

- **Integration contract: no copied data pipelines, and permissions travel with the context.** Query VAST (VSS and VastDB) when a request comes in, instead of exporting the data into our own store.
- **The agent runtime carries tools, context, state and traces.** Trace the agent loop in Weave, and keep its state on the cluster side.
- **Model services can switch providers without rebuilding the app.** Keep model ids and endpoints in env vars, not in code.
- **Context is built on demand from the platform:** data (files, objects, tables, logs), tool calls and results, plus retrieval (vector search, interaction history). VSS search plus VastDB is our context supply.

## Access (once per person; the organisers' "Workshop quick start" slide)

1. **Venue Wi-Fi:** `Halkin-WiFi Guest`. The password is on the slide or venue sign. Never commit it.
2. **Cosmos:** join https://community.vastdata.com/c/workshop.
3. **Workshop access:** sign in at https://workshop.thecosmoslabs.com with the email you registered with.
4. **Launch VM:** enter the passcode from the quick-start slide (ask the team). Never commit it.
5. **Team:** pick **Team-1…Team-50**, only once, using the number we were assigned.
6. **Create an SSH key:**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_cursor -C "cursor-vm"
   pbcopy < ~/.ssh/id_ed25519_cursor.pub
   ```
   Paste the public key on the lab page under **Option 1 - Key**, then follow the lab page to connect once from a terminal.
7. **Connect from Cursor:** Connect via SSH → host `bc-<username>` → open `vast-builders-challenge`. Set the model to **Auto**.
8. **Health check:** in Cursor, ask `run a git pull`, then `check that everything is working`. If it fails, run `/ask-cosmos` and post the note it writes in the Cosmos Community Workshop category.
9. **See what's indexed:** open the Video Search & Summary UI from the lab page (Search, Explore and Dashboard tabs).

## What's on the VM (names only; values come from `/config/<team>.config`)

| Area | Variables |
|---|---|
| Team login | `USERNAME` (`team-<N>`), `PASSWORD` |
| VSS backend | `INGRESS_URL` (backend API base), `PIPELINE` |
| S3 | `S3_ENDPOINT`, `ACCESS_KEY`, `SECRET_KEY`, `S3_CHUNKS_BUCKET`, `S3_SEGMENTS_BUCKET` |
| VastDB | `VDB_ENDPOINT`, `VASTDB_BUCKET`, `VDB_SCHEMA=vss-schema`, `VDB_COLLECTION=vss-collection`, `VDB_PROMPTS_COLLECTION` |
| GPU models | `COSMOS3_REASON_URL`, `YOLO_URL`, `COSMOS_EMBED1_URL`, `CANARY_1B_URL` (each on its own host and port). The official `gpu/` skills also load a `GPU_BEARER_TOKEN` |
| W&B | `WANDB_API_KEY`, `WANDB_TEAM`, `WANDB_PROJECT` |
| Kubernetes | `KUBECONFIG=/config/team-<N>-k8s.yaml` |

Parse the config with `grep '^KEY=' "$TEAM_CONFIG" | cut -d= -f2-` rather than `source`. On zsh, `USERNAME` is a reserved variable.

## Footage: which packs fit Mirrorverse (`ARCHITECTURE_REFERENCE.md#video-corpus-already-indexed`)

One pipeline and one index cover six "packs". You filter them by `camera_id`, `location` or `capture_type`, and by detected object class.

| Pack | `camera_id` | What it shows | Fit for us |
|---|---|---|---|
| **F: Indoor smart spaces** ("Crowds") | `smartspace_cam-1` | ~102 indoor facility clips: occupancy, people flow | **Best for crowd density and people gathering** |
| **E: SF streets** | `sf_streets_cam-1…4` | 4 fixed street cams: pedestrians crossing, busy intersections ("ingesting soon") | **Best for street crowds**, once indexed |
| **B: Toronto live driving** | `pie_cam-3` | 6 long forward-facing drives: pedestrians near the curb | Forward-facing camera, the closest thing to a moving streamer |
| D: Neighbourhood streets | `neighborhood_cam-1` | Residential car activity over 2 days | Weak fit |
| A: Highway multi-cam | `i24_cam-1` | ~51 I-24 multi-camera highway clips | Not our story |
| C: Warehouse safety | `sdg_warehouse_cam-2` | ~178 forklift and aisle clips | Not our story |

- **Re-ingest scenario presets:** `surveillance`, `traffic`, `live_driving`, `retail`, `warehouse`, `egocentric`, `sports`, `nhl`, `general`. Or write a custom prompt.
- **Possible London footage:** the `reingest-chunk` skill's example file is `…london-luxury-walk_chunk_0000.mp4`. Search Explore for "london walk"; it may be in our archive.
- **The organisers' anchor demo query:** "person close to a moving vehicle", which pulls hits from every pack.
- **Their advice:** start with one pack, prove search → filters → UI, then expand. The winning story is *problem → video archive → search and filters across cameras → insight or action*.

## Calling VSS (platform data, Cosmos and YOLO results)

```bash
TOKEN=$(curl -s -X POST "$INGRESS_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Moments: ranked segments with timestamps, Cosmos description and similarity
curl -s -X POST "$INGRESS_URL/api/v1/search" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"crowd of pedestrians gathering at the crossing","top_k":10,"min_similarity":0.3}'

# An answer, with evidence (the built-in agent)
curl -s -X POST "$INGRESS_URL/api/v1/agent/search-and-answer" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"is a crowd building near the camera?","top_k":10}'
```

- **Also available:** `POST /api/v1/agent/ask` with `{question, original_video?, top_k}`.
- **`search` response:**
  - `results[]` is moments (segment, `similarity_score`, Cosmos `reasoning_content`);
  - `chunk_results[]` is "which video" (`original_video`, `best_match_start_sec/end_sec`, `preview_source`);
  - `llm_synthesis` is a written summary.
- **Filtering:** use `min_similarity` 0.3–0.5. Only filter on fields that `/metadata/schema` returns; don't guess column names. Tags go in `tags[]`.
- **Video playback** takes the JWT as `?token=` (`/videos/stream`, `/videos/playback-url`).
- **Routes that don't exist** (don't invent them): `/reports`, `/alerts`, `/analytics`, `/videos/ask`, `/tags`, `/locations`.

### Our own agent: orchestrate the VSS tools (A layer)

`/api/v1/tools/*` exists so you can build your own agent:
- `POST tools/search`
- `GET tools/segments?original_video=`
- `GET tools/segment?source=`
- `GET tools/detections?source=` (YOLO boxes)
- `GET tools/explore`
- `POST tools/synthesize`

Our agent calls these as tools, reasons on W&B, and stores what it decided (below). Other building blocks:
- `POST /api/v1/videos/synthesize` `{original_video, question, max_segments}` summarises a whole video;
- `GET /api/v1/dashboard/stats` gives object counts and ingest health;
- `GET /api/v1/suggestions` gives generated queries and key events.

### Store the agent's verdicts in VastDB (P layer)

Use the official `vast-database/vastdb-write` skill (vastdb SDK, **data VIP = `S3_ENDPOINT`**). Create our own schema and table in our `VASTDB_BUCKET`, for example `classroom47.verdicts` with `(at, query, level, reason, evidence_source, model)`. Read it back with `vastdb-read`.

This makes VAST the agent's memory, which is a strong story for the "Platform" judges.
- Never drop or rewrite `vss-collection` or `vss-prompts-events`.
- Never call `select()` on `vss-collection` without a column list; the vector columns crash the SDK.

### Direct model calls (M layer, optional)

The `gpu/` skills load `GPU_BEARER_TOKEN` from the config.
- **Cosmos3-Reason** (`$COSMOS3_REASON_URL/v1/chat/completions`, OpenAI-style) accepts `{"type":"video_url","video_url":{"url":"data:video/mp4;base64,…"}}`, so it can reason directly over a clip.
- **YOLO11:** `POST $YOLO_URL/v1/infer {video_base64, filename, include_frames}`. Health check is `GET /healthz`.
- **Embed1:** 256-dim vectors (`request_type: "query"`).
- **Canary-1B ASR:** `POST $CANARY_1B_URL/v1/audio/transcriptions` (multipart `file`). It isn't in the pipeline.
  - **Idea:** transcribe the stream's audio, and flag when the streamer says where they are.
- Health checks differ per model; see `gpu/model-health`. A 404 on `/v1/models` for YOLO or Canary is normal.

## Re-ingest with our prompt (Cosmos does the real reasoning)

Cosmos3-Reason only writes down what the ingest prompt asks about. For Mirrorverse, ask it to describe:
- how many people there are and how dense the crowd is;
- whether people are gathering or moving towards the camera or one spot;
- whether anyone is filming, pointing a phone at, or following the camera holder;
- blocked crossings, vehicles stopping for crowds.

**How to run it:**
- Use the official `ingest/reingest-videos` skill (whole video or stream, latest N chunks) or `ingest/reingest-chunk` (one Explore card). It asks you to confirm the target, the prompt mode and the chunk count.
- Under the hood it's `POST /api/v1/dashboard/reingest {original_video | stream_id, chunk_count, scenario | custom_prompt, camera_id?, capture_type?, location?}`. Poll `GET /api/v1/dashboard/reingest/<job_id>` every 4 s.
- A `custom_prompt` can be **up to 800 characters**, and it overrides `scenario`.
- The current prompt isn't stored anywhere you can read back, so **keep our prompt text in this repo**.
- Wait a few minutes, check the Dashboard tab, then search again.

**The organisers' Test Drive loop** (`build-day-quickstart`):
1. Look at what's indexed.
2. Search for our idea.
3. Ask a question instead of searching.
4. Search for a gap, and expect it to come back empty.
5. Re-ingest with a prompt that describes the gap.
6. Search again; it should match now.

If the loop works, the stack is healthy.

## Agent reasoning on W&B inference, traced in Weave (M layer)

W&B inference is OpenAI-compatible.

```python
import os, weave
from openai import OpenAI
weave.init(f"{os.environ['WANDB_TEAM']}/{os.environ['WANDB_PROJECT']}")   # every call is traced
llm = OpenAI(base_url="https://api.inference.wandb.ai/v1", api_key=os.environ["WANDB_API_KEY"],
             project=f"{os.environ['WANDB_TEAM']}/{os.environ['WANDB_PROJECT']}")
```

- To pick a model, list what's available with `llm.models.list()`. Our planned defaults are in `services/vision/.env.example`.
- The agent loop: the VSS tools (`tools/search`, `tools/detections`, `agent/search-and-answer`) → the LLM decides `calm | busy | danger` plus advice → write the verdict to VastDB → app.
- Show the Weave trace in the demo; the W&B judge looks for it.

## Deploy the agent and app on the cluster (A layer)

Use the official `/deploy-app-no-registry` skill:
- a public `python:3.12-slim` image;
- **app code from a ConfigMap (about 1 MiB in total)**;
- VSS credentials from a Secret;
- Deployment + Service + Ingress on `video-lab-team-<N>.cosmos.vastdata.com`, **path `/app`**.

Open it from https://workshop.thecosmoslabs.com → **App**. Don't use `$INGRESS_URL` for that; it's the internal VSS API.

**Mechanics** (from the skill):
- **Code:** `tools/<app>/main.py`, plus an optional `requirements.txt` that's pip-installed when the container starts.
- **Serving:** listen on `0.0.0.0:$PORT` and serve `/` and `/health`. The Ingress strips the `/app` prefix.
- **Credentials:** the app reads `VSS_URL`, `VSS_USERNAME` and `VSS_PASSWORD` from the Secret, logs in once, and reuses the JWT.
- **After a code change:** recreate the ConfigMap, then `kubectl -n $NS rollout restart deploy/<app>`. A running pod doesn't pick up ConfigMap changes.
- **Image:** `node:22-slim` is allowed if Python is wrong, but there's still no build or push, and the ConfigMap stays under 1 MiB.
- **Never:** a second hostname, path `/`, or "run it locally" as the deliverable.
- **Our agent's Secret keys differ from the official template.** The template injects `VSS_URL`, `VSS_USERNAME` and `VSS_PASSWORD`. `services/agent` reads `USERNAME`, `PASSWORD`, `INGRESS_URL`, `WANDB_API_KEY`, `WANDB_TEAM` and `WANDB_PROJECT`. Create the Secret with those names (`envFrom: secretRef`), following `services/agent/README.md`.

What this means for us:
- Keep the deployed part **small**: a Python agent API plus a light dashboard.
- Our Next.js apps (`apps/stream`, `apps/web`) are far too big for a ConfigMap. They stay as local front ends and read the agent's output, if `/app` is reachable from a laptop. Check that after the first deploy.

## Where Mirrorverse code sits today

| Piece | Layer | On CAMP? |
|---|---|---|
| `apps/stream`: stream page, Around me (TfL cams, buses, disruptions, weather), `/api/around/*`, the `/twin` 3D mirror (real OSM Tower Hill, real-vs-simulated CCTV compare, first-person streamer view, live weather, dev panel) | front end | Runs locally. Fine as a front end |
| `services/yolo/server.py`: local YOLO on TfL JamCams (`npm run yolo`, port 8047) | M (extra) | **No.** It's local, on internet video. Treat it as a live-London bonus, not the VAST path |
| `services/vision/`: Cosmos/W&B clients, London live-cam catalogue (YouTube via yt-dlp) | M | W&B client, yes. Cosmos via build.nvidia.com is outside the VAST env; prefer the VM's `COSMOS3_REASON_URL`. YouTube footage must **never** go into VAST |
| `apps/web`: 3D city | front end | Runs locally. See `HANDOFF.md` for the build blocker |
| `services/agent/app.py`: **the CAMP agent** (PRs #8, #10). Stdlib HTTP plus `openai` and `weave` | A + P + M | **Code done; deploy it.** It runs VSS `agent/search-and-answer` + `search` (Cosmos text and YOLO counts as evidence), then one W&B call traced in Weave, and returns `calm/busy/danger` + advice. Routes `/app/`, `/app/health`, `POST /app/assess` (works with or without the `/app` rewrite). How to deploy: `services/agent/README.md`. It doesn't yet write to VastDB or use `tools/*` |
| `services/predict/`: a MiroFish-style 30-minute forecast seeded from the live twin (PR #11), port 8048 | M (W&B + Weave) | Runs locally. It reads the twin's routes, so on the cluster it would need the VSS detections instead |
| `vast-builders-challenge/` (submodule) | C (reference) | The official guide and skills, read-only. Never edit it |

## Gotchas

- **Two YOLO variables:** `JAMCAM_YOLO_URL` is our local TfL server (`apps/stream`, default `http://127.0.0.1:8047`, renamed in PR #7). `YOLO_URL` on the VM is the shared YOLO11 GPU endpoint, which has a different API. Don't mix them up.
- **An empty search:**
  1. Check that the filter values exist (`list-metadata`).
  2. Check that nothing is still indexing (`dashboard`: `pending_index`).
  3. Then assume the ingest prompt never asked about that thing, and re-ingest. Don't debug the search.
- The VM can't build Docker images. Use the no-registry deploy only.
- Only ever change things in your own team's namespace.
- **When stuck:** run the official `ask-cosmos` skill. It writes a 5-line note (`Team / Trying to / Happened / Tried / Health check`) with URLs, IPs, names and tokens redacted. Post it yourself at https://community.vastdata.com/c/workshop/27.
- **No submission skill:** submit at https://tokensand.com/vastlondon (see `AGENTS.md`).
