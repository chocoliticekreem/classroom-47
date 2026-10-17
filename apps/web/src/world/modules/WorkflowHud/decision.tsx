"use client";
// The HUD's decision toast for REAL decision cards only (mock cards go to the review drawer's Simulation tab).
// Fed by (a) replayed real traces whose human node carries a card and (b) the human review queue gaining a
// new agent card. Shows the agent's own fields (whyStopped, evidence, alreadyDone, options with effect).
// A choice is recorded through the review queue API (backendLink.recordDecision). If that fails, the choice
// stays local and is labelled NOT SENT. Once saved, a card from a console case run is re-run by the agent
// with the choice (rerun.ts) and the new trace replays in the feed as "Re-run with your choice".
import { useEffect, useRef, useState } from "react";
import { useWorld, type WorkflowEvent } from "../../store";
import type { ReviewTask } from "../../../review/types";
import { browserFetchJson, provenanceLabel, recordDecision, rememberReplay, replayByRun, replayFor, type DecisionOutcome } from "../../backendLink";
import { findExecutionId, rerunFeed, rerunWithChoice, type CityRerun } from "./rerun";
import { isReal, newAsks } from "./flow";
import { plainOwner, scrubLeaks } from "../../../ui/plain";
import { GLASS, RealAgentTag } from "./parts";

type HudCard = NonNullable<WorkflowEvent["card"]>;

export interface ToastItem {
  key: string; // runId|traceCaseId
  caseLabel: string; // what the feed shows, e.g. "INC-003 · car crash"
  runId: string;
  traceCaseId: string;
  card: HudCard;
  prov: string;
  /** performance.now() when it arrived, for the deadline. */
  at: number;
  /** The console case run behind the card, when the review queue links one. */
  executionId?: string | null;
}

/** A real replayed card event -> toast item (null for mock events or events without a card). */
export function toastFromEvent(e: WorkflowEvent, traceCaseId: string | undefined, at: number): ToastItem | null {
  if (!e.card || !isReal(e) || !e.runId) return null;
  const caseId = traceCaseId ?? e.caseId;
  return { key: `${e.runId}|${caseId}`, caseLabel: e.caseId, runId: e.runId, traceCaseId: caseId, card: e.card, prov: provenanceLabel(e), at };
}

/** A pending agent card from the review queue -> toast item (null for the city's simulated tasks). */
export function toastFromTask(t: ReviewTask, at: number): ToastItem | null {
  if (t.origin === "city" || t.status !== "pending") return null;
  // prov uses the shared plain labels: "Practice case" for city-made cases, "Live" otherwise.
  const fallback = t.options.find((o) => o.label === t.fallback) ?? t.options.find((o) => o.undoable) ?? t.options[0];
  return {
    key: `${t.runId}|${t.caseId}`,
    caseLabel: t.caseId,
    runId: t.runId,
    traceCaseId: t.caseId,
    prov: t.simulated ? "Practice case" : "Live",
    at,
    executionId: t.executionId ?? null,
    card: {
      cardId: t.cardId,
      summary: t.summary,
      routeTo: t.routeTo,
      options: t.options.map((o) => ({ id: o.id, label: o.label, safe: o.undoable, ...(o.effect ? { effect: o.effect } : {}) })),
      deadlineMs: Math.max(60_000, Date.parse(t.deadlineAt) - Date.parse(t.receivedAt)),
      fallbackOptionId: fallback?.id ?? "",
      whyStopped: { reason: "review_queue", line: t.mustDecide },
      ...(t.evidence.length ? { evidence: t.evidence } : {}),
      ...(t.tried.length ? { alreadyDone: t.tried } : {}),
      ...(t.clash ? { clash: t.clash } : {}),
      ...(t.wouldChangeMyMind ? { wouldChangeMyMind: t.wouldChangeMyMind } : {}),
      fallback: t.fallback,
    },
  };
}

function reviewer(): string {
  try {
    return localStorage.getItem("rivet-reviewer")?.trim() || "City HUD reviewer";
  } catch {
    return "City HUD reviewer";
  }
}

/** Log the person's choice on the case's feed line (source live_human; no cost). */
function pushChoice(item: ToastItem, label: string, result: DecisionOutcome) {
  useWorld.getState().pushWorkflow({
    id: `hd-${Math.random().toString(36).slice(2, 10)}`,
    t: performance.now(),
    caseId: item.caseLabel,
    nodeId: "human",
    status: "ok",
    summary: result.status === "recorded" ? `You chose "${label}". Saved for the team.` : `You chose "${label}". Not sent.`,
    source: "live_human",
    runId: item.runId,
  });
}

