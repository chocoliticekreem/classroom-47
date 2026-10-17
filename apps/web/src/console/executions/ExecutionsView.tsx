"use client";
// "Case runs": plain list on the left (case name, status word, time), the selected run on the right.
// Result chips (with counts) and a search box filter the list. Polls every 1.5 s while anything is running.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConsoleApi, ExecutionRecord } from "../types";
import ExecutionDetail from "./ExecutionDetail";
import { plainDataset } from "../../ui/plain";
import {
  RESULT_CHIPS, anyRunning, chipCounts, datasetsOf, filterExecutions, fmtStarted, matchesChip, sortExecutions,
  type ExecFilter, type ExecutionSummary, type ResultChip,
} from "./logic";
import { caseName, statusTone, statusWord } from "./plainView";
import { useConsoleNav } from "./nav";
import { Badge, Button, SearchInput, Select, cx, getJson } from "./ui";

const POLL_MS = 1500;

type ListResp = ConsoleApi["GET /api/console/executions?limit&dataset"];
type DetailResp = ConsoleApi["GET /api/console/executions/:id"];
type ExecResp = ConsoleApi["POST /api/console/execute"];
type CasesResp = ConsoleApi["GET /api/console/cases?dataset&q"];

export async function executeCase(body: { caseId: string; dataset?: string; workflowId?: string }): Promise<ExecutionRecord> {
  const r = await getJson<ExecResp>("/api/console/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.execution;
}

function Row({ e, name, selected, onClick }: { e: ExecutionSummary; name: string; selected: boolean; onClick: () => void }) {
  const tone = statusTone(e);
  const color = { ok: "#3ecf8e", warn: "#f5b83d", info: "#6aa7ff", err: "#ff5c5c", muted: "#8b8b96", accent: "#ff6a1a" }[tone];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          "w-full border-l-2 px-4 py-3 text-left transition-colors",
          selected ? "border-[#ff6a1a] bg-white/[0.07]" : "border-transparent hover:bg-white/[0.04]",
        )}
      >
        <div className="truncate text-[14px] text-white/90" title={name}>{name}</div>
        <div className="mt-1 flex items-center gap-2 text-[13px]">
          <span className="font-medium" style={{ color }}>{statusWord(e)}</span>
          {e.simulated && <Badge tone="warn">Practice case</Badge>}
          <span className="ml-auto shrink-0 text-white/40" title={e.startedAt}>{fmtStarted(e.startedAt)}</span>
        </div>
      </button>
    </li>
  );
}

