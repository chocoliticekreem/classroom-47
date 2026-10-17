"use client";
// Console tab: City. The live city in the middle, a few plain controls on the left, and what's happening
// on the right. Talks to the city over the "rivet-city" BroadcastChannel.
import { useState } from "react";
import { useCityLink } from "../city/useCityLink";
import { MakeSomethingHappen, SpeedControl, TimeControl, WeatherControl } from "../city/Controls";
import { PracticeCases } from "../city/PracticeCases";
import { Happening } from "../city/Happening";
import { LINK_WORDS } from "../city/logic";
import { useCitySaved } from "../city/useCitySaved";

const DOT = { live: "bg-emerald-400", stale: "bg-red-400", waiting: "bg-white/30" } as const;

export default function CityTab() {
  const { telemetry: t, state, send } = useCityLink();
  const saved = useCitySaved();
  const [tour, setTour] = useState(false);

  return (
    <div className="grid h-full min-h-[560px] grid-cols-[280px_minmax(0,1fr)_320px] bg-[#1f1f23] text-white 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
      <aside aria-label="City controls" className="min-h-0 overflow-y-auto border-r border-white/[0.06]">
        <MakeSomethingHappen send={send} />
        <WeatherControl send={send} t={t} />
        <TimeControl send={send} t={t} />
        <SpeedControl send={send} t={t} />
        <PracticeCases send={send} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 text-[13px]">
          <span className="flex items-center gap-2 text-white/70" role="status" aria-live="polite">
            {LINK_WORDS[state]}
            <span className={`size-2 rounded-full ${DOT[state]}`} />
          </span>
          <span className="ml-auto flex items-center gap-4">
            <button
              aria-pressed={tour}
              onClick={() => {
                send({ type: "tour", on: !tour });
                setTour(!tour);
              }}
              className={tour ? "text-white" : "text-white/55 hover:text-white"}
            >
              {tour ? "Stop camera tour" : "Camera tour"}
            </button>
            <a href="/city" className="text-white/55 hover:text-white">
              Open full screen
            </a>
          </span>
        </div>
        <div className="relative min-h-0 flex-1 bg-black">
          <iframe src="/city?embed=1" title="Live city" className="absolute inset-0 size-full border-0" allow="fullscreen" />
        </div>
      </main>

      <aside aria-label="What's happening" className="min-h-0 overflow-y-auto border-l border-white/[0.06]">
        <Happening t={t} send={send} saved={saved} />
      </aside>
    </div>
  );
}
