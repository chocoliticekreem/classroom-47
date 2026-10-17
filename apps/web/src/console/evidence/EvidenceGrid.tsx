"use client";
// "Results" (PRD J0, the coverage shot): how the agent does across the WHOLE workload, not one
// case. Big honest numbers, a scorecard per case set, strengths and weaknesses per difficulty
// pattern, then every case with the judge's one-line reason. Real results only, read from
// GET /api/console/evidence; fields the API doesn't send yet are hidden or shown as "not recorded".
import { useMemo, useState } from "react";
import { cents, plainOutcome, scrubLeaks } from "../../ui/plain";
import { executeCase } from "../executions/ExecutionsView";
import { caseName } from "../executions/plainView";
import {
  Badge, Button, EmptyState, ErrorState, HeaderActions, IconPlay, Panel, SimulatedBadge, Skeleton, cx,
  formatDuration, useConsole,
} from "../ui";
import { DownloadResultsButton, EvidencePackButton } from "../export/Buttons";
import { useEvidence } from "../useApi";
import {
  PRACTICE_SET, byPattern, headline, normalizeRow, scorecard, segments, setLabel, strength, tableRows, why, words,
  type ResultRow, type Show, type Strength, type Tally,
} from "./coverage";
import { EMPTY_FILTER, filterRows, wasRun } from "./logic";

const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------
// Top numbers

