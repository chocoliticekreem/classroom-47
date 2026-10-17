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

## Streaming from your phone

Camera and GPS need HTTPS on a phone, so the dev server is exposed through a Cloudflare quick tunnel.

1. Laptop: `npm run dev:stream` (port 3047), then in a second terminal `npm run tunnel` (set `PORT=3051 npm run tunnel` for another port). Copy the `https://<random>.trycloudflare.com` URL it prints. The host is already in `allowedDevOrigins` in `next.config.ts`.
2. Phone: open that URL, tap **Go live** (rear camera + GPS) and allow camera and location. Tap the flip icon for the selfie camera. The screen stays awake while live. The badge under the clock shows `Phone GPS · ±8 m · 2 s ago` and `Sync: connected`.
3. Laptop: open `http://localhost:3047` and `http://localhost:3047/twin`. Both follow the phone: the Live tab and Around me take the phone's position (`Following phone`), the twin's beacon, heading cone and **Streamer view** move with it. More than 650 m from Tower Hill the twin says `Outside the mirrored area`; Around me works anywhere.

The phone posts its state to `POST /api/live/state` every 2 s; every other page listens on `GET /api/live/stream` (server-sent events). State is in memory, one session called `default`; add `?session=<name>` to the phone and laptop URLs to run several streamers on one server. Without GPS the location picker is the **Demo location**.

Set `NEXT_PUBLIC_MIRROR_URL` in your local env file in `apps/stream` to change where **Mirror** opens the city (default `/twin`, the 3D twin in this app).
