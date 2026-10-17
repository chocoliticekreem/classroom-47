# Architecture — CAMP

The repo follows VAST's **CAMP** developer stack: **C**oding agents, **A**gent runtimes, **M**odel services, **P**latform (VAST AI OS).

| Layer | What | In this repo | Next |
|---|---|---|---|
| **C** — Coding agents | Cursor, Claude Code | `CLAUDE.md`, `AGENTS.md` | — |
| **A** — Agent runtimes | Agents that act on stream + city state | `apps/stream/src/agents/chat-crowd` (mock chat crowd) | Advisor agent, persona sim agents; target runtime VAST AgentEngine |
| **M** — Model services | W&B inference, NVIDIA Cosmos, YOLO on CoreWeave | — | `apps/stream/src/models/` when the first client lands |
| **P** — Platform | Data + eventing | `apps/stream/src/platform/bus.ts` (cross-tab event bus) | VAST DataBase / InsightEngine for clip ingest + vector search |

UI lives in `apps/stream/src/components/{stream,chat}`; shared types in `apps/stream/src/lib`.

## Event bus contract

Any tab on the **same origin** (e.g. `http://localhost:3000/...`) shares one `BroadcastChannel` named **`classroom-47`**. The stream page, the 3D city and any sim/agent page integrate through it with no backend. `publish()` also delivers to listeners in the same tab.

| `type` | Payload | Published by | Consumed by |
|---|---|---|---|
| `stream.location` | `location: StreamLocation` | Stream page | City |
| `stream.viewers` | `viewers: number` | Stream page | City / sim |
| `chat.message` | `message: ChatMessage` | Chat crowd | Anyone |
| `location.reveal` | `location: StreamLocation`, `viewers: number`, `at: number` (ms epoch) | Stream page ("Tell chat my location") | City sim |
| `sim.request` | `location: StreamLocation`, `viewers: number`, `prompt: string` | Stream page ("Simulate first") | City sim |
| `surroundings.update` | `summary: string`, `level: "calm" \| "busy" \| "danger"` | City / awareness data | Stream page (Surroundings card) |

`StreamLocation` = `{ id: string; name: string; area: string; lat: number; lon: number }` (see `apps/stream/src/lib/types.ts`).

### Integrating from the city (Arvin)

Inside this app, import the helpers:

```ts
import { subscribe, publish } from "@/platform/bus";

const off = subscribe((e) => {
  if (e.type === "location.reveal" || e.type === "sim.request") {
    runCrowdSim(e.location, e.viewers);
  }
});

publish({ type: "surroundings.update", summary: "Crush risk at Eros statue in 14 min", level: "danger" });
```

From a separate app on the same origin, use the raw channel:

```ts
const ch = new BroadcastChannel("classroom-47");
ch.onmessage = ({ data }) => {
  if (data.type === "location.reveal") runCrowdSim(data.location, data.viewers);
};
ch.postMessage({ type: "surroundings.update", summary: "Trafalgar Sq stays green", level: "calm" });
```

BroadcastChannel does not cross origins: the city must be served from the same host and port as the stream page (e.g. a route in this Next app, or behind the same dev proxy).
