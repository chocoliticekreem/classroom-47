// Pure helpers behind the voice mount slots (VoiceSlot.tsx). They turn what a voice component hands back
// (a voice-note event, a call's events and decision, an approval) into a POST /api/console/execute body.
// Prop shapes follow docs/superpowers/plans/2026-10-10-voice-layer.md Task 6 ("for Arvin's mount slots").
import type { CaseViewEvent, DecisionCard, ExecuteRequest, ExecutionRecord, HumanDecision, OutboxEntry } from "../types";

/** The voice components (apps/web/src/voice/*.tsx, owned by the voice layer) the slots try to load. */
export const VOICE_COMPONENTS = ["VoiceNoteButton", "CallDrawer", "ApproveByVoice"] as const;
export type VoiceComponentName = (typeof VOICE_COMPONENTS)[number];

/** Session request for a call (apps/api buildSession input, minus `mode`, which the drawer sets). */
export interface CallSessionRequest {
  mode: "demo";
  purpose: "call" | "approval";
  caseId: string;
  calleeRole: string;
  calleeName: string;
  brief: string;
  goal: string;
  questions?: string[];
  card?: DecisionCard;
  boundaries?: string[];
}

/** What the slot knows of the call state before the session exists (the drawer adds callId once connected). */
export interface CallStateSeed {
  caseId: string;
  mode: "demo";
  source: "live_human" | "simulated_persona";
  caseText: string;
  calleeName: string;
  card?: DecisionCard;
  startN: number;
  at: string;
}

/** The run a voice moment just started (its parent is the run you were on), so the page can open it
 * while it is still working and its steps show live. */
export function childRun<T extends { parentExecutionId?: string | null; startedAt: string }>(
  runs: T[], parentId: string | null | undefined, sinceMs: number,
): T | undefined {
  if (!parentId) return undefined;
  return runs.find((r) => r.parentExecutionId === parentId && Date.parse(r.startedAt) >= sinceMs - 2_000);
}

/** Outbox rows a person could ring instead of writing: the planner chose a call, callback or phone channel. */
export function callableRows(outbox: OutboxEntry[] | null | undefined): OutboxEntry[] {
  return (outbox ?? []).filter((o) => /\b(call|callback|phone|telephone|ring)\b/i.test(o.action.channel));
}

const ROLE_WORDS = "recipient|customer|driver|courier|dispatcher|merchant|sender|seller|buyer|tenant|landlord|neighbour|neighbor|concierge|manager";
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who a person is in this case, read from its own messages: "Fen Orlo, route driver" as a sender, or
 * "recipient Elva Kesh" in a message. A pasted case keeps only its title and the agent's claims in the
 * run, so those are read too. Empty when the case does not say. */
export function partyRole(name: string, e: ExecutionRecord): string {
  const events = e.trace?.events ?? [];
  const start = events.find((x) => x.kind === "run_start");
  if (!start || start.kind !== "run_start" || !name.trim()) return "";
  const claims = clashClaims(events);
  const senders = [...start.inputs.map((i) => i.from), ...claims.map((c) => c.who)];
  const asSender = senders.find((f) => f.toLowerCase().startsWith(`${name.toLowerCase()}, `));
  if (asSender) return asSender.slice(name.length + 2).trim();
  const mentioned = new RegExp(`\\b(${ROLE_WORDS})\\s+${escapeRe(name)}\\b`, "i");
  for (const text of [start.title ?? "", ...start.inputs.map((i) => i.excerpt), ...claims.map((c) => c.says)]) {
    const m = mentioned.exec(text);
    if (m) return m[1].toLowerCase();
  }
  return "";
}

/** Why a run has no call button, in plain words. */
export function noCallLine(outbox: OutboxEntry[] | null | undefined): string {
  const first = (outbox ?? [])[0];
  return first
    ? `No call needed on this run: the agent chose ${first.action.channel} to ${first.action.recipient}.`
    : "No call needed on this run: the agent sent nothing.";
}

/** A card can be approved while it is still open. */
export function cardOpen(card: DecisionCard | null | undefined): card is DecisionCard {
  return Boolean(card && !card.chosen && card.options?.length);
}

type Claim = { who: string; says: string };

/** The "do the stories match" step's claims: what each person says, as the agent read it. */
function clashClaims(events: NonNullable<ExecutionRecord["trace"]>["events"]): Claim[] {
  return events.flatMap((x) => {
    const out = x.kind === "node_end" ? (x.output as { type?: string; claims?: Claim[] } | undefined) : undefined;
    return out?.type === "clash_check" && Array.isArray(out.claims) ? out.claims : [];
  });
}

/** What the run knows of the case as plain text: its title, its messages ("From: sender" blocks), the
 * agent's claims and the desk's own messages. A pasted case keeps only a size placeholder for its
 * messages, so the title, claims and messages carry the names. Voice notes use it to guide
 * transcription; calls use it so the safety check knows who is on the line. */
