// Turns what a person typed, pasted and dropped on the "New case" page into the case the agent
// reads, and checks that body again on the server. Pure, no I/O.
import type { IntakeMessage } from "./split";

export const CHANNELS = [
  "Email",
  "Customer portal",
  "Call transcript",
  "Driver chat",
  "Dispatch chat",
  "Depot queue",
  "Business portal",
  "Text message",
] as const;

export const DESK = "Rivet Delivery Desk";

/** A message on the page. `source` marks a call transcript made from a recording. */
export interface DraftMessage extends IntakeMessage {
  source?: "audio_attachment" | "simulated_persona";
}

export type AttachmentKind = "text" | "pdf" | "image" | "audio" | "other";

export interface DraftAttachment {
  name: string;
  kind: AttachmentKind;
  size: number;
  /** Text read in the browser (txt, csv, …). Null for files the agent can't read through this page. */
  text: string | null;
}

export interface IntakeEvent {
  n: number;
  timestamp: string;
  stage: string | null;
  channel: string | null;
  from: string | null;
  to: string | null;
  body: string;
  source?: "audio_attachment" | "simulated_persona";
}

/** The body POSTed to /api/console/intake. */
export interface IntakeRequest {
  title: string;
  events: IntakeEvent[];
  attachments: { name: string; text: string }[];
  workflowId?: string | null;
  practice?: boolean;
}

export const MAX_ATTACHMENT_CHARS = 200_000;
export const MAX_CASE_CHARS = 600_000;
export const MAX_EVENTS = 200;

const TEXT_EXT = /\.(txt|csv|tsv|md|json|eml|log|html?|ya?ml)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|webm|flac)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic)$/i;

export function attachmentKind(name: string, mime = ""): AttachmentKind {
  if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (mime.startsWith("audio/") || AUDIO_EXT.test(name)) return "audio";
  if (mime.startsWith("text/") || /csv|json/.test(mime) || TEXT_EXT.test(name)) return "text";
  return "other";
}

/** Short title: the first subject line, else the start of the latest message. */
export function caseTitle(messages: DraftMessage[]): string {
  const subject = messages.find((m) => m.subject?.trim())?.subject?.trim();
  const raw = subject || messages.at(-1)?.body.replace(/\s+/g, " ").trim() || "New case";
  return raw.length > 70 ? `${raw.slice(0, 67).trimEnd()}…` : raw;
}

/**
 * Messages as case events, numbered from 1 in the order given. A message with no date is placed
 * one minute after the one before it; if none before it has a date, it counts back from `now`.
 * The subject, when there is one, is the first line of the body.
 */
export function buildEvents(messages: DraftMessage[], now: Date): IntakeEvent[] {
  const kept = messages.filter((m) => m.body.trim());
  let last: number | null = null;
  return kept.map((m, i) => {
    const own = m.date ? Date.parse(m.date) : NaN;
    const ms = Number.isFinite(own) ? own : last !== null ? last + 60_000 : now.getTime() - (kept.length - i) * 60_000;
    last = ms;
    const subject = m.subject?.trim();
    return {
      n: i + 1,
      timestamp: new Date(ms).toISOString(),
      stage: null,
      channel: m.channel?.trim() || "Email",
      from: m.from?.trim() || null,
      to: m.to?.trim() || null,
      body: subject ? `Subject: ${subject}\n\n${m.body.trim()}` : m.body.trim(),
      ...(m.source ? { source: m.source } : {}),
    };
  });
}

/** The request for the page's current state. Only attachments with text go to the agent. */
export function buildIntakeRequest(input: {
  messages: DraftMessage[];
  attachments: DraftAttachment[];
  now: Date;
  workflowId?: string | null;
}): IntakeRequest {
  return {
    title: caseTitle(input.messages),
    events: buildEvents(input.messages, input.now),
    attachments: input.attachments
      .filter((a) => a.text !== null && a.text.trim())
      .map((a) => ({ name: a.name, text: (a.text as string).slice(0, MAX_ATTACHMENT_CHARS) })),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Server-side check of a POSTed body. */
export function parseIntakeRequest(raw: unknown): { ok: true; value: IntakeRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "The request was empty." };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.events) || r.events.length === 0) return { ok: false, error: "Add at least one message." };
  if (r.events.length > MAX_EVENTS) return { ok: false, error: `At most ${MAX_EVENTS} messages per case.` };
  const events: IntakeEvent[] = [];
  for (const [i, e] of (r.events as unknown[]).entries()) {
    const ev = (e ?? {}) as Record<string, unknown>;
    const body = str(ev.body);
    if (!body) return { ok: false, error: `Message ${i + 1} is empty.` };
    const ts = str(ev.timestamp);
    if (!ts || !Number.isFinite(Date.parse(ts))) return { ok: false, error: `Message ${i + 1} has no valid time.` };
    events.push({
      n: i + 1,
      timestamp: new Date(Date.parse(ts)).toISOString(),
      stage: str(ev.stage),
      channel: str(ev.channel),
      from: str(ev.from),
      to: str(ev.to),
      body,
      ...(r.practice === true ? { source: "simulated_persona" as const } : ev.source === "audio_attachment" ? { source: "audio_attachment" as const } : {}),
    });
  }
  const attachments: { name: string; text: string }[] = [];
  if (r.attachments !== undefined) {
    if (!Array.isArray(r.attachments)) return { ok: false, error: "Attachments must be a list." };
    for (const a of r.attachments as unknown[]) {
      const at = (a ?? {}) as Record<string, unknown>;
      const name = str(at.name);
      const text = str(at.text);
      if (!name || !text) return { ok: false, error: "Each attachment needs a name and text." };
      attachments.push({ name: name.replace(/[\\/]/g, "_").slice(0, 120), text: text.slice(0, MAX_ATTACHMENT_CHARS) });
    }
  }
  const size = events.reduce((n, e) => n + e.body.length, 0) + attachments.reduce((n, a) => n + a.text.length, 0);
  if (size > MAX_CASE_CHARS) return { ok: false, error: "The case is too long. Remove some text or files." };
  const title = (str(r.title) ?? "New case").replace(/\s+/g, " ").trim().slice(0, 120);
  return { ok: true, value: { title, events, attachments, workflowId: str(r.workflowId), ...(r.practice === true ? { practice: true } : {}) } };
}

/** Pasted messages, then added ones; sorted by time when every message has a date. */
export function mergeMessages(pasted: DraftMessage[], added: DraftMessage[]): DraftMessage[] {
  const all = [...pasted, ...added].filter((m) => m.body.trim());
  if (!all.every((m) => m.date && Number.isFinite(Date.parse(m.date)))) return all;
  return all.map((m, i) => ({ m, i })).sort((a, b) => Date.parse(a.m.date!) - Date.parse(b.m.date!) || a.i - b.i).map((x) => x.m);
}
