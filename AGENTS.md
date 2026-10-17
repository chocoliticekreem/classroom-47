# AGENTS.md: read this first

Brief for every coding agent (Claude Code, Cursor, Codex) and every teammate on this repo.
Hackathon project: speed and a demo that works live matter more than process.

- **Current state, what's broken, who's on what:** [`HANDOFF.md`](HANDOFF.md)
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

### Sponsor tools and how to get access

| Tool | Use it for | Access |
|---|---|---|
| NVIDIA Cosmos + **VSS Blueprint** | Reasoning over clips. VSS turns video segments into searchable descriptions and embeddings | [VSS docs](https://docs.nvidia.com/vss/latest/) |
| VAST AI OS | Video ingestion, data layer, build environment | Join the [Cosmos Community](https://community.vastdata.com) (limited to the first 100 attendees) |
| Semantic video search | Natural-language search over hours of footage | Via VAST / VSS |
| YOLO | Real-time object detection and tracking | Self-host on CoreWeave GPUs |
| W&B serverless inference + Weave | LLMs for agent logic, tracing | Account at [wandb.ai](https://wandb.ai/site/), [inference docs](https://docs.wandb.ai/inference) |
| CoreWeave | GPUs for model serving | Through the event |
| Cursor | Dev environment | Credits go to the email you registered with |

Video assets come from the organisers through the Cosmos Community / VAST environment.

### Links

- Event: https://luma.com/vastlondon
- Hack page: https://tokensand.com/vastlondon
- Submit: https://tokensand.com/vastlondon/submit
- Other teams' projects: https://tokensand.com/vastlondon/projects
- Discord (find help and teammates): https://discord.gg/rPBMhMzRU

## Working in this repo

- **Monorepo** with npm workspaces:
  - `apps/stream`: the streaming platform (Next 16).
  - `apps/web`: the 3D city and console (Next 16, three.js).
  - `apps/*/AGENTS.md`: the Next.js 16 note. Read `node_modules/next/dist/docs/` before writing Next code; the APIs differ from older Next.
- **Run**, from the repo root:
  ```bash
  npm install                            # once, at the repo root
  npm run dev -w web                     # 3D city, http://localhost:3000 (/ and /city)
  npm run dev -w stream -- --port 3001   # streaming page, http://localhost:3001
  ```
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
