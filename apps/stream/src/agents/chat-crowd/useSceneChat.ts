"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage, Persona, StreamContext, StreamSource } from "@/lib/types";
import { PERSONAS } from "./personas";
import type { SceneRequest, SceneResponse } from "./scene";

const INTERVAL_MS = 12_000;
const MAX_BACKOFF_MS = 120_000;
const FRAME_WIDTH = 640;
const FRAME_QUALITY = 0.7;
const PERSONAS_PER_CALL = 10;
const TOPIC_COUNT = 8;

function pickPersonas(count: number): Persona[] {
  const pool = [...PERSONAS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** JPEG data URI from the live <video>, or null when there is no decodable frame or the canvas is tainted. */
function captureFrame(): string | null {
  const video = document.querySelector<HTMLVideoElement>("video");
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const g = canvas.getContext("2d");
  if (!g) return null;
  try {
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", FRAME_QUALITY);
  } catch {
    return null;
  }
}

/**
 * Every 12 s while live and visible: look at the stream, ask /api/chat/scene what viewers would
 * say about it, and drip those lines into chat on top of the template crowd. Backs off on
 * errors and goes quiet for good when the server has no W&B key.
 */
export function useSceneChat(
  ctx: StreamContext,
  source: StreamSource,
  messages: ChatMessage[],
  inject: (batch: ChatMessage[]) => void,
): void {
  const ctxRef = useRef(ctx);
  const messagesRef = useRef(messages);
  const disabledRef = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    ctxRef.current = ctx;
    messagesRef.current = messages;
  }, [ctx, messages]);

  const sourceUrl = source.kind === "url" ? source.url : null;

  useEffect(() => {
    if (!ctx.live || disabledRef.current) return;
    let cancelled = false;
    let delay = INTERVAL_MS;
    let next: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const pending = timers.current;

    const schedule = () => {
      if (!cancelled) next = setTimeout(tick, delay);
    };

    const drip = (res: SceneResponse, personas: Persona[]) => {
      const byName = new Map(personas.map((p) => [p.username, p]));
      let offset = 400;
      res.lines.forEach((line, i) => {
        const persona = byName.get(line.username);
        if (!persona) return;
        offset += i === 0 ? 0 : 600 + Math.random() * 700;
        const at = Date.now() + offset;
        const t = setTimeout(() => {
          pending.delete(t);
          if (!ctxRef.current.live) return;
          inject([
            {
              id: `sc-${at}-${i}`,
              personaId: persona.id,
              username: persona.username,
              color: persona.color,
              badges: persona.badges,
              text: line.text,
              timestamp: Date.now(),
              locationSignal: line.locationSignal || undefined,
              scene: res.scene,
            },
          ]);
        }, offset);
        pending.add(t);
      });
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) return schedule();
      const frame = captureFrame();
      if (!frame && !sourceUrl) return schedule();

      const personas = pickPersonas(PERSONAS_PER_CALL);
      const current = ctxRef.current;
      const body: SceneRequest = {
        frame: frame ?? undefined,
        videoUrl: frame ? undefined : (sourceUrl ?? undefined),
        location: { name: current.location.name, area: current.location.area },
        viewers: current.viewers,
        topics: messagesRef.current
          .filter((m) => !m.scene && !m.fromStreamer)
          .slice(-TOPIC_COUNT)
          .map((m) => m.text),
        personas: personas.map((p) => ({ username: p.username, archetype: p.archetype })),
      };

      try {
        const res = await fetch("/api/chat/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 501) {
          disabledRef.current = true;
          return;
        }
        if (!res.ok) throw new Error(`scene route ${res.status}`);
        const data = (await res.json()) as SceneResponse;
        if (!cancelled) drip(data, personas);
        delay = INTERVAL_MS;
      } catch (err) {
        if (cancelled) return;
        delay = Math.min(MAX_BACKOFF_MS, delay * 2);
        if (process.env.NODE_ENV === "development") console.warn("[scene-chat]", err, `retry in ${delay / 1000}s`);
      }
      schedule();
    };

    next = setTimeout(tick, 2_000);
    return () => {
      cancelled = true;
      controller.abort();
      if (next) clearTimeout(next);
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [ctx.live, sourceUrl, inject]);
}
