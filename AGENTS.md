# AGENTS.md: read this first

Brief for every coding agent (Claude Code, Cursor, Codex) and every teammate on this repo.
Hackathon project: speed and a demo that works live matter more than process.

- **Current state, what's broken, who's on what:** [`HANDOFF.md`](HANDOFF.md)
- **How to build on the required CAMP infrastructure:** the [`vast-camp` skill](.agents/skills/vast-camp/SKILL.md)
- **Pitch, product and demo arc:** [`CLAUDE.md`](CLAUDE.md) (project section) and [`README.md`](README.md)
- **To-dos:** [`TODO.md`](TODO.md). **Event bus contract:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## The event

**Real-Time Video Agents Hack, London** (VAST Builders Challenge, organised by [tokens&](https://tokensand.com/vastlondon)).
Sponsors: VAST Data, NVIDIA, CoreWeave, SpaceXAI (Cursor), Weights & Biases.

- **When:** Saturday 17 October 2026, London time (BST).
- **Where:** Halkin, 1–2 Paris Garden, London SE1 8ND.
- **Host:** Francisco Terpolilli (Growth Engineer, SpaceXAI ambassador).
- **Brief** (from the organisers' slides): "Build agents that unlock the value of video. Ship a real-time video agent that understands footage and acts on it: search hours of video in plain language, ask what happened, spot events, or trigger an action when something matters. **Use 3+ sponsor tools.** One idea. Working. Shipped by end of day."
  - Pick a **narrow** use case.
  - Adapt it to the footage available on build day.

### Timeline (BST, from the organisers' slides)

| Time | What |
|---|---|
| 09:30 | Keynote and opening remarks |
| 10:00 | Hacking begins |
| 12:30 | Lunch |
| 15:30 | **Team: backup demo video recorded** |
| 15:45 | **Team: code freeze** |
| **16:30** | **Submission deadline (late = rejected)** |
| 16:45 | Judging round 1: **2-minute demo** to the judges at a designated area |
| 18:00 | Finalists (top 5): **3-minute demo** in front of everyone |
| 18:30 | Awards ceremony |

### Submission checklist

Submit at **https://tokensand.com/vastlondon/submit**:

- [ ] GitHub repo reviewers can open: `chocoliticekreem/classroom-47` (public)
- [ ] Short demo video, as a **shareable link**
- [ ] What we built, and **which tools we used** (name each sponsor tool and where it's used)
- [ ] **Every team member is on the submission** (the organisers' slides: "Make sure everyone is on it"). Names and contact emails go in the form, never in this repo
- [ ] Optional: a working website and a screenshot
- [ ] README up to date: what it does, sponsor tools and where, how to run it, demo link, and **inputs, outputs and evaluation steps** (a judging criterion)

The judging slide links `tokensand.com/vastnyc`, copied over from the NYC event. **Ours is `/vastlondon`.**

**Rules.**
- **3 or more sponsor tools.** Confirmed on the organisers' slides; it's the Impact criterion.
- **Demo lengths:** 2 minutes in round 1, and 3 minutes if we reach the top 5. Show a live demo, not a slide deck.
- **"No previous projects: everything built today"** is still unconfirmed. It comes from our notes, not the organisers' slides. `HANDOFF.md` explains why it matters for `apps/web`.

### Judging criteria (from the organisers' slides)

| Criterion | What the judges ask | What it means for us |
|---|---|---|
| **Idea** | Does the solution show a compelling use of the **video search and summary stack provided**? | Put VSS search and Q&A at the centre of the product, not off to one side |
| **Technical implementation** | Is the code high quality and easy to follow, reproduce and evaluate? Are the **inputs, outputs and evaluation steps** clearly documented? | Write a README section on inputs, outputs and evaluation, plus a small evaluation run (example queries → expected clips → results) |
| **Design** | Is the design and user experience well thought out and intuitive? | One clear flow: stream → "should I tell chat?" → verdict → safer spot |
| **Impact** | Did it use **at least 3 sponsor tools** effectively? | Show each layer: Cursor, VAST (VSS, VastDB, the cluster), NVIDIA Cosmos and YOLO, W&B inference + Weave, CoreWeave GPUs |
| **Presentation** | A demo of the solution in **2 minutes** (demos > slides) | Rehearse a 2-minute live run, and keep a 3-minute version ready for the finals |

### Judges and prizes

- **Judges** (the "what they want" column is our guess):

  | Judge | Role | What they want |
  |---|---|---|
  | Abubakr Karali | Senior Solutions Architect, NVIDIA | Cosmos doing real reasoning, not captioning |
  | Ram B. | Sr. Developer Advocate, VAST Data | VAST as the data layer |
  | Brian Verkley | Director, AI Data Platform, VAST Data | Video going from storage to value at scale |
  | Junaid Butt | AI Solutions Engineer, W&B | A real agent loop on W&B inference, traced in Weave |

- **Prizes:**
  - 1st place: NVIDIA DGX Spark
  - 2nd place: Hugging Face Microduck
  - Each top-5 presenting team: a $100 Amazon gift card
- **Teams:** up to 4 people, one project per team.

## CAMP: the infrastructure we must build on

**The organisers require the project to run on VAST's CAMP stack.** Every layer is a sponsor, and the
judges look for each one. The step-by-step how-to (access, APIs, env vars, deploy, re-ingest prompt) is
the **`vast-camp` skill**: [`.agents/skills/vast-camp/SKILL.md`](.agents/skills/vast-camp/SKILL.md), also
linked into `.claude/skills/` and `.cursor/skills/`. Source of truth:
[`vast-data/vast-builders-challenge`](https://github.com/vast-data/vast-builders-challenge).

| Layer | Sponsor | Already running | What we build or use |
|---|---|---|---|
| **C**: coding agent | SpaceXAI (Cursor) | Cursor credits. Lab VM `bc-<username>` reached over Cursor Remote-SSH, with the official repo and `.cursor/skills` | Build in Cursor on the VM. Start with `/build-day-quickstart` |
| **A**: agent runtime | VAST | A Kubernetes namespace per team, plus the `/deploy-app-no-registry` skill | **Our agent and app, deployed on the cluster at `/app`.** People open it at workshop.thecosmoslabs.com → **App** |
| **M**: model services | NVIDIA + CoreWeave | Cosmos3-Reason, Cosmos Embed1, YOLO11 and Canary-1B on CoreWeave GPUs. W&B serverless LLM inference | Agent reasoning on W&B inference, traced in **Weave**. Cosmos and YOLO results come through VSS |
| **P**: platform | VAST | NVIDIA VSS Blueprint on VAST: S3, then DataEngine, then VastDB, plus the VSS UI and API | Query our team's index, and re-ingest the footage with **our own Cosmos prompt** |

**Rules.**
- Only the **pre-ingested footage** can be used: dashcam clips of pedestrians at crossings, overhead highway multi-camera footage, a neighbourhood camera. **No uploads, and no internet video (YouTube, TfL) into VAST.**
- The deployed app must be small: a `python:3.12-slim` image, with code from a ConfigMap of **about 1 MiB**. That means a Python agent plus a light dashboard. Our Next.js apps stay as local front ends.
- Pick the team number **once**, using the number you were assigned.
- Only 1–2 people run large re-ingests.
- Credentials stay in `/config/<team>.config` on the VM. Never commit them.

**Getting access** (each person; the organisers' "Workshop quick start" slide):
1. **Venue Wi-Fi:** `Halkin-WiFi Guest`. The password is on the venue sign and the quick-start slide; it isn't in this repo because the repo is public.
2. **Cosmos:** join https://community.vastdata.com/c/workshop.
3. **Workshop access:** sign in at **https://workshop.thecosmoslabs.com** with your registration email.
4. **Launch VM:** enter the passcode from the quick-start slide. Ask a teammate; it isn't in this repo.
5. **Team:** pick our team number (**Team-1…Team-50**). You can only do this once, so use the number we were assigned.
6. `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_cursor -C "cursor-vm"`, then paste the `.pub` key on the lab page under **Option 1 - Key**.
7. In Cursor: Connect via SSH → `bc-<username>` → open `vast-builders-challenge` → `/build-day-quickstart`.

Help: the [Cosmos Community](https://community.vastdata.com/c/workshop) Workshop category, or `/ask-cosmos` on the VM.
Cursor credits: check that requests show `Free` at cursor.com/dashboard/usage. If not, use the credit request form in the official README.

### Links

- Event: https://luma.com/vastlondon
- Hack page: https://tokensand.com/vastlondon
- Submit: https://tokensand.com/vastlondon/submit
- Other teams' projects: https://tokensand.com/vastlondon/projects
- Discord (find help and teammates): https://discord.gg/rPBMhMzRU
- Cosmos Community workshop (help, infra Q&A): https://community.vastdata.com/c/workshop
- Lab portal (VM, VSS UI, our deployed App): https://workshop.thecosmoslabs.com
- Official build guide and Cursor skills: https://github.com/vast-data/vast-builders-challenge

## Working in this repo

- **Monorepo** with npm workspaces:
  - `apps/stream`: the streaming platform (Next 16).
    - Tabs: Live, Around me, 3D mirror.
    - `/twin`: a real-OpenStreetMap twin of Tower Hill with live people, buses and CCTV (code in `src/twin/`).
    - `/api/around/*`: TfL cameras, buses, disruptions, Open-Meteo weather, and YOLO counts and tracks.
    - `/api/twin/osm`: OpenStreetMap geometry for the twin.
  - `apps/web`: the 3D city and console (Next 16, three.js).
  - `services/yolo`: a local YOLO server on TfL JamCams (port 8047).
  - `services/vision`: Python model clients (YOLO, Cosmos, W&B) and the London live-camera catalogue (uv).
  - `docs/`: `ARCHITECTURE.md` (CAMP mapping and the bus contract), `PMF.md` (market research), `superpowers/plans/` (the data-sourcing plan).
  - `apps/*/AGENTS.md`: the Next.js 16 note. Read `node_modules/next/dist/docs/` before writing Next code; the APIs differ from older Next.
- **Run on your laptop** (local front ends), from the repo root:
  ```bash
  npm install            # once, at the repo root
  npm run dev:stream     # streaming page, http://localhost:3047
  npm run yolo           # YOLO server for Around me, http://127.0.0.1:8047 (needs uv)
  npm run dev -w web     # 3D city, http://localhost:3000 (build currently blocked, see HANDOFF.md)
  ```
  The CAMP parts (VSS, Cosmos, the agent on the cluster) run on the **lab VM**. See the `vast-camp` skill.
- **Don't use root `npm run dev`, `build` or `lint`.** They call an `api` workspace that isn't in this repo.
- **Checks:**
  - `apps/stream`: typecheck, lint and build.
  - `apps/web`: also has Vitest (`npm test -w web`).
- **The repo is public:**
  - Keys go in `.env` / `.env.local`, which are gitignored. Never commit them.
  - No personal emails or contact details in files.
- **Many people and agents push at once:**
  - `git pull --rebase` before you push, and keep commits small.
  - Work on a branch and open a PR. PRs #1–#7 went to `main` this way.
  - Don't rewrite another person's files without telling them.
  - Commit or push only when your human asks.
- **Pre-compute and cache** every network-dependent result the demo needs, and put a timeout on every external call. The demo can't depend on venue wifi.
