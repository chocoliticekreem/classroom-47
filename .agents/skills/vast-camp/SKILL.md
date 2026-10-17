---
name: vast-camp
description: >-
  Use when building, wiring or deploying any Classroom 47 feature for the VAST Builders Challenge.
  Every feature must run on the event's CAMP stack: Cursor coding agent, VAST agent runtime,
  NVIDIA + CoreWeave model services, VAST platform. This skill covers the layer map, how to reach
  the team's VSS backend, GPU models and W&B inference from the lab VM, how to deploy our app on
  the cluster, the organisers' judging criteria (including a small evaluation run), and the rules
  (pre-ingested footage only, no internet video into VAST).
---

# VAST CAMP stack for Classroom 47

The organisers' rule for the day is that the project must be built on **CAMP**. Each layer is a sponsor:

| Layer | Sponsor | What's already running | What we build or use |
|---|---|---|---|
| **C**: coding agent | SpaceXAI (Cursor) | Cursor credits. A lab VM `bc-<username>`, reached by Cursor Remote-SSH, with the official repo `vast-builders-challenge` and its `.cursor/skills` | Build everything in Cursor connected to the VM. Start with `/build-day-quickstart` |
| **A**: agent runtime | VAST | A Kubernetes namespace per team, plus the `/deploy-app-no-registry` skill | Our agent and app, deployed on the cluster at path `/app`. People open it at workshop.thecosmoslabs.com → **App** |
| **M**: model services | NVIDIA + CoreWeave | On CoreWeave GPUs: Cosmos3-Reason, Cosmos Embed1, YOLO11, Canary-1B ASR. W&B serverless LLM inference | The agent's reasoning on W&B inference, traced in Weave. Cosmos and YOLO results come through VSS search and re-ingest |
| **P**: platform | VAST | NVIDIA VSS Blueprint on VAST: S3 buckets, then DataEngine (Segmenter → Detector/YOLO → Reasoner/Cosmos → Embedder → VastDB writer), then VastDB. The VSS UI and API | Query the team's index. Re-ingest pre-loaded footage with our own Cosmos prompt |

Official guide (source of truth): https://github.com/vast-data/vast-builders-challenge. Read `README.md`, `BEFORE_YOU_BUILD.md` and `ARCHITECTURE_REFERENCE.md` there.

## Rules (break these and it doesn't count)

1. **Only use the pre-ingested footage**: dashcam clips of pedestrians at crossings, overhead highway multi-camera footage, a neighbourhood camera.
   - Re-ingesting it with a new prompt is allowed.
   - Don't upload new chunks, and **never put internet video (YouTube, TfL, etc.) into VAST.**
2. **The agent and app must run on the cluster** (Ingress path `/app`). A server on a laptop doesn't count as the agent runtime.
3. **Don't rebuild or redeploy the DataEngine pipeline or the VSS stack.** Use the skills.
4. **Pick the team number once**, and only the one the organisers assigned. Everyone on the team shares one pipeline, one index and one set of credentials.
5. **Only 1–2 people run big re-ingests.** Try a few clips first.
6. **Never print, commit or paste credentials.** They live in `/config/<team>.config` on the VM. This repo is public.

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

- Also available:
  - `POST /api/v1/agent/ask` with `{question, original_video?, top_k}`
  - `/api/v1/tools/*` (search, segments, detections, explore, synthesize)
- Video playback takes the JWT as `?token=` (`/videos/stream`, `/videos/playback-url`).
- To find valid filters, use the official `retrieval/list-metadata` skill.

## Re-ingest with our prompt (Cosmos does the real reasoning)

Cosmos3-Reason only writes down what the ingest prompt asks about. For Classroom 47, ask it to describe:
- how many people there are and how dense the crowd is;
- whether people are gathering or moving towards the camera or one spot;
- whether anyone is filming, pointing a phone at, or following the camera holder;
- blocked crossings, vehicles stopping for crowds.

Run it with the official `ingest/reingest-videos` or `ingest/reingest-chunk` skill. It asks you to confirm the target, the prompt and the chunk count. Wait a few minutes, check the Dashboard tab, then search again.

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
- The agent loop: VSS search-and-answer plus YOLO counts → LLM decides `calm | busy | danger` plus advice → app.
- Show the Weave trace in the demo; the W&B judge looks for it.

## Deploy the agent and app on the cluster (A layer)

Use the official `/deploy-app-no-registry` skill:
- a public `python:3.12-slim` image;
- **app code from a ConfigMap (about 1 MiB in total)**;
- VSS credentials from a Secret;
- Deployment + Service + Ingress on `video-lab-team-<N>.cosmos.vastdata.com`, **path `/app`**.

Open it from https://workshop.thecosmoslabs.com → **App**. Don't use `$INGRESS_URL` for that; it's the internal VSS API.

What this means for us:
- Keep the deployed part **small**: a Python agent API plus a light dashboard.
- Our Next.js apps (`apps/stream`, `apps/web`) are far too big for a ConfigMap. They stay as local front ends and read the agent's output, if `/app` is reachable from a laptop. Check that after the first deploy.

## Where Classroom 47 code sits today

| Piece | Layer | On CAMP? |
|---|---|---|
| `apps/stream`: stream page, Around me (TfL cams, buses, disruptions, weather), `/api/around/*`, the `/twin` 3D mirror (real OSM Tower Hill, real-vs-simulated CCTV compare, first-person streamer view, live weather, dev panel) | front end | Runs locally. Fine as a front end |
| `services/yolo/server.py`: local YOLO on TfL JamCams (`npm run yolo`, port 8047) | M (extra) | **No.** It's local, on internet video. Treat it as a live-London bonus, not the VAST path |
| `services/vision/`: Cosmos/W&B clients, London live-cam catalogue (YouTube via yt-dlp) | M | W&B client, yes. Cosmos via build.nvidia.com is outside the VAST env; prefer the VM's `COSMOS3_REASON_URL`. YouTube footage must **never** go into VAST |
| `apps/web`: 3D city | front end | Runs locally. See `HANDOFF.md` for the build blocker |
| Agent and app on the cluster at `/app` | A + P + M | **Missing. Build this first** |

## Gotchas

- **Two YOLO variables:** `JAMCAM_YOLO_URL` is our local TfL server (`apps/stream`, default `http://127.0.0.1:8047`, renamed in PR #7). `YOLO_URL` on the VM is the shared YOLO11 GPU endpoint, which has a different API. Don't mix them up.
- An empty search usually means the ingest prompt never asked about that thing. Re-ingest; don't debug the search.
- The VM can't build Docker images. Use the no-registry deploy only.
- Only ever change things in your own team's namespace.
