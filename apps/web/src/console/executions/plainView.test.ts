import { describe, expect, it } from "vitest";
import { plainStep, scrubLeaks } from "../../ui/plain";
import type { Trace } from "../types";
import { caseName, checklist, clashSentence, headline, messageOf, plainChannel, statusWord, whyLine } from "./plainView";

const trace = (outcome: string, extra: Trace["events"] = []): Trace => ({
  version: 1, runId: "r", caseId: "delivery-024", flowId: "f", mode: "practice",
  events: [
    { t: 0, kind: "run_start", title: "Case 024: Parcel missing", inputs: [] },
    { t: 1, kind: "node_start", nodeId: "ingest", nodeType: "ingest" },
    { t: 2, kind: "node_end", nodeId: "ingest", status: "ok", summary: "ingest: 1 files, 0 attachments read", latencyMs: 1, costUsd: 0 },
    { t: 3, kind: "node_start", nodeId: "perspectives", nodeType: "perspectives" },
    { t: 4, kind: "node_end", nodeId: "perspectives", status: "ok", summary: "perspectives: skipped: no Jev key", latencyMs: 1, costUsd: 0 },
    { t: 5, kind: "node_start", nodeId: "triage", nodeType: "triage" },
    { t: 6, kind: "node_end", nodeId: "triage", status: "ok", summary: "triage: missed_or_failed_delivery · medium", latencyMs: 1, costUsd: 0 },
    { t: 7, kind: "node_start", nodeId: "gate", nodeType: "safety_gate" },
    { t: 8, kind: "node_end", nodeId: "gate", status: "ok", summary: "gate: 2 of 2 messages cleared", latencyMs: 1, costUsd: 0,
      output: { type: "safety_gate", risk: 0.1, decision: "allow", allowBelow: 0.3, blockAbove: 0.8 } },
    { t: 9, kind: "node_start", nodeId: "verify", nodeType: "verify" },
    { t: 10, kind: "node_end", nodeId: "verify", status: "ok", summary: "verify: accepted by the outbox; receipt and reply unverified", latencyMs: 1, costUsd: 0 },
    { t: 11, kind: "node_start", nodeId: "log", nodeType: "case_log" },
    { t: 12, kind: "node_end", nodeId: "log", status: "ok", summary: "log written", latencyMs: 1, costUsd: 0 },
    ...extra,
    { t: 20, kind: "run_end", outcome: outcome as "acted", totalCostUsd: 0.07, totalLatencyMs: 20,
      nextAction: { recipient: "Delivery investigations", channel: "email", message: "Please investigate.", undoable: true } },
  ],
});

describe("case run in plain words", () => {
  it("writes a headline sentence", () => {
    expect(headline({ status: "success", outcome: "acted", trace: trace("acted") })).toBe("Emailed Delivery investigations");
    expect(headline({ status: "success", outcome: "asked_for_info", trace: trace("asked_for_info") })).toBe("Asked Delivery investigations for more information");
    expect(headline({ status: "success", outcome: "blocked", trace: null })).toBe("Stopped: it wasn't safe to send anything");
    expect(headline({ status: "running", outcome: null, trace: null })).toBe("Working on it…");
  });

  it("names the person deciding when escalated", () => {
    const t = trace("escalated", [
      { t: 13, kind: "node_end", nodeId: "human", status: "ok", summary: "card", latencyMs: 1, costUsd: 0,
        output: { type: "human_decision", card: { routeTo: "Desk supervisor", summary: "s", tried: [], options: [], wouldChangeMyMind: "", deadlineMins: 0, fallback: "" } } },
    ]);
    expect(headline({ status: "success", outcome: "escalated", trace: t })).toBe("Handed this to Desk supervisor to decide");
  });

  it("builds the message card", () => {
    expect(messageOf({ outcome: "acted", trace: trace("acted") })).toEqual({ title: "What we sent", to: "Delivery investigations", how: "Email", message: "Please investigate." });
    expect(messageOf({ outcome: "escalated", trace: trace("escalated") })?.title).toBe("Message waiting to go");
  });

  it("turns steps into a plain checklist, hiding skipped and log steps, never raw summaries", () => {
    const steps = checklist(trace("acted"));
    expect(steps.map((s) => s.text)).toEqual([
      "Read the messages",
      "Problem: missed delivery",
      "Safety check passed (risk: low)",
      "Sent, waiting for a reply",
    ]);
    const all = steps.map((s) => s.text).join(" ");
    expect(all).not.toMatch(/Jev|outbox|_|:\s*\d+ files/);
  });

  it("gives the list a status word and a case name", () => {
    expect(statusWord({ status: "success", outcome: "escalated" })).toBe("Needs a person");
    expect(statusWord({ status: "error", outcome: null })).toBe("Didn't finish");
    expect(statusWord({ status: "success", outcome: "blocked" })).toBe("Stopped");
    expect(statusWord({ status: "running", outcome: null })).toBe("Working…");
    expect(caseName("delivery-024", "Case 024: Parcel missing")).toBe("Parcel missing");
    expect(caseName("gen-007")).toBe("Practice case 7");
    expect(caseName("delivery-024")).toBe("Delivery case 24");
    expect(caseName("2197cdad9601425fb099673adff479d4")).toBe("A case you added");
    expect(plainChannel("sms")).toBe("Text message");
  });
});

