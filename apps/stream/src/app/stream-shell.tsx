"use client";

import { useCallback, useEffect, useState } from "react";
import { useChatCrowd } from "@/agents/chat-crowd/useChatCrowd";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TopBar } from "@/components/TopBar";
import { Player } from "@/components/stream/Player";
import { StreamerBar } from "@/components/stream/StreamerBar";
import { SurroundingsCard } from "@/components/stream/SurroundingsCard";
import { LOCATIONS } from "@/lib/locations";
import type { StreamContext, StreamLocation, StreamSource } from "@/lib/types";
import { publish } from "@/platform/bus";

const BASE_VIEWERS = 1840;

export function StreamShell() {
  const [source, setSource] = useState<StreamSource>({ kind: "idle" });
  const [location, setLocation] = useState<StreamLocation>(LOCATIONS[0]);
  const [viewers, setViewers] = useState(0);
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const live = source.kind !== "idle";

  const ctx: StreamContext = {
    streamer: "sonion",
    title: "IRL London walk — West End at night, pull up?",
    location,
    viewers,
    live,
    locationRevealedAt: revealedAt,
  };
  const { messages, send } = useChatCrowd(ctx);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setViewers((v) => {
        const target = BASE_VIEWERS * (revealedAt ? 2.6 : 1);
        const drift = (target - v) * 0.08 + (Math.random() - 0.45) * 40;
        return Math.max(1, Math.round(v + drift));
      });
    }, 1000);
    return () => clearInterval(id);
  }, [live, revealedAt]);

  useEffect(() => {
    if (live) publish({ type: "stream.viewers", viewers });
  }, [live, viewers]);

  // Stable identity: Player's webcam effect depends on it and would restart the camera.
  const changeSource = useCallback((next: StreamSource) => {
    setSource(next);
    if (next.kind === "idle") {
      setViewers(0);
      setRevealedAt(null);
    } else {
      setViewers((v) => (v === 0 ? Math.round(BASE_VIEWERS * 0.4) : v));
    }
  }, []);

  function changeLocation(next: StreamLocation) {
    setLocation(next);
    setRevealedAt(null);
    publish({ type: "stream.location", location: next });
  }

  function reveal() {
    const at = Date.now();
    setRevealedAt(at);
    publish({ type: "location.reveal", location, viewers, at });
    send(`yo I'm at ${location.name} right now, come say hi`);
  }

  function simulate() {
    publish({
      type: "sim.request",
      location,
      viewers,
      prompt: `What happens if I tell ${viewers} viewers I'm at ${location.name}?`,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar live={live} />
      <div className="flex min-h-0 flex-1">
        <main className="scrollbar-thin flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
          <Player source={source} onSourceChange={changeSource} ctx={ctx} />
          <StreamerBar
            ctx={ctx}
            onLocationChange={changeLocation}
            onReveal={reveal}
            onSimulate={simulate}
          />
          <SurroundingsCard />
        </main>
        <aside className="hidden w-[360px] shrink-0 flex-col border-l border-line bg-surface md:flex">
          <ChatPanel messages={messages} onSend={send} viewers={viewers} live={live} />
        </aside>
      </div>
    </div>
  );
}
