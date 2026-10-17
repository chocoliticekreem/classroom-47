import { describe, expect, it } from "vitest";
import type { CaseViewEvent, OutboxEntry } from "../types";
import { buildRerun, caseTime, parseExtraEvents, priorDeskEvents } from "./rerun";

const ev = (n: number, timestamp: string, body = "x"): CaseViewEvent => ({ n, timestamp, stage: null, channel: "Email", from: "A", to: "B", body });
const out = (status: OutboxEntry["status"], message: string): OutboxEntry => ({
  action: { recipient: "Recipient", channel: "Email", kind: "status_update", purpose: "p", message },
  status,
  note: "",
});

describe("caseTime", () => {
  it("adds elapsed time to the last case event, never the wall clock", () => {
    const view = { events: [ev(1, "2026-02-01T10:00:00Z"), ev(2, "2026-02-01T11:00:00Z"), ev(3, "not a date")] };
    expect(caseTime(view, 90_000)).toBe("2026-02-01T11:01:30.000Z");
  });
  it("returns empty when no event has a parsable time", () => {
    expect(caseTime({ events: [ev(1, "")] }, 1000)).toBe("");
  });
  it("uses the latest timestamp even when a history is newest first", () => {
    expect(caseTime({ events: [ev(1, "2026-02-01T11:00:00Z"), ev(2, "2026-02-01T10:00:00Z")] }, 60_000)).toBe("2026-02-01T11:01:00.000Z");
  });
});

describe("priorDeskEvents", () => {
  it("turns recorded outbox entries into desk events and skips held, blocked and failed ones", () => {
    const got = priorDeskEvents([out("recorded", "We are on it"), out("held_for_human", "h"), out("blocked", "b"), out("failed", "f"), out("recorded", "Second")], 4, "T");
    expect(got.map((e) => [e.n, e.from, e.body])).toEqual([
      [4, "Desk", "Already sent by the desk: We are on it"],
      [5, "Desk", "Already sent by the desk: Second"],
    ]);
  });
});

describe("buildRerun", () => {
  it("appends prior desk events then new voice events, numbered after the last event", () => {
    const view = { id: "c", events: [ev(1, "2026-02-01T10:00:00Z"), ev(2, "2026-02-01T10:05:00Z")] };
    const note: CaseViewEvent = { ...ev(0, "", "Driver: gate locked"), channel: "Voice note", source: "live_human" };
    const { view: v, synthetic } = buildRerun({ view, previousOutbox: [out("recorded", "Hi")], newEvents: [note], elapsedMs: 60_000 });
    expect(v.events.map((e) => e.n)).toEqual([1, 2, 3, 4]);
    expect(v.events[2].body).toBe("Already sent by the desk: Hi");
    expect(v.events[3]).toMatchObject({ body: "Driver: gate locked", source: "live_human", timestamp: "2026-02-01T10:06:00.000Z" });
    expect(synthetic).toBe(false);
    expect(v.id).toBe("c");
  });
  it("keeps a voice event's own valid timestamp", () => {
    const view = { events: [ev(1, "2026-02-01T10:00:00Z")] };
    const { view: v } = buildRerun({ view, newEvents: [ev(9, "2026-02-01T10:02:00Z")], elapsedMs: 0 });
    expect(v.events[1].timestamp).toBe("2026-02-01T10:02:00Z");
  });
  it("marks synthetic when a simulated_persona event is present", () => {
    const view = { events: [ev(1, "")] };
    const { synthetic } = buildRerun({ view, newEvents: [{ ...ev(0, ""), source: "simulated_persona" }], elapsedMs: 0 });
    expect(synthetic).toBe(true);
  });
});

describe("parseExtraEvents", () => {
  it("accepts missing as empty and validates shape", () => {
    expect(parseExtraEvents(undefined)).toEqual([]);
    expect(parseExtraEvents("x")).toBeNull();
    expect(parseExtraEvents([{ body: "" }])).toBeNull();
    expect(parseExtraEvents([{ body: "hi", source: "robot" }])).toBeNull();
    expect(parseExtraEvents([{ body: "hi", source: "live_human", channel: "Voice note" }])).toEqual([
      { n: 0, timestamp: "", stage: null, channel: "Voice note", from: null, to: null, body: "hi", source: "live_human" },
    ]);
  });
});