describe("shared glossary as used here", () => {
  it("hides skipped second opinions and scrubs leak words", () => {
    expect(plainStep("perspectives", "perspectives: skipped: no Jev key")).toBeNull();
    expect(plainStep("safety_gate", "gate: 1 of 2 messages cleared")).toBe("Safety check: 1 held for a person");
    expect(scrubLeaks("Claude flagged missed_or_failed_delivery")).not.toMatch(/Claude|_/);
  });
});

describe("why line", () => {
  const clashEv: Trace["events"] = [
    { t: 13, kind: "node_start", nodeId: "clash", nodeType: "clash_check" },
    { t: 14, kind: "node_end", nodeId: "clash", status: "ok", summary: "1 conflict: Gate called the side gate in one note", latencyMs: 1, costUsd: 0,
      output: { type: "clash_check", clash: true, p: 1, claims: [] } },
  ];
  it("gives the clash when the stories don't match", () => {
    expect(whyLine({ status: "success", outcome: "acted", trace: trace("acted", clashEv) })).toBe("The stories don't match: Gate called the side gate in one note.");
  });
  it("says the safety check passed when nothing clashed", () => {
    expect(whyLine({ status: "success", outcome: "acted", trace: trace("acted") })).toBe("The safety check passed (risk: low).");
  });
  it("uses the card's reason when a person must decide", () => {
    const t = trace("escalated", [
      { t: 13, kind: "node_end", nodeId: "human", status: "ok", summary: "card", latencyMs: 1, costUsd: 0,
        output: { type: "human_decision", card: { routeTo: "Desk supervisor", summary: "s", whyStopped: { reason: "rule_requires_person", line: "Legal action needs a named person." }, tried: [], options: [], wouldChangeMyMind: "", deadlineMins: 0, fallback: "" } } },
    ]);
    expect(whyLine({ status: "success", outcome: "escalated", trace: t })).toBe("Legal action needs a named person.");
  });
  it("explains a failed run without the raw error, and says nothing while working", () => {
    expect(whyLine({ status: "error", outcome: null, trace: null, error: "429 overloaded req_abc123" })).toBe("The AI service is busy. Try again in a minute.");
    expect(whyLine({ status: "running", outcome: null, trace: null })).toBeNull();
  });
});

describe("clash sentence", () => {
  const out = { type: "clash_check", clash: true, p: 1, claims: [] };
  it("keeps the whole reason, and ends a cut-off one on a whole word", () => {
    const cut = "1 conflict: Gate described as the 'pedestrian gate' in one and the 'side gate' i"; // 80 chars, cut by the agent
    expect(cut.length).toBe(80);
    expect(clashSentence({ nodeType: "clash_check", summary: cut, output: out })).toBe("The stories don't match: Gate described as the 'pedestrian gate' in one and the 'side gate'…");
    expect(clashSentence({ nodeType: "clash_check", summary: "1 conflict: Who may choose redelivery for DL-907", output: out })).toBe("The stories don't match: Who may choose redelivery for DL-907");
    expect(clashSentence({ nodeType: "clash_check", summary: "no conflict", output: { ...out, clash: false } })).toBeNull();
  });
});
