"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  BadgeCheck,
  Crown,
  Gem,
  MapPin,
  MessageSquareOff,
  Send,
  Shield,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import type { Badge, ChatMessage } from "@/lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  viewers: number;
  live: boolean;
}

const BADGE_ICON: Record<Badge, { Icon: typeof Shield; className: string; label: string }> = {
  mod: { Icon: Shield, className: "text-ok", label: "Moderator" },
  vip: { Icon: Gem, className: "text-[#ff6bd6]", label: "VIP" },
  sub: { Icon: Star, className: "text-[#c77dff]", label: "Subscriber" },
  founder: { Icon: Crown, className: "text-warn", label: "Founder" },
  verified: { Icon: BadgeCheck, className: "text-[#5aa9ff]", label: "Verified" },
};

const STICK_THRESHOLD_PX = 48;

function formatViewers(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function Badges({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="mr-1 inline-flex translate-y-[2px] gap-0.5">
      {badges.map((b) => {
        const { Icon, className, label } = BADGE_ICON[b];
        return <Icon key={b} aria-label={label} className={`size-3.5 ${className}`} />;
      })}
    </span>
  );
}

function MessageRow({ m }: { m: ChatMessage }) {
  if (m.highlight === "donation") {
    return (
      <div className="animate-chat-in my-1 rounded-lg border border-ember/40 bg-ember-soft px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ember">
          <Sparkles className="size-3.5" />
          {m.username} tipped £{m.amount}
        </div>
        <p className="mt-0.5 text-sm text-text">{m.text}</p>
      </div>
    );
  }

  const base = "animate-chat-in rounded-md px-2 py-1 text-[13px] leading-5 break-words";
  const tone = m.fromStreamer
    ? "border-l-2 border-ember bg-ember-soft"
    : m.highlight === "first"
      ? "border-l-2 border-[#5aa9ff] bg-[#5aa9ff12]"
      : "hover:bg-surface-2";

  return (
    <div className={`${base} ${tone}`}>
      {m.highlight === "first" && (
        <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-[#5aa9ff] uppercase">
          First message
        </div>
      )}
      <Badges badges={m.badges} />
      <span className="font-semibold" style={{ color: m.color }}>
        {m.username}
      </span>
      <span className="text-muted">: </span>
      <span className={m.fromStreamer ? "font-medium text-text" : "text-text/90"}>{m.text}</span>
      {m.locationSignal && (
        <span className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-0.5 rounded border border-warn/30 bg-warn/10 px-1 py-px align-middle text-[10px] font-medium text-warn">
          <MapPin className="size-2.5" />
          location signal
        </span>
      )}
    </div>
  );
}

export function ChatPanel({ messages, onSend, viewers, live }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const [seenId, setSeenId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");

  const lastId = messages.at(-1)?.id;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (stuck && el) el.scrollTop = el.scrollHeight;
  }, [lastId, stuck]);

  const seenIndex = seenId ? messages.findIndex((m) => m.id === seenId) : -1;
  const unseen = stuck ? 0 : seenIndex < 0 ? messages.length : messages.length - 1 - seenIndex;

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    if (atBottom === stuck) return;
    if (!atBottom) setSeenId(lastId);
    setStuck(atBottom);
  }

  function resume() {
    setStuck(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function submit() {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
    resume();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-text uppercase">Live chat</h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
          <Users className="size-3.5" />
          {live ? formatViewers(viewers) : "—"}
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="scrollbar-thin h-full overflow-y-auto px-2 py-2"
        >
          {!live && messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
              <MessageSquareOff className="size-6" />
              <p className="text-sm">Chat opens when you go live</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {messages.map((m) => (
                <MessageRow key={m.id} m={m} />
              ))}
            </div>
          )}
        </div>

        {!stuck && (
          <button
            type="button"
            onClick={resume}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface-2/95 px-3 py-1.5 text-xs font-medium text-text shadow-lg backdrop-blur hover:border-ember/60"
          >
            <ArrowDown className="size-3.5" />
            Chat paused{unseen > 0 ? ` — ${unseen} new` : ""}
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 focus-within:border-ember/60">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Send a message as streamer"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send"
            className="rounded-md p-1.5 text-ember transition-opacity disabled:opacity-30"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
