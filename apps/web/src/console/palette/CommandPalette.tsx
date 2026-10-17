"use client";
// ⌘K / Ctrl+K command palette. Keyboard first: type to fuzzy-search, ↑/↓ to move, Enter to run,
// Esc to close. Commands come from ./commands (pure registry); this file wires the side effects
// (run a case, start practice, talk to the city) and the live lists (cases, recent runs, sets).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CITY_CHANNEL } from "../../world/controlChannel";
import { consoleApi, useApi, useCases, withQuery, type ApiResponse } from "../useApi";
import { startTestRun, type ScenarioSetInfo } from "../workflows/api";
import { cx, useConsole, IconCity, IconPlay, IconSearch, IconWorkflow, IconExecutions, IconChevronRight, Spinner } from "../ui";
import { buildCommands, searchCommands, shortSetLabel, type CityTrigger, type Command, type CommandGroup, type PaletteActions } from "./commands";
import { IconBolt, IconNewCase } from "./icons";
import { toast } from "../ui/Toast";
import type { FuzzyMatch } from "./fuzzy";

/** Global ⌘K / Ctrl+K toggle. */
export function usePaletteHotkey(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

/** Post a trigger to the 3D city (if it's open in another tab of this browser). */
function sendCityTrigger(event: CityTrigger) {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(CITY_CHANNEL);
  try {
    ch.postMessage({ type: "inject", event });
  } finally {
    ch.close();
  }
}

const GROUP_ICON: Record<CommandGroup, (p: { size?: number }) => ReactNode> = {
  "Go to": IconChevronRight,
  Actions: IconNewCase,
  "Run a case": IconPlay,
  "Case runs": IconExecutions,
  Practice: IconWorkflow,
  City: IconCity,
};

export default function CommandPalette({ open, onClose, onOpenDecisions }: { open: boolean; onClose: () => void; onOpenDecisions: () => void }) {
  if (!open) return null;
  return <PaletteDialog onClose={onClose} onOpenDecisions={onOpenDecisions} />;
}

function PaletteDialog({ onClose, onOpenDecisions }: { onClose: () => void; onOpenDecisions: () => void }) {
  const { navigate, workflowId } = useConsole();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const cases = useCases({}, true);
  const runs = useApi<ApiResponse<"GET /api/console/executions?limit&dataset">>(withQuery("/api/console/executions", { limit: 60 }));
  const sets = useApi<{ sets: ScenarioSetInfo[] }>("/api/console/scenario-sets");

  const actions = useMemo<PaletteActions>(
    () => ({
      navigate: (tab, params) => {
        navigate(tab, params);
        onClose();
      },
      openDecisions: () => {
        onClose();
        onOpenDecisions();
      },
      runCase: async (c) => {
        const res = await consoleApi.execute({ caseId: c.id, dataset: c.dataset, workflowId: workflowId ?? undefined });
        navigate("executions", { id: res.execution.id });
        onClose();
        toast.success(`Case ${c.id} sent to the agent`);
      },
      practice: async (s) => {
        if (!workflowId) return;
        await startTestRun({ workflowId, set: s.id as ScenarioSetInfo["id"], limit: 5 });
        navigate("workflows", { workflow: workflowId });
        onClose();
        toast.success(`Practice started on ${shortSetLabel(s.label)}`, { description: "Results show up in Practice." });
      },
      openCity: () => {
        window.open("/city", "_blank", "noopener");
        onClose();
      },
      trigger: (event) => {
        sendCityTrigger(event);
        navigate("city");
        onClose();
        toast.info(event === "motorcade" ? "Motorcade sent to the city" : "Truck crash sent to the city", {
          description: "Shows up if the city is open in this browser.",
        });
      },
    }),
    [navigate, onClose, onOpenDecisions, workflowId],
  );

  const commands = useMemo(
    () =>
      buildCommands(actions, {
        cases: cases.data?.cases,
        runs: runs.data?.executions,
        sets: sets.data?.sets,
        canPractice: !!workflowId,
      }),
    [actions, cases.data, runs.data, sets.data, workflowId],
  );
  const results = useMemo(() => searchCommands(query, commands), [query, commands]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const runCommand = useCallback(
    async (cmd: Command | undefined) => {
      if (!cmd || pending) return;
      setError(null);
      setPending(cmd.id);
      try {
        await cmd.run();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    const n = results.length;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (n) setActive((current + 1) % n);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (n) setActive((current - 1 + n) % n);
    } else if (e.key === "Home" && e.ctrlKey) {
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      setActive(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runCommand(results[current]?.item);
    }
  }

  const loadingLists = query.trim() !== "" && (cases.loading || runs.loading);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-[min(560px,72vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#25252b] shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <IconSearch size={17} className="shrink-0 text-white/40" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Type a command, a case or a page…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/35"
          />
          {(pending || loadingLists) && <Spinner />}
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] text-white/45">Esc</kbd>
        </div>

        {error && <div className="border-b border-white/[0.06] bg-rv-red/10 px-4 py-2 text-[13px] text-rv-red">{error}</div>}

        <ul ref={list} id={listId} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-white/45">
              {loadingLists ? "Looking…" : "Nothing matches. Try a case number like 024."}
            </li>
          )}
          {results.map(({ item, match }, i) => {
            const Icon = item.id.startsWith("trigger:") ? IconBolt : GROUP_ICON[item.group];
            const on = i === current;
            return (
              <li
                key={item.id}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={on}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => void runCommand(item)}
                className={cx(
                  "flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-[14px]",
                  on ? "bg-white/[0.08] text-white" : "text-white/75",
                )}
              >
                <span className={cx("shrink-0", on ? "text-rv-orange" : "text-white/40")}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0 shrink truncate">
                  <Highlight text={item.title} match={match} />
                </span>
                {item.hint && <span className="ml-auto min-w-0 truncate pl-3 text-[12px] text-white/40">{item.hint}</span>}
                <span className={cx("shrink-0 text-[11px] text-white/30", !item.hint && "ml-auto")}>
                  {pending === item.id ? "Starting…" : item.group}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-white/[0.08] px-4 py-2 text-[11px] text-white/40">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
          <span><Kbd>Enter</Kbd> run</span>
          <span><Kbd>Esc</Kbd> close</span>
          <span className="ml-auto"><Kbd>⌘</Kbd> <Kbd>K</Kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/15 px-1 py-px font-sans text-[10px] text-white/55">{children}</kbd>;
}

function Highlight({ text, match }: { text: string; match: FuzzyMatch }) {
  if (!match.ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of match.ranges) {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={s} className="bg-transparent font-semibold text-rv-orange">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
