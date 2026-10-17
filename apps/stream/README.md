# Classroom 47

An IRL streaming platform that gives London streamers eyes on the city around them.
It also links to a parallel 3D London, where they can simulate what happens before they tell chat where they are.

## Run

```bash
npm install (repo root)
npm run dev -w stream
```

Open http://localhost:3000.

## Structure

The code is laid out by CAMP layer (Coding agents, Agent runtimes, Model services, Platform). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layers and the cross-tab event bus the 3D city integrates through. Team to-dos are in [TODO.md](TODO.md).

## Sponsor tools

- **YOLO**: crowd counts on TfL JamCams
- **NVIDIA Cosmos**: reasoning about incidents near the streamer
- **Weights & Biases**: inference for personas and the advisor agent, with Weave traces
- **VAST AI OS**: clip ingest and semantic search
- **CoreWeave**: model serving
- **Cursor**: dev environment

Powered by TfL Open Data.

Set `NEXT_PUBLIC_MIRROR_URL` in your local env file in `apps/stream` to change where **Mirror** opens the city (default `/twin`, the 3D twin in this app).
