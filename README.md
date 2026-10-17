# Classroom 47

An IRL streaming platform that gives London streamers eyes on the city around them.
It also links to a parallel 3D London, where they can simulate what happens before they tell chat where they are.

## Run

```bash
pnpm install
pnpm dev
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
