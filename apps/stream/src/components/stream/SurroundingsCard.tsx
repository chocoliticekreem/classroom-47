"use client";

import { useEffect, useState } from "react";
import { Activity, Radar } from "lucide-react";
import { subscribe } from "@/platform/bus";
import type { StreamLocation } from "@/lib/types";

type Level = "calm" | "busy" | "danger";

interface Status {
  summary: string;
  level: Level;
  at: number;
}

const LEVEL_STYLE: Record<Level, { dot: string; text: string; bar: string; label: string; bars: number }> = {
  calm: { dot: "bg-ok", text: "text-ok", bar: "bg-ok", label: "Calm", bars: 1 },
  busy: { dot: "bg-warn", text: "text-warn", bar: "bg-warn", label: "Busy", bars: 2 },
  danger: { dot: "bg-live", text: "text-live", bar: "bg-live", label: "Danger", bars: 3 },
};

function hhmm(at: number) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function SurroundingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [fix, setFix] = useState<StreamLocation | null>(null);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "surroundings.update") {
          setStatus({ summary: e.summary, level: e.level, at: Date.now() });
          setPending(null);
        } else if (e.type === "reality:fork") {
          setFix(e.location);
          setPending(`Mirror opened for ${e.location.name}`);
        } else if (e.type === "streamer:location_leaked") {
          setFix(e.location);
          setPending(`Location shared at ${e.location.name} with ${e.viewers.toLocaleString("en-GB")} viewers`);
        } else if (e.type === "stream.location") {
          setFix(e.location);
        }
      }),
    [],
  );

  const style = status ? LEVEL_STYLE[status.level] : null;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex h-10 items-center justify-between border-b border-line px-4">
        <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          <Radar className={`size-3.5 ${status ? "text-ember" : "text-dim"}`} aria-hidden />
          Surroundings
          <span className="text-dim">/</span>
          <span className="text-dim">Intel</span>
        </h2>
        <div className="flex items-center gap-3">
          <span className="flex items-end gap-0.5" aria-hidden>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`w-1 rounded-sm ${style && n <= style.bars ? style.bar : "bg-line-strong"}`}
                style={{ height: 4 + n * 3 }}
              />
            ))}
          </span>
          <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${style ? style.text : "text-dim"}`}>
            {style ? style.label : "No feed"}
          </span>
        </div>
      </header>

      <div className="grid gap-px bg-line sm:grid-cols-[1fr_auto]">
        <div className="bg-surface px-4 py-3.5">
          {status ? (
            <p className="text-[14px] leading-6 text-text">{status.summary}</p>
          ) : (
            <p className="text-[14px] leading-6 text-muted">
              City feed not connected.{" "}
              <span className="text-dim">Waiting for surroundings data from the sim tab.</span>
            </p>
          )}
          {pending && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-ember">
              <Activity className="size-3" aria-hidden />
              {pending}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-[1fr_1.7fr_1fr] gap-px bg-line sm:w-[360px]">
          <Cell label="Fix" value={fix ? fix.area : "—"} />
          <Cell label="Lat / Lon" value={fix ? `${fix.lat.toFixed(4)} ${fix.lon.toFixed(4)}` : "—"} />
          <Cell label="Updated" value={status ? hhmm(status.at) : "—"} />
        </dl>
      </div>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-dim">{label}</dt>
      <dd className="mt-1 truncate font-mono text-[11px] text-text/90">{value}</dd>
    </div>
  );
}
