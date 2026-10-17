"use client";
// "Watch it think": plays a finished run back step by step from its real trace (beats from ./replayBeats.ts).
// Purely visual: the words and the order come from the trace; only the pacing is chosen here.
// Also LiveSteps: the checklist shown while a run is still working.
import { useEffect, useMemo, useRef, useState } from "react";
import { plainNode } from "../../ui/plain";
import type { ConsoleApi, ExecutionRecord } from "../types";
import { buildTimeline } from "./logic";
import { stepText } from "./plainView";
import { buildReplay, type ReplayBeat } from "./replayBeats";
import { Button, C, cx, getJson } from "./ui";

const STYLE = `
@keyframes dwellBeatIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes dwellCaret { 50% { opacity: 0 } }
.dwell-beat { animation: dwellBeatIn 380ms ease-out both }
.dwell-caret { animation: dwellCaret 900ms steps(1) infinite }
@media (prefers-reduced-motion: reduce) { .dwell-beat, .dwell-caret { animation: none } }
`;

const TYPE_TICK_MS = 30;

/** Plays beats with their delays, types out messages, and can pause, skip or start again. */
function usePlayback(beats: ReplayBeat[]) {
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = shown > 0 ? beats[shown - 1] : null;
  const typing = last?.kind === "message" && typed < last.message.length;
  const done = shown >= beats.length && !typing;

  useEffect(() => {
    if (paused || done) return;
    if (typing && last?.kind === "message") {
      // Typing follows the clock, not the tick count, so a throttled tab still finishes on time.
      const len = last.message.length;
      const from = typed;
      const t0 = Date.now();
      const t = setInterval(() => {
        const n = Math.min(len, from + Math.ceil(((Date.now() - t0) / last.typeMs) * len));
        setTyped(n);
        if (n >= len) clearInterval(t);
      }, TYPE_TICK_MS);
      return () => clearInterval(t);
    }
    const next = beats[shown];
    if (!next) return;
    const t = setTimeout(() => {
      setShown((n) => n + 1);
      setTyped(0);
    }, next.delayMs);
    return () => clearTimeout(t);
    // `typed` is left out on purpose: the typing interval runs on its own until the message is out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, shown, paused, done, typing, last]);

  return {
    shown, typed, paused, done,
    next: done || typing ? null : beats[shown] ?? null,
    toggle: () => setPaused((p) => !p),
    skip: () => {
      setShown(beats.length);
      setTyped(Number.MAX_SAFE_INTEGER);
      setPaused(false);
    },
    restart: () => {
      setShown(0);
      setTyped(0);
      setPaused(false);
    },
  };
}

function beatLabel(b: ReplayBeat): string {
  switch (b.kind) {
    case "messages": return "Reading the messages";
    case "end": return "Finishing up";
    case "message": return b.sent ? "Sending the message" : b.label;
    default: return b.label;
  }
}

function Row({ dot, children, last }: { dot: string; children: React.ReactNode; last?: boolean }) {
  return (
    <li className="dwell-beat relative flex gap-3.5">
      <div className="relative flex w-4 shrink-0 justify-center">
        {!last && <span className="absolute bottom-0 top-4 w-px bg-white/10" />}
        <span className="relative mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
      </div>
      <div className="min-w-0 flex-1 pb-5">{children}</div>
    </li>
  );
}

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[12px] font-medium uppercase tracking-wide text-white/40">{children}</div>
);

function Beat({ b, typed, isLast, verdict, why, call }: {
  b: ReplayBeat; typed: number; isLast: boolean; verdict: string; why: string | null;
  /** With Live calls on: the incoming call, shown under the message it belongs to once that message is written. */
  call?: { to: string; node: React.ReactNode };
}) {
  switch (b.kind) {
    case "messages":
      return (
        <Row dot={C.info} last={isLast}>
          <Kicker>Messages in</Kicker>
          {b.title && <p className="mt-1 text-[17px] leading-snug text-white">{b.title}</p>}
          {b.inputs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {b.inputs.map((i, k) => (
                <li key={k} className="rounded-md bg-white/[0.06] px-2 py-1 text-[12px] text-white/70">
                  <span className="text-white/85">{i.from}</span>
                  {i.how && <span className="text-white/40"> · {i.how}</span>}
                  {i.note && <span className="block text-white/55">{i.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </Row>
      );
    case "step":
      return (
        <Row dot={b.failed ? C.err : C.ok} last={isLast}>
          <Kicker>{b.label}</Kicker>
          <p className={cx("mt-0.5 text-[15px]", b.failed ? "text-[#ff5c5c]" : "text-white/90")}>{b.text}</p>
        </Row>
      );
    case "clash":
      return (
        <Row dot={b.match ? C.ok : C.warn} last={isLast}>
          <Kicker>{b.label}</Kicker>
          <p className="mt-0.5 text-[17px] font-semibold" style={{ color: b.match ? C.ok : C.warn }}>
            {b.match ? "Yes" : "No"}
            <span className="ml-2 text-[15px] font-normal text-white/85">{b.text}</span>
          </p>
          {!b.match && b.claims.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {b.claims.map((c, k) => (
                <li key={k} className="rounded-md border border-dashed border-[#f5b83d]/40 px-3 py-1.5 text-[13px] leading-snug">
                  <span className="text-white/85">{c.who}:</span> <span className="text-white/60">&ldquo;{c.says}&rdquo;</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
      );
    case "gate": {
      const tone = { allow: C.ok, ask: C.warn, block: C.err }[b.decision];
      return (
        <Row dot={tone} last={isLast}>
          <Kicker>{b.label}</Kicker>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {(["allow", "ask", "block"] as const).map((d) => {
              const on = d === b.decision;
              const c = { allow: C.ok, ask: C.warn, block: C.err }[d];
              return (
                <span
                  key={d}
                  className={cx("rounded-full px-3 py-1 text-[13px] font-semibold", !on && "opacity-30")}
                  style={on ? { color: "#1f1f23", background: c } : { color: c, boxShadow: `inset 0 0 0 1px ${c}80` }}
                >
                  {{ allow: "OK", ask: "Ask a person", block: "Stop" }[d]}
                </span>
              );
            })}
            {b.risk && <span className="ml-1 text-[13px] text-white/55">risk: {b.risk}</span>}
          </div>
          <p className="mt-1 text-[14px] text-white/70">{b.text}</p>
        </Row>
      );
    }
    case "message": {
      const text = b.message.slice(0, typed);
      const typing = typed < b.message.length;
      return (
        <Row dot={b.sent ? C.ok : C.warn} last={isLast}>
          <Kicker>{b.label}</Kicker>
          <div className="mt-1.5 rounded-lg border border-white/10 bg-[#2a2a30] p-4">
            <div className="text-[13px] text-white/50">
              To <span className="text-white/90">{b.to}</span> · {b.how}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">
              {text}
              {typing && <span className="dwell-caret ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-[#ff6a1a]" />}
            </p>
          </div>
          {call && !typing && call.to === b.to && <div className="mt-3">{call.node}</div>}
        </Row>
      );
    }
    case "decide":
      return (
        <Row dot={C.warn} last={isLast}>
          <div className="rounded-lg border border-[#f5b83d]/50 bg-[#f5b83d]/[0.06] p-4">
            <div className="text-[17px] font-semibold text-white">{b.label}</div>
            {b.routeTo && <div className="mt-0.5 text-[13px] text-white/55">Asked: <span className="text-white/85">{b.routeTo}</span></div>}
            {b.line && <p className="mt-2 text-[15px] leading-snug text-white/85">{b.line}</p>}
          </div>
        </Row>
      );
    case "end":
      return (
        <Row dot={C.accent} last>
          <Kicker>Result</Kicker>
          <p className="mt-1 text-2xl font-semibold leading-tight text-white">{verdict}</p>
          {why && <p className="mt-1.5 text-[15px] leading-snug text-white/65"><span className="text-white/40">Why: </span>{why}</p>}
        </Row>
      );
  }
}

/** The replay panel. `verdict` and `why` are the run's headline and why line, shown on the last beat. */
export default function Replay({ execution, verdict, why, onClose, call }: {
  execution: ExecutionRecord;
  verdict: string;
  why: string | null;
  onClose: () => void;
  /** With Live calls on: the call to ring under the message to `to` (VoiceSlot.Ring). */
  call?: { to: string; node: React.ReactNode };
}) {
  const beats = useMemo(() => buildReplay(execution.trace), [execution.trace]);
  const p = usePlayback(beats);
  const visible = beats.slice(0, p.shown);
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest beat on screen while it plays.
  useEffect(() => {
    if (p.shown > 0) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.shown, p.typed]);

  return (
    <section className="rounded-xl border border-[#ff6a1a]/30 bg-[#232327] p-5" aria-live="polite">
      <style>{STYLE}</style>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Watch it think</h3>
        <span className="text-xs tabular-nums text-white/40">
          {Math.min(p.shown, beats.length)} / {beats.length}
        </span>
        <span className="ml-auto flex gap-2">
          {!p.done && (
            <>
              <Button onClick={p.toggle}>{p.paused ? "Play" : "Pause"}</Button>
              <Button onClick={p.skip}>Skip</Button>
            </>
          )}
          {p.done && <Button onClick={p.restart}>Play again</Button>}
          <Button onClick={onClose}>Close</Button>
        </span>
      </div>
      {beats.length === 0 ? (
        <p className="text-sm text-white/45">No steps were recorded for this case run, so there is nothing to play.</p>
      ) : (
        <ol>
          {visible.map((b, i) => (
            <Beat
              key={i}
              b={b}
              typed={i === visible.length - 1 ? p.typed : Number.MAX_SAFE_INTEGER}
              isLast={i === visible.length - 1 && p.done}
              verdict={verdict}
              why={why}
              call={call}
            />
          ))}
          {p.next && (
            <li className="flex gap-3.5 text-[14px] text-white/45">
              <span className="flex w-4 shrink-0 justify-center">
                <span className={cx("mt-1.5 h-2.5 w-2.5 rounded-full bg-[#ff6a1a]", !p.paused && "animate-pulse")} />
              </span>
              <span>{p.paused ? "Paused" : `${beatLabel(p.next)}…`}</span>
            </li>
          )}
        </ol>
      )}
      <div ref={endRef} />
    </section>
  );
}

// ---- Live checklist while a run is working -------------------------------------------------

type WorkflowsResp = ConsoleApi["GET /api/console/workflows"];

function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}

/**
 * While a run is working: the steps the agent has reported so far (ticked), then the rest of the
 * playbook's steps (not yet run). Both come from real data: the run's trace and its playbook.
 */
export function LiveSteps({ execution }: { execution: ExecutionRecord }) {
  const elapsed = useElapsed(execution.startedAt);
  const [playbook, setPlaybook] = useState<{ id: string; type: string }[] | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<WorkflowsResp>("/api/console/workflows").then(
      (r) => {
        const wf = r.workflows.find((w) => w.id === execution.workflowId);
        if (alive && wf) setPlaybook(wf.flow.nodes.filter((n) => n.type !== "case_log").map((n) => ({ id: n.id, type: n.type })));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [execution.workflowId]);

  const reported = buildTimeline(execution.trace).flatMap((i) => (i.kind === "node" ? [i] : []));
  const doneIds = new Set(reported.map((n) => n.nodeId));
  const rows: { key: string; text: string; state: "ok" | "error" | "running" | "todo" }[] = [];
  for (const n of reported) {
    if (n.status === "skipped") continue;
    const text = stepText(n);
    if (text) rows.push({ key: n.nodeId, text, state: n.status });
  }
  for (const n of playbook ?? []) if (!doneIds.has(n.id)) rows.push({ key: n.id, text: plainNode(n.type), state: "todo" });

  return (
    <section className="rounded-xl border border-[#ff6a1a]/30 bg-[#232327] p-5" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff6a1a]" />
        <h3 className="text-sm font-semibold text-white">Working on it</h3>
        <span className="ml-auto text-sm tabular-nums text-white/50">{elapsed}</span>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-[14px]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2.5">
              <span
                className={cx(
                  "w-4 shrink-0 text-center",
                  r.state === "ok" ? "text-[#3ecf8e]" : r.state === "error" ? "text-[#ff5c5c]" : r.state === "running" ? "text-[#ff6a1a]" : "text-white/25",
                )}
              >
                {r.state === "ok" ? "✓" : r.state === "error" ? "✗" : r.state === "running" ? "…" : "○"}
              </span>
              <span className={r.state === "todo" ? "text-white/40" : "text-white/85"}>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-white/45">Steps show here as the agent reports them.</p>
      )}
      <p className="mt-3 text-[12px] text-white/35">
        {reported.length === 0 && playbook?.length
          ? "The steps of this playbook. They tick off when the agent reports back, then the run plays back step by step."
          : "Checking every 1.5 seconds."}
      </p>
    </section>
  );
}
