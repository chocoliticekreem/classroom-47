# Compliance with the official VAST Builders Challenge guide

Audit of Classroom 47 against `vast-builders-challenge/` (the official guide, submodule at the repo root)
and the organisers' slides (`AGENTS.md`). Status verified **17 October 2026, 12:50 BST** by reading the
code and running read-only checks against the team-47 cluster from the lab VM. Nothing here is claimed
from intent.

## Do next, ranked by judging impact

| # | Gap | Why it scores | Exactly how (official skill / command) | Who, time |
|---|---|---|---|---|
| 1 | **Re-ingest a few clips with our streamer-safety Cosmos prompt** | *Idea* and *Technical*: the guide's whole loop is search → gap → re-ingest → search again. Our eval shows the gap: "someone filming the camera holder or following them" is the one query that misses (hit@8 = 7/8, `services/agent/eval_search.py`). A before/after table is the strongest evidence we can show the NVIDIA and VAST judges | In Cursor on the VM: `/ingest-reingest-videos` (or `reingest-chunk` for one Explore card). Target: an `sf_streets_cam-*` or `nyc_streets_cam-*` chunk, **1 chunk**. Prompt mode: *Custom prompt* (≤ 800 chars), text below. Metadata: keep. Under the hood: `POST /api/v1/dashboard/reingest {"original_video": "<s3-uri>", "chunk_count": 1, "custom_prompt": "..."}`, poll `GET /api/v1/dashboard/reingest/<job_id>`. Then re-run `python3 services/agent/eval_search.py --json after.json` and paste both tables in the README | 1 person (rule: 1–2 re-ingesters), 10 min incl. wait |
| 2 | **Store each verdict in our own VastDB table** | *Impact* and the VAST judges: makes VAST the agent's memory, not just its search index. The CAMP slide: "the agent runtime carries tools, context, state" | `vast-builders-challenge/.cursor/skills/vast-database/vastdb-write` (`insert.py --schema classroom47 --table verdicts --json rows.json`, data VIP = `S3_ENDPOINT`). Minimal: after each `/app/assess`, append `{at, question, level, evidence_source, model}`; read back with `vastdb-read`. Needs `vastdb` + `pyarrow` in `requirements.txt` and `S3_ENDPOINT`, `ACCESS_KEY`, `SECRET_KEY`, `VASTDB_BUCKET` in the Secret. Never touch `vss-collection` | 1 person, 30 min |
| 3 | **Use the VSS agent tools, not only `search-and-answer`** | *Idea*: "a compelling use of the video search and summary stack". `tools/detections?source=` gives YOLO boxes per segment; `tools/segments?original_video=` gives the timeline around a hit | `retrieval/agent-qa` skill, section "Agent tools": `GET /api/v1/tools/detections?source=<preview_source>`, `GET /api/v1/tools/segments?original_video=`. Add one call per top evidence moment in `services/agent/app.py`, show the box counts in the advisor card | 1 person, 30 min |
| 4 | **Show a VSS search from the product** | *Design*: the streamer types "is anyone following me?" and sees the ranked clips with Cosmos text, not only the verdict. Today the evidence list is shown but search is agent-only | Reuse `POST /app/assess` (`evidence[]` already carries `video`, `start_s`, `end_s`, `description`, `similarity`, `camera`, `counts`); add a free-text search box in the advisor card. Playback: `GET /api/v1/videos/stream?token=` (`retrieval/videos`) needs the JWT, so proxy it through the agent | 1 person, 30 min |
| 5 | **Record the backup demo and submit with every teammate listed** | *Presentation*; a late or incomplete submission is rejected | `docs/DEMO.md`; form at https://tokensand.com/vastlondon → *Submit your project* before **16:30 BST** | 1 person, 15:30 and 16:15 |
| 6 | Canary-1B ASR on the stream audio: flag when the streamer says where they are | Extra sponsor depth (NVIDIA); the guide invites it ("let your imagination go and hook it in") | `gpu/model-smoke-test`: `POST $CANARY_1B_URL/v1/audio/transcriptions` (multipart `file`) | Stretch only |

**Our re-ingest prompt** (keep it here; VSS does not store it anywhere readable):

> Describe the scene for a person live-streaming from a phone at street level. State how many people are
> visible and how dense the crowd is (sparse, moderate, dense, crush risk). Say whether people are gathering,
> moving towards one spot, or moving towards the camera. Say whether anyone is pointing a phone at, filming,
> watching or following the camera holder. Note blocked crossings, vehicles stopping for pedestrians, and
> anything that would make it unsafe to stand still here. Be concrete and short.

## Requirement → status

