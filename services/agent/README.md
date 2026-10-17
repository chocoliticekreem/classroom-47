# Classroom 47 agent (`/app`)

The CAMP **A** layer: the agent runtime that runs on the team's VAST Kubernetes namespace and is
reachable at Ingress path `/app`. It is the piece that turns the platform (**P**: VSS search over the
pre-ingested footage, with Cosmos descriptions and YOLO detections) and the model services (**M**: W&B
serverless inference, traced in Weave) into one answer for a live IRL streamer:
`calm | busy | danger`, two sentences of advice, and the video moments that justify it.

Single file, two pip deps (`openai`, `weave`), stdlib HTTP server. Small enough for a ConfigMap.

## Endpoints (all under `/app`)

| Route | What |
|---|---|
| `GET /app/` | Dark single-file dashboard: ask "What's happening near the streamer?", see level, advice, evidence moments and the Weave link |
| `GET /app/health` | `{ok, vss: <login works>, wandb: <configured>}`. Never returns values |
| `POST /app/assess` | JSON `{question?, location?: {name, lat, lon}, yolo?: {people, vehicles, camera}}` → `{level, advice, reasons, evidence: [{video, start_s, end_s, description, similarity}], vss_answer, trace: {weave_project}}` |

CORS is open for GET/POST so the local `apps/stream` front end (`http://localhost:3047`) can call it.

Flow of one `/app/assess`:
1. Login to VSS (`POST /api/v1/auth/login`), JWT cached until its `exp`.
2. `POST /api/v1/agent/search-and-answer` with a streamer-safety query (crowds gathering, people moving
   towards or following the camera holder, people filming, blocked crossings), topped up with
   `POST /api/v1/search` (`top_k` 8, `min_similarity` 0.3) if it returned fewer moments.
3. One W&B inference chat call (`WANDB_MODEL`, default `Qwen/Qwen3.8-27B`; if that model fails, the
   first chat model from `models.list()`), wrapped in a `weave.op` so the whole assess shows up as one
   trace in `WANDB_TEAM/WANDB_PROJECT`.
4. The LLM's JSON is validated and repaired (level forced into the three values, advice capped).

Any upstream failure returns HTTP 502 `{"error": "<dependency> unavailable: <why>", "dependency": "vss"|"wandb"}`.
No stack traces, no values.

## Environment (names only, values live in `/config/<team>.config` on the VM)

| Variable | Used for |
|---|---|
| `USERNAME`, `PASSWORD` | VSS login |
| `INGRESS_URL` | VSS backend API base |
| `WANDB_API_KEY`, `WANDB_TEAM`, `WANDB_PROJECT` | W&B inference + Weave project |
| `WANDB_MODEL` | optional, default `Qwen/Qwen3.8-27B` |
| `PORT` | optional, default `8080` |
| `REQUEST_TIMEOUT_S` | optional, default `20` |
| `VSS_TOP_K`, `VSS_MIN_SIMILARITY` | optional, defaults `8` / `0.3` |

## Run locally

```bash
cd services/agent
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
USERNAME=… PASSWORD=… INGRESS_URL=… WANDB_API_KEY=… WANDB_TEAM=… WANDB_PROJECT=… .venv/bin/python app.py
# http://localhost:8080/app/
```

Without credentials it still starts: `/app/health` reports `vss: false, wandb: false` and `/app/assess`
returns a 502 naming the missing dependency.

## Deploy on the cluster (lab VM, Cursor)

Rules from the `vast-camp` skill: no Docker build on the VM, public `python:3.12-slim` image, code from a
ConfigMap, creds from a Secret, Ingress path `/app`, only your team's namespace.

1. Copy `app.py` and `requirements.txt` into the `vast-builders-challenge` checkout on the VM
   (for example `app/agent/`), or `git pull` this repo there.
2. In Cursor on the VM run **`/deploy-app-no-registry`** and answer its prompts with:
   - image: `python:3.12-slim`
   - app code: ConfigMap built from `app.py` + `requirements.txt`
     (`kubectl create configmap classroom47-agent --from-file=app.py --from-file=requirements.txt`)
   - secret: keys `USERNAME`, `PASSWORD`, `INGRESS_URL`, `WANDB_API_KEY`, `WANDB_TEAM`, `WANDB_PROJECT`
     read from `/config/<team>.config` with `grep '^KEY=' "$TEAM_CONFIG" | cut -d= -f2-`
     (never `source`, never echo them), exposed to the container with `envFrom: secretRef`
   - container command: `sh -c "pip install -r /app/requirements.txt && python /app/app.py"`
     with the ConfigMap mounted at `/app` and `PORT=8080`
   - container port `8080`, Service port `8080`, Ingress host `video-lab-team-<N>.cosmos.vastdata.com`,
     path `/app` (the app serves `/app/...` itself, so no path rewrite)
3. Check: `kubectl -n <team-namespace> get pods,svc,ingress` and
   `kubectl -n <team-namespace> logs deploy/classroom47-agent` should show `agent listening on :8080`.
4. Open https://workshop.thecosmoslabs.com → **App**. `/app/health` should return `"vss": true, "wandb": true`.

To update: recreate the ConfigMap (`kubectl create configmap … --dry-run=client -o yaml | kubectl apply -f -`)
and `kubectl rollout restart deploy/classroom47-agent`.

## Deployed (team 47, verified 17 Oct 2026 12:50 BST)

Namespace `team-47`: Deployment/Service/Ingress `classroom47-agent`, ConfigMap `classroom47-agent-code`
(`app.py` + `requirements.txt`), Secret `classroom47-agent-creds` (keys `INGRESS_URL`, `USERNAME`, `PASSWORD`,
`WANDB_API_KEY`, `WANDB_TEAM`, `WANDB_PROJECT`, `WANDB_MODEL`; `INGRESS_URL` points at the in-cluster
`video-backend-service`). `WANDB_MODEL` is `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B`. Weave project
`anson9m23-chocoliticekreem-codes/classroom-47`. `/app/health` → `{"ok": true, "vss": true, "wandb": true}`.

## Evaluate the search the agent depends on

`eval_search.py` runs the eight streamer-safety queries in `eval_queries.json` through `POST /api/v1/search`
and reports hit@k (an expected camera appears in the top-k moments). Stdlib only, so it runs on the lab VM:

```bash
INGRESS_URL=$INGRESS_URL USERNAME=$USERNAME PASSWORD=$PASSWORD python3 eval_search.py --top-k 8 --json before.json
# re-ingest with our prompt (ingest/reingest-videos), then run it again and compare
```

Result on 17 Oct 12:50 BST, before any re-ingest: **hit@8 = 7/8**; the miss is "someone filming the camera
holder or following them" (2 moments, none from an expected camera). The table is in the root README.

## Try it

```bash
APP=https://video-lab-team-47.cosmos.vastdata.com   # the public app host, not INGRESS_URL
curl -s "$APP/app/health"
curl -s -X POST "$APP/app/assess" -H 'Content-Type: application/json' -d '{
  "question": "Is a crowd building around me?",
  "location": {"name": "Tower Hill", "lat": 51.5098, "lon": -0.0766},
  "yolo": {"people": 42, "vehicles": 6, "camera": "JamCams_00001.07501"}
}'
```

Weave traces: https://wandb.ai/<WANDB_TEAM>/<WANDB_PROJECT>/weave
