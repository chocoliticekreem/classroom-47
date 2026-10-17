// One shared poller per endpoint. Every component that reads the same path shares one entry:
// one request in flight at a time, one timer, one cached answer. Framework-free so it can be
// tested with fake timers; useApi.ts binds it to React with useSyncExternalStore.
//
// Timing for an entry with subscribers:
//   - interval = the smallest pollMs among its subscribers (0 = fetch once, no polling)
//   - after a retryable failure: interval doubles per consecutive failure, capped at maxBackoffMs.
//     Fetch-once entries also retry this way (from retryBaseMs), so a blip heals by itself.
//   - while the tab is hidden: interval x hiddenFactor. Back on screen: refresh at once if due.
//   - the last subscriber leaving aborts the request in flight and stops the timer (data is kept
//     so a remount shows it immediately while it revalidates).
import { ApiError, isAbortError, isRetryable, MSG_SERVER } from "./http";

export interface PollSnapshot<T = unknown> {
  data?: T;
  /** Last failure; cleared by the next success. Old `data` is kept through failures. */
  error?: ApiError;
  /** ms epoch of the last successful response. */
  updatedAt?: number;
  /** At least one request for this key has finished (success or failure). */
  settled: boolean;
  /** Consecutive failures (0 after a success). */
  failures: number;
}

export type Fetcher = (key: string, signal: AbortSignal) => Promise<unknown>;

export interface PollerOptions {
  /** Cap for error back-off. */
  maxBackoffMs?: number;
  /** Interval multiplier while the tab is hidden. */
  hiddenFactor?: number;
  /** Retry base for fetch-once keys that failed. */
  retryBaseMs?: number;
  /** A new subscriber reuses an answer younger than this instead of fetching again. */
  freshMs?: number;
  isHidden?: () => boolean;
  now?: () => number;
}

interface Entry {
  key: string;
  snap: PollSnapshot;
  subs: Map<number, { pollMs: number; listener: () => void }>;
  inflight: { ctrl: AbortController; promise: Promise<void> } | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastFinished: number | null;
}

export const EMPTY_SNAPSHOT: PollSnapshot = Object.freeze({ settled: false, failures: 0 }) as PollSnapshot;

/** Pure: delay before the next fetch. null = don't schedule. */
export function nextDelay(
  pollMs: number,
  failures: number,
  hidden: boolean,
  retryable: boolean,
  o: { maxBackoffMs: number; hiddenFactor: number; retryBaseMs: number },
): number | null {
  let base = pollMs > 0 ? pollMs : 0;
  if (failures > 0 && retryable) {
    // A non-retryable failure (e.g. 404) keeps the normal cadence; a fetch-once key stops.
    const from = base || o.retryBaseMs;
    base = Math.min(from * 2 ** Math.min(failures - 1, 16), Math.max(o.maxBackoffMs, from));
  }
  if (!base) return null;
  return hidden ? base * o.hiddenFactor : base;
}

export class Poller {
  private entries = new Map<string, Entry>();
  private nextId = 1;
  private readonly o: Required<PollerOptions>;

  constructor(
    private readonly fetcher: Fetcher,
    opts: PollerOptions = {},
  ) {
    this.o = {
      maxBackoffMs: opts.maxBackoffMs ?? 60_000,
      hiddenFactor: opts.hiddenFactor ?? 4,
      retryBaseMs: opts.retryBaseMs ?? 5_000,
      freshMs: opts.freshMs ?? 1_000,
      isHidden: opts.isHidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden"),
      now: opts.now ?? (() => Date.now()),
    };
  }

  getSnapshot = (key: string): PollSnapshot => this.entries.get(key)?.snap ?? EMPTY_SNAPSHOT;

  /** Start sharing `key`. Returns the unsubscribe function. */
  subscribe(key: string, pollMs: number, listener: () => void): () => void {
    const e = this.entry(key);
    const id = this.nextId++;
    e.subs.set(id, { pollMs: Math.max(0, pollMs || 0), listener });
    const fresh = e.lastFinished !== null && this.o.now() - e.lastFinished < this.o.freshMs && !e.snap.error;
    if (!e.inflight && !fresh) void this.refresh(key);
    else this.schedule(e);
    return () => {
      if (!e.subs.delete(id)) return;
      if (e.subs.size === 0) this.stop(e);
      else this.schedule(e); // the fastest subscriber may have left
    };
  }

  /** Fetch now. Joins the request already in flight instead of sending a second one. */
  refresh(key: string): Promise<void> {
    const e = this.entry(key);
    if (e.inflight) return e.inflight.promise;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    const ctrl = new AbortController();
    const promise = this.fetcher(key, ctrl.signal).then(
      (data) => this.finish(e, ctrl, { data, updatedAt: this.o.now(), settled: true, failures: 0 }),
      (err) => {
        if (ctrl.signal.aborted || isAbortError(err)) return this.finish(e, ctrl, null);
        const error =
          err instanceof ApiError ? err : new ApiError(MSG_SERVER, 0, err instanceof Error ? err.message : String(err));
        this.finish(e, ctrl, { ...e.snap, error, settled: true, failures: e.snap.failures + 1 });
      },
    );
    e.inflight = { ctrl, promise };
    return promise;
  }

  /** Call when tab visibility changes or the network comes back: re-plans every timer. */
  wake(opts: { retryNow?: boolean } = {}): void {
    for (const e of this.entries.values()) {
      if (!e.subs.size || e.inflight) continue;
      if (opts.retryNow && e.snap.error && isRetryable(e.snap.error)) void this.refresh(e.key);
      else this.schedule(e);
    }
  }

  /** Test/debug helper: is a request for `key` in flight? */
  isInflight(key: string): boolean {
    return !!this.entries.get(key)?.inflight;
  }

  /** Drop idle entries (no subscribers) to bound memory. */
  prune(keep = 50): void {
    if (this.entries.size <= keep) return;
    for (const [k, e] of this.entries) if (!e.subs.size && !e.inflight) this.entries.delete(k);
  }

  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { key, snap: EMPTY_SNAPSHOT, subs: new Map(), inflight: null, timer: null, lastFinished: null };
      this.entries.set(key, e);
      this.prune();
    }
    return e;
  }

  private finish(e: Entry, ctrl: AbortController, snap: PollSnapshot | null) {
    if (e.inflight?.ctrl !== ctrl) return;
    e.inflight = null;
    if (!snap) return; // aborted: nobody is listening
    e.lastFinished = this.o.now();
    e.snap = snap;
    for (const s of [...e.subs.values()]) s.listener();
    this.schedule(e);
  }

  private schedule(e: Entry) {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    if (!e.subs.size || e.inflight) return;
    let pollMs = 0;
    for (const s of e.subs.values()) if (s.pollMs > 0 && (pollMs === 0 || s.pollMs < pollMs)) pollMs = s.pollMs;
    const delay = nextDelay(pollMs, e.snap.failures, this.o.isHidden(), isRetryable(e.snap.error), this.o);
    if (delay === null) return;
    const since = e.lastFinished === null ? delay : this.o.now() - e.lastFinished;
    e.timer = setTimeout(() => {
      e.timer = null;
      void this.refresh(e.key);
    }, Math.max(0, delay - since));
  }

  private stop(e: Entry) {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    if (e.inflight) {
      const { ctrl } = e.inflight;
      e.inflight = null;
      ctrl.abort();
    }
  }
}
