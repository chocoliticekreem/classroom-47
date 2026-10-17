import type { Archetype, ChatMessage, Persona, StreamContext } from "@/lib/types";
import {
  DONATION_LINES,
  FIRST_MESSAGE_LINES,
  LINES,
  LOCATION_SIGNAL_LINES,
  STREAMER_REPLY_LINES,
  SURGE_LINES,
} from "./lines";
import { PERSONAS, PERSONAS_BY_ARCHETYPE } from "./personas";

export type Rng = () => number;

export const SURGE_MS = 45_000;

const WEIGHTS: [Archetype, number][] = [
  ["hype", 30],
  ["questioner", 15],
  ["local", 15],
  ["superfan", 15],
  ["troll", 10],
  ["mod", 3],
];
const TOTAL_WEIGHT = WEIGHTS.reduce((s, [, w]) => s + w, 0);

let seq = 0;

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

export function pickPersona(rng: Rng, archetype?: Archetype): Persona {
  if (archetype) return pick(PERSONAS_BY_ARCHETYPE[archetype], rng);
  let roll = rng() * TOTAL_WEIGHT;
  for (const [a, w] of WEIGHTS) {
    roll -= w;
    if (roll < 0) return pick(PERSONAS_BY_ARCHETYPE[a], rng);
  }
  return pick(PERSONAS, rng);
}

export function renderTemplate(template: string, ctx: StreamContext): string {
  return template
    .replaceAll("{loc}", ctx.location.name)
    .replaceAll("{area}", ctx.location.area)
    .replaceAll("{streamer}", ctx.streamer);
}

function makeMessage(
  persona: Persona,
  text: string,
  now: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  seq += 1;
  return {
    id: `m-${now}-${seq}`,
    personaId: persona.id,
    username: persona.username,
    color: persona.color,
    badges: persona.badges,
    text,
    timestamp: now,
    ...extra,
  };
}

/** 0..1 — how far into the post-reveal surge window we are (1 = just revealed). */
export function surgeIntensity(ctx: StreamContext, now: number): number {
  if (ctx.locationRevealedAt == null) return 0;
  const elapsed = now - ctx.locationRevealedAt;
  if (elapsed < 0 || elapsed > SURGE_MS) return 0;
  return 1 - elapsed / SURGE_MS;
}

export function messagesPerSecond(ctx: StreamContext, now: number): number {
  const base = Math.min(10, Math.max(1, ctx.viewers / 800));
  return base * (1 + 1.5 * surgeIntensity(ctx, now));
}

function oneMessage(ctx: StreamContext, now: number, rng: Rng): ChatMessage {
  const surge = surgeIntensity(ctx, now);

  if (surge > 0 && rng() < 0.2 + 0.5 * surge) {
    const persona = pickPersona(rng, rng() < 0.6 ? "local" : undefined);
    return makeMessage(persona, renderTemplate(pick(SURGE_LINES, rng), ctx), now, {
      locationSignal: true,
    });
  }

  const roll = rng();
  if (roll < 0.004) {
    const persona = pickPersona(rng, "superfan");
    const amount = pick([2, 5, 5, 10, 20, 50], rng);
    return makeMessage(persona, renderTemplate(pick(DONATION_LINES, rng), ctx), now, {
      highlight: "donation",
      amount,
    });
  }
  if (roll < 0.014) {
    const persona = pickPersona(rng, "questioner");
    return makeMessage(persona, renderTemplate(pick(FIRST_MESSAGE_LINES, rng), ctx), now, {
      highlight: "first",
    });
  }

  const persona = pickPersona(rng);
  if (persona.archetype === "local" && rng() < 0.12) {
    return makeMessage(persona, renderTemplate(pick(LOCATION_SIGNAL_LINES, rng), ctx), now, {
      locationSignal: true,
    });
  }
  return makeMessage(persona, renderTemplate(pick(LINES[persona.archetype], rng), ctx), now);
}

/** Messages to emit for one tick of `dtMs`. Fractional rates carry over probabilistically. */
export function nextMessages(
  ctx: StreamContext,
  now: number,
  rng: Rng = Math.random,
  dtMs = 250,
): ChatMessage[] {
  if (!ctx.live) return [];
  const expected = (messagesPerSecond(ctx, now) * dtMs) / 1000;
  const count = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
  return Array.from({ length: count }, () => oneMessage(ctx, now, rng));
}

export function streamerMessage(text: string, ctx: StreamContext, now: number): ChatMessage {
  seq += 1;
  return {
    id: `s-${now}-${seq}`,
    personaId: null,
    username: ctx.streamer,
    color: "var(--ember)",
    badges: ["verified"],
    text,
    timestamp: now,
    fromStreamer: true,
  };
}

/** Burst of replies to the streamer's own message, each with a delay in ms from now. */
export function reactToStreamer(
  text: string,
  ctx: StreamContext,
  rng: Rng = Math.random,
): { delayMs: number; template: string; archetype?: Archetype }[] {
  const size = 4 + Math.floor(rng() * Math.min(10, 2 + ctx.viewers / 1500));
  const mentionsLocation = /pull up|come (through|find)|i'?m at|link up|meet/i.test(text);
  return Array.from({ length: size }, (_, i) => {
    const delayMs = 300 + i * (150 + rng() * 350);
    if (mentionsLocation && rng() < 0.6) {
      return { delayMs, template: pick(SURGE_LINES, rng), archetype: "local" as const };
    }
    return { delayMs, template: pick(STREAMER_REPLY_LINES, rng) };
  });
}

export function replyMessage(
  reply: { template: string; archetype?: Archetype },
  ctx: StreamContext,
  now: number,
  rng: Rng = Math.random,
): ChatMessage {
  const persona = pickPersona(rng, reply.archetype);
  return makeMessage(persona, renderTemplate(reply.template, ctx), now, {
    locationSignal: SURGE_LINES.includes(reply.template) || undefined,
  });
}
