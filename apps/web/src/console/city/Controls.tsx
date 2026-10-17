"use client";
// Left column of the City tab: weather, time, speed and "Make something happen".
import { useEffect, useRef, useState } from "react";
import type { CityCommand, CityTelemetry } from "../../world/controlChannel";
import { HAPPENINGS, SPEEDS, TIMES, WEATHERS, speedBucket, timeBucket, weatherBucket } from "./logic";
import { Choice, Section, WeatherIcon } from "./ui";

type Send = (c: CityCommand) => void;

export function WeatherControl({ send, t }: { send: Send; t: CityTelemetry | null }) {
  return (
    <Section title="Weather">
      <Choice
        label="Weather"
        options={WEATHERS.map((w) => ({ ...w, icon: WeatherIcon[w.id] }))}
        value={weatherBucket(t?.weather)}
        onChange={(w) => send({ type: "weather", weather: w })}
      />
    </Section>
  );
}

export function TimeControl({ send, t }: { send: Send; t: CityTelemetry | null }) {
  return (
    <Section title="Time">
      <Choice
        label="Time"
        options={TIMES}
        value={timeBucket(t?.timeOfDay)}
        onChange={(id) => send({ type: "time", hour: TIMES.find((x) => x.id === id)!.hour })}
      />
    </Section>
  );
}

export function SpeedControl({ send, t }: { send: Send; t: CityTelemetry | null }) {
  return (
    <Section title="Speed">
      <Choice
        label="Speed"
        options={SPEEDS}
        value={speedBucket(t?.timeScale)}
        onChange={(id) => send({ type: "timeScale", scale: SPEEDS.find((x) => x.id === id)!.scale })}
      />
    </Section>
  );
}

export function MakeSomethingHappen({ send }: { send: Send }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative px-5 py-4">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center justify-between rounded-lg bg-[#ff6a1a] px-4 text-[14px] font-semibold text-white hover:bg-[#ff7a30]"
      >
        <span>{sent ? `${sent} ✓` : "Make something happen"}</span>
        <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <ul role="menu" className="absolute inset-x-5 top-[calc(100%-8px)] z-10 overflow-hidden rounded-lg border border-white/10 bg-[#2a2a30] py-1 shadow-lg">
          {HAPPENINGS.map((h) => (
            <li key={h.event}>
              <button
                role="menuitem"
                onClick={() => {
                  send({ type: "inject", event: h.event });
                  setOpen(false);
                  setSent(h.label);
                  window.setTimeout(() => setSent((s) => (s === h.label ? null : s)), 1500);
                }}
                className="w-full px-4 py-2.5 text-left text-[14px] text-white/85 hover:bg-white/[0.06] hover:text-white"
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
