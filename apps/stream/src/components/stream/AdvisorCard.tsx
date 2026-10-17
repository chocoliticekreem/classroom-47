"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Route, Send, Sparkles } from "lucide-react";
import type { StreamLocation } from "@/lib/types";
import type { AdviceLevel, Assessment } from "@/platform/agent/types";
import { useAdvisor } from "@/platform/agent/useAdvisor";
import { publish } from "@/platform/bus";
import type { RouteResponse } from "@/platform/route/types";

const LEVEL: Record<AdviceLevel, { pill: string; label: string }> = {
  calm: { pill: "border-ok/40 bg-ok/10 text-ok", label: "Calm" },
  busy: { pill: "border-warn/40 bg-warn/10 text-warn", label: "Busy" },
  danger: { pill: "border-live/40 bg-live/10 text-live", label: "Danger" },
};

const SOURCE: Record<Assessment["source"], string> = {
  "cluster-agent": "Cluster agent on VAST",
  "local-llm": "Local LLM (W&B)",
};

const time = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Where the calmer route goes when the advisor says the spot is busy: the next stop of the walk. */
function nextStop(location: StreamLocation) {
  return location.id === "tower-bridge" ? "Tower Hill station" : "Tower Bridge";
}

function useSuggestedRoute(location: StreamLocation, level: AdviceLevel | null) {
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const wanted = level === "busy" || level === "danger";
  useEffect(() => {
    if (!wanted) return;
    const ctrl = new AbortController();
    const to = nextStop(location);
    fetch(`/api/route?from=${location.lat},${location.lon}&to=${encodeURIComponent(to)}&mode=calm`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RouteResponse>) : null))
      .then((r) => {
        if (!r || ctrl.signal.aborted) return;
        setRoute(r);
        publish({
          type: "route.suggested",
          to: r.to.name,
          xz: r.calmest.xz,
          polyline: r.calmest.polyline,
          lengthM: r.calmest.lengthM,
          etaMin: r.calmest.etaMin,
          extraMin: r.extraMin,
          lessCrowd: r.lessCrowd,
        });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [location, wanted]);
  return wanted ? route : null;
}

export function AdvisorCard({ location, live }: { location: StreamLocation; live: boolean }) {
  const { assessment, error, loading, assess } = useAdvisor(location, live);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const route = useSuggestedRoute(location, assessment?.level ?? null);

  function ask(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    void assess(q);
    setDraft("");
  }

  if (!live && !assessment) return null;
  const level = assessment ? LEVEL[assessment.level] : null;

  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2 pt-3.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Sparkles className="size-3.5 text-ember" aria-hidden />
          Advisor
        </span>
        {level && (
          <span className={`rounded-md border px-2 py-0.5 text-[12px] font-semibold ${level.pill}`}>{level.label}</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[12px] text-dim">
          {assessment && (
            <span className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
              {SOURCE[assessment.source]}
            </span>
          )}
          {assessment && <span>Updated {time(assessment.at)}</span>}
          {loading && <span className="animate-pulse text-muted">Assessing…</span>}
        </span>
      </header>

      <div className="px-4 pb-4">
        {assessment ? (
          <>
            <p className="text-[15px] leading-6 text-text">{assessment.advice}</p>
            {assessment.reasons.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-[13px] leading-5 text-muted">
                {assessment.reasons.slice(0, 3).map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-dim" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-3 flex items-center gap-1.5 text-[12px] text-muted hover:text-text"
            >
              <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              Based on {assessment.evidence.length} clip{assessment.evidence.length === 1 ? "" : "s"} ·{" "}
              {assessment.liveCams} live cam{assessment.liveCams === 1 ? "" : "s"}
            </button>
            {open && (
              <ul className="mt-2 flex flex-col gap-2">
                {assessment.evidence.length === 0 && (
                  <li className="text-[12px] text-dim">No VSS clips in this answer; it rests on live camera counts only.</li>
                )}
                {assessment.evidence.map((ev) => (
                  <li key={`${ev.video}-${ev.start_s}`} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-text">
                      <span className="font-semibold">{ev.camera}</span>
                      <span className="text-dim">
                        {ev.start_s}–{ev.end_s} s · match {Math.round(ev.similarity * 100)}%
                      </span>
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{ev.description}</p>
                    <p className="mt-1 text-[11px] text-dim">
                      YOLO:{" "}
                      {Object.entries(ev.counts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {route && (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-ember/30 bg-ember-soft px-3 py-2.5">
                <Route className="mt-0.5 size-4 shrink-0 text-ember" aria-hidden />
                <p className="text-[13px] leading-5 text-text">
                  <span className="font-semibold">Suggested route</span> to {route.to.name}: {route.calmest.lengthM} m,{" "}
                  {Math.round(route.calmest.etaMin)} min
                  {route.extraMin > 0 ? ` (+${route.extraMin} min)` : ""}
                  {route.lessCrowd > 0 ? `, ${Math.round(route.lessCrowd * 100)}% less crowd` : ", same crowd either way"}
                  {route.avoids.length > 0 ? ` · avoids ${route.avoids.join(", ")}` : ""}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-[14px] leading-6 text-muted">
            {error ? (
              <>
                <span className="font-semibold text-text">Advisor offline.</span> {error}
              </>
            ) : (
              "Reading the cameras around you…"
            )}
          </p>
        )}
        {assessment && error && <p className="mt-2 text-[12px] text-warn">Last refresh failed: {error}</p>}

        <form onSubmit={ask} className="mt-3 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the advisor, e.g. is the bridge crowded right now?"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 text-[13px] text-text placeholder:text-dim focus:border-text/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-text text-bg disabled:opacity-40"
            aria-label="Ask"
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