/** Truncate to `n` chars with an ellipsis (whitespace collapsed). */
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Option button text: at most 4 words and 28 chars. The full label and effect go in the tooltip. */
export function shortLabel(label: string): string {
  const words = label.replace(/\s+/g, " ").trim().split(" ");
  return clip(words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : words.join(" "), 28);
}

const scrub = (s: string) => scrubLeaks(s);

const BASIS_DOT: Record<string, string> = {
  system_record: "bg-emerald-400",
  owning_team_statement: "bg-sky-400",
  unverified_claim: "bg-amber-400",
};

type Choice =
  | { key: string; optionId: string; state: "sending" }
  | { key: string; optionId: string; state: "done"; result: DecisionOutcome; rerun?: "running" | CityRerun };

/** Replay the re-run's trace on the case's feed line and remember it, so a new card can be answered too. */
function replayRerun(item: ToastItem, rerun: CityRerun) {
  if (rerun.status === "failed") {
    useWorld.getState().pushWorkflow({
      id: `rr-${Math.random().toString(36).slice(2, 10)}`, t: performance.now(), caseId: item.caseLabel, nodeId: "log",
      status: "error", summary: scrub(rerun.reason).slice(0, 120) || "Couldn't run it again.", source: "agent", runId: item.runId,
    });
    return;
  }
  if (rerun.status !== "done" || !rerun.execution.trace) return;
  const ex = rerun.execution;
  rememberReplay({ caseLabel: item.caseLabel, trace: ex.trace!, card: ex.card ?? null, outbox: ex.outbox ?? null, origin: "console", executionId: ex.id });
  for (const t of rerunFeed(ex, item.caseLabel)) {
    setTimeout(() => useWorld.getState().pushWorkflow({ ...t.event, id: `rr-${Math.random().toString(36).slice(2, 10)}`, t: performance.now() }), t.atMs);
  }
}

