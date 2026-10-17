"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatCrowd } from "@/agents/chat-crowd/useChatCrowd";
import { useSceneChat } from "@/agents/chat-crowd/useSceneChat";
import { AroundMe } from "@/components/around/AroundMe";
import { ChatDock } from "@/components/chat/ChatDock";
import { CopilotPanel, PANEL_W, RAIL_W, useCopilotOpen } from "@/components/copilot/CopilotPanel";
import { DevPanel } from "@/components/DevPanel";
import { TopBar } from "@/components/TopBar";
import { Player } from "@/components/stream/Player";
import { StreamerBar } from "@/components/stream/StreamerBar";
import { prefetch } from "@/lib/client/cachedFetch";
import { LOCATIONS } from "@/lib/locations";
import type { StreamContext, StreamLocation, StreamSource } from "@/lib/types";
import { useSurroundings } from "@/platform/around/useSurroundings";
import { publish } from "@/platform/bus";
import { StreamVideo } from "@/components/stream/PhoneFeed";
import { usePhoneVideo } from "@/platform/live/rtc/usePhoneVideo";
import { useLiveLink } from "@/platform/live/useLiveLink";
import { sessionFromUrl } from "@/platform/live/useRemoteLive";
import { useWakeLock } from "@/platform/live/useWakeLock";

const BASE_VIEWERS = 1840;
// The 3D twin of the streamer's surroundings (/twin).
const MIRROR_URL = process.env.NEXT_PUBLIC_MIRROR_URL ?? "/twin";
const DESKTOP_QUERY = "(min-width: 768px)";

// Why: ChatPanel and the copilot own scroll/draft state, so it must be mounted exactly once —
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
  const desktop = useIsDesktop();
  const [copilotOpen, setCopilotOpen] = useCopilotOpen(desktop);
  const live = source.kind !== "idle";
  const link = useLiveLink({ live, viewers, demo: demoLocation });
  const location = link.location;
  const session = useMemo(() => sessionFromUrl(), []);
  const phone = usePhoneVideo(session, link.followPhone);
  useWakeLock(live);
  useEffect(() => {
    // The 3D tab is an iframe of /twin on this origin, so warming the Cache API here makes its first paint instant.
    // The field is polled with no-store, so it is only fetched to get the server computing it early.
    const warm = () => {
      void prefetch("/api/twin/osm");
      void fetch("/api/twin/field").catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 2000);
    return () => clearTimeout(t);
  }, []);

  const ctx: StreamContext = {
    streamer: "sonion",
    title: "IRL London walk — Tower Hill to Tower Bridge, pull up?",
    location,
    viewers: link.viewers,
    live,
    locationRevealedAt: revealedAt,
  };
  const { messages, send, inject } = useChatCrowd(ctx);
  useSceneChat(ctx, source, messages, inject);
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

  const mainStyle = desktop ? { paddingRight: (copilotOpen ? PANEL_W : RAIL_W) + 24 } : undefined;

  return (
    <div className="flex h-full flex-col">
      <TopBar live={live} />
      <DevPanel />
      <div className="relative flex min-h-0 flex-1">
        <main
          className="scrollbar-thin flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-3 pb-24 transition-[padding] duration-200 sm:p-4 sm:pb-24 md:pb-4 lg:gap-5 lg:p-6"
          style={mainStyle}
        >
          <ViewTabs tab={tab} onChange={setTab} />
          {/* The player stays mounted across tabs so the stream never drops. */}
          <div className={tab === "live" ? "flex flex-col gap-4 lg:gap-5" : "hidden"}>
            <Player source={source} onSourceChange={changeSource} ctx={ctx} positionBadge={link.badge} sync={link.sync} remote={phone} />
            <StreamerBar
              ctx={ctx}
              positionSource={link.source}
              onLocationChange={changeLocation}
              onReveal={reveal}
              onSimulate={mirror}
            />
          </div>
          {tab === "around" && (
            <AroundMe location={location} activeCamUrl={source.kind === "url" ? source.url : null} />
          )}
          {tab === "3d" && <TwinView src={mirrorUrl ?? `/twin?lat=${location.lat}&lon=${location.lon}`} pip={phone.stream} />}
        </main>

        <CopilotPanel location={location} live={live} desktop={desktop} open={copilotOpen} onOpenChange={setCopilotOpen} />
        <ChatDock messages={messages} onSend={send} viewers={viewers} live={live} desktop={desktop} raised={!copilotOpen} />
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

function TwinView({ src, pip }: { src: string; pip: MediaStream | null }) {
  return (
    <section className="relative min-h-[520px] flex-1 overflow-hidden rounded-xl border border-line bg-black">
      <iframe src={src} title="3D mirror" className="absolute inset-0 size-full" allow="fullscreen; geolocation" />
      {pip && (
        <div className="absolute bottom-3 left-3 w-[200px] overflow-hidden rounded-lg border border-line-strong bg-black shadow-[0_12px_40px_rgba(0,0,0,0.55)] sm:w-[260px]">
          <StreamVideo stream={pip} className="aspect-video size-full object-cover" />
          <span className="absolute left-2 top-2 flex h-5 items-center gap-1 rounded-[4px] bg-live px-1.5 font-mono text-[10px] font-semibold text-white">
            <span className="animate-live size-1.5 rounded-full bg-white" />
            Phone
          </span>
        </div>
      )}
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
