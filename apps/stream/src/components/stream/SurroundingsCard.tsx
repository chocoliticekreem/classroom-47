"use client";

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { subscribe } from "@/platform/bus";

type Level = "calm" | "busy" | "danger";

interface Status {
  summary: string;
  level: Level;
  at: number;
}

const LEVEL_STYLE: Record<Level, { dot: string; text: string; label: string }> = {
  calm: { dot: "bg-ok", text: "text-ok", label: "Calm" },
  busy: { dot: "bg-warn", text: "text-warn", label: "Busy" },
  danger: { dot: "bg-live", text: "text-live", label: "Danger" },
};

export function SurroundingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "surroundings.update") {
          setStatus({ summary: e.summary, level: e.level, at: Date.now() });
          setPending(null);
        } else if (e.type === "sim.request") {
          setPending(`Simulation requested for ${e.location.name}`);
        } else if (e.type === "location.reveal") {
          setPending(`Location shared at ${e.location.name} with ${e.viewers.toLocaleString("en-GB")} viewers`);
        }
      }),
    [],
  );

  const style = status ? LEVEL_STYLE[status.level] : null;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Radar className="size-3.5 text-ember" aria-hidden />
          Surroundings
        </h2>
        {style && status && (
          <span className={`flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
            <span className={`size-1.5 rounded-full ${style.dot}`} />
            {style.label} ·{" "}
            {new Date(status.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {status ? (
        <p className="mt-2 text-sm text-text">{status.summary}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">City feed not connected — waiting for surroundings data</p>
      )}

      {pending && <p className="mt-2 text-xs text-ember">{pending}</p>}
    </section>
  );
}
