// Imports runner outputs from disk into SQLite. Idempotent: each file (or eval row) has a stable
// source key, so a rescan updates rows in place.
//   ANSWERS/<case>/ (ANSWER.md, REASONING.md, trace.json, result.json)  origin "answers", dataset "reality"
//   examples/practice-run/**/trace.json (+ siblings)                origin "examples"
//   runs/**/*.json: eval outputs (scripts/eval/run-eval.mjs) and traces   origin "runs"
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DecisionCard, ExecutionRecord, OutboxEntry, RealityRunlog } from "../types";
import { listCases } from "./catalogue";
import { getDb, repoRoot, setSetting } from "./db";
import { evalRowSummary, isEvalFile, isoFromEvalFilename, isTrace, resultJsonVerdict, summariseTrace } from "./mapping";
import { answerFolders, answersDir, answerTitle, CASE_FILES, parseRunlog } from "./reality";
import { upsertExecution } from "./store";

async function walk(dir: string, match: (name: string) => boolean): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, match));
    else if (e.isFile() && match(e.name)) out.push(full);
  }
  return out.sort();
}

const readText = (file: string) => readFile(file, "utf8").catch(() => null);
async function readJson(file: string): Promise<unknown> {
  const t = await readText(file);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
const idFor = (key: string) => `imp-${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
const mtimeIso = async (file: string) => (await stat(file)).mtime.toISOString();

type DatasetOf = (caseId: string) => string | null;

async function importTraceFile(
  file: string, root: string, origin: ExecutionRecord["origin"], datasetOf: DatasetOf, fallbackDataset: string,
): Promise<boolean> {
  const trace = await readJson(file);
  if (!isTrace(trace)) return false;
  const s = summariseTrace(trace);
  const dir = path.dirname(file);
  const isFolderTrace = path.basename(file) === "trace.json";
  const caseId = isFolderTrace ? path.basename(dir) : (s.caseId ?? path.basename(file, ".json"));
  const [answerMd, reasoningMd, result] = isFolderTrace
    ? await Promise.all([readText(path.join(dir, "ANSWER.md")), readText(path.join(dir, "REASONING.md")), readJson(path.join(dir, "result.json"))])
    : [null, null, null];
  const key = `${origin}:${path.relative(root, file)}`;
  upsertExecution({
    id: idFor(key),
    sourceKey: key,
    caseId,
    dataset: datasetOf(caseId) ?? (s.caseId ? datasetOf(s.caseId) : null) ?? fallbackDataset,
    workflowId: s.workflowId ?? "default-incident",
    status: s.status,
    outcome: s.outcome,
    startedAt: s.startedAt ?? await mtimeIso(file),
    durationMs: s.durationMs,
    costUsd: s.costUsd,
    origin,
    simulated: s.simulated,
    title: s.title,
    nextAction: s.nextAction,
    gate: s.gate,
    error: s.error,
    trace,
    answerMd,
    reasoningMd,
    eval: resultJsonVerdict(result),
  });
  return true;
}

async function importEvalFile(file: string, root: string, datasetOf: DatasetOf): Promise<number> {
  const data = await readJson(file);
  if (!isEvalFile(data)) return 0;
  const startedAt = isoFromEvalFilename(path.basename(file)) ?? await mtimeIso(file);
  const rel = path.relative(root, file);
  let n = 0;
  for (const row of data.rows) {
    const s = evalRowSummary(row);
    const key = `runs:${rel}#${row.id}`;
    upsertExecution({
      id: idFor(key),
      sourceKey: key,
      caseId: row.id,
      // The eval's own set is "public" or "generated"; the catalogue also tells grounded and fixtures apart.
      dataset: datasetOf(row.id) ?? s.set ?? "adhoc",
      workflowId: "default-incident",
      status: s.status,
      outcome: s.outcome,
      startedAt,
      durationMs: s.durationMs,
      costUsd: s.costUsd,
      origin: "runs",
      simulated: false,
      title: null,
      nextAction: s.nextAction,
      gate: null,
      error: s.error,
      trace: null,
      answerMd: null,
      reasoningMd: null,
      eval: s.eval,
    });
    n++;
  }
  return n;
}

// ---------- ANSWERS/ (the Reality Test run, apps/api/src/agent/cli.ts) ----------

/** A stamp that changes when any case folder, its files or the run log change. */
async function answersStamp(dir: string): Promise<string> {
  const parts: string[] = [];
  for (const f of ["RUNLOG.md", "INDEX.md"]) parts.push(`${f}:${await stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)}`);
  for (const folder of await answerFolders(dir)) {
    const times = await Promise.all(CASE_FILES.map((f) => stat(path.join(folder, f)).then((s) => `${s.mtimeMs}/${s.size}`, () => "-")));
    parts.push(`${folder}:${times.join(",")}`);
  }
  return parts.join("|");
}

interface SavedResult {
  outcome?: string;
  error?: string;
  failedAt?: string;
  trace?: unknown;
  outbox?: OutboxEntry[];
  card?: DecisionCard;
  bundle?: { title?: string };
}

/** The reason a folder has no finished trace, in the runner's own words where it left them. */
function failureReason(result: SavedResult | null, reasoningMd: string | null, logged: RealityRunlog["rows"][number] | undefined): string {
  if (result?.error) return result.failedAt ? `failed at ${result.failedAt}: ${result.error}` : result.error;
  const early = reasoningMd?.match(/The run failed before any analysis:\s*(.+)/)?.[1];
  if (early) return early.trim();
  if (logged && logged.result !== "ok") return logged.result;
  return "no trace.json: the run did not finish for this case";
}

