import { describe, expect, it } from "vitest";
import type { CaseViewEvent } from "../types";
import { agentRequestBody } from "./execute";

const view = { id: "delivery-003", title: "t", events: [{ n: 1, timestamp: "2026-02-01T10:00:00Z", stage: null, channel: "Email", from: "A", to: "B", body: "x" }] as CaseViewEvent[] };

describe("agentRequestBody", () => {
  it("sends the plain view, unchanged, for an ordinary execute", () => {
    const r = agentRequestBody({ view, elapsedMs: 0, rerun: false });
    expect(r.body).toEqual(view);
    expect(r.voiceInput).toBe(false);
  });
  it("appends voice events, runs in demo mode and passes humanDecision through", () => {
    const hd = { optionId: "option-1", label: "Redeliver", by: "voice" as const, who: "Desk manager", confirmation: "yes, option one" };
    const r = agentRequestBody({
      view,
      extraEvents: [{ n: 0, timestamp: "", stage: null, channel: "Voice note", from: "Driver", to: "Desk", body: "gate shut", source: "live_human" }],
      humanDecision: hd,
      elapsedMs: 30_000,
      rerun: true,
      parentOutbox: [{ action: { recipient: "R", channel: "Email", kind: "k", purpose: "p", message: "sent before" }, status: "recorded", note: "" }],
    });
    expect(r.body.mode).toBe("demo");
    expect(r.body.humanDecision).toEqual(hd);
    expect(r.body.events.map((e) => e.body)).toEqual(["x", "Already sent by the desk: sent before", "gate shut"]);
    expect(r.body.events[2].timestamp).toBe("2026-02-01T10:00:30.000Z");
  });
  it("an explicit mode wins, and simulated personas mark the run synthetic", () => {
    const r = agentRequestBody({
      view,
      extraEvents: [{ n: 0, timestamp: "", stage: null, channel: "Call", from: "Recipient", to: "Desk", body: "hi", source: "simulated_persona" }],
      mode: "practice",
      elapsedMs: 0,
      rerun: false,
    });
    expect(r.body.mode).toBe("practice");
    expect(r.synthetic).toBe(true);
  });
});
