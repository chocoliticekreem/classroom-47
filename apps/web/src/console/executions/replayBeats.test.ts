import { describe, expect, it } from "vitest";
import type { Trace } from "../types";
import { MAX_BEAT_MS, MIN_BEAT_MS, buildReplay, paceMs, replayDurationMs, typeMsFor, type ReplayBeat } from "./replayBeats";

type Ev = Trace["events"][number];
const node = (t: number, id: string, type: string, summary: string, latencyMs: number, output?: unknown, status: "ok" | "error" | "skipped" = "ok"): Ev[] => [
  { t, kind: "node_start", nodeId: id, nodeType: type as never },
  { t: t + latencyMs, kind: "node_end", nodeId: id, status, summary, latencyMs, costUsd: 0, ...(output ? { output: output as never } : {}) },
];
const trace = (events: Ev[]): Trace => ({ version: 1, runId: "r", caseId: "gen-1201", flowId: "f", mode: "practice", events });

const MSG = "Thank you for telling us. A supervisor needs to decide how we can handle your request.";
const card = {
  routeTo: "Desk supervisor", summary: "s", tried: [], options: [{ id: "a", label: "Redirect", undoable: true }],
  wouldChangeMyMind: "", deadlineMins: 30, fallback: "",
  whyStopped: { reason: "agent_judged_unsafe", line: "The recipient has died, so only a supervisor can sign off." },
};

// Shaped like a real escalated run (runs/console.db gen-1201).
const escalated = trace([
  { t: 0, kind: "run_start", title: "Case: A relative replies from the recipient's account", inputs: [
    { n: 1, channel: "file", from: "context", excerpt: "188 characters" },
    { n: 2, channel: "email", from: "Calla Mossop", excerpt: "My father died on 21 Feb." },
  ] },
  ...node(0, "ingest", "ingest", "2 files, 0 attachments read", 20000),
  ...node(20000, "history", "history_lookup", "4 open commitments, 1 deadlines", 0),
  ...node(20000, "perspectives", "perspectives", "skipped: no Jev key", 0, undefined, "skipped"),
  ...node(20000, "triage", "triage", "missed_or_failed_delivery · medium", 285, { type: "triage", caseType: "missed_or_failed_delivery", urgency: "medium", p: 1 }),
  ...node(20300, "clash", "clash_check", "2 conflict: Who may choose redelivery for DL-907", 223, {
    type: "clash_check", clash: true, p: 0.32,
    claims: [{ who: "Exception desk", says: "Only the verified recipient can choose." }, { who: "Calla Mossop", says: "I am his daughter." }],
  }),
  { t: 20600, kind: "edge", from: "clash", to: "planner" },
  ...node(20600, "planner", "planner", "escalate_to_human: The recipient is reported deceased", 44000, {
    type: "planner", nextAction: { recipient: "Calla Mossop", channel: "Customer portal", message: MSG, undoable: true }, wontDo: [],
  }),
  ...node(64600, "gate", "safety_gate", "1 of 1 messages cleared", 23400, { type: "safety_gate", risk: 0.12, decision: "allow", allowBelow: 0.3, blockAbove: 0.8 }),
  ...node(88000, "action", "action", "1 of 1 message(s) accepted by the outbox", 0, {
    type: "action", ok: true, done: { recipient: "Calla Mossop", channel: "Customer portal", message: MSG, undoable: true },
  }),
  ...node(88000, "verify", "verify", "accepted by the outbox; receipt and reply unverified", 0, { type: "verify", ok: true, p: 1 }),
  ...node(88000, "human", "human_decision", "Card for Desk supervisor", 0, { type: "human_decision", card }),
  ...node(88000, "log", "case_log", "outcome: escalated", 0),
  { t: 88000, kind: "run_end", outcome: "escalated", totalCostUsd: 0.09, totalLatencyMs: 88000 },
]);

const kinds = (b: ReplayBeat[]) => b.map((x) => x.kind);

