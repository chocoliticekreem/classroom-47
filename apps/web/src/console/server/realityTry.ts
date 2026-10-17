// "Try it now" for the Reality Test page: a small real run of the Reality Test command on a few of
// the organisers' raw practice cases, before the real cases arrive.
//   runs/reality-try/<stamp>/cases/1..N   copies of data/raw/<Delivery track>/NNN (renamed, so ids are opaque)
//   runs/reality-try/<stamp>/ANSWERS/     what `npm run reality -- <cases> <ANSWERS> --budget-usd 1` wrote
//   runs/reality-try/<stamp>/try.json     what was picked and when; exit.json once the runner exits
//   runs/reality-try/<stamp>/console.log  the runner's output
// It never writes into the repo's ANSWERS/ (the real submission).
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { repoRoot } from "./db";
import { readStaged } from "./realityUpload";

export const TRY_MAX = 10;
export const TRY_DEFAULT = 3;
/** About what one case costs on the real agent, in US cents. */
export const CENTS_PER_CASE = 5;
export const TRY_BUDGET_USD = 1;
export const TRY_BUDGET_MAX_USD = 5;

/** The --budget-usd for a try run: 0.1..TRY_BUDGET_MAX_USD, TRY_BUDGET_USD when missing; null when not a number. */
export function tryBudget(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return TRY_BUDGET_USD;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(TRY_BUDGET_MAX_USD, Math.max(0.1, Math.round(n * 100) / 100));
}

export const tryRoot = () => process.env.CONSOLE_TRY_DIR ?? path.join(repoRoot(), "runs", "reality-try");
export const rawRoot = () => path.join(repoRoot(), "data", "raw");

const STAMP = /^\d{8}-\d{6}(?:-\d{1,3})?$/;

/** True for a run folder name made by stampFor(). Anything else (.., slashes, dots) is refused. */
export function isStamp(s: unknown): s is string {
  return typeof s === "string" && STAMP.test(s);
}

