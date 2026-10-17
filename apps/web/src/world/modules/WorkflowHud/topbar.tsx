"use client";
// HUD top bar, kept minimal (docs/plans/ui-simplify-brief.md): logo, clock, Live/Offline, Weather ▾,
// "Make something happen ▾", Practice cases. Wraps on narrow screens; WorkflowHud measures its height.
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { emit, type WorldEvent } from "../../bus";
import { useWorld, type IncidentKind, type WeatherOverride } from "../../store";
import { formatClock } from "./flow";
import { AgentToggle, GLASS, IncidentIcon } from "./parts";

type MenuId = "time" | "weather" | "inject";

const POPOVER =
  "pointer-events-auto absolute left-0 top-full z-40 mt-2 max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-[#0b0d12]/95 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)]";
const SEG = "rounded-md px-2 py-1 text-[11px] font-medium transition whitespace-nowrap";
const SEG_ON = "bg-[#ff6a1a]/25 text-[#ffb28a] ring-1 ring-inset ring-[#ff6a1a]/50";
const SEG_OFF = "text-white/65 hover:bg-white/[0.06] hover:text-white";

// ---------------------------------------------------------------- shared bits

function Caret() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="shrink-0 opacity-60">
      <path d="M1.5 3 L4 5.5 L6.5 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function MenuButton({
  open,
  onClick,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition ${
        open
          ? "border-[#ff6a1a]/70 bg-[#ff6a1a]/15 text-white"
          : "border-white/10 bg-white/[0.04] text-white/85 hover:border-[#ff6a1a]/60 hover:bg-[#ff6a1a]/10 hover:text-white"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function PopTitle({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-1.5 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/45">{children}</div>;
}

// ---------------------------------------------------------------- brand, clock, pause, counters

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#ff6a1a]">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 3 V13 M12 3 V13 M4 8 H12" stroke="#111318" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <div className="whitespace-nowrap text-[13px] font-semibold text-white">Hamyway City</div>
    </div>
  );
}

export function Clock({ className = "text-[15px]" }: { className?: string }) {
  const hhmm = useWorld((s) => formatClock(s.timeOfDay));
  return <span className={`w-[3.2em] shrink-0 font-mono font-medium tabular-nums tracking-tight text-white ${className}`}>{hhmm}</span>;
}

// ---------------------------------------------------------------- Time ▾

export const SPEEDS = [1, 3, 10, 30] as const;
export const TIME_PRESETS: { label: string; hour: number }[] = [
  { label: "Dawn", hour: 6 },
  { label: "Noon", hour: 12 },
  { label: "Golden", hour: 18.5 },
  { label: "Night", hour: 22.5 },
];

// ---------------------------------------------------------------- Weather ▾

export const WEATHER_OPTIONS: { id: WeatherOverride; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "clear", label: "Clear" },
  { id: "overcast", label: "Overcast" },
  { id: "drizzle", label: "Drizzle" },
  { id: "rain", label: "Rain" },
  { id: "storm", label: "Storm" },
];

