// Type-level and reducer tests for the PRD J3 additions to bus.ts and store.ts.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { EventOf, Party, ScenarioOutcome, VoiceSource, WorldEvent } from "./bus";
import { voiceReduce, waitsForAudio, type VoiceSlice, type WorkflowEvent } from "./store";

describe("bus types (J3)", () => {
  it("has the voice and decision events verbatim", () => {
    expectTypeOf<EventOf<"call:ringing">>().toEqualTypeOf<{ type: "call:ringing"; caseId: string; callId: string; caller: Party; callee: Party; source: VoiceSource; purpose: string }>();
    expectTypeOf<EventOf<"call:connected">>().toEqualTypeOf<{ type: "call:connected"; caseId: string; callId: string }>();
    expectTypeOf<EventOf<"voice:utterance">>().toEqualTypeOf<{ type: "voice:utterance"; caseId: string; callId: string; seq: number; speaker: Party; text: string; source: VoiceSource; audioUrl?: string; durationMs?: number }>();
    expectTypeOf<EventOf<"call:ended">["reason"]>().toEqualTypeOf<"completed" | "no_answer" | "failed" | "human_took_over">();
    expectTypeOf<EventOf<"voice:note_in">>().toEqualTypeOf<{ type: "voice:note_in"; caseId: string; noteId: string; from: Party; source: VoiceSource; transcript: string; audioUrl?: string; durationMs?: number }>();
    expectTypeOf<EventOf<"decision:voice">>().toEqualTypeOf<{ type: "decision:voice"; caseId: string; optionId: string; by: Party; source: VoiceSource; callId?: string }>();
    expectTypeOf<EventOf<"decision:needed">["card"]>().toEqualTypeOf<NonNullable<WorkflowEvent["card"]>>();
    expectTypeOf<VoiceSource>().toEqualTypeOf<"live_human" | "simulated_persona" | "audio_attachment" | "case_file">();
  });
  it("widens scenario:resolved.outcome with waiting, refused and routed", () => {
    expectTypeOf<EventOf<"scenario:resolved">["outcome"]>().toEqualTypeOf<ScenarioOutcome>();
    expectTypeOf<"waiting" | "refused" | "routed" | "acted" | "no_action">().toMatchTypeOf<ScenarioOutcome>();
  });
  it("keeps the existing events", () => {
    expectTypeOf<{ type: "request:roadworks" }>().toMatchTypeOf<WorldEvent>();
  });
});

describe("store types (J3)", () => {
  it("adds only optional fields to WorkflowEvent and keeps old producers valid", () => {
    const old: WorkflowEvent = { id: "1", t: 0, caseId: "C", nodeId: "triage", status: "ok", summary: "s", source: "mock" };
    expect(old.source).toBe("mock");
    expectTypeOf<WorkflowEvent["decision"]>().toEqualTypeOf<"act" | "ask_for_info" | "route_to_owner" | "hold_for_human" | "wait_until" | "refuse" | undefined>();
    expectTypeOf<NonNullable<WorkflowEvent["card"]>>().toHaveProperty("fallbackOptionId").toEqualTypeOf<string>();
    expectTypeOf<WorkflowEvent["due"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<WorkflowEvent["actionId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<WorkflowEvent["synthetic"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<WorkflowEvent["costUsd"]>().toEqualTypeOf<number | undefined>();
  });
});

describe("voiceReduce", () => {
  const empty: VoiceSlice = { calls: {}, transcripts: {}, voiceNotes: [], soundEnabled: false };
  const apply = (s: VoiceSlice, e: WorldEvent, now: number): VoiceSlice => ({ ...s, ...(voiceReduce(s, e, now) ?? {}) });

  it("tracks a call from ringing to ended", () => {
    let s = apply(empty, { type: "call:ringing", caseId: "c", callId: "k", caller: "desk_agent", callee: "driver", source: "simulated_persona", purpose: "p" }, 1);
    expect(s.calls.k).toMatchObject({ status: "ringing", ringingAt: 1 });
    s = apply(s, { type: "call:connected", caseId: "c", callId: "k" }, 2);
    s = apply(s, { type: "call:ended", caseId: "c", callId: "k", reason: "completed", summary: "ok" }, 3);
    expect(s.calls.k).toMatchObject({ status: "ended", connectedAt: 2, endedAt: 3, reason: "completed", summary: "ok" });
  });

  it("keeps transcript lines in seq order and applies the reveal start rules", () => {
    const u = (seq: number, source: VoiceSource, audioUrl?: string): WorldEvent => ({ type: "voice:utterance", caseId: "c", callId: "k", seq, speaker: "driver", text: `l${seq}`, source, ...(audioUrl ? { audioUrl } : {}) });
    let s = apply(empty, u(2, "live_human"), 10);
    s = apply(s, u(1, "simulated_persona"), 11);
    s = apply(s, u(3, "case_file", "a.mp3"), 12);
    expect(s.transcripts.k.map((l) => [l.seq, l.startedAt])).toEqual([[1, null], [2, 10], [3, null]]);
  });

  it("records voice notes and ignores unrelated events", () => {
    const s = apply(empty, { type: "voice:note_in", caseId: "c", noteId: "n1", from: "driver", source: "live_human", transcript: "gate shut" }, 5);
    expect(s.voiceNotes).toEqual([{ noteId: "n1", caseId: "c", from: "driver", source: "live_human", transcript: "gate shut", at: 5 }]);
    expect(voiceReduce(s, { type: "request:roadworks" }, 6)).toBeNull();
    expect(voiceReduce(s, { type: "call:connected", caseId: "c", callId: "unknown" }, 6)).toBeNull();
  });

  it("text waits for audio only for replay audio and simulated personas", () => {
    expect(waitsForAudio({ source: "live_human" })).toBe(false);
    expect(waitsForAudio({ source: "simulated_persona" })).toBe(true);
    expect(waitsForAudio({ source: "audio_attachment", audioUrl: "x" })).toBe(true);
  });
});
