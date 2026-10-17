"use client";
// HUD building blocks: agent status and labels, agent queue, case feed, incidents, deliveries, hotkeys footer.
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorld, type Delivery, type Incident, type IncidentKind, type WorkflowEvent } from "../../store";
import { getScenario } from "../../scenarios";
import { caseLine, caseTitle, formatAge, spendSplit, summariseCases } from "./flow";
import { cents } from "../../../ui/plain";
import { provenanceLabel } from "../../backendLink";
import { budgetLeft, nextSlotAt } from "../WorkflowDriver/budget";
import { chosenAction, formatExpected, hasRealTrace, matchExpected, scenarioIdOf } from "./scenarioMatch";
import { INCIDENT_COLOR, INCIDENT_LABEL, INCIDENT_STATUS_STYLE, ORANGE } from "./theme";

export const GLASS =
  "pointer-events-auto rounded-xl border border-white/10 bg-[#111318]/90";

/** Ticking clock in ms (performance.now), for ages and countdowns. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Ticking wall clock in ms (Date.now), for budget windows. */
export function useEpochNow(intervalMs: number) {
  // The clock is first read after mount, not while rendering: Next prerenders this component, and a
  // time read during render would be frozen into the page. Until that first read the value is 0,
  // and callers show nothing time-based.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Workflow events, re-rendered at most every `ms` to avoid storms when the driver is busy. */
export function useThrottledWorkflow(ms: number) {
  const [events, setEvents] = useState(() => useWorld.getState().workflow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    const flush = () => {
      timer = null;
      if (!pending) return;
      pending = false;
      setEvents(useWorld.getState().workflow);
      timer = setTimeout(flush, ms);
    };
    const unsub = useWorld.subscribe((s, prev) => {
      if (s.workflow === prev.workflow) return;
      pending = true;
      if (!timer) flush();
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [ms]);
  return events;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold text-white/60">{children}</h3>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------- agent labels

/** Provenance in plain words: "Live" (the real agent) or "Practice case" (made from city events). */
export function RealAgentTag({ label = "Live" }: { label?: string }) {
  const practice = /practice/i.test(label);
  return (
    <span
      title={practice ? "Answered by the live agent. The case was made from what happened in the city." : "Answered by the live agent."}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-medium ${
        practice ? "bg-sky-400/15 text-sky-200" : "bg-emerald-400/15 text-emerald-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${practice ? "bg-sky-300" : "bg-emerald-300"}`} />
      {label}
    </span>
  );
}

/** Spend so far and cases left in this 10 minutes. Click to change the limit. */
function BudgetChip({ editable }: { editable: boolean }) {
  const b = useWorld((s) => s.agentBudget);
  const setMax = useWorld((s) => s.setAgentBudgetMax);
  const [open, setOpen] = useState(false);
  const now = useEpochNow(5000);
  const left = now ? budgetLeft(b, now) : b.maxPerWindow;
  const next = now ? nextSlotAt(b, now) : null;
  const title = `${cents(b.spentUsd) || "0¢"} spent. ${left} of ${b.maxPerWindow} cases left for this 10 minutes${
    next ? `, more in ${Math.ceil((next - now) / 60_000)} min` : ""
  }.${editable ? " Click to change." : ""}`;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={title}
        onClick={() => editable && setOpen((o) => !o)}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 text-[10px] tabular-nums text-white/45 hover:text-white/80"
      >
        {cents(b.spentUsd) || "0¢"}
        {left === 0 && <span className="text-amber-200/80">· limit reached</span>}
      </button>
      {open && editable && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-52 rounded-lg border border-white/10 bg-[#111318] p-3 text-[11px] text-white/80">
          <div className="font-medium text-white">Cases per 10 minutes</div>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="h-7 w-7 rounded border border-white/15 hover:bg-white/10" onClick={() => setMax(b.maxPerWindow - 1)}>−</button>
            <span className="w-8 text-center text-[14px] tabular-nums text-white">{b.maxPerWindow}</span>
            <button type="button" className="h-7 w-7 rounded border border-white/15 hover:bg-white/10" onClick={() => setMax(b.maxPerWindow + 1)}>+</button>
          </div>
          <div className="mt-2 text-[10px] text-white/50">More cases wait their turn.</div>
        </div>
      )}
    </span>
  );
}

/** The agent is not answering: cases wait, nothing is made up. */
export function OfflineTag() {
  return (
    <span
      title="The agent is not answering. Cases wait until it is back."
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-rose-500/15 px-1.5 py-[1px] text-[10px] font-medium text-rose-200"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-rose-300" />
      Offline
    </span>
  );
}

/** Live / Offline, the spend, and how many cases are waiting. No toggle: there is only the live agent. */
export function AgentToggle({ short = false }: { short?: boolean }) {
  const online = useWorld((s) => s.agentOnline);
  const queued = useWorld((s) => s.agentQueue.length);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {online === true ? <RealAgentTag /> : online === false ? <OfflineTag /> : <span className="text-[10px] text-white/45">Connecting…</span>}
      {online === false && !short && <span className="whitespace-nowrap text-[10px] text-rose-200/70">paused</span>}
      {online === true && <BudgetChip editable={!short} />}
      {queued > 0 && (
        <span title={`${queued} waiting their turn`} className="whitespace-nowrap rounded bg-amber-400/10 px-1.5 py-[1px] text-[10px] tabular-nums text-amber-200">
          {queued} waiting
        </span>
      )}
    </span>
  );
}

/** Cases waiting their turn, oldest first. */
export const AgentQueueList = memo(function AgentQueueList() {
  const queue = useWorld((s) => s.agentQueue);
  const online = useWorld((s) => s.agentOnline);
  const b = useWorld((s) => s.agentBudget);
  const now = useEpochNow(5000);
  if (!queue.length || !now) return null;
  const next = nextSlotAt(b, now);
  const why = online !== true ? "Paused: offline" : next ? `More in ${Math.max(1, Math.ceil((next - now) / 60_000))} min` : "Next up";
  return (
    <section>
      <SectionTitle right={<span className="text-[10px] text-white/45">{why}</span>}>Waiting</SectionTitle>
      <ul className="space-y-1">
        {queue.slice(0, 4).map((q, i) => (
          <li key={q.id} className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1 text-[11px]">
            <span className="text-white/40 tabular-nums">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate text-white/80">{caseTitle(q.label)}</span>
            <span className="shrink-0 text-[10px] text-white/35">{formatAge(now - q.enqueuedAt)}</span>
          </li>
        ))}
        {queue.length > 4 && <li className="text-center text-[10px] text-white/40">+{queue.length - 4} more</li>}
      </ul>
    </section>
  );
});

// ---------------------------------------------------------------- icons

export function IncidentIcon({ kind, size = 16 }: { kind: IncidentKind; size?: number }) {
  const c = INCIDENT_COLOR[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {(kind === "car_crash" || kind === "pileup") && (
        <path d="M8 1 L9.6 5.2 L14 4.4 L11 8 L14.4 11.4 L9.8 11 L8 15 L6.2 11 L1.6 11.4 L5 8 L2 4.4 L6.4 5.2 Z" fill={c} />
      )}
      {kind === "pileup" && <circle cx="12.6" cy="3.4" r="2.2" fill={c} stroke="#0b0d12" strokeWidth="0.8" />}
      {(kind === "emergency_landing" || kind === "plane_crash") && (
        <path
          d="M8 1 C8.8 1 9 2 9 3 V6.2 L15 9.6 V11 L9 9 V12.4 L10.8 13.8 V15 L8 14.2 L5.2 15 V13.8 L7 12.4 V9 L1 11 V9.6 L7 6.2 V3 C7 2 7.2 1 8 1 Z"
          fill={c}
          transform={kind === "plane_crash" ? "rotate(35 8 8)" : undefined}
        />
      )}
      {kind === "truck_crash" && (
        <g fill={c}>
          <rect x="1" y="4" width="9" height="7" rx="1" />
          <path d="M10.5 6 H13 L15 8.5 V11 H10.5 Z" />
          <circle cx="4" cy="12.5" r="1.6" />
          <circle cx="12" cy="12.5" r="1.6" />
        </g>
      )}
      {kind === "roadworks" && (
        <g>
          <path d="M8 1.5 L13 14 H3 Z" fill={c} />
          <rect x="4.6" y="9" width="6.8" height="1.6" fill="#0b0d12" />
          <rect x="6" y="5.4" width="4" height="1.4" fill="#0b0d12" />
        </g>
      )}
      {kind === "breakdown" && (
        <path
          d="M10.8 1.6 A3.6 3.6 0 0 0 7.2 6.4 L1.8 11.8 A1.4 1.4 0 0 0 4.2 14.2 L9.6 8.8 A3.6 3.6 0 0 0 14.4 5.2 L12.2 7.4 L10 6 L8.6 3.8 Z"
          fill={c}
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- case feed

const STATUS_TONE: Record<string, string> = {
  Working: "bg-[#ff6a1a]/15 text-[#ffb08a]",
  "Needs a person": "bg-amber-400/15 text-amber-200",
  Stopped: "bg-rose-500/15 text-rose-200",
  Problem: "bg-red-500/15 text-red-200",
  Done: "bg-emerald-400/15 text-emerald-200",
};

/** One plain sentence per case with a status word. The raw case id and cost sit in a small grey caption. */
export const CaseFeed = memo(function CaseFeed({ events }: { events: readonly WorkflowEvent[] }) {
  const cases = useMemo(() => summariseCases(events, 8), [events]);
  const spend = useMemo(() => spendSplit(events).real, [events]);
  return (
    <section>
      <SectionTitle right={spend > 0 ? <span className="text-[10px] tabular-nums text-white/40">{cents(spend)} spent</span> : undefined}>Cases</SectionTitle>
      {cases.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {cases.map((c) => {
            const line = caseLine(events, c);
            return (
              <li key={c.caseId} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${STATUS_TONE[line.status] ?? "bg-white/10 text-white/70"}`}>{line.status}</span>
                  <span className="min-w-0 truncate text-[12px] font-medium text-white" title={line.title}>{line.title}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-white/65" title={line.sentence}>{line.sentence}</p>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/35">
                  {c.prov && <RealAgentTag label={provenanceLabel(c.prov)} />}
                  <span className="min-w-0 truncate">{c.caseId.split(" · ")[0]}</span>
                  {c.prov && c.cost > 0 && <span className="ml-auto tabular-nums">{cents(c.cost)}</span>}
                </div>
                <ExpectedLine caseId={c.caseId} events={events} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});

/**
 * For practice-set cases answered by the live agent: does its reply go where the answer key says?
 * Only for live answers, never for anything else (PRD J4).
 */
function ExpectedLine({ caseId, events }: { caseId: string; events: readonly WorkflowEvent[] }) {
  if (!hasRealTrace(events, caseId)) return null;
  const sid = scenarioIdOf(caseId);
  const expected = sid ? getScenario(sid)?.expected : null;
  if (!expected) return null;
  const chosen = chosenAction(events, caseId);
  const ok = chosen && chosen.nodeId === "action" ? matchExpected(chosen.summary, expected) : null;
  if (ok === null) return null;
  return (
    <div className={`mt-0.5 text-[10px] ${ok ? "text-emerald-300/80" : "text-rose-300/80"}`} title={`Answer key: ${formatExpected(expected)}`}>
      {ok ? "Matches the answer key" : "Differs from the answer key"}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-[11px] text-white/40">{children}</div>;
}

// ---------------------------------------------------------------- incidents

const INCIDENT_STATUS_WORD = { active: "Happening", responding: "Help on the way", clearing: "Clearing up" } as const;

export const IncidentList = memo(function IncidentList() {
  const incidents = useWorld((s) => s.incidents);
  const setFocus = useWorld((s) => s.setFocus);
  const now = useNow(1000);
  const live = useMemo(
    () => incidents.filter((i): i is Incident & { status: Exclude<Incident["status"], "cleared"> } => i.status !== "cleared").reverse(),
    [incidents],
  );
  return (
    <section>
      <SectionTitle right={<span className="font-mono text-[10px] text-white/45">{live.length} live</span>}>Incidents</SectionTitle>
      {live.length === 0 ? (
        <Empty>All clear. Roads are open.</Empty>
      ) : (
        <ul className="space-y-1">
          {live.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => setFocus({ x: i.x, z: i.z })}
                title="Fly camera here"
                className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-left transition hover:border-[#ff6a1a]/50 hover:bg-[#ff6a1a]/10"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-black/40">
                  <IncidentIcon kind={i.kind} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-white">{INCIDENT_LABEL[i.kind]}</span>
                    <span className={`rounded px-1.5 py-px text-[10px] ${INCIDENT_STATUS_STYLE[i.status]}`}>
                      {INCIDENT_STATUS_WORD[i.status]}
                    </span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-white/45">{formatAge(now - i.createdAt)}</span>
                  </span>
                  <span className="block truncate text-[10.5px] text-white/55">{i.note}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

// ---------------------------------------------------------------- deliveries

function countDeliveries(ds: Record<string, Delivery>) {
  let enRoute = 0;
  let delayed = 0;
  let delivered = 0;
  let other = 0;
  for (const k in ds) {
    const st = ds[k].status;
    if (st === "en_route") enRoute++;
    else if (st === "delayed") delayed++;
    else if (st === "delivered") delivered++;
    else other++;
  }
  return { enRoute, delayed, delivered, other };
}

export const Deliveries = memo(function Deliveries() {
  const c = useWorld(useShallow((s) => countDeliveries(s.deliveries)));
  const total = c.enRoute + c.delayed + c.delivered + c.other;
  const rows = [
    { label: "En route", n: c.enRoute, color: ORANGE },
    { label: "Delayed", n: c.delayed, color: "#fbbf24" },
    { label: "Delivered", n: c.delivered, color: "#34d399" },
  ];
  return (
    <section>
      <SectionTitle right={<span className="font-mono text-[10px] tabular-nums text-white/45">{total} total</span>}>Deliveries</SectionTitle>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        {total > 0 &&
          rows.map((r) => (
            <div key={r.label} className="h-full transition-[width] duration-500" style={{ width: `${(r.n / total) * 100}%`, background: r.color }} />
          ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md bg-white/[0.03] px-2 py-1.5">
            <div className="font-mono text-[15px] font-semibold tabular-nums leading-none" style={{ color: r.n ? r.color : "rgba(255,255,255,0.35)" }}>
              {r.n}
            </div>
            <div className="mt-1 text-[10px] text-white/45">{r.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
});

// ---------------------------------------------------------------- footer

const KEYS: [string, string][] = [
  ["WASD", "pan"],
  ["Q/E", "rotate"],
  ["R/F", "zoom"],
  ["1–5", "zones"],
  ["V", "follow van"],
  ["C", "cinematic tour"],
  ["Esc", "release"],
];

export function HotkeysFooter() {
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-white/10 bg-[#0b0d12]/55 px-3.5 py-1.5 text-[10.5px] text-white/55 backdrop-blur-md">
      {KEYS.map(([k, v], i) => (
        <span key={k} className="flex items-center gap-1.5 whitespace-nowrap">
          {i > 0 && <span className="text-white/20">·</span>}
          <kbd className="rounded border border-white/15 bg-white/[0.06] px-1 py-px font-mono text-[10px] text-white/85">{k}</kbd>
          {v}
        </span>
      ))}
    </div>
  );
}
