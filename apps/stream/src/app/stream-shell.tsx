"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { useChatCrowd } from "@/agents/chat-crowd/useChatCrowd";
import { AroundMe } from "@/components/around/AroundMe";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DevPanel } from "@/components/DevPanel";
import { TopBar } from "@/components/TopBar";
import { Player } from "@/components/stream/Player";
import { StreamerBar } from "@/components/stream/StreamerBar";
import { SurroundingsCard } from "@/components/stream/SurroundingsCard";
import { LOCATIONS } from "@/lib/locations";
import type { StreamContext, StreamLocation, StreamSource } from "@/lib/types";
import { useSurroundings } from "@/platform/around/useSurroundings";
import { publish } from "@/platform/bus";
import { useLiveLink } from "@/platform/live/useLiveLink";
import { useWakeLock } from "@/platform/live/useWakeLock";

const BASE_VIEWERS = 1840;
// The 3D twin of the streamer's surroundings (/twin).
const MIRROR_URL = process.env.NEXT_PUBLIC_MIRROR_URL ?? "/twin";
const DESKTOP_QUERY = "(min-width: 768px)";

// Why: ChatPanel owns scroll/draft state, so it must be mounted exactly once —
// a CSS-only show/hide of two copies would fork that state.
function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function StreamShell() {
  const [source, setSource] = useState<StreamSource>({ kind: "idle" });
  const [demoLocation, setDemoLocation] = useState<StreamLocation>(LOCATIONS[0]);
  const [viewers, setViewers] = useState(0);
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<View>("live");
  const [mirrorUrl, setMirrorUrl] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const desktop = useIsDesktop();
  const live = source.kind !== "idle";
  const link = useLiveLink({ live, viewers, demo: demoLocation });
  const location = link.location;
  useWakeLock(live);

  const ctx: StreamContext = {
    streamer: "sonion",
    title: "IRL London walk — Tower Hill to Tower Bridge, pull up?",
    location,
    viewers: link.viewers,
    live,
    locationRevealedAt: revealedAt,
  };
  const { messages, send } = useChatCrowd(ctx);
  useSurroundings(location, live);

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
    setDemoLocation(next);
    if (source.kind === "url") {
      setSource({ kind: "url", url: next.camera.url, label: next.camera.label });
    }
    setRevealedAt(null);
    publish({ type: "stream.location", location: next });
  }

  function reveal() {
    const at = Date.now();
    setRevealedAt(at);
    publish({ type: "streamer:location_leaked", location, viewers, at });
    send(`yo I'm at ${location.name} right now, come say hi`);
  }

  function mirror() {
    const url = new URL(MIRROR_URL, window.location.origin);
    url.searchParams.set("lat", String(location.lat));
    url.searchParams.set("lon", String(location.lon));
    url.searchParams.set("scenario", "leak_location_50");
    url.searchParams.set("location", location.id);
    url.searchParams.set("viewers", String(viewers));
    const session = new URLSearchParams(window.location.search).get("session");
    if (session) url.searchParams.set("session", session);
    setMirrorUrl(url.pathname + url.search);
    setTab("3d");
    publish({
      type: "reality:fork",
      scenario: "leak_location_50",
      location,
      viewers,
      label: `What if I tell ${viewers} viewers I'm at ${location.name}?`,
    });
  }

  const chat = <ChatPanel messages={messages} onSend={send} viewers={viewers} live={live} />;
  const lastMessage = messages.at(-1);

  return (
    <div className="flex h-full flex-col">
      <TopBar live={live} />
      <DevPanel />
      <div className="relative flex min-h-0 flex-1">
        <main className="scrollbar-thin flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-3 pb-20 sm:p-4 md:pb-4 lg:gap-5 lg:p-6">
          <ViewTabs tab={tab} onChange={setTab} />
          {/* The player stays mounted across tabs so the stream never drops. */}
          <div className={tab === "live" ? "flex flex-col gap-4 lg:gap-5" : "hidden"}>
            <Player source={source} onSourceChange={changeSource} ctx={ctx} positionBadge={link.badge} sync={link.sync} />
            <StreamerBar
              ctx={ctx}
              positionSource={link.source}
              onLocationChange={changeLocation}
              onReveal={reveal}
              onSimulate={mirror}
            />
            <SurroundingsCard />
          </div>
          {tab === "around" && (
            <AroundMe location={location} activeCamUrl={source.kind === "url" ? source.url : null} />
          )}
          {tab === "3d" && <TwinView src={mirrorUrl ?? `/twin?lat=${location.lat}&lon=${location.lon}`} />}
        </main>

        {desktop ? (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface xl:w-[380px]">
            {chat}
          </aside>
        ) : chatOpen ? (
          <div className="absolute inset-x-0 bottom-0 top-[18%] z-20 flex flex-col">
            <button
              type="button"
              aria-label="Collapse chat"
              onClick={() => setChatOpen(false)}
              className="h-6 shrink-0 bg-gradient-to-b from-transparent to-bg/80"
            />
            <div className="animate-sheet-up relative flex min-h-0 flex-1 flex-col rounded-t-xl border-t border-line-strong bg-surface shadow-[0_-24px_60px_rgba(0,0,0,0.6)]">
              <button
                type="button"
                aria-label="Collapse chat"
                onClick={() => setChatOpen(false)}
                className="absolute left-1/2 top-1.5 z-10 grid h-5 w-12 -translate-x-1/2 place-items-center text-dim"
              >
                <ChevronDown className="size-4" />
              </button>
              <div className="min-h-0 flex-1 pt-3">{chat}</div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="absolute inset-x-3 bottom-3 z-20 flex h-12 items-center gap-3 rounded-lg border border-line-strong bg-surface-2/95 px-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur"
          >
            <span className="relative grid size-8 shrink-0 place-items-center rounded-md bg-surface-3 text-text">
              <MessageSquare className="size-4" />
              {live && <span className="animate-live absolute right-1 top-1 size-1.5 rounded-full bg-live" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[9px] tracking-normal text-muted">
                Chat {live ? `· ${viewers.toLocaleString("en-GB")} watching` : ""}
              </span>
              <span className="block truncate text-[13px] text-text/85">
                {lastMessage ? (
                  <>
                    <span className="font-semibold" style={{ color: lastMessage.color }}>
                      {lastMessage.username}
                    </span>{" "}
                    {lastMessage.text}
                  </>
                ) : (
                  <span className="text-muted">Chat opens when you go live</span>
                )}
              </span>
            </span>
            <ChevronDown className="size-4 rotate-180 text-muted" />
          </button>
        )}
      </div>
    </div>
  );
}

type View = "live" | "around" | "3d";

const VIEWS: { id: View; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "around", label: "Around me" },
  { id: "3d", label: "3D mirror" },
];

function ViewTabs({ tab, onChange }: { tab: View; onChange: (v: View) => void }) {
  return (
    <nav className="flex w-fit gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Views">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          aria-current={tab === v.id ? "page" : undefined}
          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            tab === v.id ? "bg-text text-bg" : "text-muted hover:text-text"
          }`}
        >
          {v.label}
        </button>
      ))}
    </nav>
  );
}

function TwinView({ src }: { src: string }) {
  return (
    <section className="relative min-h-[520px] flex-1 overflow-hidden rounded-xl border border-line bg-black">
      <iframe src={src} title="3D mirror" className="absolute inset-0 size-full" allow="fullscreen" />
      <a
        href={src}
        target="_blank"
        rel="noopener"
        className="absolute right-3 top-3 rounded-lg border border-line-strong bg-surface/90 px-2.5 py-1 text-[12px] font-semibold text-text backdrop-blur hover:border-text/40"
      >
        Open full screen
      </a>
    </section>
  );
}
