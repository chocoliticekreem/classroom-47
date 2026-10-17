import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tiny stale-while-revalidate cache: memory first, then a gzipped JSON file under `.cache/` so a
 * dev-server restart serves the last good value instantly. Expired entries are returned at once
 * while one background refresh runs; a loader failure keeps the stale value.
 */

// Vercel functions can only write to /tmp; locally keep the cache next to the app.
const DIR = process.env.VERCEL ? join("/tmp", "emfol-cache") : join(process.cwd(), ".cache");
const HOUR = 3_600_000;
export const TTL = { minute: 60_000, hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR } as const;

interface Entry<T> {
  at: number;
  body: T;
}

const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const fileFor = (key: string) => join(DIR, `${key.replace(/[^a-z0-9._-]/gi, "_")}.json.gz`);

function readFile<T>(key: string): Entry<T> | null {
  try {
    return JSON.parse(gunzipSync(readFileSync(fileFor(key))).toString("utf8")) as Entry<T>;
  } catch {
    return null;
  }
}

function writeFile(key: string, entry: Entry<unknown>) {
  try {
    mkdirSync(DIR, { recursive: true });
    const tmp = `${fileFor(key)}.${process.pid}.tmp`;
    writeFileSync(tmp, gzipSync(JSON.stringify(entry), { level: 4 }));
    renameSync(tmp, fileFor(key));
  } catch (e) {
    console.warn(`[cache] could not persist ${key}: ${(e as Error).message}`);
  }
}

function refresh<T>(key: string, loader: () => Promise<T>, persist: boolean): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = loader()
    .then((body) => {
      const entry = { at: Date.now(), body };
      memory.set(key, entry);
      if (persist) writeFile(key, entry);
      return body;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export interface CachedOptions {
  /** How long a value is fresh. After this it is still served, but a refresh starts in the background. */
  ttlMs: number;
  /** Write to `.cache/` so the value survives a server restart. Default true. */
  persist?: boolean;
  /** Serve a stale value no older than this; beyond it the caller waits for the loader. Default: forever. */
  maxStaleMs?: number;
}

export async function cached<T>(key: string, opts: CachedOptions, loader: () => Promise<T>): Promise<T> {
  const persist = opts.persist !== false;
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry && persist) {
    const fromDisk = readFile<T>(key);
    if (fromDisk) {
      memory.set(key, fromDisk);
      entry = fromDisk;
    }
  }
  const age = entry ? Date.now() - entry.at : Infinity;
  if (entry && age < opts.ttlMs) return entry.body;
  if (entry && age < (opts.maxStaleMs ?? Infinity)) {
    void refresh(key, loader, persist).catch((e: unknown) => {
      console.warn(`[cache] refresh of ${key} failed, keeping stale: ${(e as Error).message}`);
    });
    return entry.body;
  }
  return refresh(key, loader, persist);
}
