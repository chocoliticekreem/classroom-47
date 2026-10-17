"use client";
// Practice panel: run the playbook on a few real cases (real agent, real scoring), show "4 of 5
// right" with one plain line per case, improve it from the misses, and show if it's getting
// better. Versions, case lists and the auto-improve loop sit behind "Advanced". Every number here
// comes from the practice-run API.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Flow, ImproveProposal, ScenarioSetId, TestRun, TestRunCase, WorkflowVersion } from "../types";
import { Icon } from "./icons";
import { Badge, Btn, SectionLabel } from "./bits";
import {
  cancelTestRun, createVersion, executeCase, getTestRun, getExecution, improveFlow, listCases, listScenarioSets, listTestRuns, listVersions,
  startTestRun, type ScenarioSetInfo, type TestRunBody,
} from "./api";
import {
  AUTO_MAX_ITERATIONS, MAX_MISSES, POLL_MS, autoNext, autoStart, costPerCase, initialPoll, latestVersion,
  learningCurve, pollReducer, retestBody, reuseLine, type AutoState,
} from "./testing";
import { LearningCurve } from "./LearningCurve";
import { FeedbackForm } from "./FeedbackForm";
import { caseElapsedMs, caseTitle, fmtElapsed, isFinished, overallProgress, runningLine } from "./practiceProgress";
import { cents, scrubLeaks } from "../../ui/plain";

const SET_WORDS: Record<string, string> = {
  quick: "Quick 5", city: "City cases", fixtures: "Tricky cases", adversarial: "Hard cases", generated: "Made-up cases", custom: "Pick my own",
};

const FALLBACK_SETS: ScenarioSetInfo[] = [
  { id: "quick", label: "Quick 5", count: 5 },
  { id: "fixtures", label: "Edge-case fixtures", count: 12 },
  { id: "adversarial", label: "Adversarial", count: 0 },
  { id: "generated", label: "Generated", count: 0 },
  { id: "custom", label: "Custom", count: 0 },
];

type RunSummary = Omit<TestRun, "cases">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


/** Provenance in plain words: these results come from the real agent and the real judge. */
export function RealBadge() {
  return (
    <span title="Real agent, real scoring">
      <Badge tone="green">Live</Badge>
    </span>
  );
}

/** One plain sentence for a case: the judge's reason, cleaned of developer words. */
export function caseSentence(c: TestRunCase): string {
  if (c.status === "queued") return "Waiting…";
  if (c.status === "running") return "Working on it…";
  if (c.status === "error") return "Couldn't finish this case.";
  if (c.reused) return `Reused · same playbook, same case. ${scrubLeaks(c.verdict) || (c.status === "passed" ? "Handled it right." : "Didn't handle it right.")}`;
  const v = scrubLeaks(c.verdict);
  if (v) return v;
  if (c.mustNotBroken.length) return "Broke a rule it must keep.";
  return c.status === "passed" ? "Handled it right." : "Didn't handle it right.";
}

/** Current time, ticking every `ms` while `on`; frozen otherwise. */
function useNow(on: boolean, ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, ms);
    const first = setTimeout(tick, 0);
    return () => { clearInterval(t); clearTimeout(first); };
  }, [on, ms]);
  return now;
}

