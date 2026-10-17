"use client";
// "Practice cases ▾": closed by default. Pick one of the 50 cases, optionally add twists, and run it in the city.
import { useMemo, useState } from "react";
import type { CityCommand } from "../../world/controlChannel";
import { SCENARIOS, type Modifier } from "../../world/scenarios";
import { TWISTS, filterScenarios } from "./logic";

const TWIST_IDS = Object.keys(TWISTS) as Modifier[];

export function PracticeCases({ send }: { send: (c: CityCommand) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [twists, setTwists] = useState<Modifier[]>([]);
  const [sent, setSent] = useState(false);
  const list = useMemo(() => filterScenarios(SCENARIOS, q), [q]);

  return (
    <div className="border-t border-white/[0.06] px-5 py-3">
      <button
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-1.5 text-[13px] font-medium text-white/55 hover:text-white"
      >
        Practice cases <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="mt-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search practice cases"
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-[#ff6a1a]/60 focus:outline-none"
          />
          <ul role="listbox" aria-label="Practice cases" className="h-[200px] overflow-y-auto rounded-lg border border-white/[0.06]">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  role="option"
                  aria-selected={s.id === picked}
                  onClick={() => setPicked(s.id)}
                  className={`block w-full truncate px-3 py-2 text-left text-[13px] ${
                    s.id === picked ? "bg-[#ff6a1a]/10 text-white" : "text-white/75 hover:bg-white/[0.04]"
                  }`}
                >
                  {s.title}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-3 text-[13px] text-white/40">Nothing found.</li>}
          </ul>
          <p className="mb-1.5 mt-3 text-[12px] text-white/45">Add a twist</p>
          <div className="flex flex-wrap gap-1.5">
            {TWIST_IDS.map((m) => {
              const on = twists.includes(m);
              return (
                <button
                  key={m}
                  aria-pressed={on}
                  onClick={() => setTwists((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                  className={`rounded-full border px-2.5 py-1 text-[12px] ${
                    on ? "border-[#ff6a1a] bg-[#ff6a1a]/10 text-white" : "border-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  {TWISTS[m]}
                </button>
              );
            })}
          </div>
          <button
            disabled={!picked}
            onClick={() => {
              if (!picked) return;
              send({ type: "scenario", scenarioId: picked, modifiers: twists });
              setSent(true);
              window.setTimeout(() => setSent(false), 1500);
            }}
            className="mt-3 h-10 w-full rounded-lg border border-white/15 text-[13px] font-medium text-white hover:bg-white/[0.06] disabled:opacity-40"
          >
            {sent ? "Started ✓" : picked ? "Run this case" : "Pick a case"}
          </button>
        </div>
      )}
    </div>
  );
}