describe("watch it think: replay timeline", () => {
  it("plays messages in, then each step, the clash, the safety check, the message, the decision and the result", () => {
    const b = buildReplay(escalated);
    expect(kinds(b)).toEqual(["messages", "step", "step", "clash", "step", "gate", "message", "step", "decide", "end"]);
    const texts = b.flatMap((x) => ("text" in x ? [x.text] : []));
    expect(texts).toEqual([
      "Found 4 open promises",
      "Problem: missed delivery",
      "The stories don't match: Who may choose redelivery for DL-907",
      "Plan: ask a person",
      "Safety check passed",
      "Sent, waiting for a reply",
    ]);
  });

  it("uses the real trace for every beat and never leaks internal words", () => {
    const b = buildReplay(escalated);
    const messages = b[0];
    expect(messages).toMatchObject({ kind: "messages", title: "A relative replies from the recipient's account" });
    if (messages.kind !== "messages") throw new Error();
    // A size-only excerpt says nothing, so it is dropped; a real excerpt is kept.
    expect(messages.inputs).toEqual([
      { from: "Background notes", how: "", note: null },
      { from: "Calla Mossop", how: "Email", note: "My father died on 21 Feb." },
    ]);
    const clash = b.find((x) => x.kind === "clash");
    expect(clash).toMatchObject({ label: "Do the stories match?", match: false });
    expect(clash?.kind === "clash" && clash.claims).toHaveLength(2);
    expect(b.find((x) => x.kind === "gate")).toMatchObject({ label: "Safety check", decision: "allow", verdict: "OK", risk: "low" });
    expect(b.find((x) => x.kind === "message")).toMatchObject({ sent: true, to: "Calla Mossop", how: "Customer portal", message: MSG });
    expect(b.find((x) => x.kind === "decide")).toMatchObject({
      label: "A person needs to decide", routeTo: "Desk supervisor", line: "The recipient has died, so only a supervisor can sign off.",
    });
    expect(b.at(-1)).toMatchObject({ kind: "end", outcome: "escalated" });
    expect(JSON.stringify(b)).not.toMatch(/Jev|outbox|_to_|case_log|"log"/);
  });

  it("hides skipped steps and the case log, and does not invent a sent message", () => {
    const b = buildReplay(escalated);
    expect(b.some((x) => "label" in x && x.label === "Second opinions")).toBe(false);
    expect(b.some((x) => "label" in x && x.label === "Done")).toBe(false);

    const blocked = trace([
      { t: 0, kind: "run_start", title: "Case 9: Refund", inputs: [] },
      ...node(0, "planner", "planner", "act: refund", 1000, { type: "planner", nextAction: { recipient: "Ana", channel: "sms", message: "Refund sent.", undoable: false }, wontDo: [] }),
      ...node(1000, "gate", "safety_gate", "0 of 1 messages cleared", 500, { type: "safety_gate", risk: 0.9, decision: "block", allowBelow: 0.3, blockAbove: 0.8 }),
      { t: 1500, kind: "run_end", outcome: "blocked", totalCostUsd: 0, totalLatencyMs: 1500 },
    ]);
    const bb = buildReplay(blocked);
    expect(kinds(bb)).toEqual(["messages", "step", "gate", "message", "end"]);
    expect(bb.find((x) => x.kind === "gate")).toMatchObject({ verdict: "Stop", risk: "high", text: "Safety check stopped it" });
    expect(bb.find((x) => x.kind === "message")).toMatchObject({ sent: false, label: "Message held back", how: "Text message" });
  });

  it("shows a failed step as didn't work, and returns nothing without a trace", () => {
    const failed = trace([...node(0, "triage", "triage", "failed: timeout", 100, undefined, "error")]);
    expect(buildReplay(failed)).toEqual([
      { kind: "step", delayMs: MAX_BEAT_MS, label: "What kind of problem?", text: "What kind of problem?: didn't work", failed: true },
    ]);
    expect(buildReplay(null)).toEqual([]);
    expect(buildReplay(trace([]))).toEqual([]);
  });
});

describe("replay pacing", () => {
  it("scales real latency into 0.6-1.2 s per beat", () => {
    expect(paceMs(0, 44000)).toBe(MIN_BEAT_MS);
    expect(paceMs(null, 44000)).toBe(MIN_BEAT_MS);
    expect(paceMs(44000, 44000)).toBe(MAX_BEAT_MS);
    expect(paceMs(11000, 44000)).toBe(1122); // ln(11001) / ln(44001) = 0.87
    expect(paceMs(285, 44000)).toBe(917); // a quick check still gets a visible beat
    expect(paceMs(500, 0)).toBe(MIN_BEAT_MS);
    for (const b of buildReplay(escalated)) {
      expect(b.delayMs).toBeGreaterThanOrEqual(MIN_BEAT_MS);
      expect(b.delayMs).toBeLessThanOrEqual(MAX_BEAT_MS);
    }
    // The slowest real step (the plan) gets the longest pause; instant steps get the shortest.
    const b = buildReplay(escalated);
    expect(b.find((x) => x.kind === "step" && x.label === "Plan the reply")?.delayMs).toBe(MAX_BEAT_MS);
    expect(b.find((x) => x.kind === "step" && x.label === "Check past orders")?.delayMs).toBe(MIN_BEAT_MS);
  });

  it("types messages out in 0.8-3.5 s and adds it to the total", () => {
    expect(typeMsFor("hi")).toBe(800);
    expect(typeMsFor("x".repeat(100))).toBe(1400);
    expect(typeMsFor("x".repeat(5000))).toBe(3500);
    const b = buildReplay(escalated);
    const pauses = b.reduce((s, x) => s + x.delayMs, 0);
    expect(replayDurationMs(b)).toBe(pauses + typeMsFor(MSG));
    expect(replayDurationMs(b)).toBeLessThan(15000);
  });
});
