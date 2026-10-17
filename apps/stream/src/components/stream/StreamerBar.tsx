"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Heart, MapPinned, Sparkles, Star } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import type { StreamContext, StreamLocation } from "@/lib/types";

interface StreamerBarProps {
  ctx: StreamContext;
  onLocationChange: (l: StreamLocation) => void;
  onReveal: () => void;
  onSimulate: () => void;
}

const TAGS = ["IRL", "London", "Just Chatting"];

function useSince(at: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  if (at === null) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function StreamerBar({ ctx, onLocationChange, onReveal, onSimulate }: StreamerBarProps) {
  const since = useSince(ctx.locationRevealedAt);
  const revealed = ctx.locationRevealedAt !== null;

  return (
    <section className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div className={`relative shrink-0 rounded-full p-0.5 ${ctx.live ? "bg-live" : "bg-line"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote SVG avatar, next/image adds nothing here */}
          <img
            src={`https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(ctx.streamer)}&backgroundColor=16161d`}
            alt=""
            className="size-12 rounded-full bg-surface-2"
          />
          {ctx.live && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-live px-1 text-[9px] font-bold uppercase text-white">
              Live
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-base font-semibold">{ctx.streamer}</h1>
            <BadgeCheck className="size-4 shrink-0 text-ember" aria-label="Verified" />
          </div>
          <p className="truncate text-sm text-text/80">{ctx.title}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TAGS.map((t) => (
              <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Location"
          value={ctx.location.id}
          onChange={(e) => {
            const loc = LOCATIONS.find((l) => l.id === e.target.value);
            if (loc) onLocationChange(loc);
          }}
          className="h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-ember"
        >
          {LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onSimulate}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-sm font-medium transition-colors hover:border-ember/60"
        >
          <Sparkles className="size-4 text-ember" aria-hidden />
          Simulate first
        </button>

        <button
          type="button"
          onClick={onReveal}
          disabled={revealed}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-ember px-3 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
        >
          <MapPinned className="size-4" aria-hidden />
          {revealed ? `Location shared · ${since} ago` : "Tell chat my location"}
        </button>

        <span className="mx-1 hidden h-6 w-px bg-line lg:block" />

        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-sm font-medium transition-colors hover:bg-line"
        >
          <Heart className="size-4" aria-hidden />
          Follow
        </button>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-text px-3 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Star className="size-4" aria-hidden />
          Subscribe
        </button>
      </div>
    </section>
  );
}
