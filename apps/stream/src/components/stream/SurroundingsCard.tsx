"use client";

import { useEffect, useState } from "react";
import { subscribe } from "@/platform/bus";

type Level = "calm" | "busy" | "danger";

const LEVEL: Record<Level, { dot: string; label: string }> = {
  calm: { dot: "bg-ok", label: "Calm" },
  busy: { dot: "bg-warn", label: "Busy" },
  danger: { dot: "bg-live", label: "Danger" },
};

export function SurroundingsCard() {
  const [status, setStatus] = useState<{ summary: string; level: Level } | null>(null);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "surroundings.update") setStatus({ summary: e.summary, level: e.level });
      }),
    [],
  );

  if (!status) return null;
  const level = LEVEL[status.level];

  return (
    <section className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span className={`mt-2 size-2 shrink-0 rounded-full ${level.dot}`} aria-hidden />
      <div>
        <p className="text-[13px] font-semibold text-text">Around you · {level.label}</p>
        <p className="mt-0.5 text-[14px] leading-6 text-muted">{status.summary}</p>
      </div>
    </section>
  );
}