async function importAnswerFolder(dir: string, root: string, datasetOf: DatasetOf, log: Map<string, RealityRunlog["rows"][number]>): Promise<string> {
  const name = path.basename(dir);
  const [answerMd, reasoningMd, traceRaw, resultRaw] = await Promise.all([
    readText(path.join(dir, "ANSWER.md")), readText(path.join(dir, "REASONING.md")),
    readJson(path.join(dir, "trace.json")), readJson(path.join(dir, "result.json")),
  ]);
  const result = typeof resultRaw === "object" && resultRaw !== null ? resultRaw as SavedResult : null;
  // result.json carries the same trace; it is the fallback when trace.json was cut off.
  const trace = isTrace(traceRaw) ? traceRaw : isTrace(result?.trace) ? result.trace : null;
  const s = trace ? summariseTrace(trace) : null;
  const logged = log.get(name);
  const key = `answers:${path.relative(root, path.join(dir, "trace.json"))}`;
  const newest = await Promise.all(CASE_FILES.map((f) => stat(path.join(dir, f)).then((x) => x.mtime.getTime(), () => 0)));
  const fileTime = new Date(Math.max(...newest) || Date.now()).toISOString();
  // A practice run of a known case keeps that case's dataset; everything else here is the Reality Test.
  const dataset = trace?.mode === "practice" ? (datasetOf(name) ?? "reality") : "reality";
  const failed = !s || s.status === "error";
  upsertExecution({
    id: idFor(key),
    sourceKey: key,
    caseId: name,
    dataset,
    workflowId: s?.workflowId ?? "default-incident",
    status: failed ? "error" : "success",
    outcome: s?.outcome ?? result?.outcome ?? "error",
    startedAt: s?.startedAt ?? fileTime,
    durationMs: s?.durationMs ?? (logged?.seconds !== null && logged?.seconds !== undefined ? Math.round(logged.seconds * 1000) : null),
    costUsd: s?.costUsd ?? logged?.costUsd ?? null,
    origin: "answers",
    simulated: s?.simulated ?? false,
    title: s?.title ?? result?.bundle?.title ?? answerTitle(answerMd),
    nextAction: s?.nextAction ?? null,
    gate: s?.gate ?? null,
    error: failed ? (s?.error && s.error !== "run ended with outcome error" ? s.error : failureReason(result, reasoningMd, logged)) : null,
    trace,
    answerMd,
    reasoningMd,
    eval: resultJsonVerdict(result),
    outbox: Array.isArray(result?.outbox) ? result.outbox : null,
    card: result?.card ?? null,
  });
  return key;
}

const ga = globalThis as unknown as { __consoleAnswersStamp?: string };

/**
 * Mirrors ANSWERS/ into SQLite: one execution per case folder, including folders where the run
 * failed and left only ANSWER.md and REASONING.md. Rows for folders that no longer exist are removed.
 */
export async function importAnswers(datasetOf: DatasetOf = () => null): Promise<number> {
  const root = repoRoot();
  const dir = answersDir();
  const stamp = await answersStamp(dir);
  const runlogText = await readText(path.join(dir, "RUNLOG.md"));
  const log = new Map((runlogText ? parseRunlog(runlogText).rows : []).map((r) => [r.caseName, r]));
  const keys: string[] = [];
  for (const folder of await answerFolders(dir)) keys.push(await importAnswerFolder(folder, root, datasetOf, log));
  const db = getDb();
  const stale = db.prepare("SELECT source_key FROM executions WHERE origin = 'answers'").all()
    .map((r) => String(r.source_key)).filter((k) => !keys.includes(k));
  for (const k of stale) db.prepare("DELETE FROM executions WHERE origin = 'answers' AND source_key = ?").run(k);
  ga.__consoleAnswersStamp = stamp;
  return keys.length;
}

/** Re-imports ANSWERS/ only when something in it changed since the last import (a few stats per case). */
export async function refreshAnswersIfChanged(): Promise<boolean> {
  const stamp = await answersStamp(answersDir());
  if (stamp === ga.__consoleAnswersStamp) return false;
  const known = new Map((await listCases()).map((c) => [c.id, c.dataset]));
  await importAnswers((id) => known.get(id) ?? null);
  return true;
}

/** Rescans ANSWERS/, runs/ and examples/practice-run/. Returns how many executions were written. */
export async function importAll(): Promise<number> {
  const root = repoRoot();
  const known = new Map((await listCases()).map((c) => [c.id, c.dataset]));
  const datasetOf: DatasetOf = (id) => known.get(id) ?? known.get(`delivery-${id}`) ?? null;
  let n = 0;

  n += await importAnswers(datasetOf);
  // Practice-run folders are exported public cases (examples/practice-run/README.md).
  for (const f of await walk(path.join(root, "examples", "practice-run"), (name) => name === "trace.json")) {
    if (await importTraceFile(f, root, "examples", datasetOf, "public")) n++;
  }
  for (const f of await walk(path.join(root, "runs"), (name) => name.endsWith(".json"))) {
    const evalRows = await importEvalFile(f, root, datasetOf);
    if (evalRows) n += evalRows;
    else if (await importTraceFile(f, root, "runs", datasetOf, "adhoc")) n++;
  }
  setSetting("last_import", new Date().toISOString());
  return n;
}

const g = globalThis as unknown as { __consoleImport?: Promise<number> };

/** Runs the import once per server process, the first time any GET needs executions. */
export function ensureImported(): Promise<number> {
  g.__consoleImport ??= importAll().catch((err) => {
    g.__consoleImport = undefined;
    throw err;
  });
  return g.__consoleImport;
}
