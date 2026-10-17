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
- **Brief:** "Spend the day building agents to unlock the value of video." Build a video agent that searches footage, answers questions, detects events or takes action.
  - Pick a **narrow** use case.
  - Adapt it to the footage available on build day.

### Timeline (BST)

| Time | What |
|---|---|
| 08:30 | Doors open, breakfast |
| 09:00 | Opening keynotes |
| 09:30 | Build starts |
| 12:30 | Lunch |
| 15:30 | **Team: backup demo video recorded** |
| 15:45 | **Team: code freeze** |
| **16:30** | **Submission deadline (late = rejected), then demos** |
| 18:30 | Closing and awards |

### Submission checklist

Submit at **https://tokensand.com/vastlondon/submit**:

- [ ] GitHub repo reviewers can open: `chocoliticekreem/classroom-47` (public)
- [ ] Short demo video, as a **shareable link**
- [ ] What we built, and **which tools we used** (name each sponsor tool and where it's used)
- [ ] Every team member's name and contact email (enter these in the form, never in this repo)
- [ ] Optional: a working website and a screenshot
- [ ] README up to date: what it does, sponsor tools and where, how to run it, demo link

**Team rules to confirm.** These are in our notes (`CLAUDE.md`) but not on the public event pages; check them on Discord.

- At least 3 sponsor tools, each visible in the demo and the README.
- 3-minute demo.
- **No previous projects: everything built today.** `HANDOFF.md` explains why this matters for `apps/web`.

### Judges, criteria, prizes

- **Judges** (no criteria published; the "what they want" column is our guess):

  | Judge | Role | What they want |
  |---|---|---|
  | Abubakr Karali | Senior Solutions Architect, NVIDIA | Cosmos doing real reasoning, not captioning |
  | Ram B. | Sr. Developer Advocate, VAST Data | VAST as the data layer |
  | Brian Verkley | Director, AI Data Platform, VAST Data | Video going from storage to value at scale |
  | Junaid Butt | AI Solutions Engineer, W&B | A real agent loop on W&B inference, traced in Weave |

- **Prizes:**
  - 1st place: NVIDIA DGX Spark
  - 2nd place: Hugging Face Microduck
  - Cursor credits and cash gift cards, split across team members
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

**Getting access** (each person):
1. Sign in at **https://workshop.thecosmoslabs.com** with your registration email, then pick the team number.
2. `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_cursor -C "cursor-vm"`, then paste the `.pub` key on the lab page under **Option 1 - Key**.
3. In Cursor: Connect via SSH → `bc-<username>` → open `vast-builders-challenge` → `/build-day-quickstart`.

Help: the [Cosmos Community](https://community.vastdata.com) Workshop category, or `/ask-cosmos` on the VM.
Cursor credits: check that requests show `Free` at cursor.com/dashboard/usage. If not, use the credit request form in the official README.

### Links

- Event: https://luma.com/vastlondon
- Hack page: https://tokensand.com/vastlondon
- Submit: https://tokensand.com/vastlondon/submit
- Other teams' projects: https://tokensand.com/vastlondon/projects
- Discord (find help and teammates): https://discord.gg/rPBMhMzRU

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
  - Work on a branch and open a PR. PRs #1–#4 went to `main` this way.
  - Don't rewrite another person's files without telling them.
  - Commit or push only when your human asks.
- **Pre-compute and cache** every network-dependent result the demo needs, and put a timeout on every external call. The demo can't depend on venue wifi.