function CaseRow({ c, selected, onClick, now, live }: { c: TestRunCase; selected: boolean; onClick: () => void; now: number; live: boolean }) {
  const done = isFinished(c);
  const elapsed = caseElapsedMs(c, now);
  const sub = !live && (c.status === "running" || c.status === "queued")
    ? (c.status === "running" ? "Still finishing in the background." : "Not started.")
    : c.status === "queued" ? "Waiting to start…" : caseSentence(c);
  const icon =
    c.status === "queued" ? <span className="block h-4 w-4 rounded-full border-2 border-white/20" />
      : c.status === "running" ? <span className="wf-spin block h-4 w-4 rounded-full border-2 border-[#ff6a1a] border-t-transparent" />
      : c.status === "passed" ? <span className="text-[18px] font-bold leading-none text-[#4ade80]" aria-label="Right">✓</span>
      : <span className="text-[18px] font-bold leading-none text-[#f87171]" aria-label="Wrong">✗</span>;
  return (
    <button
      type="button" onClick={onClick} disabled={!c.executionId}
      title={c.executionId ? "Show this case on the playbook" : undefined}
      className={`relative flex w-full items-start gap-2.5 overflow-hidden rounded-md px-2.5 py-2 text-left ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"} disabled:cursor-default`}
    >
      <span key={done ? "done" : "live"} className={`mt-0.5 grid w-5 shrink-0 place-items-center ${done ? "wf-appear" : ""}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-snug text-white/90" title={c.caseId}>{caseTitle(c)}</span>
        <span className={`line-clamp-2 block text-[12.5px] leading-snug ${done ? "text-white/60" : "text-white/40"}`}>{sub}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {elapsed !== null && (
          <span className={`block text-[12.5px] ${c.status === "running" && live ? "text-[#ff9a5c]" : "text-white/50"}`} title={c.reused ? "Time the original run took" : done ? "Time taken" : "Time so far"}>{fmtElapsed(elapsed)}</span>
        )}
        {c.reused ? (
          <span className="block text-[11px] text-white/30" title={cents(c.reused.originalCostUsd) ? `The original run cost ${cents(c.reused.originalCostUsd)}` : undefined}>0¢ new</span>
        ) : done && cents(c.costUsd) && <span className="block text-[11px] text-white/30">{cents(c.costUsd)}</span>}
      </span>
      {c.status === "running" && live && <span aria-hidden className="wf-row-pulse pointer-events-none absolute inset-x-2.5 bottom-0 h-[2px]" />}
    </button>
  );
}

function ConfirmAuto({ cases, perCase, onGo, onCancel }: { cases: number; perCase: number | null; onGo: () => void; onCancel: () => void }) {
  const runs = AUTO_MAX_ITERATIONS + 1;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div role="dialog" aria-label="Keep improving" className="w-full max-w-[420px] rounded-xl border border-white/10 bg-[#222227] p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-[16px] font-semibold text-white">Keep improving?</div>
        <p className="mt-3 text-[13px] leading-relaxed text-white/70">
          We&apos;ll practise, improve, and practise again, up to {AUTO_MAX_ITERATIONS} times. We stop early if it stops getting better.
        </p>
        <p className="mt-3 rounded-md bg-[#f59e0b]/10 px-3 py-2.5 text-[13px] leading-relaxed text-[#fcd34d]">
          This costs real money: up to {runs * cases} case runs.
          {perCase !== null ? <> About {cents(perCase * cases * runs)}.</> : null}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={onGo}>Start</Btn>
        </div>
      </div>
    </div>
  );
}

export function TestPanel({ workflowId, blocked, hint, selectedExecId, onShowExecution, onProposal, onLoadVersion, onMakeCurrent, versionsTick, initialSet, initialFilter, onClose }: {
  workflowId: string | null;
  /** Why testing is unavailable right now (draft, unsaved changes), or null. */
  blocked: string | null;
  selectedExecId: string | null;
  onShowExecution: (id: string | null) => void;
  /** Show (or clear) a proposal as a diff against `base` on the canvas. */
  onProposal: (p: { proposal: ImproveProposal; base: Flow | null } | null) => void;
  /** Soft warning shown above the controls (e.g. unsaved canvas edits). */
  hint?: string | null;
  onLoadVersion: (v: WorkflowVersion) => void;
  /** Make a version the workflow Execute uses (PUT the workflow). */
  onMakeCurrent: (v: WorkflowVersion) => Promise<boolean>;
  /** Bumped when the editor saved a new version. */
  versionsTick?: number;
  /** Case list (and filter) to start with, e.g. from a "Run more cases" link. */
  initialSet?: ScenarioSetId | null;
  initialFilter?: string | null;
  onClose: () => void;
}) {
  const [sets, setSets] = useState<ScenarioSetInfo[]>(FALLBACK_SETS);
  const [setsNote, setSetsNote] = useState<string | null>(null);
  const [setId, setSetId] = useState<ScenarioSetId>(initialSet ?? "quick");
  const [filter, setFilter] = useState(initialFilter ?? "");
  // A filter that came with a link is sent even if the case list does not offer it as a choice.
  const [linkFilter, setLinkFilter] = useState(initialFilter ?? "");
  const [limit, setLimit] = useState(5);
  const [custom, setCustom] = useState<string[]>([]);
  const [caseQ, setCaseQ] = useState("");
  const [caseHits, setCaseHits] = useState<{ id: string; dataset: string; title: string | null }[]>([]);

  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [poll, dispatch] = useReducer(pollReducer, initialPoll);
  const [proposal, setProposal] = useState<ImproveProposal | null>(null);
  const [improving, setImproving] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ version: number; run: TestRun } | null>(null);
  const [feedbackRetest, setFeedbackRetest] = useState<{ version: number; caseId: string; dataset: string } | null>(null);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // Default: reuse results this exact playbook already has for a case (instant, free). On: run every case again.
  const [fresh, setFresh] = useState(false);
  const cancelRef = useRef(false);
  const stopAutoRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelRef.current = true; stopAutoRef.current = true; }; }, []);

  const run = poll.run;
  const running = poll.phase === "starting" || poll.phase === "polling";
  const autoRunning = !!auto && auto.step !== "stopped";
  const set = sets.find((s) => s.id === setId);
  const perCase = useMemo(() => costPerCase(runs), [runs]);
  const curve = useMemo(() => learningCurve(runs), [runs]);
  const caseCount = setId === "custom" ? custom.length : Math.min(limit, set?.count || limit);

  // ---- loading
  useEffect(() => {
    let live = true;
    listScenarioSets().then((r) => {
      if (!live) return;
      if (r.ok && r.data?.sets?.length) { setSets(r.data.sets); setSetsNote(null); }
      else setSetsNote("Couldn't load the case lists.");
    });
    return () => { live = false; };
  }, []);

  const refreshVersions = useCallback(async (select?: number) => {
    if (!workflowId) return [] as WorkflowVersion[];
    const r = await listVersions(workflowId);
    const vs = r.ok ? [...(r.data?.versions ?? [])].sort((a, b) => b.version - a.version) : [];
    if (!alive.current) return vs;
    setVersions(vs);
    setVersion((cur) => select ?? (cur !== null && vs.some((v) => v.version === cur) ? cur : latestVersion(vs)?.version ?? null));
    return vs;
  }, [workflowId]);

  const refreshRuns = useCallback(async () => {
    if (!workflowId) return;
    const r = await listTestRuns(workflowId);
    if (alive.current && r.ok) setRuns(r.data?.testRuns ?? []);
  }, [workflowId]);

  useEffect(() => {
    let live = true;
    if (!workflowId) return;
    Promise.all([listVersions(workflowId), listTestRuns(workflowId)]).then(([v, t]) => {
      if (!live) return;
      const vs = v.ok ? [...(v.data?.versions ?? [])].sort((a, b) => b.version - a.version) : [];
      setVersions(vs);
      setVersion(latestVersion(vs)?.version ?? null);
      setRuns(t.ok ? t.data?.testRuns ?? [] : []);
    });
    return () => { live = false; };
  }, [workflowId]);

  useEffect(() => {
    if (!versionsTick) return;
    const t = setTimeout(() => { void refreshVersions(); }, 0);
    return () => clearTimeout(t);
  }, [versionsTick, refreshVersions]);

  useEffect(() => {
    if (setId !== "custom") return;
    let live = true;
    const t = setTimeout(() => {
      listCases(caseQ).then((r) => { if (live) setCaseHits(r.ok ? (r.data?.cases ?? []).slice(0, 40) : []); });
    }, caseQ ? 200 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [setId, caseQ]);

  // ---- running a test to completion (shared by the button and the auto loop)
  const runTest = useCallback(async (body: TestRunBody): Promise<TestRun | null> => {
    cancelRef.current = false;
    setError(null);
    setAccepted(null);
    dispatch({ type: "start" });
    const r = await startTestRun(body);
    if (!r.ok || !r.data?.testRun) {
      const msg = "it couldn't start";
      dispatch({ type: "start_failed", error: msg });
      return null;
    }
    let tr = r.data.testRun;
    dispatch({ type: "started", run: tr });
    let misses = 0;
    while (tr.status === "running") {
      await sleep(POLL_MS);
      if (cancelRef.current || !alive.current) return null;
      const g = await getTestRun(tr.id);
      if (g.ok && g.data?.testRun) {
        tr = g.data.testRun;
        misses = 0;
        dispatch({ type: "poll_ok", run: tr });
      } else {
        misses += 1;
        dispatch({ type: "poll_failed", error: "lost touch with it", status: g.ok ? 200 : g.status });
        if ((!g.ok && g.status === 404) || misses >= MAX_MISSES) return null;
      }
    }
    void refreshRuns();
    void refreshVersions();
    return tr;
  }, [refreshRuns, refreshVersions]);

  const body = (): TestRunBody | null => {
    if (!workflowId) return null;
    const b: TestRunBody = { workflowId, set: setId, limit };
    if (version !== null) b.version = version;
    if (filter && (set?.filters?.includes(filter) || filter === linkFilter)) b.filter = filter;
    if (setId === "custom") { b.caseIds = custom; b.limit = Math.min(20, Math.max(1, custom.length)); }
    if (fresh) b.fresh = true;
    return b;
  };

  const cancel = async () => {
    cancelRef.current = true;
    stopAutoRef.current = true;
    dispatch({ type: "cancel" });
    if (run) await cancelTestRun(run.id);
    void refreshRuns();
  };

  // ---- improve
  const improve = useCallback(async (tr: TestRun): Promise<ImproveProposal | null> => {
    if (!workflowId) return null;
    setImproving(true);
    setError(null);
    const r = await improveFlow({ workflowId, testRunId: tr.id });
    setImproving(false);
    if (!r.ok || !r.data?.proposal) {
      setError("Couldn't suggest changes right now.");
      return null;
    }
    const p = r.data.proposal;
    setProposal(p);
    onProposal({ proposal: p, base: versions.find((v) => v.version === p.fromVersion)?.flow ?? null });
    return p;
  }, [workflowId, versions, onProposal]);

  const accept = useCallback(async (p: ImproveProposal): Promise<WorkflowVersion | null> => {
    if (!workflowId) return null;
    setBusyMsg("Saving the new version…");
    const r = await createVersion(workflowId, {
      flow: p.flow, createdBy: "improve", note: [p.feedbackId ? `Feedback ${p.feedbackId}` : "", p.changes.join("; "), p.rationale].filter(Boolean).join("; ") || null, parentVersion: p.fromVersion,
    });
    setBusyMsg(null);
    if (!r.ok || !r.data?.version) {
      setError(r.ok ? "Couldn't save the new version." : r.error);
      return null;
    }
    const v = r.data.version;
    setProposal(null);
    onProposal(null);
    await refreshVersions(v.version);
    // Accepting makes it the workflow Execute and the agent use.
    if (!(await onMakeCurrent(v))) onLoadVersion(v);
    return v;
  }, [workflowId, onProposal, onLoadVersion, onMakeCurrent, refreshVersions]);

  const reject = () => { setProposal(null); onProposal(null); };

  // ---- auto-improve loop
  const autoImprove = async () => {
    setConfirmAuto(false);
    const first = body();
    if (!first || !workflowId) return;
    stopAutoRef.current = false;
    let s = autoStart();
    setAuto(s);
    let next: TestRunBody = first;
    let last: TestRun | null = null;
    let current: ImproveProposal | null = null;
    while (s.step !== "stopped") {
      if (stopAutoRef.current || !alive.current) { s = autoNext(s, { type: "stop" }); break; }
      if (s.step === "test") {
        const tr = await runTest(next);
        s = tr ? autoNext(s, { type: "tested", status: tr.status, summary: tr.summary }) : autoNext(s, { type: "failed", error: "the test run did not finish" });
        if (tr) last = tr;
      } else if (s.step === "improve") {
        current = last ? await improve(last) : null;
        s = current ? autoNext(s, { type: "improved", proposal: current }) : autoNext(s, { type: "failed", error: "no proposal from the Architect" });
        if (s.step === "accept") await sleep(2200); // let the diff sit on the canvas for a moment
      } else if (s.step === "accept") {
        const v = current ? await accept(current) : null;
        s = v && last ? autoNext(s, { type: "accepted", version: v.version }) : autoNext(s, { type: "failed", error: "could not save the new version" });
        if (v && last) next = retestBody(last, v.version);
      }
      if (alive.current) setAuto(s);
    }
    if (alive.current) setAuto(s);
  };

  const retest = async () => {
    if (!accepted) return;
    await runTest(retestBody(accepted.run, accepted.version));
  };

  const failures = run ? run.summary.failed + run.summary.errors : 0;
  const finished = poll.phase === "done" && run;
  const disabled = !!blocked || !workflowId || running || autoRunning || improving || !!proposal;

  const finishedRun = finished ? run : null;
  const progress = run ? run.cases.filter(isFinished).length : 0;
  const now = useNow(running && !!run);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-[#19191d]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1 text-[15px] font-semibold text-white">Practice</div>
        <RealBadge />
        <button type="button" onClick={onClose} title="Close" className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white"><Icon name="close" size={15} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {blocked && <div className="rounded-md bg-[#f59e0b]/10 px-3 py-2 text-[13px] text-[#fcd34d]">{blocked}</div>}
        {!blocked && hint && <div className="rounded-md bg-white/[0.04] px-3 py-2 text-[12.5px] text-white/60">{hint}</div>}
        <FeedbackForm key={`${workflowId}:${selectedExecId}`} executionId={selectedExecId} workflowId={workflowId} disabled={disabled}
          onBusy={setImproving}
          onProposal={(p) => {
            setProposal(p);
            onProposal({ proposal: p, base: versions.find((v) => v.version === p.fromVersion)?.flow ?? null });
          }} />

        {(setId !== "quick" || filter) && !running && (
          <div className="flex items-center gap-2 text-[12.5px] text-white/60">
            <span>Cases: <span className="text-white/85">{SET_WORDS[setId] ?? set?.label ?? setId}</span>{filter ? <> · <span className="text-white/85">{filter.replace(/_/g, " ")}</span></> : null}</span>
            <button type="button" className="ml-auto text-white/40 underline-offset-2 hover:text-white hover:underline" disabled={autoRunning} onClick={() => { setSetId("quick"); setFilter(""); setLinkFilter(""); }}>Back to Quick 5</button>
          </div>
        )}

        {/* Main action */}
        {running ? (
          <Btn variant="outline" className="h-12 w-full justify-center text-[15px]" title="No new cases start; cases already running finish" onClick={() => void cancel()}>Cancel</Btn>
        ) : (
          <Btn
            variant="primary" className="h-12 w-full justify-center text-[16px] font-semibold"
            disabled={disabled || (setId === "custom" && !custom.length)}
            onClick={() => { const b = body(); if (b) void runTest(b); }}
          >
            Practice on {caseCount} case{caseCount === 1 ? "" : "s"}
          </Btn>
        )}
        {!running && (
          <label className="-mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-white/55" title="Off: a case this exact playbook already ran is reused (instant, free). On: every case calls the agent again.">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} disabled={autoRunning} className="accent-[#ff6a1a]" />
            Run fresh <span className="text-white/35">{fresh ? "· every case runs again" : "· reuses results this playbook already has"}</span>
          </label>
        )}

        {error && <div className="rounded-md bg-[#ef4444]/10 px-3 py-2 text-[13px] text-[#fca5a5]">{scrubLeaks(error) || "Something went wrong."}</div>}
        {poll.phase === "error" && poll.error && <div className="rounded-md bg-[#ef4444]/10 px-3 py-2 text-[13px] text-[#fca5a5]">Practice stopped: {scrubLeaks(poll.error) || "something went wrong"}.</div>}
        {busyMsg && <div className="text-[13px] text-white/60">{busyMsg}</div>}

        {/* Result */}
        {poll.phase === "starting" && <div className="text-[13px] text-white/60"><span className="wf-pulse-soft">●</span> Checking the playbook and starting {caseCount} case{caseCount === 1 ? "" : "s"}…</div>}
        {run && (
          <div>
            <div
              aria-live="polite"
              className={`text-[40px] font-semibold leading-none tracking-tight tabular-nums ${running ? "text-white" : run.summary.total > 0 && run.summary.passed === run.summary.total ? "text-[#4ade80]" : "text-white"}`}
            >
              {running ? <>{progress} of {run.cases.length} <span className="text-[22px] font-medium text-white/50">done</span></> : <>{run.summary.passed} of {run.summary.total} <span className="text-[22px] font-medium text-white/60">right</span></>}
            </div>
            {reuseLine(run.cases) && (
              <div className="mt-1.5 text-[12.5px] text-white/55" title="Reused cases come from an earlier run of this exact playbook: no new agent call, no new cost">{reuseLine(run.cases)}</div>
            )}
            {running && (
              <>
                <div className="mt-1.5 text-[12.5px] text-white/55">{runningLine(run.cases)}</div>
                <div
                  role="progressbar" aria-label="Practice progress, estimated from time" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={Math.round(overallProgress(run.cases, now) * 100)}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
                >
                  <div className="h-full rounded-full bg-[#ff6a1a] transition-[width] duration-500 ease-out" style={{ width: `${overallProgress(run.cases, now) * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-white/30">Bar fills with time and jumps as each case finishes.</div>
              </>
            )}
            {poll.phase === "cancelled" && <div className="text-[12px] text-white/45">Stopped early</div>}
            {!running && run.summary.costUsd > 0 && <div className="text-[11px] text-white/30">{cents(run.summary.costUsd)}</div>}
            <div className="mt-2 space-y-0.5">
              {run.cases.map((c) => (
                <CaseRow
                  key={`${c.dataset}/${c.caseId}`} c={c} selected={!!c.executionId && c.executionId === selectedExecId} now={now} live={poll.phase !== "cancelled"}
                  onClick={() => c.executionId && onShowExecution(c.executionId === selectedExecId ? null : c.executionId)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Improve */}
        {finishedRun && failures > 0 && !proposal && !autoRunning && (
          <Btn variant="primary" className="h-12 w-full justify-center text-[16px] font-semibold" disabled={improving || !!blocked} onClick={() => void improve(finishedRun)}>
            {improving ? "Looking at what went wrong…" : "Improve it"}
          </Btn>
        )}
        {finishedRun && failures === 0 && finishedRun.summary.total > 0 && (
          <div className="text-[13px] text-[#4ade80]">All right. Nothing to improve.</div>
        )}

        {proposal && (
          <div className="space-y-3 rounded-lg border border-white/12 px-3 py-3">
            <div className="text-[14px] font-semibold text-white">Suggested changes</div>
            <div className="text-[12px] text-white/45">Shown on the playbook: green is new, red is removed.</div>
            {proposal.changes.length > 0 && (
              <ul className="space-y-1 text-[13px] text-white/85">
                {proposal.changes.map((c, i) => <li key={i}>• {scrubLeaks(c)}</li>)}
              </ul>
            )}
            {proposal.rationale && (
              <details className="text-[12.5px] text-white/55"><summary className="cursor-pointer">Why</summary><p className="mt-1 leading-relaxed">{scrubLeaks(proposal.rationale)}</p></details>
            )}
            {proposal.problems.length > 0 && <div className="text-[12.5px] text-[#fca5a5]">This change isn&apos;t safe, so it can&apos;t be used.</div>}
            {!autoRunning && (
              <div className="flex gap-2">
                <Btn onClick={reject}>No thanks</Btn>
                <Btn
                  variant="primary" disabled={proposal.problems.length > 0 || !!busyMsg}
                  onClick={async () => {
                    const p = proposal;
                    const r = run;
                    const v = await accept(p);
                    if (v && p.feedbackId && (p.feedbackExecutionId || selectedExecId)) {
                      const ex = await getExecution(p.feedbackExecutionId || selectedExecId!);
                      if (ex.ok) setFeedbackRetest({ version: v.version, caseId: ex.data.execution.caseId, dataset: ex.data.execution.dataset });
                    } else if (v && r) setAccepted({ version: v.version, run: r });
                  }}
                >
                  Use it
                </Btn>
              </div>
            )}
          </div>
        )}

        {accepted && !running && !autoRunning && (
          <div className="space-y-2.5 rounded-lg bg-[#22c55e]/[0.07] px-3 py-3">
            <div className="text-[13.5px] text-white/85">Version {accepted.version} saved. Try the same cases again?</div>
            <Btn variant="primary" className="h-12 w-full justify-center text-[16px] font-semibold" onClick={() => void retest()}>Practice again</Btn>
          </div>
        )}
        {feedbackRetest && !running && !autoRunning && workflowId && (
          <div className="space-y-2 rounded-lg bg-[#22c55e]/[0.07] p-3">
            <p className="text-[13px] text-white/85">Version {feedbackRetest.version} saved. Check the corrected case, then try another example.</p>
            <Btn variant="primary" disabled={disabled} onClick={async () => {
              setImproving(true);
              const r = await executeCase({ workflowId, caseId: feedbackRetest.caseId, dataset: feedbackRetest.dataset });
              setImproving(false);
              if (r.ok) onShowExecution(r.data.execution.id);
              else setError(r.error);
            }}>Test the corrected case</Btn>
          </div>
        )}

        {auto && (
          <div className="rounded-md bg-white/[0.04] px-3 py-2.5">
            <div className="mb-1 text-[12px] font-semibold text-white/70">{autoRunning ? "Improving…" : "Finished improving"}</div>
            <ol className="space-y-0.5 text-[12.5px] text-white/65">
              {auto.log.map((l, i) => <li key={i} className={l.startsWith("Stopped") ? "text-[#fcd34d]" : ""}>{l}</li>)}
            </ol>
            {autoRunning && <Btn className="mt-2" onClick={() => { stopAutoRef.current = true; void cancel(); }}>Stop</Btn>}
          </div>
        )}

        {/* Getting better? */}
        <div>
          <div className="mb-1.5 text-[14px] font-semibold text-white/85">Getting better?</div>
          <LearningCurve points={curve} current={version} />
        </div>

        {/* Advanced */}
        <div>
          <button type="button" onClick={() => setAdvanced((a) => !a)} className="inline-flex items-center gap-1 text-[12px] text-white/45 hover:text-white/80">
            <Icon name="chevron" size={11} className={advanced ? "rotate-90" : ""} /> Advanced
          </button>
        </div>
        {advanced && (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <div>
              <SectionLabel>Version</SectionLabel>
              {versions.length ? (
                <>
                  <select
                    value={version ?? ""} disabled={running || autoRunning}
                    onChange={(e) => {
                      const v = versions.find((x) => x.version === Number(e.target.value));
                      if (v) { setVersion(v.version); onLoadVersion(v); }
                    }}
                    className="h-8 w-full rounded-md border border-white/10 bg-[#222227] px-2 text-[12px] text-white outline-none"
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        Version {v.version} · {v.createdBy === "user" ? "saved by you" : v.createdBy === "improve" ? "improved" : "made for you"}
                      </option>
                    ))}
                  </select>
                  <Btn
                    variant="outline" className="mt-2" disabled={running || autoRunning || !!busyMsg || !!blocked || version === null}
                    title="Use this version for real cases"
                    onClick={async () => {
                      const v = versions.find((x) => x.version === version);
                      if (!v) return;
                      setBusyMsg(`Switching to version ${v.version}…`);
                      await onMakeCurrent(v);
                      setBusyMsg(null);
                    }}
                  >
                    Use version {version}
                  </Btn>
                </>
              ) : (
                <div className="text-[12px] text-white/45">No versions yet.</div>
              )}
            </div>

            <div>
              <SectionLabel>Which cases</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {sets.map((x) => (
                  <button
                    key={x.id} type="button" onClick={() => { setSetId(x.id); setFilter(""); setLinkFilter(""); }} disabled={running || autoRunning}
                    className={`rounded-md border px-2.5 py-1 text-[12px] ${setId === x.id ? "border-[#ff6a1a]/70 text-white" : "border-white/12 text-white/65 hover:bg-white/[0.04]"}`}
                  >
                    {SET_WORDS[x.id] ?? x.label.split(":")[0]}
                  </button>
                ))}
              </div>
              {setsNote && <div className="mt-1.5 text-[12px] text-[#fbbf24]">Couldn&apos;t load the case lists.</div>}
              {((set?.filters?.length ?? 0) > 0 || !!linkFilter) && (
                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2 h-8 w-full rounded-md border border-white/10 bg-[#222227] px-2 text-[12px] text-white outline-none">
                  <option value="">Any kind</option>
                  {linkFilter && !(set?.filters ?? []).includes(linkFilter) && <option value={linkFilter}>{linkFilter.replace(/_/g, " ")}</option>}
                  {(set?.filters ?? []).map((f) => <option key={f} value={f}>{f.replace(/_/g, " ")}</option>)}
                </select>
              )}
              {setId === "custom" && (
                <div className="mt-2 space-y-1.5">
                  <input
                    value={caseQ} onChange={(e) => setCaseQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search cases…"
                    className="h-8 w-full rounded-md border border-white/10 bg-black/25 px-2 text-[12px] text-white outline-none focus:border-white/30"
                  />
                  {custom.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {custom.map((id) => (
                        <button key={id} type="button" onClick={() => setCustom((c) => c.filter((x) => x !== id))} className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-white/70" title="Remove">
                          {id} ×
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="max-h-32 overflow-y-auto rounded-md border border-white/[0.07]">
                    {caseHits.map((c) => {
                      const on = custom.includes(c.id);
                      return (
                        <label key={`${c.dataset}/${c.id}`} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12px] hover:bg-white/[0.04]">
                          <input
                            type="checkbox" checked={on} disabled={!on && custom.length >= 20}
                            onChange={() => setCustom((cs) => (on ? cs.filter((x) => x !== c.id) : [...cs, c.id]))}
                            className="accent-[#ff6a1a]"
                          />
                          <span className="min-w-0 flex-1 truncate text-white/80">{c.title ?? c.id}</span>
                        </label>
                      );
                    })}
                    {!caseHits.length && <div className="px-2 py-2 text-[11px] text-white/35">No cases found.</div>}
                  </div>
                </div>
              )}
            </div>

            {setId !== "custom" && (
              <div>
                <div className="flex items-center justify-between">
                  <SectionLabel>How many</SectionLabel>
                  <span className="text-[12px] font-semibold tabular-nums text-white/80">{limit}</span>
                </div>
                <input type="range" min={1} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full" style={{ accentColor: "#ff6a1a" }} />
                {perCase !== null && <div className="text-[11px] text-white/35">About {cents(perCase * Math.max(1, caseCount))}</div>}
              </div>
            )}

            {!autoRunning && (
              <Btn variant="outline" disabled={disabled || (setId === "custom" && !custom.length)} onClick={() => setConfirmAuto(true)}>
                Keep improving (up to {AUTO_MAX_ITERATIONS} times)
              </Btn>
            )}

            {runs.length > 0 && (
              <div>
                <SectionLabel>Earlier practice</SectionLabel>
                <div className="space-y-0.5">
                  {[...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 8).map((r) => (
                    <button
                      key={r.id} type="button" disabled={running || autoRunning}
                      onClick={async () => {
                        const g = await getTestRun(r.id);
                        if (g.ok && g.data?.testRun) dispatch({ type: "started", run: g.data.testRun });
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-white/[0.05] ${run?.id === r.id ? "bg-white/[0.05]" : ""}`}
                    >
                      <span className="w-16 text-white/55">Version {r.version}</span>
                      <span className="min-w-0 flex-1 text-white/80">{r.summary.passed} of {r.summary.total} right</span>
                      <span className="text-[11px] text-white/30">{cents(r.summary.costUsd)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmAuto && <ConfirmAuto cases={Math.max(1, caseCount)} perCase={perCase} onGo={() => void autoImprove()} onCancel={() => setConfirmAuto(false)} />}
    </aside>
  );
}
