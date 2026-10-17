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

## Project
_TBD: idea, architecture and run commands go here once decided._