/** 20261010-153012 (local time) for a run folder. */
export function stampFor(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The run folder for `stamp`, or null if the stamp is not a plain run name. Never joins anything else. */
export function tryRunDir(stamp: unknown, root = tryRoot()): string | null {
  if (!isStamp(stamp)) return null;
  // The pattern allows only digits and "-", so the join cannot leave `root`.
  return path.join(root, stamp);
}

/** Clamp the requested case count to 1..TRY_MAX; null when it is not a number at all. */
export function tryCount(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(TRY_MAX, Math.max(1, Math.round(n)));
}

/** The Delivery track's raw folder under data/raw (the organisers' folder name, matched loosely). */
export async function deliveryRawDir(root = rawRoot()): Promise<string | null> {
  const names = await readdir(root).catch(() => [] as string[]);
  const name = names.find((n) => /^delivery/i.test(n));
  return name ? path.join(root, name) : null;
}

/** Case folders (NNN) in a raw track folder: any numbered folder holding a .md file. */
export async function rawCases(trackDir: string): Promise<string[]> {
  const entries = await readdir(trackDir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !/^\d+$/.test(e.name)) continue;
    const files = await readdir(path.join(trackDir, e.name)).catch(() => [] as string[]);
    if (files.some((f) => f.endsWith(".md"))) out.push(e.name);
  }
  return out.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** `n` distinct names, picked at random (Fisher-Yates on a copy). */
export function pickCases(names: string[], n: number, rand: () => number = Math.random): string[] {
  const a = [...names];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

/** Copies each picked raw case folder to <dropDir>/1..N, the format the judges send. Returns [drop name, source name]. */
export async function buildDropFolder(trackDir: string, picked: string[], dropDir: string): Promise<{ name: string; source: string }[]> {
  await mkdir(dropDir, { recursive: true });
  const out: { name: string; source: string }[] = [];
  for (const [i, source] of picked.entries()) {
    if (!/^\d+$/.test(source)) throw new Error(`not a case folder name: ${source}`);
    const name = String(i + 1);
    await cp(path.join(trackDir, source), path.join(dropDir, name), { recursive: true });
    out.push({ name, source });
  }
  return out;
}

export interface TryRun {
  stamp: string;
  n: number;
  startedAt: string;
  /** Drop folder name -> organisers' practice case number. */
  picked: { name: string; source: string }[];
  pid: number | null;
  status: "running" | "done" | "failed";
  exitCode: number | null;
  finishedAt: string | null;
  estimateCents: number;
  /** Practice cases picked at random, or the user's own upload. */
  origin?: "practice" | "upload";
  budgetUsd?: number;
}

/** The server's env without the Reality deadline/budget overrides, so the flags here are the only ones. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.REALITY_DEADLINE;
  delete env.REALITY_BUDGET_USD;
  return env;
}

const g = globalThis as unknown as { __realityTry?: string | null };

function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const readJson = async <T>(f: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** One run's state from its folder. A run with no exit.json whose process is gone counts as failed. */
export async function readTryRun(dir: string): Promise<TryRun | null> {
  const meta = await readJson<Omit<TryRun, "status" | "exitCode" | "finishedAt">>(path.join(dir, "try.json"));
  if (!meta) return null;
  const exit = await readJson<{ code: number | null; finishedAt: string }>(path.join(dir, "exit.json"));
  const status: TryRun["status"] = exit ? (exit.code === 0 ? "done" : "failed") : alive(meta.pid) ? "running" : "failed";
  return { ...meta, status, exitCode: exit?.code ?? null, finishedAt: exit?.finishedAt ?? null };
}

/** Every try run, newest first. */
export async function listTryRuns(root = tryRoot()): Promise<TryRun[]> {
  const names = (await readdir(root).catch(() => [] as string[])).filter(isStamp).sort().reverse();
  const runs = await Promise.all(names.map((n) => readTryRun(path.join(root, n))));
  return runs.filter((r): r is TryRun => r !== null);
}

/** Starts a try run in the background: `n` random practice cases, or a staged upload. Throws (with status) when one is already running. */
export async function startTry(n: number, opts: { upload?: string; budgetUsd?: number } = {}): Promise<TryRun> {
  const budgetUsd = opts.budgetUsd ?? TRY_BUDGET_USD;
  const running = (await listTryRuns()).find((r) => r.status === "running");
  if (running) throw Object.assign(new Error(`A try run is already going (${running.stamp}).`), { status: 409 });
  const staged = opts.upload !== undefined ? await readStaged(opts.upload, tryRoot()) : null;
  if (opts.upload !== undefined && !staged) throw Object.assign(new Error("That upload is gone. Drop the files again."), { status: 404 });
  let track: string | null = null;
  let all: string[] = [];
  if (!staged) {
    track = await deliveryRawDir();
    all = track ? await rawCases(track) : [];
    if (!track || !all.length) throw Object.assign(new Error("No Delivery practice cases in data/raw."), { status: 404 });
  }

  let stamp = stampFor(new Date());
  for (let i = 1; await stat(path.join(tryRoot(), stamp)).then(() => true, () => false); i++) stamp = `${stampFor(new Date())}-${i}`;
  const dir = path.join(tryRoot(), stamp);
  const drop = path.join(dir, "cases");
  const out = path.join(dir, "ANSWERS");
  let picked: { name: string; source: string }[];
  if (staged) {
    await mkdir(dir, { recursive: true });
    await rename(path.join(staged.dir, "cases"), drop);
    await rm(staged.dir, { recursive: true, force: true }).catch(() => {});
    picked = staged.staged.cases.map((c) => ({ name: c.name, source: c.source }));
  } else {
    picked = await buildDropFolder(track!, pickCases(all, n), drop);
  }

  const log = createWriteStream(path.join(dir, "console.log"));
  // The same command as `npm run reality -- <drop> <out> --budget-usd <budget>` (root package.json), no deadline.
  const child = spawn("npm", ["run", "reality", "--", drop, out, "--budget-usd", String(budgetUsd)], {
    cwd: repoRoot(),
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  const meta = {
    stamp, n: picked.length, startedAt: new Date().toISOString(), picked, pid: child.pid ?? null,
    estimateCents: picked.length * CENTS_PER_CASE, origin: staged ? ("upload" as const) : ("practice" as const), budgetUsd,
  };
  await writeFile(path.join(dir, "try.json"), JSON.stringify(meta, null, 2));
  g.__realityTry = stamp;
  const finish = (code: number | null) => {
    if (g.__realityTry === stamp) g.__realityTry = null;
    log.end();
    void writeFile(path.join(dir, "exit.json"), JSON.stringify({ code, finishedAt: new Date().toISOString() })).catch(() => {});
  };
  child.on("close", (code) => finish(code));
  child.on("error", () => finish(1));
  return { ...meta, status: "running", exitCode: null, finishedAt: null };
}

/** The case input (history.md, then any other .md) of drop folder `name` in a try run. Found by scan, never joined from the request. */
export async function tryCaseInput(runDir: string, name: string): Promise<string | null> {
  const casesDir = path.join(runDir, "cases");
  const names = await readdir(casesDir).catch(() => [] as string[]);
  if (!names.includes(name) || name.startsWith(".")) return null;
  const dir = path.join(casesDir, name);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".md"))
    .sort((a, b) => (a === "history.md" ? -1 : b === "history.md" ? 1 : a.localeCompare(b)));
  const parts = await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8").catch(() => "")));
  const text = parts.filter(Boolean).join("\n\n---\n\n");
  return text || null;
}
