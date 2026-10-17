// Voice audio for the city and the console (PRD J3). Three things live here, all outside React:
//   1. createAudioQueue: plays clips strictly in order, with onStart / onEnd per utterance (pure, testable).
//   2. audioManager: the singleton. It unlocks ONE AudioContext on a click ("Enable sound / Start demo"),
//      plays utterance audio through an analyser, and falls back to a silent timer (no audio URL, sound off,
//      fetch or decode failure) so transcript timing and the city effects still run.
//   3. The per-frame loudness registry: loudness(key) is read in useFrame. Never put it in zustand.
// installVoiceAudio() wires the bus to the manager: lines whose text waits for audio (replay audio,
// simulated personas) are queued, and their onStart marks the transcript line as started in the store.
import { on, type WorldEvent } from "./bus";
import { useWorld, waitsForAudio, type TranscriptLine } from "./store";

// ---------- 1. the queue ----------

export interface Clip {
  id: string;
  /** Loudness registry key of whoever speaks (see speakerKey). */
  key: string;
  text: string;
  audioUrl?: string;
  durationMs?: number;
  onStart?: (at: number) => void;
  onEnd?: (at: number) => void;
}

/** Plays one clip; calls started() when sound (or the timer) begins; resolves when it is over. */
export type Player = (clip: Clip, started: () => void) => Promise<void>;

export interface AudioQueue {
  enqueue(clip: Clip): void;
  /** Drops clips not yet started. The current clip finishes. */
  clear(): void;
  readonly pending: number;
  readonly current: Clip | null;
}

export function createAudioQueue(play: Player, now: () => number = () => performance.now()): AudioQueue {
  const queue: Clip[] = [];
  let current: Clip | null = null;

  const next = () => {
    if (current || !queue.length) return;
    const clip = queue.shift()!;
    current = clip;
    let didStart = false;
    const start = () => {
      if (didStart) return;
      didStart = true;
      try {
        clip.onStart?.(now());
      } catch {
        /* a listener's failure must not stall the queue */
      }
    };
    const finish = () => {
      start(); // a clip that ended without starting still gets its onStart, in order
      try {
        clip.onEnd?.(now());
      } catch {
        /* ignore */
      }
      current = null;
      next();
    };
    let p: Promise<void>;
    try {
      p = play(clip, start);
    } catch {
      p = Promise.resolve();
    }
    p.then(finish, finish);
  };

  return {
    enqueue(clip) {
      queue.push(clip);
      next();
    },
    clear() {
      queue.length = 0;
    },
    get pending() {
      return queue.length;
    },
    get current() {
      return current;
    },
  };
}

// ---------- 3. loudness registry (per frame) ----------

interface Voice {
  analyser: AnalyserNode | null;
  buf: Uint8Array<ArrayBuffer> | null;
  synthStart: number;
  synthEnd: number;
}

const voices = new Map<string, Voice>();

/** Registry key for one party on one call (or one note). */
export function speakerKey(callId: string, speaker: string): string {
  return `${callId}|${speaker}`;
}

function voiceFor(key: string): Voice {
  let v = voices.get(key);
  if (!v) {
    v = { analyser: null, buf: null, synthStart: 0, synthEnd: 0 };
    voices.set(key, v);
  }
  return v;
}

export function setSpeaking(key: string, from: number, to: number) {
  const v = voiceFor(key);
  v.synthStart = from;
  v.synthEnd = to;
}

function setAnalyser(key: string, analyser: AnalyserNode | null) {
  const v = voiceFor(key);
  v.analyser = analyser;
  v.buf = analyser ? new Uint8Array(new ArrayBuffer(analyser.fftSize)) : null;
}

export function stopSpeaking(key: string) {
  const v = voices.get(key);
  if (!v) return;
  v.analyser = null;
  v.buf = null;
  v.synthEnd = 0;
}

/** 0..1, how loud `key` is right now. Cheap, allocation-free; call it in useFrame. */
export function loudness(key: string, now: number = performance.now()): number {
  const v = voices.get(key);
  if (!v) return 0;
  if (v.analyser && v.buf) {
    v.analyser.getByteTimeDomainData(v.buf);
    let sum = 0;
    for (let i = 0; i < v.buf.length; i++) {
      const x = (v.buf[i] - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / v.buf.length) * 4);
  }
  if (now < v.synthStart || now > v.synthEnd) return 0;
  // A speech-like envelope: syllable flutter under a slower phrase swell, faded at both ends.
  const fade = Math.min(1, (now - v.synthStart) / 150, (v.synthEnd - now) / 150);
  const syllable = Math.abs(Math.sin(now * 0.019));
  const phrase = 0.55 + 0.45 * Math.sin(now * 0.0043 + 1.3);
  return fade * (0.2 + 0.8 * syllable * phrase);
}

