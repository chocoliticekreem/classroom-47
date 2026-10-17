// The files in one case run's download, built only from what the console stored for that run:
// ANSWER.md (the runner's own when stored, else the same shape built from the stored run),
// REASONING.md (when stored), steps.md (the plain step list), trace.json, messages.json, run.json.
// Pure, unit tested.
import type { StoredExecution } from "../server/store";
import type { OutboxEntry } from "../types";
import { caseName, checklist, decisionCardOf, headline, messageOf } from "../executions/plainView";

export interface ExportFile {
  name: string;
  content: string;
}

// Same labels as apps/api/src/agent/report.ts, so a console run reads like a runner ANSWER.md.
const DECISION_LABEL: Record<string, string> = {
  acted: "ACT",
  asked_for_info: "ASK FOR INFORMATION",
  escalated: "HOLD FOR A HUMAN",
  blocked: "BLOCKED BY THE SAFETY CHECK",
  no_action: "NO ACTION NEEDED NOW",
  error: "SYSTEM FAILURE: HANDED TO A HUMAN",
};

const STATUS_LABEL: Record<OutboxEntry["status"], string> = {
  recorded: "Recorded in sandbox outbox, awaiting reply",
  failed: "Not delivered: every channel failed",
  held_for_human: "Proposed, held for a human",
  blocked: "Not sent: stopped by the safety check",
};

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");
const usd = (n: number | null) => (n === null ? "not recorded" : `$${n.toFixed(4)}`);
const secs = (ms: number | null) => (ms === null ? "not recorded" : `${(ms / 1000).toFixed(1)} s`);

/** ANSWER.md-style summary of a stored run. */
export function answerSummary(e: StoredExecution): string {
  const outcome = e.outcome ?? (e.status === "error" ? "error" : null);
  const lines = [
    `# ${caseName(e.caseId, e.title)}`,
    "",
    `**Decision:** ${outcome ? (DECISION_LABEL[outcome] ?? outcome) : "NOT FINISHED"}. ${headline(e)}.`,
  ];
  if (e.error) lines.push("", "## What failed", `- ${e.error}`);

  const outbox = e.outbox ?? [];
  lines.push("", "## Actions");
  if (outbox.length) {
    lines.push("| # | To | Channel | Status |", "|---|---|---|---|");
    outbox.forEach((o, i) => lines.push(`| ${i + 1} | ${cell(o.action.recipient)} | ${cell(o.action.channel)} | ${STATUS_LABEL[o.status] ?? o.status} |`));
    lines.push("", "## Messages");
    outbox.forEach((o, i) => {
      lines.push(`**${i + 1}. To ${o.action.recipient} via ${o.action.channel}** (${(STATUS_LABEL[o.status] ?? o.status).toLowerCase()})`, "",
        o.status === "blocked" ? "> Message text withheld: it was stopped by the safety check." : quote(o.action.message), "");
      if (o.status !== "recorded" && o.note) lines.push(`Reason: ${o.note}`, "");
    });
  } else {
    const m = messageOf(e);
    if (m) lines.push(`${m.title}: ${m.how} to ${m.to}.`, "", quote(m.message), "");
    else lines.push("None. No message is sent for this case.", "");
  }

  const card = e.card ?? decisionCardOf(e.trace);
  lines.push("## Escalated");
  if (card) {
    lines.push(`To: ${card.routeTo}`, "");
    if (card.whyStopped) lines.push(`**Why a person is needed:** ${card.whyStopped.line}`, "");
    lines.push(card.summary, "");
    if (card.options.length) {
      lines.push("Options for the person deciding:", ...card.options.map((o) => `- **${o.label}**${o.effect ? `: ${o.effect}` : ""}${o.undoable ? "" : " (cannot be undone)"}`), "");
    }
  } else {
    lines.push("Nothing.", "");
  }

  lines.push("## Run", `- Case: \`${e.caseId}\` (${e.dataset})`, `- Run id: \`${e.id}\``, `- Started: ${e.startedAt}`,
    `- Time: ${secs(e.durationMs)}`, `- Cost: ${usd(e.costUsd)}`, `- Source: ${e.origin}${e.simulated ? " (simulated, not evidence)" : ""}`);
  if (e.parentExecutionId) lines.push(`- Re-run of: \`${e.parentExecutionId}\``);
  lines.push(e.eval
    ? `- Checked against the answer key: ${e.eval.pass ? "right" : "wrong"}, score ${e.eval.score.toFixed(2)}${e.eval.notes ? `. ${e.eval.notes.replace(/\s+/g, " ")}` : ""}`
    : "- Checked against the answer key: not checked");
  return lines.join("\n") + "\n";
}

/** The plain step list, one line per step that ran. */
export function stepList(e: StoredExecution): string {
  const steps = checklist(e.trace);
  const mark = { ok: "[x]", error: "[!]", skipped: "[-]", running: "[ ]" } as const;
  const body = steps.length ? steps.map((s, i) => `${i + 1}. ${mark[s.state]} ${s.text}`).join("\n") : "No steps were recorded for this run.";
  return `# Steps: ${caseName(e.caseId, e.title)}\n\n${body}\n`;
}

/** The run's metadata, without the big blobs (those are their own files). */
function runMeta(e: StoredExecution) {
  const { trace: _t, answerMd: _a, reasoningMd: _r, outbox: _o, ...meta } = e;
  void _t; void _a; void _r; void _o;
  return meta;
}

export function runFiles(e: StoredExecution): ExportFile[] {
  const files: ExportFile[] = [
    { name: "ANSWER.md", content: e.answerMd ?? answerSummary(e) },
    { name: "steps.md", content: stepList(e) },
    { name: "trace.json", content: JSON.stringify(e.trace, null, 2) + "\n" },
    { name: "messages.json", content: JSON.stringify(e.outbox ?? [], null, 2) + "\n" },
    { name: "run.json", content: JSON.stringify(runMeta(e), null, 2) + "\n" },
  ];
  if (e.answerMd) files.splice(1, 0, { name: "SUMMARY.md", content: answerSummary(e) });
  if (e.reasoningMd) files.splice(1, 0, { name: "REASONING.md", content: e.reasoningMd });
  return files;
}

/** "run-delivery-024-1a619ef0" (safe for a file name). */
export function runBaseName(e: Pick<StoredExecution, "caseId" | "id">): string {
  return `run-${e.caseId}-${e.id.slice(0, 8)}`.replace(/[^A-Za-z0-9._-]+/g, "_");
}
