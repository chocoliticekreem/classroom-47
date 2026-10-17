import { scrubLeaks } from "../ui/plain";
import type { ReviewDecision, ReviewTask } from "./types";

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];

/** Read today's trace and the PRD's future card events without changing the runtime contract. */
export function taskFromTrace(value: unknown, receivedAt: string, id: string, result?: unknown): ReviewTask | null {
  const trace = record(value);
  if (!trace || !Array.isArray(trace.events) || !str(trace.caseId) || !str(trace.runId)) return null;
  const events = trace.events.map(record).filter((e): e is Record<string, unknown> => e !== null);
  const startIndex = events.findLastIndex((e) => e.kind === "run_start");
  const segment = events.slice(Math.max(0, startIndex));
  let card: Record<string, unknown> | null = null;
  for (const e of segment) {
    const out = record(e.output);
    if (e.kind === "card") card = record(e.card);
    else if (e.kind === "node_end" && out?.type === "human_decision") card = record(out.card);
  }
  if (!card || !str(card.summary) || !str(card.routeTo)) return null;
  const options = Array.isArray(card.options) ? card.options.flatMap((value) => {
    const option = record(value);
    return option && str(option.id) && str(option.label)
      ? [{ id: str(option.id), label: str(option.label), undoable: option.undoable === true, ...(str(option.effect) && { effect: str(option.effect) }) }] : [];
  }) : [];
  const fallbackOption = options.find((o) => o.id === card.fallbackOptionId);
  const triage = segment.map((e) => record(e.output)).find((o) => o?.type === "triage");
  const gate = segment.map((e) => record(e.output)).find((o) => o?.type === "safety_gate");
  const end = segment.findLast((e) => e.kind === "run_end");
  const snapshot = record(result);
  const messages: ReviewTask["messages"] = [];
  if (Array.isArray(snapshot?.outbox)) {
    for (const value of snapshot.outbox) {
      const entry = record(value);
      const action = record(entry?.action);
      if (entry && action) messages.push({ from: str(action.recipient), channel: str(action.channel), body: str(action.message), status: str(entry.status), note: str(entry.note) });
    }
  }
  if (!messages.length) {
    for (const e of segment) {
      const out = record(e.output);
      const action = record(out?.type === "action" ? out.done : out?.type === "planner" ? out.nextAction : null);
      if (action) messages.push({ from: str(action.recipient), channel: str(action.channel), body: str(action.message), status: out?.type === "action" ? "outbox_recorded" : "proposed" });
    }
  }
  const deadlineMins = typeof card.deadlineMins === "number" && Number.isFinite(card.deadlineMins) && card.deadlineMins > 0 ? card.deadlineMins : 60;
  const human = segment.findLast((e) => e.kind === "human_decision" && (!card?.cardId || e.cardId === card.cardId));
  const chosen = str(human?.optionId, str(card.chosen));
  const choice = options.find((o) => o.id === chosen);
  const decision: ReviewDecision | null = choice ? {
    optionId: choice.id, optionLabel: choice.label, who: str(human?.who, "Someone earlier"),
    note: "", at: receivedAt, execution: "pending",
  } : null;
  return {
    id, caseId: str(trace.caseId), runId: str(trace.runId), cardId: str(card.cardId, id),
    title: str(segment.find((e) => e.kind === "run_start")?.title, str(trace.caseId)),
    summary: str(card.summary), routeTo: str(card.routeTo), mustDecide: str(record(card.whyStopped)?.line, str(card.mustDecide, "Choose what happens next.")),
    evidence: Array.isArray(card.evidence) ? card.evidence.flatMap((value) => {
      const item = record(value);
      return item && str(item.who) && str(item.says) ? [{ who: str(item.who), says: str(item.says), basis: str(item.basis) }] : [];
    }) : [],
    clash: str(card.clash) || null, tried: strings(card.alreadyDone).length ? strings(card.alreadyDone) : strings(card.tried), wouldChangeMyMind: str(card.wouldChangeMyMind), options,
    fallback: str(card.fallback, fallbackOption?.label ?? "Hold the case and send nothing until the team decides."),
    receivedAt, deadlineAt: new Date(Date.parse(receivedAt) + deadlineMins * 60_000).toISOString(),
    urgency: triage?.urgency === "high" || triage?.urgency === "low" ? triage.urgency : "medium",
    risk: typeof gate?.risk === "number" ? gate.risk : null,
    status: decision ? "decision_recorded" : "pending", decision,
    simulated: trace.synthetic === true,
    mode: trace.mode === "reality" || trace.mode === "demo" ? trace.mode : "practice",
    origin: "runner", messages,
    timeline: segment.filter((e) => e.kind === "node_end").map((e) => ({ node: str(e.nodeId), summary: str(e.summary), status: str(e.status) })),
    costUsd: typeof end?.totalCostUsd === "number" ? end.totalCostUsd : null,
    durationMs: typeof end?.totalLatencyMs === "number" ? end.totalLatencyMs : null,
  };
}

export function deadlineLabel(task: ReviewTask, now: number): string {
  if (task.status !== "pending") return task.status === "resolved" ? "Resolved in simulation" : "Decision recorded";
  const mins = Math.ceil((Date.parse(task.deadlineAt) - now) / 60_000);
  if (mins <= 0) return `${Math.max(1, Math.abs(mins))}m overdue`;
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
}

export function sortTasks(tasks: ReviewTask[]): ReviewTask[] {
  const urgency = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) =>
    Number(a.status !== "pending") - Number(b.status !== "pending") ||
    urgency[a.urgency] - urgency[b.urgency] || Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt) || a.id.localeCompare(b.id));
}

/** One short readable line for the decision view: scrubbed, first sentence, at most `words` words. */
export function shortLine(text: string | null | undefined, words = 15): string {
  const clean = scrubLeaks(text);
  if (!clean) return "";
  const first = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  const list = first.split(/\s+/);
  return list.length > words ? `${list.slice(0, words).join(" ").replace(/[,;:.]$/, "")}…` : first;
}

/** At most two short evidence lines; the rest of the card lives under "Details". */
export function keyEvidence(task: ReviewTask): string[] {
  const lines = task.evidence.map((e) => shortLine(`${scrubLeaks(e.who)}: ${e.says}`, 14));
  if (task.clash) lines.push(`The stories don't match: ${shortLine(task.clash, 10)}`);
  return lines.filter(Boolean).slice(0, 2);
}
