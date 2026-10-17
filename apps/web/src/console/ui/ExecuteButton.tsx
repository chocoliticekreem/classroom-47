"use client";
// "Run a case" primary button with a case picker. POSTs /api/console/execute and calls
// onExecuted with the new run (default: open it in the Case runs tab).
import { useEffect, useId, useRef, useState } from "react";
import { consoleApi, useAction, useCases } from "../useApi";
import type { ExecutionRecord } from "../types";
import { Button } from "./Button";
import { useConsole } from "./context";
import { ErrorState, Spinner } from "./Feedback";
import { IconChevronDown, IconPlay } from "./icons";
import { cx } from "./cx";

export function ExecuteButton({
  label = "Run a case",
  defaultCaseId,
  onExecuted,
}: {
  label?: string;
  defaultCaseId?: string;
  onExecuted?: (execution: ExecutionRecord) => void;
}) {
  const { navigate, workflowId } = useConsole();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(defaultCaseId ?? null);
  const cases = useCases({ q: query || null }, open);
  const exec = useAction(consoleApi.execute);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = cases.data?.cases ?? [];
  const pickedCase = list.find((c) => c.id === picked);

  async function run() {
    if (!picked) return;
    const res = await exec.run({
      caseId: picked,
      dataset: pickedCase?.dataset,
      workflowId: workflowId ?? undefined,
    });
    if (!res) return;
    setOpen(false);
    if (onExecuted) onExecuted(res.execution);
    else navigate("executions", { id: res.execution.id });
  }

  return (
    <div ref={root} className="relative">
      <Button
        variant="primary"
        icon={<IconPlay size={13} />}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        loading={exec.pending}
      >
        {label}
        <IconChevronDown size={14} className="-mr-1 opacity-80" />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick a case to run"
          className="absolute top-full right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-lg border border-white/10 bg-rv-panel shadow-lg shadow-black/30"
        >
          <div className="border-b border-white/[0.07] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a case…"
              aria-controls={listId}
              className="h-8 w-full rounded-md border border-white/10 bg-rv-canvas px-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-rv-orange/60 focus:outline-none"
            />
          </div>
          <div id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {cases.loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-white/50">
                <Spinner size={12} /> Loading cases…
              </div>
            )}
            {cases.error && !cases.data && <ErrorState compact error={cases.error} onRetry={cases.reload} />}
            {!cases.loading && cases.data && list.length === 0 && (
              <div className="px-3 py-3 text-xs text-white/50">No cases match.</div>
            )}
            {list.map((c) => (
              <button
                key={`${c.dataset}/${c.id}`}
                type="button"
                role="option"
                aria-selected={picked === c.id}
                onClick={() => setPicked(c.id)}
                onDoubleClick={() => {
                  setPicked(c.id);
                  void run();
                }}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                  picked === c.id ? "bg-rv-orange/12 text-white" : "text-white/75 hover:bg-white/[0.04]",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{c.title ? stripCaseNo(c.title) : c.id}</span>
                <span className="shrink-0 text-[11px] text-white/30">{c.id}</span>
              </button>
            ))}
          </div>
          {exec.error && <ErrorState compact title="That case didn't start" error={exec.error} />}
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2">
            <span className="truncate text-xs text-white/45">
              {picked ? (pickedCase?.title ? stripCaseNo(pickedCase.title) : picked) : "Pick a case"}
            </span>
            <Button size="sm" variant="primary" disabled={!picked} loading={exec.pending} onClick={run}>
              Run
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Case 003: Driver cannot access…" -> "Driver cannot access…". */
export function stripCaseNo(title: string): string {
  return title.replace(/^case\s*[\w-]+\s*:\s*/i, "");
}