export function runCaseText(e: ExecutionRecord): string {
  const events = e.trace?.events ?? [];
  const start = events.find((x) => x.kind === "run_start");
  if (!start || start.kind !== "run_start") return "";
  const parts: string[] = [];
  if (start.title) parts.push(start.title);
  for (const i of start.inputs) if (!/^\d+ characters$/.test(i.excerpt.trim())) parts.push(`From: ${i.from}\n${i.excerpt}`);
  for (const c of clashClaims(events)) parts.push(`${c.who}: ${c.says}`);
  for (const o of e.outbox ?? []) parts.push(`To ${o.action.recipient} (${o.action.channel}): ${o.action.message}`);
  return parts.join("\n\n").slice(0, 8000);
}

/** The case text a voice note's transcription is guided by. */
export const noteCaseText = runCaseText;

export function noteRerun(e: ExecutionRecord, event: CaseViewEvent): ExecuteRequest {
  return { caseId: e.caseId, dataset: e.dataset, workflowId: e.workflowId, parentExecutionId: e.id, extraEvents: [event], voice: { trigger: "note" } };
}

export function callRerun(e: ExecutionRecord, r: { events: CaseViewEvent[]; decision?: HumanDecision; callId?: string }): ExecuteRequest {
  return {
    caseId: e.caseId,
    dataset: e.dataset,
    workflowId: e.workflowId,
    parentExecutionId: e.id,
    extraEvents: r.events,
    ...(r.decision ? { humanDecision: r.decision } : {}),
    voice: { trigger: r.decision ? "approval" : "call", ...(r.callId ? { callId: r.callId } : {}) },
  };
}

/** A call the person did not take: the case re-runs knowing nobody answered, so the agent picks a fallback. */
export function noAnswerRerun(e: ExecutionRecord, row: OutboxEntry): ExecuteRequest {
  const who = row.action.recipient;
  const event: CaseViewEvent = {
    n: 0, timestamp: "", stage: null, channel: "Call", from: "Desk (voice agent)", to: who,
    body: `Called ${who} about ${row.action.purpose}: no answer.`, source: "live_human",
  };
  return { caseId: e.caseId, dataset: e.dataset, workflowId: e.workflowId, parentExecutionId: e.id, extraEvents: [event], voice: { trigger: "call" } };
}

/** A run shows voice only when the agent chose a call or a decision is still open. */
export function voiceNeeded(e: ExecutionRecord, card: DecisionCard | null | undefined): boolean {
  return callableRows(e.outbox).length > 0 || cardOpen(card);
}

export function approvalRerun(e: ExecutionRecord, d: HumanDecision): ExecuteRequest {
  return { caseId: e.caseId, dataset: e.dataset, workflowId: e.workflowId, parentExecutionId: e.id, humanDecision: d, voice: { trigger: "approval" } };
}

/** The call brief for an outbox row, kept under the 600 characters the session allows. */
export function callRequest(e: ExecutionRecord & { title?: string | null }, row: OutboxEntry): CallSessionRequest {
  return {
    mode: "demo",
    purpose: "call",
    caseId: e.caseId,
    calleeRole: row.action.recipient,
    calleeName: row.action.recipient,
    brief: `${e.title ?? e.caseId}. ${row.action.message}`.slice(0, 600),
    goal: row.action.purpose,
  };
}

export function callStateSeed(e: ExecutionRecord, calleeName: string, simulated: boolean): CallStateSeed {
  const events = e.trace?.events ?? [];
  const start = events.find((x) => x.kind === "run_start");
  const caseText = runCaseText(e);
  const lastN = start && start.kind === "run_start" ? start.inputs.reduce((m, i) => Math.max(m, i.n), 0) : 0;
  return {
    caseId: e.caseId,
    mode: "demo",
    source: simulated ? "simulated_persona" : "live_human",
    caseText,
    calleeName,
    ...(e.card ? { card: e.card } : {}),
    startN: lastN + 1,
    at: "",
  };
}

/** New case: a driver on the road phones the desk. Nothing is known before the call; the call is the case. */
export const DRIVER_CALL_ID = "new-driver-call";

export function driverCallRequest(name: string) {
  return {
    mode: "demo" as const,
    purpose: "call" as const,
    caseId: DRIVER_CALL_ID,
    calleeRole: "driver",
    calleeName: name,
    brief: `${name} is one of our delivery drivers, out on their round. They flagged a delivery they can't complete. Nothing else is known yet.`,
    goal: "Find out what is stopping the delivery, which parcel and address it is, and what the driver can do from there (wait, try again later, or leave it at a pickup point), so the desk can sort out the rest.",
    questions: ["What's stopping the delivery?", "Which parcel is it, and what's the address?", "What can you do from there, and how long can you wait?"],
  };
}

export function driverCallState(name: string): CallStateSeed {
  return { caseId: DRIVER_CALL_ID, mode: "demo", source: "live_human", caseText: "", calleeName: name, startN: 1, at: "" };
}

/** The finished driver call as one call transcript for the case: only what was said, desk and driver. */
export function driverCallMessage(events: CaseViewEvent[], name: string): { channel: string; from: string; to: string; subject: null; date: null; body: string } | null {
  const lines = events
    .filter((e) => e.channel === "Call transcript" && (e.from === name || (e.from === "Desk (voice agent)" && e.to === name)))
    .map((e) => `${e.from === name ? name : "Desk"}: ${e.body}`);
  if (!lines.length) return null;
  return { channel: "Call transcript", from: `${name} (driver)`, to: "Rivet Delivery Desk", subject: null, date: null, body: lines.join("\n") };
}