function Big({ label, value, sub, tone }: { label: string; value: string | null; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-rv-card px-5 py-4">
      <div className="text-[13px] text-white/55">{label}</div>
      <div
        className={cx(
          "tabular mt-1 text-[40px] leading-[44px] font-semibold tracking-tight",
          value === null ? "text-white/25" : tone === "good" ? "text-rv-green" : tone === "bad" ? "text-rv-red" : "text-white",
        )}
      >
        {value ?? "–"}
      </div>
      <div className="mt-1 min-h-4 truncate text-[12px] text-white/45">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Scorecard by case set

const SEG = [
  { k: "right", cls: "bg-rv-green", label: "Right" },
  { k: "wrong", cls: "bg-rv-red", label: "Wrong" },
  { k: "unchecked", cls: "bg-white/35", label: "Not checked yet" },
  { k: "notRun", cls: "bg-white/[0.07]", label: "Not run" },
] as const;

function SetBar({ t, selected, onClick }: { t: Tally; selected: boolean; onClick: () => void }) {
  const s = segments(t);
  const rate = pct(t.rightRate);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "grid w-full grid-cols-[190px_1fr_64px_130px] items-center gap-4 rounded-md px-3 py-2.5 text-left",
        selected ? "bg-white/[0.07] ring-1 ring-rv-orange/50" : "hover:bg-white/[0.04]",
      )}
    >
      <span className="flex min-w-0 items-center gap-2 truncate text-[14px] text-white/90">
        {setLabel(t.key)}
        {t.key === "city" && <SimulatedBadge />}
      </span>
      <span className="flex h-3 overflow-hidden rounded-full bg-white/[0.07]" title={`${t.right} right · ${t.wrong} wrong · ${t.unchecked} not checked · ${t.notRun} not run`}>
        {SEG.map(({ k, cls }) => (s[k] > 0 ? <span key={k} className={cls} style={{ width: `${s[k] * 100}%` }} /> : null))}
      </span>
      <span className={cx("tabular text-right text-[18px] font-semibold", rate === null ? "text-white/25" : t.rightRate! >= 0.8 ? "text-rv-green" : t.rightRate! >= 0.5 ? "text-rv-amber" : "text-rv-red")}>
        {rate ?? "–"}
      </span>
      <span className="tabular truncate text-right text-[12px] text-white/45">
        {t.run === 0 ? `none of ${t.known} run` : `${t.right + t.wrong} checked · ${t.run}/${t.known} run`}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Difficulty patterns

const STRENGTH: Record<Strength, { cls: string; word: string }> = {
  strong: { cls: "border-rv-green/30 bg-rv-green/[0.08]", word: "Strong" },
  mixed: { cls: "border-rv-amber/30 bg-rv-amber/[0.08]", word: "Mixed" },
  weak: { cls: "border-rv-red/35 bg-rv-red/[0.09]", word: "Weak" },
  unknown: { cls: "border-white/[0.07] bg-white/[0.02]", word: "Not checked" },
};

function PatternCell({ t, selected, onClick }: { t: Tally; selected: boolean; onClick: () => void }) {
  const st = strength(t);
  const checked = t.right + t.wrong;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={STRENGTH[st].word}
      className={cx("min-w-0 rounded-md border px-3 py-2.5 text-left", STRENGTH[st].cls, selected && "ring-1 ring-rv-orange/60")}
    >
      <div className="truncate text-[13px] text-white/85">{words(t.key)}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={cx("tabular text-[20px] font-semibold", st === "unknown" ? "text-white/25" : st === "strong" ? "text-rv-green" : st === "mixed" ? "text-rv-amber" : "text-rv-red")}>
          {pct(t.rightRate) ?? "–"}
        </span>
        <span className="tabular truncate text-[11px] text-white/45">{checked ? `${t.right} of ${checked}` : `${t.run}/${t.known} run`}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Case table

function RightMark({ r }: { r: ResultRow }) {
  if (r.pass === null) return <span className="text-white/25" title={wasRun(r) ? "Not checked yet" : "Not run"}>–</span>;
  if (r.pass) return <span className="text-lg font-semibold text-rv-green" title="Right">✓</span>;
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className="text-lg leading-5 font-semibold text-rv-red" title="Wrong">✗</span>
      {r.critical && <Badge tone="red">Broke a rule</Badge>}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx("rounded-md px-2.5 py-1 text-[13px]", active ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

export default function EvidenceGrid() {
  const { navigate } = useConsole();
  const { data, error, loading, reload } = useEvidence({ pollMs: 15000 });
  const [set, setSet] = useState<string | null>(null);
  const [pattern, setPattern] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("run");
  const [q, setQ] = useState("");
  const [executing, setExecuting] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const rows = useMemo(() => (data?.rows ?? []).map(normalizeRow), [data]);
  const totals = data?.totals as Record<string, unknown> | undefined;
  const top = useMemo(() => headline(rows, totals?.criticalFailures ?? totals?.critical), [rows, totals]);
  const sets = useMemo(() => scorecard(rows), [rows]);
  const patterns = useMemo(() => byPattern(rows), [rows]);
  const patternsChecked = patterns.some((t) => t.right + t.wrong > 0);
  const [allPatterns, setAllPatterns] = useState(false);
  const visible = useMemo(() => {
    let rs = tableRows(rows, set, show);
    if (pattern) rs = rs.filter((r) => r.pattern === pattern);
    return q.trim() ? (filterRows(rs, { ...EMPTY_FILTER, q }) as ResultRow[]) : rs;
  }, [rows, set, show, pattern, q]);

  // "Run more cases" practises on the chosen set, else the first set (in the scorecard order) with cases left to run.
  const target = set && PRACTICE_SET[set] ? set : (sets.find((t) => PRACTICE_SET[t.key] && t.notRun > 0)?.key ?? "public");
  const runMore = () => navigate("workflows", { panel: "practice", set: PRACTICE_SET[target] ?? "quick", filter: pattern });

  const runOne = async (r: ResultRow) => {
    const key = `${r.dataset}/${r.caseId}`;
    setExecuting(key);
    setRunError(null);
    try {
      const ex = await executeCase({ caseId: r.caseId, dataset: r.dataset });
      navigate("executions", { id: ex.id });
    } catch (err) {
      setRunError(scrubLeaks((err as Error).message) || "That didn't work.");
      setExecuting(null);
    }
  };
  const open = (r: ResultRow) => {
    if (r.executionId) navigate("executions", { id: r.executionId });
  };

  const headerButton = (
    <HeaderActions>
      <Button variant="primary" icon={<IconPlay size={14} />} onClick={runMore}>
        Run more {setLabel(target).toLowerCase()}
      </Button>
    </HeaderActions>
  );

  if (loading && !data) {
    return (
      <div className="h-full overflow-auto bg-rv-canvas p-6">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] rounded-lg" />)}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-full overflow-auto bg-rv-canvas p-6">
        <div className="mx-auto max-w-xl"><ErrorState title="Couldn't load results" error={error ?? "Something went wrong."} onRetry={reload} /></div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="h-full bg-rv-canvas">
        <EmptyState title="No cases found">There are no cases to test yet. Add cases, then come back here.</EmptyState>
      </div>
    );
  }

  const checked = top.checked;
  const rightTone = top.rightRate === null ? undefined : top.rightRate >= 0.8 ? "good" : top.rightRate < 0.5 ? "bad" : undefined;
  const tiles: { label: string; value: string | null; sub?: string; tone?: "good" | "bad" }[] = [
    { label: "Cases run", value: top.run.toLocaleString("en-US"), sub: `of ${plural(top.known, "case")} we have` },
    {
      label: "Right",
      value: pct(top.rightRate),
      tone: rightTone,
      sub: checked ? `${top.right} of ${checked} checked` : top.run ? "None checked yet" : "Nothing run yet",
    },
  ];
  if (top.criticalReported) {
    tiles.push(
      top.critical === null
        ? { label: "Critical failures", value: null, sub: top.checked ? "Not recorded for these checks" : "Nothing checked yet" }
        : { label: "Critical failures", value: String(top.critical), tone: top.critical ? "bad" : "good", sub: top.critical ? "Broke a must-not rule" : "No rule broken" },
    );
  }
  tiles.push(
    { label: "Avg cost per case", value: top.avgCostUsd === null ? null : cents(top.avgCostUsd), sub: top.avgCostUsd === null ? "Not recorded" : undefined },
    { label: "Avg time per case", value: top.avgDurationMs === null ? null : formatDuration(top.avgDurationMs), sub: top.avgDurationMs === null ? "Not recorded" : undefined },
  );

  return (
    <div className="h-full overflow-auto bg-rv-canvas text-white">
      {headerButton}
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {/* 1. Big honest numbers */}
        <div className={cx("grid gap-3", tiles.length === 5 ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4")}>
          {tiles.map((t) => <Big key={t.label} {...t} />)}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DownloadResultsButton />
          <EvidencePackButton />
        </div>
        {top.run === 0 ? (
          <p className="text-[14px] text-white/60">Nothing has been run yet. Press <span className="text-white/85">Run more</span> to start.</p>
        ) : top.run < top.known || checked < top.run ? (
          <p className="text-[13px] text-white/45">
            {top.run < top.known && <>{plural(top.known - top.run, "case")} not run yet. </>}
            {checked < top.run && <>{plural(top.run - checked, "run")} not checked yet, so not counted in % right.</>}
          </p>
        ) : null}
        {error && <p className="text-[12px] text-rv-amber">Couldn&apos;t refresh. Showing the last results.</p>}

        {/* 2. Scorecard by case set */}
        <Panel
          title="By case set"
          subtitle="Click a set to see its cases"
          actions={
            <span className="hidden items-center gap-3 text-[11px] text-white/45 sm:flex">
              {SEG.map(({ k, cls, label }) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className={cx("h-2 w-2 rounded-full", cls)} />{label}</span>
              ))}
            </span>
          }
          bodyClassName="!p-2"
        >
          {sets.map((t) => (
            <SetBar key={t.key} t={t} selected={set === t.key} onClick={() => setSet((s) => (s === t.key ? null : t.key))} />
          ))}
        </Panel>

        {/* 3. By difficulty pattern (only when the API sends it) */}
        {patterns.length > 0 && (
          <Panel
            title="By difficulty"
            subtitle={patternsChecked ? "Weakest first. Click one to see its cases" : "None of these hard cases has been checked yet"}
            actions={
              !patternsChecked && (
                <button type="button" className="text-[12px] text-white/50 hover:text-white/80" onClick={() => setAllPatterns((v) => !v)}>
                  {allPatterns ? "Hide" : `Show all ${patterns.length}`}
                </button>
              )
            }
            bodyClassName={!patternsChecked && !allPatterns ? "hidden" : undefined}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {patterns.filter((t) => allPatterns || t.right + t.wrong > 0).map((t) => (
                <PatternCell key={t.key} t={t} selected={pattern === t.key} onClick={() => setPattern((p) => (p === t.key ? null : t.key))} />
              ))}
            </div>
            {patternsChecked && !allPatterns && patterns.some((t) => t.right + t.wrong === 0) && (
              <button type="button" className="mt-2 text-[12px] text-white/45 hover:text-white/80" onClick={() => setAllPatterns(true)}>
                + {patterns.filter((t) => t.right + t.wrong === 0).length} not checked yet
              </button>
            )}
          </Panel>
        )}

        {/* 4. Case table */}
        <Panel
          flush
          title={
            <span className="flex items-center gap-2">
              Cases
              {set && <Badge tone="orange">{setLabel(set)}</Badge>}
              {pattern && <Badge tone="orange">{words(pattern)}</Badge>}
              {(set || pattern) && (
                <button type="button" className="text-[12px] font-normal text-white/45 hover:text-white/80" onClick={() => { setSet(null); setPattern(null); }}>
                  Clear
                </button>
              )}
            </span>
          }
          actions={
            <div className="flex items-center gap-2">
              <div className="flex rounded-md bg-black/20 p-0.5">
                <Chip active={show === "run"} onClick={() => setShow("run")}>Run</Chip>
                <Chip active={show === "wrong"} onClick={() => setShow("wrong")}>Wrong</Chip>
                <Chip active={show === "all"} onClick={() => setShow("all")}>All</Chip>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                aria-label="Search cases"
                className="h-8 w-40 rounded-md border border-white/10 bg-black/20 px-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-rv-orange/60 focus:outline-none"
              />
            </div>
          }
        >
          {runError && <p className="px-4 pt-3 text-[13px] text-rv-red">{runError}</p>}
          {visible.length === 0 ? (
            <EmptyState compact title={show === "wrong" ? "Nothing wrong here" : show === "run" ? "No cases run here yet" : "No cases match"}>
              {show === "run" ? "Pick All to see every case, or run more." : null}
            </EmptyState>
          ) : (
            <table className="w-full min-w-[760px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-left text-[12px] text-white/45">
                  <th className="w-[30%] px-4 py-2 font-medium">Case</th>
                  <th className="w-[24%] px-4 py-2 font-medium">What we did</th>
                  <th className="w-[96px] px-2 py-2 text-center font-medium">Right?</th>
                  <th className="px-4 py-2 font-medium">Why</th>
                  <th className="w-[84px]" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const key = `${r.dataset}/${r.caseId}`;
                  const run = wasRun(r);
                  const reason = why(r);
                  return (
                    <tr
                      key={key}
                      tabIndex={r.executionId ? 0 : -1}
                      onClick={() => open(r)}
                      onKeyDown={(e) => { if (e.key === "Enter") open(r); }}
                      className={cx(
                        "group border-b border-white/[0.05] align-top text-[14px]",
                        r.executionId && "cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="truncate text-white/90" title={r.title ?? undefined}>{caseName(r.caseId, r.title)}</div>
                        {r.dataset === "city" && <div className="mt-0.5 flex items-center"><SimulatedBadge /></div>}
                      </td>
                      <td className="px-4 py-2.5">
                        {run ? (
                          <>
                            {r.decision ? <div className="text-white/85">{plainOutcome(r.decision)}</div> : <div className="text-rv-red">Didn&apos;t finish</div>}
                            {r.nextAction && <div className="truncate text-[12px] text-white/45" title={scrubLeaks(r.nextAction)}>{scrubLeaks(r.nextAction)}</div>}
                          </>
                        ) : (
                          <span className="text-white/35">Not run yet</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center"><RightMark r={r} /></td>
                      <td className="px-4 py-2.5 text-[13px]">
                        {reason ? (
                          <span className={cx("line-clamp-2", r.pass === false ? "text-white/80" : "text-white/60")} title={reason}>{reason}</span>
                        ) : (
                          <span className="text-white/25">{r.pass === null ? "" : "No reason recorded"}</span>
                        )}
                        {(r.costUsd !== null || r.durationMs !== null) && run && (
                          <div className="tabular mt-0.5 text-[11px] text-white/30">
                            {[cents(r.costUsd), r.durationMs !== null ? formatDuration(r.durationMs) : ""].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.executionId ? (
                          <span className="text-[13px] text-white/45 group-hover:text-rv-orange">Open →</span>
                        ) : (
                          <Button size="sm" disabled={executing !== null} onClick={(e) => { e.stopPropagation(); void runOne(r); }}>
                            {executing === key ? "Starting…" : "Run"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
