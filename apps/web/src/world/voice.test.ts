import { describe, expect, it } from "vitest";
import { clipFor, createAudioQueue, estimateDurationMs, loudness, revealedText, setSpeaking, speakerKey, stopSpeaking, type Clip } from "./voice";

/** A player whose clips finish only when the test says so. */
function manualPlayer() {
  const pending: { clip: Clip; started: () => void; done: () => void }[] = [];
  const play = (clip: Clip, started: () => void) => new Promise<void>((resolve) => pending.push({ clip, started, done: resolve }));
  return { play, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("audio queue", () => {
  it("plays clips one at a time, in order, with onStart and onEnd per utterance", async () => {
    const log: string[] = [];
    const p = manualPlayer();
    const q = createAudioQueue(p.play, () => 0);
    const clip = (id: string): Clip => ({ id, key: "k", text: id, onStart: () => log.push(`start ${id}`), onEnd: () => log.push(`end ${id}`) });
    q.enqueue(clip("a"));
    q.enqueue(clip("b"));
    q.enqueue(clip("c"));
    expect(p.pending.map((x) => x.clip.id)).toEqual(["a"]); // b and c wait
    expect(q.pending).toBe(2);
    p.pending[0].started();
    expect(log).toEqual(["start a"]);
    p.pending[0].done();
    await flush();
    expect(p.pending.map((x) => x.clip.id)).toEqual(["a", "b"]);
    p.pending[1].started();
    p.pending[1].done();
    await flush();
    p.pending[2].done(); // ended without calling started(): onStart still fires, before onEnd
    await flush();
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(q.current).toBeNull();
  });

  it("keeps going after a player failure or a throwing listener", async () => {
    const log: string[] = [];
    const q = createAudioQueue(async (c, started) => {
      started();
      if (c.id === "bad") throw new Error("decode failed");
    }, () => 0);
    q.enqueue({ id: "bad", key: "k", text: "", onEnd: () => log.push("end bad") });
    q.enqueue({ id: "throws", key: "k", text: "", onStart: () => { throw new Error("x"); }, onEnd: () => log.push("end throws") });
    q.enqueue({ id: "ok", key: "k", text: "", onEnd: () => log.push("end ok") });
    await flush();
    await flush();
    await flush();
    expect(log).toEqual(["end bad", "end throws", "end ok"]);
  });

  it("clear drops clips not yet started", async () => {
    const p = manualPlayer();
    const q = createAudioQueue(p.play, () => 0);
    q.enqueue({ id: "a", key: "k", text: "" });
    q.enqueue({ id: "b", key: "k", text: "" });
    q.clear();
    p.pending[0].done();
    await flush();
    expect(p.pending.map((x) => x.clip.id)).toEqual(["a"]);
  });
});

describe("transcript sync", () => {
  const base = { text: "one two three four", durationMs: 4000 };
  it("shows nothing before the line starts", () => {
    expect(revealedText({ ...base, source: "simulated_persona", startedAt: null }, 99)).toBe("");
    expect(revealedText({ ...base, source: "live_human", audioUrl: "a.mp3", startedAt: null }, 99)).toBe("");
  });
  it("reveals a simulated persona word by word over durationMs", () => {
    const line = { ...base, source: "simulated_persona" as const, startedAt: 1000 };
    expect(revealedText(line, 1000)).toBe("one");
    expect(revealedText(line, 2500)).toBe("one two");
    expect(revealedText(line, 4000)).toBe("one two three");
    expect(revealedText(line, 9000)).toBe("one two three four");
  });
  it("replay and live lines show whole once started", () => {
    expect(revealedText({ ...base, source: "live_human", audioUrl: "a.mp3", startedAt: 5 }, 5)).toBe(base.text);
    expect(revealedText({ ...base, source: "live_human", startedAt: 5 }, 5)).toBe(base.text);
  });
  it("estimates a duration from the words", () => {
    expect(estimateDurationMs("hi")).toBe(1200);
    expect(estimateDurationMs("a b c d e f g h i j")).toBe(3600);
  });
});

describe("loudness registry", () => {
  it("is non-zero only while a key is speaking", () => {
    const k = speakerKey("call-1", "driver");
    expect(loudness(k, 0)).toBe(0);
    setSpeaking(k, 1000, 3000);
    expect(loudness(k, 500)).toBe(0);
    const mid = Math.max(...[1500, 1600, 1700, 1800, 1900, 2000].map((t) => loudness(k, t)));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThanOrEqual(1);
    stopSpeaking(k);
    expect(loudness(k, 2000)).toBe(0);
  });
});

describe("clipFor", () => {
  const u = { type: "voice:utterance" as const, caseId: "c", callId: "call-1", seq: 1, speaker: "driver", text: "hello" };
  it("queues replay audio and simulated personas, not live turns", () => {
    expect(clipFor({ ...u, source: "live_human" }, () => {})).toBeNull();
    expect(clipFor({ ...u, source: "simulated_persona" }, () => {})).toMatchObject({ id: "call-1#1", key: "call-1|driver" });
    expect(clipFor({ ...u, source: "case_file", audioUrl: "x.mp3" }, () => {})?.audioUrl).toBe("x.mp3");
  });
});
