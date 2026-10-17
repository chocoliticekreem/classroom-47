"use client";
// Reality Test page: unseen cases run once through the frozen agent. Shows a runner's output folder
// read-only: progress while it runs, then the results. Two sources: the real run in ANSWERS/, and
// "Try runs" (runs/reality-try/<stamp>/ANSWERS), small real runs of the same command on a few of the
// organisers' raw practice cases, started from here at any time.
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconInbox,
  IconPlay,
  KpiCard,
  Meter,
  Panel,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
  cx,
  formatDuration,
  useConsole,
} from "../ui";
import { cents } from "../../ui/plain";
import { postJson, useApi } from "../useApi";
import CaseDetail from "./CaseDetail";
import FilesView from "./FilesView";
import UploadArea, { type StagedUpload } from "./UploadArea";
import { TONE_CLASS, TileStatusDot } from "./tone";
import {
  LEGEND,
  STATUS_LABEL,
  STATUS_TONE,
  caseStatus,
  caseTitle,
  gridTiles,
  headline,
  runPhase,
  sortCases,
  tally,
  tryCostLine,
  type Phase,
  type RealityCase,
  type RealityResponse,
} from "./logic";

interface TryRun {
  stamp: string;
  n: number;
  startedAt: string;
  status: "running" | "done" | "failed";
  exitCode: number | null;
  estimateCents: number;
}

interface TryList {
  runs: TryRun[];
  available: number;
  max: number;
  defaultN: number;
  centsPerCase: number;
  budgetUsd?: number;
  budgetMaxUsd?: number;
  uploadMaxBytes?: number;
  uploadMaxCases?: number;
}

type Source = "answers" | "try";

export default function RealityView() {
  const { params, setParams } = useConsole();
  const openId = params.get("case");
  const source: Source = params.get("src") === "try" ? "try" : "answers";
  const tries = useApi<TryList>("/api/console/reality/try", { pollMs: 3000 });
  const latestTry = tries.data?.runs?.[0];
  const runStamp = params.get("run") ?? latestTry?.stamp ?? null;
  const tryRun = tries.data?.runs?.find((r) => r.stamp === runStamp) ?? null;
  const query = source === "try" && runStamp ? `?source=try&run=${encodeURIComponent(runStamp)}` : "";
  // Poll every 3 s so cases appear as their answers are written.
  const probe = useApi<RealityResponse>(source === "try" && !runStamp ? null : `/api/console/reality${query}`, { pollMs: 3000 });
  const data = probe.data && Array.isArray(probe.data.cases) ? probe.data : undefined;
  const basePhase = runPhase(data);
  const phase: Phase = source === "try" && tryRun?.status === "running" ? "running" : basePhase;
  const t = useMemo(() => tally(data), [data]);
  const cases = useMemo(() => sortCases(data?.cases ?? []), [data]);
  const open = openId ? cases.find((c) => c.caseId === openId) : undefined;
  const root = source === "try" && runStamp ? `runs/reality-try/${runStamp}/ANSWERS` : "ANSWERS";

  if (open) return <CaseDetail c={open} query={query} root={root} onBack={() => setParams({ case: null })} />;

  const tryAny = () => setParams({ src: "try", run: null, case: null });
  const view: "files" | "cases" = params.get("view") === "files" ? "files" : "cases";

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-rv-title font-semibold text-white">Reality Test</h1>
          <p className="mt-1 text-[13px] text-white/55">
            {source === "answers"
              ? "Unseen cases, run once through the agent. These are the files the judges read."
              : "Small real runs of the same command on a few practice cases. Not part of the submission."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SourceSwitch source={source} onChange={(src) => setParams({ src: src === "try" ? "try" : null, run: null, case: null, view: src === "answers" ? "files" : view })} />
          <Badge tone="neutral" title="Shown exactly as written by the run. Nothing here can change them.">
            Read-only
          </Badge>
        </div>
      </header>

      {source === "try" && (
        <TryPanel list={tries.data} current={tryRun} onPick={(stamp) => setParams({ run: stamp, case: null })} />
      )}

      {source === "try" && !runStamp ? null : probe.loading && !data ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : phase === "waiting" ? (
        source === "answers" ? (
          <NoRun onTry={tryAny} error={probe.error && probe.error !== "This isn't ready yet." ? probe.error : undefined} />
        ) : (
          <Panel>
            <EmptyState compact title={tryRun?.status === "failed" ? "This try run stopped without answers" : "Starting"}>
              {tryRun?.status === "failed"
                ? `The runner exited${tryRun.exitCode !== null ? ` with code ${tryRun.exitCode}` : ""}. Its output is in runs/reality-try/${tryRun.stamp}/console.log.`
                : "Each case shows up here as soon as its answer is written."}
            </EmptyState>
          </Panel>
        )
      ) : (
        <>
          {phase === "running" ? <Progress done={t.done} total={t.total} /> : <Summary t={t} />}
          <div className="flex items-center gap-3">
            <ViewSwitch view={view} onChange={(v) => setParams({ view: v === "files" ? "files" : null })} />
            <button type="button" onClick={() => setParams({ view: "files" })} className="font-mono text-[12px] text-white/45 hover:text-white/80" title="Browse the output folder">
              {root}/
            </button>
          </div>
          {view === "files" ? <FilesView query={query} cases={cases} /> : <>
          <Panel
            title={phase === "running" ? "Cases" : `All ${t.total} cases`}
            actions={<Legend />}
          >
            <TileGrid cases={cases} total={t.total} onOpen={(id) => setParams({ case: id })} />
          </Panel>
          <CaseTable cases={cases.filter((c) => caseStatus(c) !== "working")} onOpen={(id) => setParams({ case: id })} />
          </>}
        </>
      )}
    </div>
    </div>
  );
}

