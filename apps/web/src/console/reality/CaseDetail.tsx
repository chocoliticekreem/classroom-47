"use client";
// One Reality Test case: its ANSWER.md as the judges read it, REASONING.md behind "Why", and a
// link to the step-by-step replay in Case runs. Read-only: nothing here can change the files.
import { useState } from "react";
import Markdown from "../executions/MarkdownView";
import {
  Badge,
  Button,
  EmptyState,
  IconChevronLeft,
  IconExecutions,
  Panel,
  Skeleton,
  cx,
  formatDuration,
  useConsole,
} from "../ui";
import { cents } from "../../ui/plain";
import { useApi } from "../useApi";
import { STATUS_LABEL, STATUS_TONE, caseStatus, caseTitle, filePath, type RealityCase } from "./logic";

interface CaseFiles {
  answerMd?: string | null;
  reasoningMd?: string | null;
  /** Try runs only: the case input the agent was given. */
  caseMd?: string | null;
}

type View = "answer" | "why" | "case";

export default function CaseDetail({ c, onBack, query = "", root = "ANSWERS" }: {
  c: RealityCase;
  onBack: () => void;
  /** Extra query for the files request ("?source=try&run=..."), empty for ANSWERS/. */
  query?: string;
  /** Folder shown as the files' location. */
  root?: string;
}) {
  const { navigate } = useConsole();
  const [view, setView] = useState<View>("answer");
  const inline = typeof c.answerMd === "string";
  const files = useApi<CaseFiles>(inline ? null : `/api/console/reality/${encodeURIComponent(c.caseId)}${query}`);
  const answer = inline ? c.answerMd : files.data?.answerMd;
  const reasoning = inline ? c.reasoningMd : files.data?.reasoningMd;
  const caseMd = files.data?.caseMd;
  const text = view === "answer" ? answer : view === "why" ? reasoning : caseMd;
  const file = view === "answer" ? "ANSWER.md" : "REASONING.md";
  const s = caseStatus(c);
  const cost = cents(c.costUsd);

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div>
        <Button variant="ghost" size="sm" icon={<IconChevronLeft size={14} />} onClick={onBack}>
          All cases
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-rv-title font-semibold text-white">{caseTitle(c)}</h1>
            <Badge tone={STATUS_TONE[s]} dot>{STATUS_LABEL[s]}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-white/40">
            Case {String(c.n)} · {c.caseId}
            {c.durationMs !== null && ` · ${formatDuration(c.durationMs)}`}
            {cost && ` · ${cost}`}
          </p>
        </div>
        {c.executionId && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconExecutions size={14} />}
            onClick={() => navigate("executions", { id: c.executionId })}
          >
            Replay step by step
          </Button>
        )}
      </header>

      <Panel
        flush
        title={
          <span className="inline-flex items-center gap-1" role="tablist">
            <ViewTab active={view === "answer"} onClick={() => setView("answer")}>Answer</ViewTab>
            <ViewTab active={view === "why"} onClick={() => setView("why")}>Why</ViewTab>
            {typeof caseMd === "string" && <ViewTab active={view === "case"} onClick={() => setView("case")}>Case</ViewTab>}
          </span>
        }
        actions={
          <span className="font-mono text-[11px] text-white/35" title="The judges read this file. Shown exactly as written; read-only.">
            {filePath(c.caseId, file, root)}
          </span>
        }
      >
        <p className="border-b border-white/[0.05] bg-white/[0.02] px-5 py-2 text-[12px] text-white/45">
          {view === "answer"
            ? "This is the answer file the judges read, exactly as the run wrote it."
            : view === "why"
              ? "How the agent got there, as written to the reasoning file."
              : "The case as the agent received it (the organisers' raw files)."}
        </p>
        <div className="px-5 py-4">
          {!inline && files.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : text ? (
            <Markdown source={text} />
          ) : (
            <EmptyState compact title={files.error ? "Can't open this file here yet" : "This file is empty"}>
              It is in the repo at <span className="font-mono text-white/70">{filePath(c.caseId, file, root)}</span>.
            </EmptyState>
          )}
        </div>
      </Panel>
    </div>
    </div>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "rounded px-2.5 py-1 text-[13px] font-medium transition-colors",
        active ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );
}