Sources: `G/README.md` = `vast-builders-challenge/README.md`; `G/ARCH` = `ARCHITECTURE_REFERENCE.md`;
`G/BYB` = `BEFORE_YOU_BUILD.md`; `G/rules` = `.cursor/rules/build-day.mdc`; `G/skills/<x>` = `.cursor/skills/<x>/SKILL.md`;
`slides` = the organisers' judging slides as recorded in `AGENTS.md`.

### What to build

| Requirement | Source | Status | Evidence | Action |
|---|---|---|---|---|
| A video agent: understands video and does something useful with it (search, ask, spot events, trigger an action) | `G/BYB` "What you're building"; `G/README.md` §1 | **done** | `services/agent/app.py`: VSS `agent/search-and-answer` + `search` → Nemotron verdict → `calm/busy/danger` + advice; shown in the stream page advisor card (`apps/stream/src/platform/agent/useAdvisor.ts`) | – |
| One narrow idea, working, shipped by end of day | `G/BYB`; `slides` | **done** | "Should I tell chat where I am?" → verdict → safer spot | Keep scope; no new features after 15:45 |
| Adapt the idea to the footage provided | `G/BYB` "Hold the use case loosely" | **done** | Agent evidence comes from `sf_streets_cam-*`, `nyc_streets_cam-*`, `smartspace_cam-1` (street crowds, indoor crowds) | – |
| Web app, CLI or script, not a native app | `G/rules`; `G/skills/build-day-quickstart` step 4 | **done** | Agent dashboard at `/app/`; Next.js front end | – |

### CAMP layers and sponsor usage

| Requirement | Source | Status | Evidence | Action |
|---|---|---|---|---|
| **C**: build with Cursor on the lab VM over Remote-SSH, using the official skills | `G/README.md` §2 "Coding Agent"; `G/rules` "Use a matching skill before raw REST" | **done** | VM `bc-anson9m23` reachable; `~/vast-builders-challenge` present on it; the agent was deployed with the `deploy-app-no-registry` pattern (ConfigMap + Secret + Ingress `/app`). Team rules for Cursor in `.cursor/rules/classroom-47.mdc` | Say "built with Cursor on the VM" in the demo |
| **A**: the app runs **on the cluster**, Ingress path `/app` on `video-lab-team-<N>.cosmos.vastdata.com`, opened via workshop.thecosmoslabs.com → App; never "run it locally" as the deliverable | `G/skills/deployment/deploy-app-no-registry` "Non-negotiable" | **done** | `kubectl -n team-47 get deploy,svc,ingress,pods`: `classroom47-agent` 1/1 Running (44 min), Service :80, Ingress host `video-lab-team-47.cosmos.vastdata.com`. `curl http://video-lab-team-47.cosmos.vastdata.com/app/health` → `{"ok": true, "vss": true, "wandb": true}` [200] | – |
| Public image, code from a ConfigMap (~1 MiB), creds from a Secret | same | **done** | ConfigMap `classroom47-agent-code` (2 keys), Secret `classroom47-agent-creds` (7 keys, names only) | – |
| Only your team's namespace | `G/ARCH` "Rules of the road"; deploy skill | **done** | Everything in `team-47` | – |
| **M**: LLM logic on W&B serverless inference | `G/README.md` §5 "LLM access"; `G/BYB` | **done** | `services/agent/app.py` (OpenAI client at `api.inference.wandb.ai/v1`, `WANDB_MODEL` = `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B` on the cluster); `services/predict/llm.py`; `apps/stream/src/app/api/chat/scene` (Nemotron VL) | – |
| **M**: Weave tracing / observability | `G/BYB` "Weights & Biases … observability … Weave" | **done** | `assess = weave.op()(assess_core)` (`services/agent/app.py:370`); project `anson9m23-chocoliticekreem-codes/classroom-47`; `/app/assess` returns `trace.weave_project` | Open the Weave project in a tab for the demo |
| **M**: Cosmos Reason + Embed + YOLO through the pipeline ("you query the vectors generated") | `G/README.md` §4 "Recap" | **done** | Agent reads `reasoning_content` (Cosmos) and `object_counts` (YOLO) from VSS moments and passes them to the LLM and the UI | – |
| **P**: search the team's pre-ingested index | `G/README.md` §4 | **done** | `POST /api/v1/search` and `/api/v1/agent/search-and-answer` via `VssClient`; `dashboard/stats`: table `team-47-vss-db/vss-schema/vss-collection` available, 612 videos in Explore | – |
| **P**: re-ingest with your own prompt so descriptions match what you build | `G/README.md` §3 "Re-ingest", §4 "Re-ingest with your prompt"; `G/ARCH` "Builders challenge note" | **missing** | No re-ingest has run; `eval_search.py` shows the filming/following query misses | **Do next #1** |
| **P**: VastDB as more than the index (own tables, `vastdb-read`/`write`) | `G/README.md` §3 "Worth knowing"; `G/skills/vast-database` | **missing** | Agent writes nothing to VastDB | **Do next #2** |
| Use the VSS agent tools (`/api/v1/tools/*`) when orchestrating your own agent | `G/skills/retrieval/agent-qa` | **partial** | Uses `agent/search-and-answer` + `search`; no `tools/detections` / `tools/segments` | **Do next #3** |
| 3+ sponsor tools used effectively (Impact) | `slides` | **done** | VAST (VSS + cluster), NVIDIA (Cosmos, YOLO, Nemotron), W&B (Inference + Weave), CoreWeave, Cursor; table in README | Name each in the demo |