export function isSpeaking(key: string, now: number = performance.now()): boolean {
  const v = voices.get(key);
  return Boolean(v && (v.analyser || (now >= v.synthStart && now <= v.synthEnd)));
}

// ---------- transcript sync (PRD J3) ----------

const MS_PER_WORD = 360;

/** Estimated speaking time when a line carries no duration. */
export function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1200, words * MS_PER_WORD);
}

/**
 * The part of a line to show at `now`:
 * - replay (audio URL): the whole line once its audio starts playing, nothing before;
 * - simulated persona: word by word over durationMs from when it started;
 * - live calls: the whole line as soon as the turn arrives.
 */
export function revealedText(
  line: Pick<TranscriptLine, "text" | "source" | "audioUrl" | "durationMs" | "startedAt">,
  now: number,
): string {
  if (line.startedAt === null) return "";
  if (line.source !== "simulated_persona" || line.audioUrl) return line.text;
  const words = line.text.split(/(\s+)/); // keep the spaces
  const wordCount = Math.ceil(words.length / 2);
  const dur = line.durationMs && line.durationMs > 0 ? line.durationMs : estimateDurationMs(line.text);
  const shown = Math.min(wordCount, Math.max(1, Math.ceil(((now - line.startedAt) / dur) * wordCount)));
  return words.slice(0, shown * 2 - 1).join("");
}

// ---------- 2. the singleton audio manager ----------

const FETCH_TIMEOUT_MS = 8000;

class AudioManager {
  private ctx: AudioContext | null = null;
  readonly queue: AudioQueue;

  constructor() {
    this.queue = createAudioQueue((clip, started) => this.play(clip, started));
  }

  /** Call from a click handler. Creates (once) and resumes the one AudioContext. */
  async unlock(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
      }
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  get unlocked(): boolean {
    return this.ctx?.state === "running";
  }

  /** Real audio when unlocked, sound on and the clip has a URL; otherwise a silent timer with synthetic loudness. */
  private async play(clip: Clip, started: () => void): Promise<void> {
    const ctx = this.ctx;
    if (clip.audioUrl && ctx && ctx.state === "running" && useWorld.getState().soundEnabled) {
      try {
        const res = await fetch(clip.audioUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        const src = ctx.createBufferSource();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.buffer = buffer;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        await new Promise<void>((resolve) => {
          src.onended = () => resolve();
          setAnalyser(clip.key, analyser);
          src.start();
          started();
        });
        stopSpeaking(clip.key);
        src.disconnect();
        analyser.disconnect();
        return;
      } catch {
        stopSpeaking(clip.key);
        // fall through to the timer so the line still plays out
      }
    }
    const dur = clip.durationMs && clip.durationMs > 0 ? clip.durationMs : estimateDurationMs(clip.text);
    const t0 = performance.now();
    setSpeaking(clip.key, t0, t0 + dur);
    started();
    await new Promise<void>((resolve) => setTimeout(resolve, dur));
    stopSpeaking(clip.key);
  }
}

const g = globalThis as unknown as { __rivetAudio?: AudioManager; __rivetVoiceOff?: () => void };

/** The one audio manager (survives hot reloads). */
export function audioManager(): AudioManager {
  if (!g.__rivetAudio) g.__rivetAudio = new AudioManager();
  return g.__rivetAudio;
}

/** Turns a bus event into a clip for the manager, or null when it plays no audio (live turns). */
export function clipFor(e: WorldEvent, onStart: (at: number) => void): Clip | null {
  if (e.type === "voice:utterance") {
    if (!waitsForAudio(e)) return null;
    return { id: `${e.callId}#${e.seq}`, key: speakerKey(e.callId, String(e.speaker)), text: e.text, audioUrl: e.audioUrl, durationMs: e.durationMs, onStart };
  }
  if (e.type === "voice:note_in" && e.audioUrl) {
    return { id: `note#${e.noteId}`, key: speakerKey(e.noteId, String(e.from)), text: e.transcript, audioUrl: e.audioUrl, durationMs: e.durationMs, onStart };
  }
  return null;
}

/** Wires bus -> audio manager once per page (idempotent, re-wired on hot reload). Safe to call from any module. */
export function installVoiceAudio() {
  if (typeof window === "undefined") return;
  g.__rivetVoiceOff?.();
  g.__rivetVoiceOff = on((e) => {
    const clip = clipFor(e, (at) => {
      if (e.type === "voice:utterance") useWorld.getState().markUtteranceStarted(e.callId, e.seq, at);
    });
    if (clip) audioManager().queue.enqueue(clip);
  });
}

/** The "Enable sound / Start demo" click: unlock audio, record it in the store. */
export async function enableSound(): Promise<boolean> {
  installVoiceAudio();
  const ok = await audioManager().unlock();
  useWorld.getState().setSoundEnabled(ok);
  return ok;
}
