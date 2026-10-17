# Architecture — CAMP

The challenge requires VAST's **CAMP** stack: **C**oding agent, **A**gent runtime, **M**odel services, **P**latform.
The event provides the infrastructure, and each layer is a sponsor. The requirements and access steps are in
[`AGENTS.md`](../AGENTS.md#camp-the-infrastructure-we-must-build-on). The how-to is the
[`vast-camp` skill](../.agents/skills/vast-camp/SKILL.md).

| Layer | Event infrastructure | In this repo today | Target |
|---|---|---|---|
| **C**: Coding agent | Cursor (SpaceXAI) on the lab VM over Remote-SSH, with the official skills | `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`, `.cursor/rules/classroom-47.mdc`, the `vast-camp` skill, the official guide (`vast-builders-challenge/` submodule) | Build the CAMP agent in Cursor on the VM |
| **A**: Agent runtime | VAST: team Kubernetes namespace, app at `/app` (`/deploy-app-no-registry`). VSS agent tools at `/api/v1/tools/*` | **`services/agent`** (VSS search-and-answer → W&B + Weave → verdict; not yet deployed). Mock chat crowd (`apps/stream/src/agents/chat-crowd`) in the browser | Deploy `services/agent` on the cluster: VSS tools (search, detections, search-and-answer) → W&B reasoning → `calm/busy/danger` + advice → verdict stored in VastDB |
| **M**: Model services | NVIDIA Cosmos3-Reason, Cosmos Embed1, YOLO11 and Canary on CoreWeave GPUs. W&B serverless inference + Weave | Local YOLO on TfL (`services/yolo`). Cosmos and W&B clients (`services/vision`) | Cosmos and YOLO through VSS. Agent LLM on W&B, traced in Weave |
| **P**: Platform | VAST: NVIDIA VSS Blueprint on S3, then DataEngine, then VastDB, with pre-ingested footage | Cross-tab bus (`apps/stream/src/platform/bus.ts`). Live TfL data via `/api/around/*` (outside VAST) | Our team's VSS index (packs F, E and B), re-ingested with our crowd prompt. Our own VastDB table of agent verdicts (`vastdb-write`) |

Stream UI: `apps/stream/src/components/{stream,chat,around}`. Live-data logic: `apps/stream/src/platform/around`. Shared types: `apps/stream/src/lib`.

## Event bus contract

Any tab on the **same origin** (e.g. `http://localhost:3000/...`) shares one `BroadcastChannel` named **`classroom-47`**. The stream page, the 3D city and any sim/agent page integrate through it with no backend. `publish()` also delivers to listeners in the same tab.

| `type` | Payload | Published by | Consumed by |
|---|---|---|---|
| `stream.location` | `location: StreamLocation` | Stream page | City |
| `stream.viewers` | `viewers: number` | Stream page | City / sim |
| `chat.message` | `message: ChatMessage` | Chat crowd | Anyone |
| `streamer:location_leaked` | `location: StreamLocation`, `viewers: number`, `at: number` (ms epoch) | Stream page ("Tell chat my location") | City sim |
| `reality:fork` | `scenario: WhatIfScenarioId` (e.g. `"leak_location_50"`), `label: string`, `location: StreamLocation`, `viewers: number` | Stream page ("Mirror") | City sim |
| `surroundings.update` | `summary: string`, `level: "calm" \| "busy" \| "danger"` | City / awareness data | Stream page (Surroundings card) |

`StreamLocation` = `{ id: string; name: string; area: string; lat: number; lon: number }` (see `apps/stream/src/lib/types.ts`).

### Integrating from the city (Arvin)

Inside this app, import the helpers:

```ts
import { subscribe, publish } from "@/platform/bus";

const off = subscribe((e) => {
  if (e.type === "streamer:location_leaked" || e.type === "reality:fork") {
    runCrowdSim(e.location, e.viewers);
  }
});

publish({ type: "surroundings.update", summary: "Crush risk at Eros statue in 14 min", level: "danger" });
```

From a separate app on the same origin, use the raw channel:

```ts
const ch = new BroadcastChannel("classroom-47");
ch.onmessage = ({ data }) => {
  if (data.type === "streamer:location_leaked") runCrowdSim(data.location, data.viewers);
};
ch.postMessage({ type: "surroundings.update", summary: "Trafalgar Sq stays green", level: "calm" });
```

BroadcastChannel does not cross origins: the city must be served from the same host and port as the stream page (e.g. a route in this Next app, or behind the same dev proxy).
