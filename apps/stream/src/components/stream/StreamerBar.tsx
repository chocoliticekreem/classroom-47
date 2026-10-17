"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown, Heart, MapPinned, Sparkles, Star } from "lucide-react";
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
    <section className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <div className={`relative shrink-0 rounded-full p-[2px] ${ctx.live ? "bg-live" : "bg-line-strong"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote SVG avatar, next/image adds nothing here */}
          <img
            src={`https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(ctx.streamer)}&backgroundColor=131318`}
            alt=""
            className="size-12 rounded-full bg-surface-2 ring-2 ring-bg"
          />
          {ctx.live && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[3px] bg-live px-1 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-white ring-2 ring-bg">
              Live
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">
              {ctx.streamer}
            </h1>
            <BadgeCheck className="size-4 shrink-0 text-ember" aria-label="Verified" />
            <span className="ml-1 hidden font-mono text-[10px] uppercase tracking-[0.16em] text-dim sm:inline">
              {ctx.live ? `${ctx.viewers.toLocaleString("en-GB")} watching` : "Offline"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[14px] text-text/85">{ctx.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {TAGS.map((t) => (
              <span
                key={t}
                className="rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface pl-2.5 pr-2.5 transition-colors focus-within:border-line-strong hover:border-line-strong">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">At</span>
          <span className="relative">
            <span className="invisible block px-1 text-[13px] font-medium">{ctx.location.name}</span>
            <select
              aria-label="Location"
              value={ctx.location.id}
              onChange={(e) => {
                const loc = LOCATIONS.find((l) => l.id === e.target.value);
                if (loc) onLocationChange(loc);
              }}
              className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent px-1 text-[13px] font-medium text-text focus:outline-none"
            >
              {LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </span>
          <ChevronDown className="pointer-events-none size-3.5 text-muted" aria-hidden />
        </label>

        <button
          type="button"
          onClick={onSimulate}
          className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium transition-colors hover:border-ember/60 hover:text-text"
        >
          <Sparkles className="size-3.5 text-ember" aria-hidden />
          Simulate first
        </button>

        <button
          type="button"
          onClick={onReveal}
          disabled={revealed}
          className="flex h-9 items-center gap-1.5 rounded-md bg-ember px-3 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-surface disabled:text-muted"
        >
          <MapPinned className="size-3.5" aria-hidden />
          {revealed ? (
            <>
              Shared <span className="font-mono text-[11px]">{since}</span> ago
            </>
          ) : (
            "Tell chat my location"
          )}
        </button>

        <span className="mx-1 hidden h-6 w-px bg-line xl:block" />

        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium transition-colors hover:border-line-strong"
        >
          <Heart className="size-3.5" aria-hidden />
          Follow
        </button>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-md bg-text px-3 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90"
        >
          <Star className="size-3.5" aria-hidden />
          Subscribe
        </button>
      </div>
    </section>
  );
}