export function WeatherGlyph({ kind, size = 12 }: { kind: WeatherOverride; size?: number }) {
  const cloud = <path d="M3.6 9.2 H9.4 A2.1 2.1 0 0 0 9.1 5 A3 3 0 0 0 3.5 5.6 A1.8 1.8 0 0 0 3.6 9.2 Z" fill="currentColor" />;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {kind === "auto" && (
        <g stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round">
          <path d="M9.6 4.4 A4 4 0 0 0 2.4 4.6" />
          <path d="M2.4 7.6 A4 4 0 0 0 9.6 7.4" />
          <path d="M9.8 2.2 V4.6 H7.4" />
          <path d="M2.2 9.8 V7.4 H4.6" />
        </g>
      )}
      {kind === "clear" && (
        <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <circle cx="6" cy="6" r="2.3" fill="currentColor" stroke="none" />
          <path d="M6 0.8 V2 M6 10 V11.2 M0.8 6 H2 M10 6 H11.2 M2.3 2.3 L3.1 3.1 M8.9 8.9 L9.7 9.7 M2.3 9.7 L3.1 8.9 M8.9 3.1 L9.7 2.3" />
        </g>
      )}
      {kind === "overcast" && cloud}
      {(kind === "drizzle" || kind === "rain" || kind === "storm") && (
        <g transform="translate(0 -1.6)">
          {cloud}
        </g>
      )}
      {kind === "drizzle" && <path d="M4.6 9.4 V10.2 M7.4 9.4 V10.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />}
      {kind === "rain" && <path d="M4 9 L3.4 11 M6.2 9 L5.6 11 M8.4 9 L7.8 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />}
      {kind === "storm" && <path d="M6.6 7.8 L5 10 H6.6 L5.6 11.8 L8 9.2 H6.4 L7.4 7.8 Z" fill="#fbbf24" />}
    </svg>
  );
}

function WeatherMenu({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const cur = useWorld((s) => s.weatherOverride);
  const setOverride = useWorld((s) => s.setWeatherOverride);
  const label = WEATHER_OPTIONS.find((w) => w.id === cur)?.label ?? "Auto";
  return (
    <div className="relative shrink-0">
      <MenuButton
        open={open}
        onClick={onToggle}
        title="Force the weather (Auto runs the cycle)"
        className={cur !== "auto" ? "!border-sky-300/50 !bg-sky-400/10" : ""}
      >
        <WeatherGlyph kind={cur} />
        <span className="w-[4.6em] truncate text-left">{label}</span>
        <Caret />
      </MenuButton>
      {open && (
        <div role="menu" aria-label="Weather" className={`${POPOVER} w-[252px]`}>
          <PopTitle>Weather</PopTitle>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/[0.03] p-1">
            {WEATHER_OPTIONS.map((w) => (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                aria-checked={cur === w.id}
                onClick={() => setOverride(w.id)}
                className={`${SEG} flex flex-col items-center gap-1 py-1.5 ${cur === w.id ? SEG_ON : SEG_OFF}`}
              >
                <WeatherGlyph kind={w.id} size={14} />
                {w.label}
              </button>
            ))}
          </div>
          <p className="px-1 pt-2 text-[10px] leading-snug text-white/45">
            {cur === "auto" ? "Following the weather cycle." : `Held at ${label.toLowerCase()}. Pick Auto to resume the cycle.`}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Inject ▾

export const INJECT: { label: string; event: WorldEvent; kind: IncidentKind }[] = [
  { label: "Car crash", event: { type: "request:crash", kind: "car_crash" }, kind: "car_crash" },
  { label: "Truck crash", event: { type: "request:crash", kind: "truck_crash" }, kind: "truck_crash" },
  { label: "Pileup", event: { type: "request:crash", kind: "pileup" }, kind: "pileup" },
  { label: "Emergency landing", event: { type: "request:plane", kind: "emergency_landing" }, kind: "emergency_landing" },
  { label: "Plane crash", event: { type: "request:plane", kind: "plane_crash" }, kind: "plane_crash" },
  { label: "Roadworks", event: { type: "request:roadworks" }, kind: "roadworks" },
  { label: "Van breakdown", event: { type: "request:breakdown" }, kind: "breakdown" },
];

function InjectMenu({ open, onToggle, onDone }: { open: boolean; onToggle: () => void; onDone: () => void }) {
  return (
    <div className="relative shrink-0">
      <MenuButton open={open} onClick={onToggle} title="Start something in the city">
        Make something happen
        <Caret />
      </MenuButton>
      {open && (
        <div role="menu" aria-label="Make something happen" className={`${POPOVER} w-[200px]`}>
          <PopTitle>Make something happen</PopTitle>
          <ul>
            {INJECT.map((d) => (
              <li key={d.label}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    emit(d.event);
                    onDone();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-white/85 transition hover:bg-[#ff6a1a]/15 hover:text-white"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-black/40">
                    <IncidentIcon kind={d.kind} size={12} />
                  </span>
                  <span className="truncate">{d.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the bar

export const TopBar = memo(function TopBar({ scenarios, badge }: { scenarios?: ReactNode; badge?: ReactNode }) {
  const [menu, setMenu] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggle = (id: MenuId) => () => setMenu((m) => (m === id ? null : id));
  const close = () => setMenu(null);

  // Close the open menu on a click outside the bar or on Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div ref={rootRef} className={`${GLASS} flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2`}>
      <Brand />
      <Clock className="text-[14px]" />
      <AgentToggle />
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        <WeatherMenu open={menu === "weather"} onToggle={toggle("weather")} />
        <InjectMenu open={menu === "inject"} onToggle={toggle("inject")} onDone={close} />
        {scenarios}
        {badge}
      </div>
    </div>
  );
});
