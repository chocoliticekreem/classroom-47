# Awareness Data Plan (Chris) — live London video → stream + city

> Plan only, nothing built. Today: build 09:30–16:30 BST, code freeze 15:45 (see `CLAUDE.md`, `TODO.md`).
> Owner: Chris — "Awareness data" + "Personas (data)" in `TODO.md`.
> Consumers: stream page (`surroundings.update` on BroadcastChannel `classroom-47`, see `docs/ARCHITECTURE.md`) and Arvin's city sim (baseline crowd).

## The idea, adapted to the video we can actually get

The city starts as a **mirror of right now**: every street near the streamer gets the people and vehicle counts that the nearest real camera saw in its latest clip. Nothing in the twin moves "on its own" while it mirrors — it is re-seeded each time a camera refreshes.

It **diverges** only when an external event happens:
- a real one: a new TfL disruption (collision, emergency incident, closure) or Cosmos flagging an incident on a clip near the streamer;
- a streamer one: "Tell chat my location" (`location.reveal`) or "Simulate first" (`sim.request`).

At that moment the twin forks: real counts stop being applied, persona agents decide who comes and how, and the sim runs forward. Reality keeps updating beside it, so the demo can show **real (ghost) vs. simulated future**.

**What the source footage shapes:**
- TfL clips are ~9 s every ~3–5 min at 352×288. So the twin mirrors **zone-level counts and flows**, not individual people. That fits the sim (crowd density, crush risk) and is privacy-safe: no one is identifiable at that resolution.
- Vehicles detect reliably; pedestrians are small → person counts are approximate. Use them as a density *level* (calm / busy / packed), not exact headcounts.
- Organiser-provided videos (via the VAST / Cosmos Community environment) are the higher-res footage for the "Cosmos explains why" and semantic-search moments.

## Video sources and where each fact comes from