function SourceSwitch({ source, onChange }: { source: Source; onChange: (s: Source) => void }) {
  const opts: [Source, string][] = [["answers", "Reality Test (ANSWERS/)"], ["try", "Try runs"]];
  return (
    <span className="inline-flex rounded-md border border-white/[0.08] p-0.5" role="tablist">
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={source === k}
          onClick={() => onChange(k)}
          className={cx(
            "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
            source === k ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function ViewSwitch({ view, onChange }: { view: "files" | "cases"; onChange: (v: "files" | "cases") => void }) {
  const opts: ["files" | "cases", string][] = [["files", "Files"], ["cases", "Cases"]];
  return (
    <span className="inline-flex rounded-md border border-white/[0.08] p-0.5" role="tablist" aria-label="Results view">
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={view === k}
          onClick={() => onChange(k)}
          className={cx(
            "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
            view === k ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function NoRun({ onTry, error }: { onTry: () => void; error?: string }) {
  return (
    <Panel>
      <EmptyState
        icon={<IconInbox size={20} />}
        title="No Reality Test run yet"
        action={<Button variant="primary" icon={<IconPlay size={13} />} onClick={onTry}>Try it now</Button>}
      >
        <p>Each case shows up here as soon as its answer is written to ANSWERS/. To see it work now, run the real agent on a few practice cases.</p>
        {error && <p className="mt-3 text-[12px] text-rv-red/80">{error}</p>}
      </EmptyState>
    </Panel>
  );
}

function TryPanel({ list, current, onPick }: { list: TryList | undefined; current: TryRun | null; onPick: (stamp: string) => void }) {
  const max = list?.max ?? 10;
  const budgetMax = list?.budgetMaxUsd ?? 5;
  const [mode, setMode] = useState<"practice" | "upload">("practice");
  const [n, setN] = useState(list?.defaultN ?? 3);
  const [budget, setBudget] = useState(list?.budgetUsd ?? 1);
  const [staged, setStaged] = useState<StagedUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = list?.runs.some((r) => r.status === "running") ?? false;
  const count = mode === "upload" ? (staged?.cases.length ?? 0) : n;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "upload" ? { upload: staged?.id, budget } : { n, budget };
      const res = await postJson<{ run: TryRun }>("/api/console/reality/try", body);
      if (mode === "upload") setStaged(null);
      onPick(res.run.stamp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const tab = (k: "practice" | "upload", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === k}
      onClick={() => setMode(k)}
      className={cx(
        "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
        mode === k ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80",
      )}
    >
      {label}
    </button>
  );
  return (
    <Panel
      title="Try it now"
      subtitle={mode === "practice"
        ? "Picks practice cases from the organisers' Delivery folder, renames them 1..N, and runs npm run reality on them. Paid: each case is a real agent run."
        : "Your own case data, renamed 1..N, through the same npm run reality command. Paid: each case is a real agent run."}
      actions={<span className="inline-flex rounded-md border border-white/[0.08] p-0.5" role="tablist">{tab("practice", "Practice cases")}{tab("upload", "Upload cases")}</span>}
    >
      {mode === "upload" && (
        <div className="mb-3">
          <UploadArea maxBytes={list?.uploadMaxBytes ?? 50 * 1024 * 1024} staged={staged} onStaged={setStaged} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {mode === "practice" && (
          <label className="flex items-center gap-2 text-[13px] text-white/70">
            Cases
            <input
              type="number"
              min={1}
              max={max}
              value={n}
              onChange={(e) => setN(Math.min(max, Math.max(1, Math.round(Number(e.target.value) || 1))))}
              className="w-16 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-white tabular"
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-[13px] text-white/70" title="Passed as --budget-usd. The run hands remaining cases to a person once it is spent.">
          Budget $
          <input
            type="number"
            min={0.1}
            max={budgetMax}
            step={0.5}
            value={budget}
            onChange={(e) => setBudget(Math.min(budgetMax, Math.max(0.1, Number(e.target.value) || 1)))}
            className="w-16 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-white tabular"
          />
        </label>
        {count > 0 && <span className="text-[13px] text-white/60 tabular">{tryCostLine(count, list?.centsPerCase ?? 5)}</span>}
        <Button
          variant="primary"
          icon={<IconPlay size={13} />}
          loading={busy}
          disabled={running || (mode === "practice" ? !list?.available : !staged)}
          onClick={start}
        >
          {running ? "A try run is going" : mode === "upload" ? "Run" : "Try it now"}
        </Button>
        {list && list.runs.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-white/50">
            Run
            <select
              value={current?.stamp ?? ""}
              onChange={(e) => onPick(e.target.value)}
              className="rounded-md border border-white/[0.1] bg-rv-card px-2 py-1 text-white/80"
            >
              {list.runs.map((r) => (
                <option key={r.stamp} value={r.stamp}>
                  {r.stamp} · {r.n} cases · {r.status}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {count > 0 && (count * (list?.centsPerCase ?? 5)) / 100 > budget && (
        <p className="mt-2 text-[12px] text-rv-amber/80">The estimate is over the budget: cases left when it runs out are handed to a person without analysis.</p>
      )}
      {error && <p className="mt-2 text-[12px] text-rv-red/80">{error}</p>}
      {list && list.runs.length === 0 && <p className="mt-2 text-[12px] text-white/45">No try runs yet.</p>}
    </Panel>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <Panel>
      <div className="flex items-baseline gap-3">
        <span className="tabular text-rv-big font-semibold text-white">{done}</span>
        <span className="text-[15px] text-white/60">of {total} done</span>
        <span className="ml-auto flex items-center gap-2 text-[12px] text-white/45">
          <span className="rv-pulse inline-block h-2 w-2 rounded-full bg-rv-blue" />
          Running now
        </span>
      </div>
      <Meter ratio={total ? done / total : null} tone="green" className="mt-3" />
    </Panel>
  );
}

function Summary({ t }: { t: ReturnType<typeof tally> }) {
  const cost = cents(t.costUsd);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Handled" value={t.handled} sub="Sent, or nothing needed" tone={t.handled ? "good" : "default"} />
      <KpiCard
        label="Handed to a person"
        value={t.person}
        sub={t.byStatus.stopped ? `${t.byStatus.stopped} stopped by the safety check` : "Needs a person"}
        tone={t.person ? "warn" : "default"}
      />
      <KpiCard label="Asked for info" value={t.asked} sub="Asked a question first" />
      <KpiCard
        label="Failed"
        value={t.failed}
        sub={cost ? `${t.total} cases · ${cost} in total` : `${t.total} cases`}
        tone={t.failed ? "bad" : "default"}
      />
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden flex-wrap items-center gap-3 text-[11px] text-white/55 sm:flex">
      {LEGEND.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <TileStatusDot status={s} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

function TileGrid({ cases, total, onOpen }: { cases: RealityCase[]; total: number; onOpen: (id: string) => void }) {
  const tiles = gridTiles(cases, total);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
      {tiles.map((tile) => {
        const clickable = tile.caseId !== null && tile.status !== "pending" && tile.status !== "working";
        const label = tile.status === "pending" ? "Not started" : STATUS_LABEL[tile.status];
        const cls =
          tile.status === "pending"
            ? "border border-dashed border-white/10 text-white/25"
            : tile.status === "working"
              ? "rv-pulse bg-white/[0.06] text-white/60 ring-1 ring-white/15 ring-inset"
              : TONE_CLASS[STATUS_TONE[tile.status]];
        return (
          <button
            key={tile.key}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onOpen(tile.caseId!) : undefined}
            title={`${tile.caseId ?? `Case ${tile.label}`}: ${label}`}
            aria-label={`${tile.caseId ?? `Case ${tile.label}`}: ${label}`}
            className={cx(
              "tabular flex h-11 items-center justify-center rounded-md text-[12px] font-medium transition-colors",
              cls,
              clickable ? "cursor-pointer hover:brightness-125" : "cursor-default",
            )}
          >
            {tile.label}
          </button>
        );
      })}
    </div>
  );
}

function CaseTable({ cases, onOpen }: { cases: RealityCase[]; onOpen: (id: string) => void }) {
  if (!cases.length) return null;
  return (
    <Panel title="What the agent decided" subtitle="Click a case to read its answer file." flush>
      <div className="max-h-[60vh] overflow-auto">
        <Table>
          <thead>
            <tr>
              <Th className="w-12">#</Th>
              <Th>Case</Th>
              <Th>Result</Th>
              <Th>What it did</Th>
              <Th align="right">Time</Th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const s = caseStatus(c);
              return (
                <Tr key={c.caseId} onClick={() => onOpen(c.caseId)}>
                  <Td muted className="tabular">{String(c.n)}</Td>
                  <Td className="max-w-[16rem]">
                    <div className="truncate">{caseTitle(c)}</div>
                    <div className="truncate text-[11px] text-white/35">{c.caseId}</div>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s]} dot>{STATUS_LABEL[s]}</Badge>
                  </Td>
                  <Td className="max-w-[28rem]">
                    <div className="line-clamp-2 text-white/75">{headline(c)}</div>
                  </Td>
                  <Td align="right" muted>{formatDuration(c.durationMs)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
}
