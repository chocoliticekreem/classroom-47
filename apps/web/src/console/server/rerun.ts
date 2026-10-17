// Builds the case view for a voice re-run (PRD I1, I4; voice plan Task 2 and "Global Constraints"):
// - the desk's earlier messages (the parent run's outbox, `recorded` only) come back as events, so a
//   re-run never sends them twice;
// - voice events are appended after them, renumbered after the last case event;
// - an event without a timestamp is stamped on the case's own timeline (last parsable event time plus
//   the real time elapsed), never the wall clock, so the agent's `caseNow` does not jump months.
// Pure: no I/O. Mirrors apps/api/src/voice/rerun.ts so the console works before that lands.
import type { CaseViewEvent, OutboxEntry } from "../types";

interface ViewLike {
  events: CaseViewEvent[];
}

/** Latest event time, plus elapsed time; input histories may arrive in reverse order. */
export function caseTime(view: ViewLike, elapsedMs: number): string {
  const times = view.events.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times) + Math.max(0, elapsedMs)).toISOString() : "";
}

/** One "Already sent by the desk" event per recorded outbox entry. Held, blocked and failed ones were never sent. */
export function priorDeskEvents(outbox: OutboxEntry[], startN: number, at: string): CaseViewEvent[] {
  return outbox
    .filter((o) => o.status === "recorded")
    .map((o, i) => ({
      n: startN + i,
      timestamp: at,
      stage: null,
      channel: o.action.channel,
      from: "Desk",
      to: o.action.recipient,
      body: `Already sent by the desk: ${o.action.message}`,
    }));
}

/**
 * The view to send: the case's events, then the desk's earlier messages, then the new voice events.
 * `synthetic` is true when any event was voiced by a simulated persona (the trace must say so).
 */
export function buildRerun<V extends ViewLike>(input: {
  view: V;
  previousOutbox?: OutboxEntry[] | null;
  newEvents?: CaseViewEvent[] | null;
  elapsedMs: number;
}): { view: V; synthetic: boolean } {
  const base = input.view.events;
  const lastN = base.reduce((m, e) => Math.max(m, Number.isFinite(e.n) ? e.n : 0), 0);
  const at = caseTime(input.view, input.elapsedMs);
  const prior = priorDeskEvents(input.previousOutbox ?? [], lastN + 1, at);
  const fresh = (input.newEvents ?? []).map((e, i) => ({
    ...e,
    n: lastN + prior.length + 1 + i,
    timestamp: e.timestamp && Number.isFinite(Date.parse(e.timestamp)) ? e.timestamp : at,
  }));
  const events = [...base, ...prior, ...fresh];
  return {
    view: { ...input.view, events },
    synthetic: events.some((e) => e.source === "simulated_persona"),
  };
}

const SOURCES = new Set(["live_human", "simulated_persona", "audio_attachment"]);
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/** Validates untrusted `extraEvents` from a request body. Returns null when the shape is wrong. */
export function parseExtraEvents(raw: unknown): CaseViewEvent[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: CaseViewEvent[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const e = r as Record<string, unknown>;
    if (typeof e.body !== "string" || !e.body.trim()) return null;
    if (e.source !== undefined && !SOURCES.has(String(e.source))) return null;
    out.push({
      n: typeof e.n === "number" ? e.n : 0,
      timestamp: typeof e.timestamp === "string" ? e.timestamp : "",
      stage: strOrNull(e.stage),
      channel: strOrNull(e.channel),
      from: strOrNull(e.from),
      to: strOrNull(e.to),
      body: e.body,
      ...(e.source !== undefined ? { source: e.source as CaseViewEvent["source"] } : {}),
    });
  }
  return out;
}
