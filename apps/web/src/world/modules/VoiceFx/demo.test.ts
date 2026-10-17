import { describe, expect, it, vi } from "vitest";
import type { WorldEvent } from "../../bus";
import { demoScript, playScript } from "./demo";
import { emptyFx, fxReduce } from "./fx";

describe("__cityVoiceDemo script", () => {
  const steps = demoScript("voice-demo-1", "call-demo-1");
  it("rings, connects, talks in seq order, hangs up, sends a note, then approves by voice", () => {
    expect(steps.map((s) => s.event.type)).toEqual([
      "call:ringing", "call:connected", "voice:utterance", "voice:utterance", "voice:utterance", "voice:utterance",
      "call:ended", "voice:note_in", "decision:needed", "decision:voice",
    ]);
    const times = steps.map((s) => s.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const seqs = steps.flatMap((s) => (s.event.type === "voice:utterance" ? [s.event.seq] : []));
    expect(seqs).toEqual([1, 2, 3, 4]);
  });
  it("labels every voiced event as a simulated persona", () => {
    for (const { event } of steps) if ("source" in event) expect(event.source).toBe("simulated_persona");
  });
  it("drives every VoiceFx effect", () => {
    let s = emptyFx();
    let focus = false;
    let hud = false;
    let maxPhones = 0;
    let maxBubbles = 0;
    for (const { event, atMs } of steps) {
      const r = fxReduce(s, event, atMs);
      s = r.state;
      focus ||= Boolean(r.focus);
      hud ||= Boolean(r.hudFlash);
      maxPhones = Math.max(maxPhones, s.phones.length);
      maxBubbles = Math.max(maxBubbles, s.bubbles.length);
    }
    expect({ focus, hud, maxPhones, maxBubbles, envelopes: s.envelopes.length, flashes: s.flashes.length }).toEqual({ focus: true, hud: true, maxPhones: 2, maxBubbles: 2, envelopes: 1, flashes: 1 });
    expect(s.phones.every((p) => p.endedAt !== null)).toBe(true);
  });
  it("plays on timers and can be cancelled", () => {
    vi.useFakeTimers();
    const got: WorldEvent[] = [];
    const cancel = playScript(steps, (e) => got.push(e));
    vi.advanceTimersByTime(3300);
    expect(got.map((e) => e.type)).toEqual(["call:ringing", "call:connected"]);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(got).toHaveLength(2);
    vi.useRealTimers();
  });
});