### Rules

| Rule | Source | Status | Evidence | Action |
|---|---|---|---|---|
| Don't ingest internet video (YouTube etc.) | `G/README.md` §4 warning | **done** | TfL JamCam YOLO runs locally (`services/yolo`) and never touches VSS; `AGENTS.md` and the `vast-camp` skill repeat the rule | – |
| Only re-ingest already-segmented content; don't upload or run the Segmenter | `G/ARCH` "Builders challenge note" | **done** | No upload code | – |
| 1–2 people run re-ingests; try a few clips first | `G/README.md` §3 warning | n/a yet | – | Assign one person for Do next #1 |
| Don't rebuild or redeploy DataEngine / the VSS stack | `G/ARCH` | **done** | Only `classroom47-agent` added to the namespace; VSS deployments untouched (5d17h old) | – |
| Credentials from `/config/<team>.config`, never printed, hardcoded or committed; list names only | `G/rules`; every skill | **done** | Repo greps clean; Secret key names documented only; `.env*` gitignored | – |
| Pick the team number once; share one pipeline | `G/README.md` §2 "Your team" | **done** | team-47 | – |
| Use a matching skill before raw REST calls | `G/rules` | **done** | `vast-camp` skill maps every need to the official skill | – |
| Stay in your own namespace, buckets, UI | `G/ARCH` "Rules of the road" | **done** | – | – |
| Health check / `ask-cosmos` when stuck | `G/README.md` Reference | n/a | – | – |

### Judging criteria (organisers' slides)

| Criterion | Judges ask | Status | Evidence | Action |
|---|---|---|---|---|
| Idea | Compelling use of the video search and summary stack provided | **partial** | VSS search + Q&A is the agent's evidence source; no re-ingest yet, so Cosmos isn't answering *our* question | Do next #1 |
| Technical implementation | Code easy to follow, reproduce, evaluate; inputs, outputs and evaluation steps documented | **done** | README "Inputs, outputs and evaluation": hit@8 table from `eval_search.py` (7/8), the `/app/assess` curl with observed output, Predict `/score`, YOLO counts | Add the after-re-ingest table |
| Design | Intuitive UX | **done** | One flow: Live → advisor verdict → calmer route → Predict what-if | Rehearse |
| Impact | 3+ sponsor tools used effectively | **done** | README sponsor table | Name each on stage |
| Presentation | 2-minute demo (demos > slides) | **partial** | `docs/DEMO.md` written; not yet rehearsed; backup video not yet recorded | Rehearse once, record by 15:30 |

### Submission (tokens& form, 16:30 BST)

| Item | Source | Status | Action |
|---|---|---|---|
| Public GitHub repo | `slides` | **done** | `chocoliticekreem/classroom-47` |
| Demo video, shareable link | `slides` | **missing** | Record by 15:30 |
| What we built + which tools, every team member named | `slides` | **missing** | Fill the form 16:00–16:15; paste the README sponsor table |
| README: what it does, tools and where, how to run, inputs/outputs/evaluation | `slides` | **done** | – |
| Optional: working website + screenshot | `slides` | **done** | `https://video-lab-team-47.cosmos.vastdata.com/app/` (via workshop → App) |

## Verification log (read-only, from the lab VM)

```
kubectl -n team-47 get deploy,svc,ingress,configmap,pods          # classroom47-agent 1/1, Ingress on video-lab-team-47.cosmos.vastdata.com
curl http://video-lab-team-47.cosmos.vastdata.com/app/health       # {"ok": true, "vss": true, "wandb": true} [200]
GET /api/v1/dashboard/stats?scope=mine                             # table team-47-vss-db/vss-schema/vss-collection, table_available true
GET /api/v1/videos/explore?scope=all&limit=100                     # total 612
POST /app/assess (Tower Hill, 42 people)                           # level busy, evidence nyc_streets_cam-2 + sf_streets_cam-1, Weave project returned
python3 services/agent/eval_search.py --top-k 8                    # hit@8 7/8
```
