"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, StreamContext } from "@/lib/types";
import { publish } from "@/platform/bus";
import { nextMessages, reactToStreamer, replyMessage, streamerMessage } from "./engine";

const TICK_MS = 250;
const MAX_MESSAGES = 150;

export function useChatCrowd(ctx: StreamContext): {
  messages: ChatMessage[];
  send: (text: string) => void;
  inject: (batch: ChatMessage[]) => void;
} {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const ctxRef = useRef(ctx);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  const append = useCallback((batch: ChatMessage[]) => {
    if (batch.length === 0) return;
    batch.forEach((message) => publish({ type: "chat.message", message }));
    setMessages((prev) => [...prev, ...batch].slice(-MAX_MESSAGES));
  }, []);

  useEffect(() => {
    if (!ctx.live) return;
    const id = setInterval(() => {
      append(nextMessages(ctxRef.current, Date.now(), Math.random, TICK_MS));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ctx.live, append]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const current = ctxRef.current;
      append([streamerMessage(trimmed, current, Date.now())]);
      if (!current.live) return;
      reactToStreamer(trimmed, current).forEach((reply) => {
        const t = setTimeout(() => {
          timers.current.delete(t);
          append([replyMessage(reply, ctxRef.current, Date.now())]);
        }, reply.delayMs);
        timers.current.add(t);
      });
    },
    [append],
  );

  return { messages, send, inject: append };
}
