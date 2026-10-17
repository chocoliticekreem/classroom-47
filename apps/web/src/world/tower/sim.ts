// Live crowd plus a parallel fork. The fork stays off the live list until acceptFork.
import { ACCIDENT, CROSSWALK, PATCH, STREAMER, onCrosswalk } from "./layout";
import { personaFor } from "./personas";

export interface Agent {
  id: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  kind: "flow" | "sniper" | "crossing" | "leak";
  speed: number;
  archetype: string;
  subreddit: string;
  thread: string;
  intent: string;
  handle: string;
}

export interface Sim {
  seed: number;
  live: Agent[];
  fork: Agent[] | null;
  forkKind: "crossing" | "leak" | null;
  incident: { label: string; x: number; z: number };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fromPersona(kind: Agent["kind"], index: number, id: string, x: number, z: number, targetX: number, targetZ: number, speed?: number): Agent {
  const persona = personaFor(kind, index, id);
  return {
    id,
    x,
    z,
    targetX,
    targetZ,
    kind,
    speed: speed ?? persona.speed,
    archetype: persona.archetype,
    subreddit: persona.subreddit,
    thread: persona.thread,
    intent: persona.intent,
    handle: persona.handle,
  };
}

function clampToPatch(x: number, z: number): { x: number; z: number } {
  const m = 8;
  return {
    x: Math.max(PATCH.minX + m, Math.min(PATCH.maxX - m, x)),
    z: Math.max(PATCH.minZ + m, Math.min(PATCH.maxZ - m, z)),
  };
}

export function createLiveCity(seed = 47): Sim {
  const rng = mulberry32(seed);
  const live: Agent[] = [];
  for (let i = 0; i < 16; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      x = -200 + rng() * 240;
      z = 160 + rng() * 290;
      if (!onCrosswalk(x, z)) break;
    }
    const target = clampToPatch(x + (rng() - 0.5) * 24, z + (rng() - 0.5) * 24);
    live.push(fromPersona("flow", i, `flow-${i}`, x, z, target.x, target.z));
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const radius = 18 + i * 6;
    const x = STREAMER.x + Math.cos(angle) * radius;
    const z = STREAMER.z + Math.sin(angle) * radius;
    live.push(fromPersona("sniper", i, `sniper-${i}`, x, z, STREAMER.x, STREAMER.z));
  }
  return {
    seed,
    live,
    fork: null,
    forkKind: null,
    incident: {
      label: "Collision blocking Tower Bridge Road south of Tooley Street",
      x: ACCIDENT.x,
      z: ACCIDENT.z,
    },
  };
}

export function previewCrossingSurge(sim: Sim, count = 50): Sim {
  const fork: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) * 2 - 1;
    const x = CROSSWALK.x + t * CROSSWALK.halfLength;
    const z = CROSSWALK.z;
    fork.push(fromPersona("crossing", i, `crossing-${i}`, x, z, x, z, 1.2));
  }
  return { ...sim, live: sim.live, fork, forkKind: "crossing" };
}

export function previewLocationLeak(sim: Sim, count = 50): Sim {
  const fork: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const radius = 100 + (i % 5) * 6;
    const angle = (i / count) * Math.PI * 2;
    const placed = clampToPatch(
      STREAMER.x + Math.cos(angle) * radius,
      STREAMER.z + Math.sin(angle) * radius,
    );
    fork.push(fromPersona("leak", i, `leak-${i}`, placed.x, placed.z, STREAMER.x, STREAMER.z, 3.2));
  }
  return { ...sim, live: sim.live, fork, forkKind: "leak" };
}

export function acceptFork(sim: Sim): Sim {
  return {
    ...sim,
    live: [...sim.live, ...(sim.fork ?? [])],
    fork: null,
    forkKind: null,
  };
}

export function discardFork(sim: Sim): Sim {
  return { ...sim, live: sim.live, fork: null, forkKind: null };
}

function stepAgent(agent: Agent, dt: number): Agent {
  if (agent.kind === "crossing") return agent;
  const dx = agent.targetX - agent.x;
  const dz = agent.targetZ - agent.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return agent;
  const step = Math.min(dist, agent.speed * dt);
  const next = { ...agent, x: agent.x + (dx / dist) * step, z: agent.z + (dz / dist) * step };
  if (next.kind === "flow" && onCrosswalk(next.x, next.z)) return agent;
  return next;
}

export function stepSim(sim: Sim, dt: number): Sim {
  return {
    ...sim,
    live: sim.live.map((agent) => stepAgent(agent, dt)),
    fork: sim.fork ? sim.fork.map((agent) => stepAgent(agent, dt)) : null,
  };
}

export function countOnCrossing(agents: readonly Agent[]): number {
  let n = 0;
  for (const agent of agents) {
    if (onCrosswalk(agent.x, agent.z)) n++;
  }
  return n;
}
