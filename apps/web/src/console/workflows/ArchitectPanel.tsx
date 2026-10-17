"use client";
// "Make a playbook": describe the business in plain words and the agent lays out the steps.
// The result is handed to the editor, which places it on the canvas as a draft.
import { useEffect, useRef, useState } from "react";
import type { Flow } from "../types";
import { Icon } from "./icons";
import { Btn } from "./bits";
import { architectBuild } from "./api";
import {
  EXAMPLE_PROMPTS, buildRequest, explainFlow, safetyLine, safetySummary, usageTotals, type ArchitectUsage, type SafetySummary, type Step,
} from "./architect";
import { cents } from "../../ui/plain";

type Msg =
  | { id: number; role: "user"; text: string; refine: boolean }
  | { id: number; role: "result"; flow: Flow | null; steps: Step[]; safety: SafetySummary | null; problems: string[]; costUsd: number | null }
  | { id: number; role: "error"; text: string };

/** Wall clock, read only from event handlers and timers. */
const now = () => Date.now();

export interface DraftState {
  description: string;
  revealing: boolean;
  /** Steps placed on the canvas so far, while it builds. */
  placed?: { count: number; total: number } | null;
}

/** Plain error text: no endpoints, keys or stack traces. */
function plainError(raw: string): string {
  if (/agent api|ANTHROPIC|npm run dev|503|offline|fetch failed|network/i.test(raw)) return "The playbook maker is offline right now. Try again in a minute.";
  if (/did not answer|timeout|504/i.test(raw)) return "That took too long. Try a shorter description.";
  return "Something went wrong. Try again.";
}

