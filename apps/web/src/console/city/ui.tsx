"use client";
// Small shared building blocks for the City tab: section, big choice buttons, simple line icons.
import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="mb-2.5 text-[13px] font-medium text-white/55">{title}</h3>
      {children}
    </section>
  );
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; icon?: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-[13px] font-medium transition-colors ${
              o.icon ? "h-[64px]" : "h-11"
            } ${on ? "border-[#ff6a1a] bg-[#ff6a1a]/10 text-white" : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07] hover:text-white"}`}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const svg = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CLOUD = "M7 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.3 8.5 4.25 4.25 0 0 1 17 17Z";

export const WeatherIcon = {
  clear: (
    <svg {...svg} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  ),
  overcast: (
    <svg {...svg} aria-hidden>
      <path d={CLOUD} transform="translate(0 2)" />
    </svg>
  ),
  rain: (
    <svg {...svg} aria-hidden>
      <path d={CLOUD} transform="translate(0 -3)" />
      <path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" />
    </svg>
  ),
  storm: (
    <svg {...svg} aria-hidden>
      <path d={CLOUD} transform="translate(0 -3)" />
      <path d="M12.5 15l-2 3.5h3l-2 3.5" />
    </svg>
  ),
};
