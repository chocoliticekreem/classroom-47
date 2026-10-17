// A person's choice on a decision card, sent back to the real agent: POST /api/console/execute with
// `parentExecutionId` + a trusted `humanDecision`. The console links the new run to its parent and the
// agent API treats the card's human step as answered (apps/api run.ts RunOptions.humanDecision).
// Used by the Decisions desk, the Case runs detail and the city's decision toast. Pure parts only:
// building the body, the send-once state machine and the plain result line. I/O is passed in.
import { plainOutcome, scrubLeaks } from "../ui/plain";
import type { ExecutionRecord, HumanDecision, OutboxEntry } from "./types";

export const EXECUTE_URL = "/api/console/execute";

/** Body of POST /api/console/execute for a decision re-run. */
export interface DecisionRerunBody {
  parentExecutionId: string;
  caseId?: string;
  dataset?: string;
  workflowId?: string;
  humanDecision: HumanDecision;
}

/**
 * The execute body for a choice. `who` is the person who decided (the agent reads it as "Decided by");
 * `by` is how they chose ("tap": on screen). Throws a plain error when something required is missing.
 */
export function decisionRerunBody(input: {
  parentExecutionId: string | null | undefined;
  option: { id: string; label: string } | null | undefined;
  person: string | null | undefined;
  caseId?: string | null;
  dataset?: string | null;
  workflowId?: string | null;
}): DecisionRerunBody {
  const parent = input.parentExecutionId?.trim();
  if (!parent) throw new Error("There is no case run to repeat.");
  const optionId = input.option?.id?.trim();
  const label = input.option?.label?.trim();
  if (!optionId || !label) throw new Error("Pick one of the choices.");
  const who = (input.person ?? "").trim().slice(0, 120);
  if (!who) throw new Error("Add your name.");
  return {
    parentExecutionId: parent,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.dataset ? { dataset: input.dataset } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    humanDecision: { optionId, label, by: "tap", who },
  };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Thrown when the server answered: the run did not start or was refused, so nothing went out. */
export class RerunRefused extends Error {}

/**
 * Sends the re-run and waits for it (the console answers when the agent run ends, up to 5 minutes).
 * A refused request throws RerunRefused (safe to try again); a dropped connection throws a plain Error
 * (the run may still be going, so the caller must not offer a blind retry).
 */
export async function postDecisionRerun(body: DecisionRerunBody, fetchImpl: FetchLike = fetch): Promise<ExecutionRecord> {
  let res: Response;
  try {
    res = await fetchImpl(EXECUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("Lost touch while it ran. Check Case runs before trying again.");
  }
  const parsed = (await res.json().catch(() => null)) as { execution?: ExecutionRecord; error?: string } | null;
  if (!res.ok || !parsed?.execution) {
    const why = scrubLeaks(parsed?.error ?? "") || `the server answered ${res.status}`;
    throw new RerunRefused(`Couldn't run it again: ${why}`);
  }
  return parsed.execution;
}

// ---------------------------------------------------------------- result line

export interface RerunResult {
  tone: "ok" | "warn" | "err";
  text: string;
}

function verb(channel: string): string {
  const c = channel.toLowerCase();
  if (/e-?mail/.test(c)) return "emailed";
  if (/\b(call|phone|telephone|callback)\b/.test(c)) return "called";
  if (/\b(sms|text)\b/.test(c)) return "texted";
  return "messaged";
}

/** "Delivery investigations, Plover Arc Logistics" -> "Delivery investigations". */
function shortWho(recipient: string): string {
  return scrubLeaks(recipient.split(",")[0]).trim() || "someone";
}

/** What went out, in a few words: "emailed Delivery investigations and messaged Sorin Vaal". */
export function sentLine(outbox: OutboxEntry[] | null | undefined): string {
  const sent = (outbox ?? []).filter((o) => o.status === "recorded");
  const parts = [...new Set(sent.map((o) => `${verb(o.action.channel)} ${shortWho(o.action.recipient)}`))];
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The plain result of the re-run: "Sent: emailed …", "Still needs a person", or what failed. */
export function rerunResult(ex: Pick<ExecutionRecord, "status" | "outcome" | "outbox" | "error">): RerunResult {
  if (ex.status === "error") return { tone: "err", text: "It didn't finish. Nothing new was sent." };
  if (ex.status === "running") return { tone: "warn", text: "Still running." };
  const sent = sentLine(ex.outbox);
  switch (ex.outcome) {
    case "acted":
      return { tone: "ok", text: sent ? `Sent: ${sent}` : "Sent" };
    case "escalated":
      return { tone: "warn", text: sent ? `Still needs a person. Sent: ${sent}` : "Still needs a person" };
    case "asked_for_info":
      return { tone: "ok", text: sent ? `Asked a question: ${sent}` : "Asked a question" };
    case "no_action":
      return { tone: "ok", text: "Nothing new to send" };
    case "blocked":
      return { tone: "warn", text: "Stopped by the safety check. Nothing sent." };
    default:
      return { tone: "warn", text: plainOutcome(ex.outcome) };
  }
}

// ---------------------------------------------------------------- send-once state machine

export interface RerunOption {
  id: string;
  label: string;
}

export type RerunState =
  | { phase: "idle" }
  | { phase: "confirm"; option: RerunOption }
  | { phase: "running"; option: RerunOption }
  | { phase: "done"; option: RerunOption; execution: ExecutionRecord; result: RerunResult }
  | { phase: "error"; option: RerunOption; message: string; canRetry: boolean };

export type RerunAction =
  | { type: "pick"; option: RerunOption }
  | { type: "cancel" }
  | { type: "start"; option?: RerunOption }
  | { type: "succeed"; execution: ExecutionRecord }
  | { type: "fail"; message: string; canRetry: boolean };

export const RERUN_IDLE: RerunState = { phase: "idle" };

/**
 * idle -> confirm (pick) -> running (start) -> done | error. `start` from idle needs an option (the desk
 * starts straight after saving). Nothing moves while running and a finished run is final, so one choice
 * sends one request. A refused request (canRetry) can be started again; a lost connection cannot.
 */
export function rerunReducer(state: RerunState, action: RerunAction): RerunState {
  switch (action.type) {
    case "pick":
      return state.phase === "idle" || state.phase === "confirm" ? { phase: "confirm", option: action.option } : state;
    case "cancel":
      return state.phase === "confirm" ? RERUN_IDLE : state;
    case "start": {
      if (state.phase === "confirm") return { phase: "running", option: state.option };
      if (state.phase === "idle" && action.option) return { phase: "running", option: action.option };
      if (state.phase === "error" && state.canRetry) return { phase: "running", option: state.option };
      return state;
    }
    case "succeed":
      return state.phase === "running" ? { phase: "done", option: state.option, execution: action.execution, result: rerunResult(action.execution) } : state;
    case "fail":
      return state.phase === "running" ? { phase: "error", option: state.option, message: action.message, canRetry: action.canRetry } : state;
  }
}

/** The person's name, remembered across pages (same key the Decisions desk uses). */
export const NAME_KEY = "rivet-reviewer";

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* private mode: the name is just not remembered */
  }
}

/** Link to the run in Case runs. */
export function caseRunHref(executionId: string): string {
  return `/?tab=executions&id=${encodeURIComponent(executionId)}`;
}