| Source | What we get | How I know (checked 2026-10-17) |
|---|---|---|
| **TfL JamCams** — primary, live | 890 cameras, 781 available, 105 in central London; each has lat/lon, view direction, `.jpg` and `.mp4` URL | Called `https://api.tfl.gov.uk/Place/Type/JamCam` myself and counted |
| | Clip = ~9.3 s, 352×288, 25 fps | Downloaded `00001.08858.mp4` (Oxford St/Orchard St) and ran `ffprobe` |
| | New clip every ~3–5 min | `Last-Modified` headers on 5 cameras were 2–6 min old |
| | Terms: TfL open data (OGL-based), register for a free app key, credit TfL | [TfL open data / UKAuthority](https://ukauthority.com/articles/tfl-opens-car-park-and-jamcam-data-feeds), [TfL blog](https://blog.tfl.gov.uk/2016/01/22/improved-roads-open-data-car-parks-jamcams/) — exact current terms not re-read |
| **TfL Road Disruptions** — the real "external events" | 119 live right now: 111 works, 2 collisions, 1 emergency incident, 2 planned events…, each with `point` [lon,lat], severity, text | Called `https://api.tfl.gov.uk/Road/all/Disruption` myself |
| TfL line status / bus arrivals / BikePoint | Station closures, real bus positions, bike dock flow | Standard TfL Unified API endpoints; BikePoint returned 200 |
| **Organiser videos** | Higher-res clips in the VAST / Cosmos environment | `CLAUDE.md` ("Video assets are provided by the organisers") |
| YouTube / EarthCam live webcams | Higher-res London views | **Not used as data.** YouTube ToS forbids downloading without permission; feeds are unreliable ([Visit London webcams page](https://www.visitlondon.com/things-to-do/sightseeing/london-attraction/webcams-of-london) notes some are down). Embed only, if at all. |

### Demo-route cameras (nearest working JamCams, computed from the API list)
| Spot | Nearest cameras (distance) |
|---|---|
| Oxford Circus | Regent St/Conduit St `00001.07451` (230 m), Oxford St/Vere St `00001.08860` (370 m) |
| Piccadilly Circus | Shaftesbury Ave/Macclesfield St `00001.07458` (280 m) |
| Leicester Sq | Charing Cross Rd/Cranbourne St `00001.07550` (170 m), Cambridge Circus `00001.07551` (320 m) |
| Trafalgar Sq | Trafalgar Square `00001.06502` (70 m), Northumberland Ave/Victoria Emb `00001.07500` (440 m) |
| Westminster | Westminster Bridge/York Rd `00001.04502`, Parliament Square `00001.06501` |
| Southbank (venue) | Waterloo Bridge south `00001.04223` (110 m), York Rd opp Mepham St `00001.04225` |

Clip URL pattern: `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/<id without "JamCams_">.mp4`.

## Pipeline

```
JamCam poller (60 s; fetch only if Last-Modified changed; nearest N to streamer + demo cams)
   └─► VAST bucket (clip + metadata)            ← sponsor: VAST
         ├─► YOLO26 + ByteTrack → counts, flows  ← sponsor: YOLO
         └─► Cosmos 3 Nano Reasoner → incident JSON  ← sponsor: NVIDIA Cosmos
TfL disruptions poller ─────────────┐
                                    ▼
         per-camera snapshot  +  events
           ├─► stream page: publish surroundings.update {summary, level}
           └─► city sim: baseline crowd per zone; events fork the sim
Advisor / personas on W&B Inference, traced in Weave  ← sponsor: W&B
```

Snapshot shape (per camera):
```json
{ "cameraId": "JamCams_00001.07550", "name": "Charing Cross Rd/Cranbourne St",
  "lat": 51.5113, "lon": -0.1286, "capturedAt": "2026-10-17T10:41:00Z",
  "counts": { "person": 18, "car": 6, "bus": 2 }, "level": "busy",
  "scene": { "summary": "Busy crossing, queue of buses", "incident": null } }
```
Events: `{ kind: "collision" | "closure" | "crowd_forming" | ..., source: "tfl" | "cosmos", lat, lon, severity, text }`.
The stream bus already has `surroundings.update`. Arvin's city bus (`apps/web/src/world/streamerContract.ts`) already has `reality:fork` — real events should trigger that rather than a new type. The two buses run on different ports today (see `CLAUDE.md`), so agree the bridge with Sonion/Arvin first.

## Models — latest versions as of 17 Oct 2026

| Job | Use | Latest? | Source |
|---|---|---|---|
| Detect + track people / vehicles | **YOLO26** (Ultralytics, released 14 Jan 2026) + ByteTrack (or default BoT-SORT) | Yes. YOLO27 is announced but **not released** (no weights) | [Ultralytics models docs](https://docs.ultralytics.com/models), [YOLO26 launch](https://www.ultralytics.com/news/ultralytics-redefines-state-of-the-art-vision-ai-with-yolo26) |
| Reason over a clip: "accident? crowd forming? why?" | **Cosmos 3 Nano Reasoner** (16B; hosted demo `cosmos3-nano-reasoner` on build.nvidia.com; also NIM / vLLM) | Yes — Cosmos 3 (May 2026) is the newest family; Cosmos3-Edge 4B added July 2026 | [github.com/NVIDIA/Cosmos](https://github.com/NVIDIA/Cosmos) |
| …fallback if the environment only serves the older one | Cosmos-Reason2-8B | Previous generation (still in NVIDIA's VSS) | [cosmos-reason2 repo](https://github.com/nvidia-cosmos/cosmos-reason2) |
| Semantic search over clips ("cams with crowds forming") | **Cosmos-Embed1** (448p; there is also a 448p anomaly-detection variant) via VSS or VAST vector search | Yes — no Embed2 found; NGC v1.0 updated 9 May 2026 | [NGC Cosmos-Embed1](https://catalog.ngc.nvidia.com/orgs/nvidia/tao/models/cosmos-embed1/-), [VSS docs](https://docs.nvidia.com/vss/latest/models/cosmos-embed1.html) |
| Optional "what happens next" video from a real frame | **Cosmos 3 Nano Generator** | Yes, replaces Cosmos-Predict2.5. Slow → pre-render only | [github.com/NVIDIA/Cosmos](https://github.com/NVIDIA/Cosmos) |
| Advisor agent + persona distillation (text) | W&B Inference: **Qwen3.8 27B** (newest Qwen, vision-capable) or **Nemotron 3.5 Lightning** (30B-A3B, fast, text only) | On the current list | [CoreWeave/W&B models page](https://docs.coreweave.com/inference/models) |
| Second opinion on a frame (cheap vision) | W&B Inference: **Nemotron 3.5 Super VL** (120B-A12B, 1M ctx) or Gemma 4 31B | On the current list; no model documented as accepting video → send frames | same |
| Tracing + evals | **W&B Weave** | — | [W&B Weave docs](https://docs.wandb.ai/weave/guides/integrations/inference) |

Corrections vs. my earlier plan: Cosmos-Reason2 → **Cosmos 3 Nano Reasoner**; Cosmos-Predict2.5 → **Cosmos 3 Generator**; W&B "Qwen3.6" → **Qwen3.8 27B** is newer. YOLO26 and Cosmos-Embed1 were already current.
Unknown until we check the environment: which of these the organisers actually serve and on which GPUs.

## Tasks (in order, for today)

- [ ] **1. Ask organisers** which Cosmos model/endpoint and GPU we get, and where their videos live in VAST. (5 min, unblocks everything)
- [ ] **2. Camera list:** fetch JamCams, keep `available == "true"`, save the demo-route cameras above + nearest-N lookup by lat/lon.
- [ ] **3. Poller + recorder:** every 60 s, download changed clips for those cameras into VAST (local folder fallback). Start it early so we have a recorded hour for replay.
- [ ] **4. YOLO26 counts:** per clip → counts, level (calm/busy/packed thresholds tuned by eye on 5 clips), flows.
- [ ] **5. Disruptions poller:** filter to ~1 km of the streamer; collisions/emergency/closures → events.
- [ ] **6. Publish:** `surroundings.update` to the stream page; snapshots + events to Arvin's sim (agree the event name).
- [ ] **7. Cosmos pass** on the 3–5 cams nearest the streamer → `scene.summary` + incident. Cache every answer.
- [ ] **8. Semantic search** (stretch): Cosmos-Embed1 over recorded clips — "show cams where a crowd is forming".
- [ ] **9. Cache for demo:** freeze one good set of snapshots/Cosmos outputs; replay mode behind a flag.

## Risks
| Risk | Mitigation |
|---|---|
| 352×288 → weak person counts | Use levels not headcounts; vehicles + organiser videos carry detail |
| Clips refresh every few minutes | Interpolate; zone-level only |
| Venue Wi-Fi / TfL / Cosmos down | Recorded clips + cached outputs, replay flag |
| Cosmos 3 not served in the env | Fall back to Cosmos-Reason2, then to a W&B vision model on frames |
| Privacy | Aggregates only; no face recognition; personas are archetypes, never real people |
