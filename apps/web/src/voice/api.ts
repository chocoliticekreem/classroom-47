// Browser calls to the voice API. JSON goes as text/plain (a "simple" request, so no CORS preflight),
// the same convention as the city's agent bridge.
import type { CaseView, ViewEvent } from "../../../api/src/agent/load";
import type { DecisionCard, Trace } from "../../../api/src/lib/trace";

export const AGENT_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Must match DENIAL in apps/api/src/voice/tools.ts (a test checks this). */
export const DENIAL = "I can't promise that. The team that owns this decides, and I'll pass your request on.";

/** Must match fallbackReply in apps/api/src/voice/wording.ts (a test checks this). */
const FAILED: Record<string, string> = {
  submit_decision: "I couldn't record that decision. Please choose on screen instead.",
  record_fact: "I couldn't note that down. Could you say it again?",
  request_human: "I couldn't reach a person just now. The team will follow up.",
};
export function fallbackReply(tool: string): string {
  return FAILED[tool] ?? DENIAL;
}

export type VoiceSource = "live_human" | "simulated_persona" | "audio_attachment";
export type { CaseView, DecisionCard, Trace, ViewEvent };

export interface HumanDecision { optionId: string; label: string; by: "voice"; who: string; confirmation: string }

export interface CallStateInput {
  caseId: string;
  mode: "demo";
  source: VoiceSource;
  caseText: string;
  calleeName: string;
  card?: DecisionCard;
  /** The option already chosen on this call, if any. */
  decided?: string;
  startN: number;
  at: string;
}

export interface SessionRequest {
  mode: "demo";
  purpose: "approval" | "call";
  caseId: string;
  calleeRole: string;
  calleeName: string;
  brief: string;
  goal: string;
  questions?: string[];
  card?: DecisionCard;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${AGENT_API}${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `voice API answered ${res.status}`);
  return data;
}

/** caseId or caseText lets the server guide transcription with the case's own references. */
export interface NoteContext { caseId?: string; caseText?: string; languageCode?: string }

export async function sendRecordedNote(input: { audio: Blob; filename: string; from: string; n: number; at: string; source: VoiceSource } & NoteContext): Promise<ViewEvent> {
  const form = new FormData();
  form.append("audio", input.audio, input.filename);
  const fields = { mode: "demo", source: input.source, from: input.from, n: String(input.n), at: input.at, caseId: input.caseId ?? "", caseText: input.caseText ?? "", languageCode: input.languageCode ?? "en" };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${AGENT_API}/api/voice/note`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
  const data = (await res.json().catch(() => ({}))) as { event?: ViewEvent; error?: string };
  if (!res.ok || !data.event) throw new Error(data.error || `voice note failed (${res.status})`);
  return data.event;
}

export async function sendTypedNote(input: { transcript: string; from: string; n: number; at: string; source: VoiceSource } & NoteContext): Promise<ViewEvent> {
  const data = await postJson<{ event: ViewEvent }>("/api/voice/note", { mode: "demo", ...input });
  return data.event;
}

export function openSession(req: SessionRequest) {
  return postJson<{ callId: string; token: string; dynamicVariables: Record<string, string> }>("/api/voice/session", req);
}

/** A client tool call during the call. Never throws: on any failure the agent gets that tool's fallback
 * wording (a promise check stays a refusal). */
export async function callTool(tool: string, state: CallStateInput & { callId: string }, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  try {
    return await postJson<{ result: string; allowed?: boolean; rule?: string; event?: ViewEvent; decision?: HumanDecision; duplicate?: boolean; events?: ViewEvent[] }>(
      `/api/voice/tools/${tool}`, { state, args, ...extra }, 3_000,
    );
  } catch {
    return { result: fallbackReply(tool) };
  }
}

/** After a call: every line the agent said goes through the safety gate. Null on any failure, never throws. */
export async function auditTranscript(state: CallStateInput & { callId: string }, lines: { role: "user" | "agent"; message: string }[]) {
  try {
    return await postJson<{ checked: number; flagged: { line: string; reasons: string[] }[]; unchecked: boolean; event: ViewEvent | null }>(
      "/api/voice/audit", { state, lines }, 8_000,
    );
  } catch {
    return null;
  }
}

export function buildRerunView(input: { view: CaseView; previousOutbox?: unknown[]; newEvents: ViewEvent[]; elapsedMs: number }) {
  return postJson<{ view: CaseView; synthetic: boolean }>("/api/voice/rerun", { ...input, mode: "demo" });
}

export function runCase(view: CaseView) {
  return postJson<{ trace: Trace; outcome: string; outbox: unknown[]; card: DecisionCard | null }>("/api/cases", { ...view, mode: "demo" }, 240_000);
}