export function RealDecisionToast({ tasks, loading, onOpenQueue }: { tasks: ReviewTask[]; loading: boolean; onOpenQueue: () => void }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [details, setDetails] = useState(false);
  const seenKeys = useRef(new Set<string>());
  const seededQueue = useRef(false);
  const lastId = useRef<string | null>(null);
  const sending = useRef(false);

  const enqueue = (items: ToastItem[]) => {
    const fresh = items.filter((i) => !seenKeys.current.has(i.key));
    if (!fresh.length) return;
    for (const i of fresh) seenKeys.current.add(i.key);
    setQueue((q) => [...q, ...fresh].slice(-6));
  };

  // (a) Replayed real traces: watch the store for new "ask" events that carry a card.
  useEffect(() => {
    const wf = useWorld.getState().workflow;
    lastId.current = wf.length ? wf[wf.length - 1].id : null;
    return useWorld.subscribe((s, prev) => {
      if (s.workflow === prev.workflow || s.workflow.length === 0) return;
      const fresh = newAsks(s.workflow, lastId.current);
      lastId.current = s.workflow[s.workflow.length - 1].id;
      const t = performance.now();
      const items = fresh.flatMap((e) => {
        const it = toastFromEvent(e, replayFor(e.caseId)?.trace.caseId, t);
        return it ? [it] : [];
      });
      if (items.length) enqueue(items);
    });
  }, []);

  // (b) The review queue gained an agent card. The first load only seeds (no backlog toasts); cards from a
  // run the city is replaying are skipped here, because the replay toasts them when it reaches the card.
  useEffect(() => {
    if (loading) return;
    const t = performance.now();
    const items = tasks.flatMap((task) => {
      const it = toastFromTask(task, t);
      return it ? [it] : [];
    });
    if (!seededQueue.current) {
      seededQueue.current = true;
      for (const i of items) seenKeys.current.add(i.key);
      return;
    }
    enqueue(items.filter((i) => !replayByRun(i.runId, i.traceCaseId)));
  }, [tasks, loading]);

  const cur = queue[0] ?? null;

  const dismiss = () => {
    setChoice(null);
    setDetails(false);
    setQueue((q) => q.slice(1));
  };

  async function choose(optionId: string) {
    if (!cur || choice || sending.current) return;
    sending.current = true;
    const item = cur;
    const key = item.key;
    // Updates land only while this card is still the one on screen.
    const update = (next: Choice) => setChoice((c) => (c && c.key !== key ? c : next));
    try {
      update({ key, optionId, state: "sending" });
      const label = item.card.options.find((o) => o.id === optionId)?.label ?? optionId;
      const who = reviewer();
      const replay = replayByRun(item.runId, item.traceCaseId);
      const result = await recordDecision(
        { runId: item.runId, caseId: item.traceCaseId, optionId, who, note: "Chosen in the city HUD", replay },
        browserFetchJson,
      );
      update({ key, optionId, state: "done", result });
      pushChoice(item, label, result);
      // Saved once; this card's buttons stay locked by `choice`, so other cards can be answered meanwhile.
      sending.current = false;
      if (result.status !== "recorded") return;
      const executionId = item.executionId ?? (await findExecutionId({ runId: item.runId, caseId: item.traceCaseId, taskId: result.taskId, replay }, browserFetchJson));
      if (!executionId) return;
      update({ key, optionId, state: "done", result, rerun: "running" });
      const rerun = await rerunWithChoice({ executionId, option: { id: optionId, label }, person: who }, (url, init) => fetch(url, init));
      update({ key, optionId, state: "done", result, rerun });
      replayRerun(item, rerun);
    } finally {
      sending.current = false;
    }
  }

  if (!cur) return null;
  const c = cur.card;
  const mins = Math.round(c.deadlineMs / 60_000);
  const picked = choice?.optionId ?? null;
  const why = scrub(c.whyStopped?.line || c.summary);
  const rerun = choice?.state === "done" ? choice.rerun : undefined;
  const status =
    choice?.state === "sending" ? { text: "Saving…", cls: "text-white/55", title: "" }
    : rerun === "running" ? { text: "Running again with your choice…", cls: "text-white/70", title: "Saved. The agent is running the case again." }
    : rerun?.status === "done"
      ? { text: rerun.result.text, cls: rerun.result.tone === "ok" ? "text-emerald-300" : rerun.result.tone === "warn" ? "text-amber-300" : "text-red-300", title: `Saved and run again: ${rerun.result.text}` }
    : rerun?.status === "failed" ? { text: "Saved. Not run again", cls: "text-amber-300", title: scrub(rerun.reason) }
    : choice?.state === "done"
      ? choice.result.status === "recorded"
        ? { text: "Saved for the team", cls: "text-emerald-300", title: "Your choice is saved. The team carries it out." }
        : { text: "Not sent", cls: "text-amber-300", title: choice.result.reason }
      : null;
  return (
    <div key={cur.key} className={`${GLASS} hud-toast w-full max-w-[380px]`} role="alertdialog" aria-label="A person needs to decide" title={cur.caseLabel}>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-white">A person needs to decide</span>
          <RealAgentTag label={cur.prov} />
          {queue.length > 1 && <span className="ml-auto shrink-0 text-[10px] text-white/45">+{queue.length - 1} more</span>}
        </div>
        <p className="mt-1 truncate text-[12px] text-white/75" title={why}>{clip(why, 90)}</p>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {c.options.map((o) => {
            const on = picked === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!!picked}
                onClick={() => void choose(o.id)}
                title={[o.label, o.effect].filter(Boolean).map((t) => scrub(t!)).join(": ")}
                className={`w-full truncate rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition ${
                  on
                    ? "border-[#ff6a1a] bg-[#ff6a1a] text-black"
                    : picked
                      ? "border-white/5 bg-white/[0.02] text-white/30"
                      : "border-white/15 bg-white/[0.06] text-white hover:border-[#ff6a1a] hover:bg-[#ff6a1a]/15"
                }`}
              >
                {shortLabel(scrub(o.label))}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/45">
          <button type="button" onClick={() => setDetails((d) => !d)} className="text-white/55 hover:text-white" aria-expanded={details}>
            Details {details ? "▴" : "▾"}
          </button>
          {status ? <span className={`min-w-0 truncate ${status.cls}`} title={status.title}>{status.text}</span> : <span>{mins} min to decide</span>}
          <span className="ml-auto flex shrink-0 gap-1.5">
            <button type="button" onClick={onOpenQueue} className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white">All</button>
            <button type="button" onClick={dismiss} className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white">{choice?.state === "done" ? "Close" : "Later"}</button>
          </span>
        </div>
        {details && (
          <div className="hud-scroll mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-white/[0.07] pt-2 text-[11px] leading-snug text-white/60">
            <p><span className="text-white/40">Who decides: </span>{plainOwner(c.routeTo)}</p>
            {c.summary && c.summary !== why && <p>{scrub(c.summary)}</p>}
            {c.evidence?.slice(0, 2).map((ev, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${BASIS_DOT[ev.basis] ?? "bg-white/40"}`} />
                <span>{clip(`${ev.who}: ${scrub(ev.says)}`, 140)}</span>
              </p>
            ))}
            {c.alreadyDone?.length ? <p><span className="text-white/40">Already done: </span>{c.alreadyDone.map(scrub).join(" · ")}</p> : null}
            {c.wouldChangeMyMind && <p><span className="text-white/40">What would settle it: </span>{scrub(c.wouldChangeMyMind)}</p>}
            {c.fallback && <p><span className="text-white/40">If nobody answers: </span>{scrub(c.fallback)}</p>}
            {status?.title && <p>{status.title}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
