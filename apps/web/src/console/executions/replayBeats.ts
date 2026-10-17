// "Watch it think": turns a finished run's real trace into a short, paced sequence of beats the
// detail page plays back one by one. Pure, so it is unit tested. Nothing here invents a step: every
// beat comes from a trace event, and the pacing only rescales the real step latencies to 0.6-1.2 s.
import { plainGate, plainNode, plainStep, riskWord, scrubLeaks } from "../../ui/plain";
import type { Trace } from "../types";
import { buildTimeline, type TimelineItem } from "./logic";
import { clashSentence, plainChannel } from "./plainView";

/** Case files the trace names by their file stem; shown as what they are. */
const FILE_NAMES: Record<string, string> = { context: "Background notes", history: "Past orders", notes: "Notes" };

type NodeItem = Extract<TimelineItem, { kind: "node" }>;

export const MIN_BEAT_MS = 600;
export const MAX_BEAT_MS = 1200;

export type ReplayBeat =
  | { kind: "messages"; delayMs: number; title: string; inputs: { from: string; how: string; note: string | null }[] }
  | { kind: "step"; delayMs: number; label: string; text: string; failed: boolean }
  | { kind: "clash"; delayMs: number; label: string; text: string; match: boolean; claims: { who: string; says: string }[] }
  | { kind: "gate"; delayMs: number; label: string; text: string; decision: "allow" | "ask" | "block"; verdict: string; risk: string }
  | { kind: "message"; delayMs: number; label: string; sent: boolean; to: string; how: string; message: string; typeMs: number }
  | { kind: "decide"; delayMs: number; label: string; routeTo: string; line: string }
  | { kind: "end"; delayMs: number; outcome: string };

/**
 * Pause before a beat: 0.6 s for an instant step, 1.2 s for the run's slowest, on a log scale so a
 * 0.3 s check and a 40 s plan both read as real but neither drags.
 */
export function paceMs(latencyMs: number | null | undefined, maxLatencyMs: number): number {
  const l = typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0;
  if (!(maxLatencyMs > 0) || l === 0) return MIN_BEAT_MS;
  const frac = Math.min(1, Math.log1p(l) / Math.log1p(maxLatencyMs));
  return Math.round(MIN_BEAT_MS + (MAX_BEAT_MS - MIN_BEAT_MS) * frac);
}

/** How long typing out a message takes: about 70 characters a second, between 0.8 and 3.5 s. */
export function typeMsFor(message: string): number {
  return Math.round(Math.min(3500, Math.max(800, message.length * 14)));
}

/** Total play time of a replay (pauses plus typing). */
export function replayDurationMs(beats: ReplayBeat[]): number {
  return beats.reduce((s, b) => s + b.delayMs + (b.kind === "message" ? b.typeMs : 0), 0);
}

const SIZE_ONLY = /^\s*\d+\s+characters?\s*$/i;

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function claimsOf(output: unknown): { who: string; says: string }[] {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>;
  if (!Array.isArray(o.claims)) return [];
  return o.claims
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ who: shorten(scrubLeaks(String(c.who ?? "")), 60), says: shorten(scrubLeaks(String(c.says ?? "")), 160) }))
    .filter((c) => c.who && c.says)
    .slice(0, 3);
}

function plannedMessage(n: NodeItem): { recipient: string; channel: string; message: string } | null {
  const o = (n.output && typeof n.output === "object" ? n.output : {}) as Record<string, unknown>;
  const next = o.nextAction as Record<string, unknown> | undefined;
  if (!next || typeof next.message !== "string" || !next.message.trim()) return null;
  return { recipient: String(next.recipient ?? ""), channel: String(next.channel ?? ""), message: next.message };
}

/**
 * The beats of a replay, in trace order:
 *   messages in -> each step's plain sentence -> "Do the stories match?" -> safety check
 *   -> the message (typed out) -> "A person needs to decide" -> the result.
 * Steps the checklist hides (skipped, the case log) are hidden here too. A message counts as sent only
 * when the trace has an action step that sent it; a planned message that was never sent shows as held.
 */