export default function ExecutionsView() {
  const { params, go } = useConsoleNav();
  const selectedId = params?.get("id") ?? null;

  const [list, setList] = useState<ExecutionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ExecFilter>({ status: "all", dataset: "all", q: "" });
  const [detail, setDetail] = useState<{ id: string; data: ExecutionRecord | null; error: string | null } | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [chip, setChip] = useState<ResultChip>("all");
  const [titles, setTitles] = useState<Map<string, string>>(new Map());

  // Case titles, so the list can show names instead of ids. Optional: ids are the fallback.
  useEffect(() => {
    let alive = true;
    getJson<CasesResp>("/api/console/cases").then(
      (r) => {
        if (!alive) return;
        const m = new Map<string, string>();
        for (const c of r.cases) if (c.title) m.set(`${c.dataset}/${c.id}`, c.title).set(c.id, c.title);
        setTitles(m);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  const nameOf = useCallback(
    (e: { caseId: string; dataset: string }) => caseName(e.caseId, titles.get(`${e.dataset}/${e.caseId}`) ?? titles.get(e.caseId)),
    [titles],
  );

  const loadList = useCallback(async () => {
    try {
      const r = await getJson<ListResp>("/api/console/executions?limit=500");
      setList(r.executions);
      setListError(null);
    } catch (err) {
      setListError((err as Error).message);
      setList((l) => l ?? []);
    }
  }, []);

  // Search and the case set narrow the list first; the chip counts are taken from that, then the chip applies.
  const searched = useMemo(() => {
    const q = (filter.q ?? "").trim().toLowerCase();
    const base = filterExecutions(list ?? [], { ...filter, q: "" });
    return q ? base.filter((e) => `${nameOf(e)} ${e.caseId} ${statusWord(e)}`.toLowerCase().includes(q)) : base;
  }, [list, filter, nameOf]);
  const counts = useMemo(() => chipCounts(searched), [searched]);
  const rows = useMemo(() => sortExecutions(searched.filter((e) => matchesChip(e, chip))), [searched, chip]);
  const datasets = useMemo(() => datasetsOf(list ?? []), [list]);
  const activeId = selectedId ?? rows[0]?.id ?? null;

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await getJson<DetailResp>(`/api/console/executions/${encodeURIComponent(id)}`);
      setDetail({ id, data: r.execution, error: null });
    } catch (err) {
      setDetail((d) => ({ id, data: d?.id === id ? d.data : null, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (activeId) void loadDetail(activeId);
  }, [activeId, loadDetail]);

  const current = detail && detail.id === activeId ? detail : null;
  const listRunning = anyRunning(list ?? []);
  const detailRunning = current?.data?.status === "running";

  // "Run again" waits for the whole run, so follow the new row as soon as it shows up as working:
  // the detail then shows the live checklist and plays the run back when it finishes.
  const [follow, setFollow] = useState<{ caseId: string; since: string } | null>(null);
  const followed = follow ? sortExecutions(list ?? []).find((x) => x.caseId === follow.caseId && x.startedAt >= follow.since) : undefined;
  useEffect(() => {
    if (followed && followed.id !== selectedId) go("executions", { id: followed.id }, true);
  }, [followed, selectedId, go]);

  useEffect(() => {
    if (!listRunning && !detailRunning && !rerunning) return;
    const t = setInterval(() => {
      void loadList();
      if (activeId) void loadDetail(activeId);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [listRunning, detailRunning, rerunning, activeId, loadList, loadDetail]);

  const rerun = async (e: ExecutionRecord) => {
    setRerunning(true);
    setRerunError(null);
    setFollow({ caseId: e.caseId, since: new Date(Date.now() - 5000).toISOString() });
    try {
      const ex = await executeCase({ caseId: e.caseId, dataset: e.dataset, workflowId: e.workflowId });
      setDetail({ id: ex.id, data: ex, error: null });
      go("executions", { id: ex.id }, true);
      void loadList();
    } catch (err) {
      setRerunError((err as Error).message);
    } finally {
      setRerunning(false);
      setFollow(null);
    }
  };

  const current_ = current?.data ?? null;
  return (
    <div className="flex h-full min-h-0 w-full bg-[#1f1f23] text-white">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-white/10 xl:w-[360px]">
        <div className="shrink-0 space-y-2 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Case runs</h2>
            {listRunning && <span className="text-xs text-[#ff6a1a]">Working…</span>}
            <Button className="ml-auto !px-2 !py-1" onClick={() => void loadList()} title="Refresh">
              Refresh
            </Button>
          </div>
          <div className="flex gap-2">
            <SearchInput value={filter.q ?? ""} onChange={(q) => setFilter((f) => ({ ...f, q }))} placeholder="Find a case" className="flex-1 !py-1.5 !text-[13px]" />
            {datasets.length > 1 && (
              <Select
                label="Cases"
                value={filter.dataset}
                onChange={(dataset) => setFilter((f) => ({ ...f, dataset }))}
                options={[{ value: "all", label: "All cases" }, ...datasets.map((d) => ({ value: d, label: plainDataset(d) }))]}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
            {RESULT_CHIPS.map((c) => {
              const on = chip === c.id;
              const n = counts[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChip(c.id)}
                  disabled={!on && n === 0 && c.id !== "all"}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors disabled:cursor-default disabled:opacity-35",
                    on ? "bg-[#ff6a1a] text-white" : "bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {c.label}
                  <span className={cx("tabular-nums", on ? "text-white/80" : "text-white/40")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && <p className="m-3 rounded bg-[#ff5c5c]/10 p-2 text-xs text-[#ff5c5c]">Couldn&apos;t load case runs.</p>}
          {list === null ? (
            <p className="p-4 text-sm text-white/40">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm leading-relaxed text-white/45">
              {list.length === 0 ? "No case runs yet. Open Results and press Run on a case." : "No case runs match."}
              {list.length > 0 && (chip !== "all" || filter.q) && (
                <button
                  type="button"
                  onClick={() => {
                    setChip("all");
                    setFilter((f) => ({ ...f, q: "" }));
                  }}
                  className="ml-1 text-[#ff6a1a] hover:underline"
                >
                  Show all
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((e) => (
                <Row key={e.id} e={e} name={nameOf(e)} selected={e.id === activeId} onClick={() => go("executions", { id: e.id }, true)} />
              ))}
            </ul>
          )}
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <ExecutionDetail
          execution={current_}
          title={current_ ? titles.get(`${current_.dataset}/${current_.caseId}`) ?? titles.get(current_.caseId) ?? null : null}
          loading={!!activeId && !current}
          error={rerunError ?? current?.error ?? null}
          onRerun={rerun}
          rerunning={rerunning}
          onOpen={(id) => {
            go("executions", { id });
            void loadList();
          }}
        />
      </section>
    </div>
  );
}