export function ArchitectPanel({ draft, onDraft, onAccept, onDiscard, accepting, onClose }: {
  draft: DraftState | null;
  onDraft: (d: { flow: Flow; description: string; problems: string[]; usage?: ArchitectUsage[] }) => void;
  onAccept: () => void;
  onDiscard: () => void;
  accepting: boolean;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number | null>(null); // start time while waiting
  const [elapsed, setElapsed] = useState(0);
  const [openSteps, setOpenSteps] = useState<number | null>(null);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const base = draft?.description ?? null; // the description a change builds on

  useEffect(() => {
    if (busy === null) return;
    const t = setInterval(() => setElapsed(Math.round((now() - busy) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (raw: string) => {
    const input = raw.trim();
    if (!input || busy !== null) return;
    const refine = !!base;
    const req = refine ? buildRequest(base, input) : buildRequest(input);
    setMsgs((m) => [...m, { id: nextId.current++, role: "user", text: input, refine }]);
    setText("");
    setElapsed(0);
    setBusy(now());
    const r = await architectBuild(req);
    setBusy(null);
    if (!r.ok) {
      setMsgs((m) => [...m, { id: nextId.current++, role: "error", text: plainError(r.error) }]);
      return;
    }
    const d = r.data ?? {};
    const problems = d.problems ?? [];
    const costUsd = usageTotals(d.usage)?.costUsd ?? null;
    if (d.flow) {
      const id = nextId.current++;
      setMsgs((m) => [...m, { id, role: "result", flow: d.flow!, steps: explainFlow(d.flow!), safety: safetySummary(d.flow!), problems, costUsd }]);
      setOpenSteps(id);
      onDraft({ flow: d.flow, description: req.description, problems, usage: d.usage });
    } else {
      setMsgs((m) => [...m, { id: nextId.current++, role: "result", flow: null, steps: [], safety: null, problems, costUsd }]);
    }
  };

  const hasDraft = !!draft && msgs.some((m) => m.role === "result" && m.flow);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-[#19191d]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1 text-[15px] font-semibold text-white">Make a playbook</div>
        <button type="button" onClick={onClose} title="Close" className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white"><Icon name="close" size={15} /></button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-white/60">Say what you deliver and who drives. We&apos;ll lay out the steps.</p>
            <div className="text-[12px] text-white/40">For example</div>
            <div className="space-y-1.5">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p} type="button" onClick={() => void send(p)} disabled={busy !== null}
                  className="block w-full rounded-md border border-white/10 px-3 py-2 text-left text-[13px] text-white/80 hover:border-white/25 hover:bg-white/[0.03] disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="ml-8 rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] leading-snug text-white/90">
                {m.refine && <div className="mb-0.5 text-[11px] text-white/45">Change</div>}
                {m.text}
              </div>
            );
          }
          if (m.role === "error") {
            return <div key={m.id} className="rounded-lg bg-[#ef4444]/10 px-3 py-2 text-[13px] text-[#fca5a5]">{m.text}</div>;
          }
          return (
            <div key={m.id} className="space-y-2 rounded-lg border border-white/10 px-3 py-3">
              {m.flow ? (
                <>
                  {m.safety && (
                    <div
                      role="status"
                      className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-[15px] font-semibold leading-snug ${m.safety.everyPath ? "bg-[#22c55e]/[0.1] text-[#4ade80]" : "bg-[#f59e0b]/[0.1] text-[#fcd34d]"}`}
                    >
                      <span className="mt-[3px] shrink-0"><Icon name={m.safety.everyPath ? "check" : "shield"} size={14} strokeWidth={m.safety.everyPath ? 3 : 2} /></span>
                      {safetyLine(m.safety)}
                    </div>
                  )}
                  <button type="button" className="text-[12px] text-white/50 underline-offset-2 hover:underline" onClick={() => setOpenSteps(openSteps === m.id ? null : m.id)}>
                    {openSteps === m.id ? "Hide the steps" : "Show the steps"}
                  </button>
                  {openSteps === m.id && (
                    <ol className="space-y-1">
                      {m.steps.map((s, i) => (
                        <li key={s.id} className="flex gap-2 text-[12.5px] leading-snug text-white/80">
                          <span className="w-5 shrink-0 text-right tabular-nums text-white/30">{i + 1}.</span>
                          <span className="min-w-0">
                            {s.label}
                            {s.branches.length > 0 && <span className="block text-[11.5px] text-white/45">{s.branches.join(" · ")}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <div className="text-[13px] text-white/80">That didn&apos;t work. Try describing it differently.</div>
              )}
              {m.problems.length > 0 && (
                <details className="text-[12px] text-[#fca5a5]">
                  <summary className="cursor-pointer">{m.problems.length} thing{m.problems.length === 1 ? "" : "s"} to fix</summary>
                  <ul className="mt-1 space-y-0.5 text-white/55">{m.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </details>
              )}
              {m.flow && m.problems.length === 0 && <div className="flex items-center gap-1.5 text-[12px] text-[#4ade80]"><Icon name="check" size={12} strokeWidth={3} /> No problems found</div>}
              {m.costUsd !== null && m.costUsd > 0 && <div className="text-[10.5px] text-white/30">{cents(m.costUsd)}</div>}
            </div>
          );
        })}

        {busy !== null && (
          <div className="flex items-center gap-2.5 rounded-lg border border-white/10 px-3 py-2.5 text-[13px] text-white/70">
            <span className="wf-spin block h-3.5 w-3.5 rounded-full border-2 border-[#ff6a1a] border-t-transparent" />
            Working on it… <span className="tabular-nums text-white/35">{elapsed}s</span>
          </div>
        )}
      </div>

      {hasDraft && (
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/50">{draft!.revealing ? (draft!.placed ? `Placing step ${Math.min(draft!.placed.count + 1, draft!.placed.total)} of ${draft!.placed.total}…` : "Placing the steps…") : "Not saved yet"}</span>
          <Btn onClick={onDiscard} disabled={accepting}>Throw away</Btn>
          <Btn variant="primary" onClick={onAccept} disabled={accepting || draft!.revealing}>
            {accepting ? "Saving…" : "Use this playbook"}
          </Btn>
        </div>
      )}

      <form className="border-t border-white/10 p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea
          value={text} rows={3} disabled={busy !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); }
          }}
          placeholder={base ? "What should change?" : "Describe your delivery business"}
          className="block w-full resize-none rounded-lg border border-white/12 bg-black/20 px-3 py-2.5 text-[13px] leading-snug text-white outline-none placeholder:text-white/35 focus:border-white/30"
        />
        <div className="mt-2 flex justify-end">
          <Btn variant="primary" disabled={!text.trim() || busy !== null} onClick={() => void send(text)}>
            {base ? "Change it" : "Make it"}
          </Btn>
        </div>
      </form>
    </aside>
  );
}