export function buildReplay(trace: Trace | null | undefined): ReplayBeat[] {
  const items = buildTimeline(trace);
  if (!items.length) return [];
  const nodes = items.filter((i): i is NodeItem => i.kind === "node");
  const maxLatency = Math.max(0, ...nodes.map((n) => n.latencyMs ?? 0));
  const beats: ReplayBeat[] = [];
  const seen = new Set<string>();
  const start = items.find((i) => i.kind === "run_start");
  const ingest = nodes.find((n) => n.nodeType === "ingest");
  let planned: ReturnType<typeof plannedMessage> = null;
  let gateDecision: "allow" | "ask" | "block" | null = null;
  let sentMessage = false;

  if (start?.kind === "run_start" || ingest) {
    beats.push({
      kind: "messages",
      delayMs: paceMs(ingest?.latencyMs, maxLatency),
      title: start?.kind === "run_start" ? scrubLeaks(start.title).replace(/^\s*case\s*[\w-]*\s*[:.\-–]\s*/i, "") : "",
      inputs: start?.kind === "run_start"
        ? start.inputs.map((i) => ({
            from: (i.channel === "file" ? FILE_NAMES[i.from.toLowerCase()] : undefined) ?? (scrubLeaks(i.from) || "Message"),
            how: i.channel === "file" ? "" : plainChannel(i.channel),
            note: i.excerpt && !SIZE_ONLY.test(i.excerpt) ? shorten(scrubLeaks(i.excerpt), 140) : null,
          }))
        : [],
    });
    if (ingest) seen.add(ingest.nodeId);
  }

  for (const n of nodes) {
    if (seen.has(n.nodeId)) continue;
    seen.add(n.nodeId);
    const delayMs = paceMs(n.latencyMs, maxLatency);
    const label = plainNode(n.nodeType);
    if (n.status === "running") continue;
    if (n.status === "error") {
      beats.push({ kind: "step", delayMs, label, text: `${label}: didn't work`, failed: true });
      continue;
    }
    if (n.status === "skipped") continue;
    const text = plainStep(n.nodeType, n.summary, n.output);

    if (n.nodeType === "planner") planned = plannedMessage(n) ?? planned;

    if (n.nodeType === "clash_check" && text) {
      const full = clashSentence(n);
      beats.push({ kind: "clash", delayMs, label, text: full ?? text, match: !full, claims: claimsOf(n.output) });
      continue;
    }
    if (n.gate && text) {
      gateDecision = n.gate.decision;
      const w = riskWord(n.gate.risk);
      beats.push({ kind: "gate", delayMs, label, text, decision: n.gate.decision, verdict: plainGate(n.gate.decision), risk: w });
      continue;
    }
    if (n.action) {
      const ok = n.action.ok;
      sentMessage = sentMessage || ok;
      const m = n.action.done;
      beats.push({
        kind: "message", delayMs, label: ok ? "Message sent" : "Message didn't go out", sent: ok,
        to: scrubLeaks(m.recipient), how: plainChannel(m.channel), message: m.message, typeMs: typeMsFor(m.message),
      });
      continue;
    }
    if (n.card) {
      beats.push({
        kind: "decide", delayMs, label: "A person needs to decide", routeTo: scrubLeaks(n.card.routeTo),
        line: scrubLeaks(n.card.whyStopped?.line || n.card.summary),
      });
      continue;
    }
    if (text) beats.push({ kind: "step", delayMs, label, text, failed: false });
  }

  // The planner wrote a message the safety check did not let out: show it as held, not sent.
  if (!sentMessage && planned && gateDecision && gateDecision !== "allow") {
    const decideAt = beats.findIndex((b) => b.kind === "decide");
    const held: ReplayBeat = {
      kind: "message", delayMs: MIN_BEAT_MS, label: "Message held back", sent: false,
      to: scrubLeaks(planned.recipient), how: plainChannel(planned.channel), message: planned.message, typeMs: typeMsFor(planned.message),
    };
    if (decideAt >= 0) beats.splice(decideAt, 0, held);
    else beats.push(held);
  }

  const end = items.find((i) => i.kind === "run_end");
  if (end?.kind === "run_end") beats.push({ kind: "end", delayMs: MIN_BEAT_MS, outcome: end.outcome });
  return beats;
}
