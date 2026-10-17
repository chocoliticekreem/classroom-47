"use client";
// The decision card on a case run, made answerable: pick an option, confirm with your name, and the
// agent runs the case again with that choice (POST /api/console/execute, parentExecutionId +
// humanDecision). When it finishes, the new case run opens.
import { useEffect, useRef, useState } from "react";
import { decisionRerunBody, NAME_KEY, savedName, saveName } from "../decisionRerun";
import type { DecisionCard, ExecutionRecord } from "../types";
import { useDecisionRerun } from "../useDecisionRerun";
import { DecisionCardView } from "./Timeline";
import { Button } from "./ui";

const TONE = { ok: "text-[#3ecf8e]", warn: "text-[#f5b83d]", err: "text-[#ff5c5c]" } as const;

export default function DecideRerun({ execution, card, onOpen }: {
  execution: ExecutionRecord;
  card: DecisionCard;
  onOpen: (executionId: string) => void;
}) {
  const { state, pick, cancel, run } = useDecisionRerun((ex) => onOpen(ex.id));
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const open = !card.chosen && (card.options?.length ?? 0) > 0 && execution.status === "success";
  const picked = state.phase === "idle" ? null : state.option.id;

  useEffect(() => {
    if (state.phase !== "confirm") return;
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [state.phase]);

  function choose(o: { id: string }) {
    // The card's own label goes to the agent (the tile shows a cleaned-up copy).
    const raw = card.options.find((x) => x.id === o.id);
    if (!raw) return;
    setName((n) => n || savedName());
    pick({ id: raw.id, label: raw.label });
  }

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (state.phase !== "confirm" && !(state.phase === "error" && state.canRetry)) return;
    if (!name.trim()) return;
    saveName(name);
    void run(decisionRerunBody({
      parentExecutionId: execution.id, caseId: execution.caseId, dataset: execution.dataset, workflowId: execution.workflowId,
      option: state.option, person: name,
    }));
  }

  return (
    <div className="space-y-3">
      <DecisionCardView card={card} onChoose={open ? choose : undefined} picked={picked} />
      {(state.phase === "confirm" || (state.phase === "error" && state.canRetry)) && (
        <form
          onSubmit={confirm}
          role="dialog"
          aria-label="Confirm your choice"
          onKeyDown={(e) => { if (e.key === "Escape" && state.phase === "confirm") cancel(); }}
          className="rounded-xl border border-[#ff6a1a]/50 bg-[#2a2a30] p-4"
        >
          <p className="text-[15px] text-white">
            Run this case again with <span className="font-semibold">&ldquo;{state.option.label}&rdquo;</span>?
          </p>
          {state.phase === "error" && <p className="mt-1 text-sm text-[#ff5c5c]" role="alert">{state.message}</p>}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-white/50">
              Your name
              <input
                ref={nameRef}
                name={NAME_KEY}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoComplete="name"
                required
                className="rounded-md border border-white/15 bg-[#1f1f23] px-3 py-2 text-sm text-white outline-none focus:border-[#ff6a1a]"
              />
            </label>
            {state.phase === "confirm" && <Button className="!px-4 !py-2 !text-sm" onClick={cancel}>Cancel</Button>}
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-[#ff6a1a] px-4 py-2 text-sm font-medium text-white hover:bg-[#ff7d38] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.phase === "error" ? "Try again" : "Run again"}
            </button>
          </div>
        </form>
      )}
      {state.phase === "running" && (
        <p className="rounded-xl border border-white/10 bg-[#2a2a30] p-4 text-[15px] text-white/85" role="status">
          Running again with your choice… <span className="text-white/45">This can take a minute or two.</span>
        </p>
      )}
      {state.phase === "error" && !state.canRetry && (
        <p className="rounded-xl border border-[#ff5c5c]/40 bg-[#2a2a30] p-4 text-[15px] text-[#ff5c5c]" role="alert">{state.message}</p>
      )}
      {state.phase === "done" && (
        <p className="rounded-xl border border-white/10 bg-[#2a2a30] p-4 text-[15px]" role="status">
          <span className={`font-semibold ${TONE[state.result.tone]}`}>{state.result.text}</span>
          <button type="button" onClick={() => onOpen(state.execution.id)} className="ml-3 text-sm text-[#ff6a1a] hover:underline">
            Open the new case run
          </button>
        </p>
      )}
    </div>
  );
}
