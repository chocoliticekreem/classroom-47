// The 3D city's persistence in the console's SQLite DB, so /city and the desk console share one source of truth:
//   - city cases run through the same recording path as Execute (execute.ts recordAgentRun), origin "city",
//     dataset "city-live", always simulated (built from city events);
//   - the real-agent budget guard for city cases (shared by every tab and across refreshes);
//   - one row of world state JSON (incidents, events, closures, weather, clock, HUD feed, queue).
import { randomUUID } from "node:crypto";
import type { DecisionCard } from "../types";
import { getDb as consoleDb, type Database } from "./db";
import { recordAgentRun } from "./execute";
import { listExecutions, upsertExecution, type ExecutionListItem, type ExecutionWrite } from "./store";

export const CITY_DATASET = "city-live";
export const BUDGET_WINDOW_MS = 10 * 60_000;
const MAX_STATE_BYTES = 512 * 1024;

// The city's tables, created on first use (idempotent, like db.ts migrations; kept here so the city's
// persistence is one file and works on a DB handle opened by older code).
const CITY_TABLES = [
  `CREATE TABLE IF NOT EXISTS city_state (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     state TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS city_budget (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     starts TEXT NOT NULL DEFAULT '[]',
     spent_usd REAL NOT NULL DEFAULT 0,
     runs INTEGER NOT NULL DEFAULT 0,
     max_per_window INTEGER NOT NULL DEFAULT 3
   )`,
];
const ready = new WeakSet<Database>();

function getDb(): Database {
  const db = consoleDb();
  if (!ready.has(db)) {
    for (const sql of CITY_TABLES) db.exec(sql);
    ready.add(db);
  }
  return db;
}

// ---------------------------------------------------------------- budget

export interface CityBudget {
  maxPerWindow: number;
  windowMs: number;
  /** Start times (ms epoch) inside the window. */
  starts: number[];
  spentUsd: number;
  runs: number;
}

export function getCityBudget(now = Date.now()): CityBudget {
  const row = getDb().prepare("SELECT starts, spent_usd, runs, max_per_window FROM city_budget WHERE id = 1").get();
  let starts: number[] = [];
  try {
    const v = JSON.parse(String(row?.starts ?? "[]")) as unknown;
    if (Array.isArray(v)) starts = v.filter((t): t is number => typeof t === "number");
  } catch {
    /* bad row: treat as empty */
  }
  return {
    maxPerWindow: row ? Number(row.max_per_window) : 3,
    windowMs: BUDGET_WINDOW_MS,
    starts: starts.filter((t) => now - t < BUDGET_WINDOW_MS && t <= now + 1000).sort((a, b) => a - b),
    spentUsd: row ? Number(row.spent_usd) : 0,
    runs: row ? Number(row.runs) : 0,
  };
}

function saveCityBudget(b: Pick<CityBudget, "starts" | "spentUsd" | "runs" | "maxPerWindow">) {
  getDb()
    .prepare(
      `INSERT INTO city_budget (id, starts, spent_usd, runs, max_per_window) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET starts = excluded.starts, spent_usd = excluded.spent_usd, runs = excluded.runs, max_per_window = excluded.max_per_window`,
    )
    .run(JSON.stringify(b.starts), b.spentUsd, b.runs, b.maxPerWindow);
}

/** Claim one slot now: the new budget, or null when the window is full. */
export function claimCityBudget(now = Date.now()): CityBudget | null {
  const b = getCityBudget(now);
  if (b.starts.length >= b.maxPerWindow) return null;
  const next = { ...b, starts: [...b.starts, now], runs: b.runs + 1 };
  saveCityBudget(next);
  return next;
}

export function addCitySpend(usd: number | null | undefined) {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
  const b = getCityBudget();
  saveCityBudget({ ...b, spentUsd: b.spentUsd + usd });
}

export function setCityBudgetMax(n: number) {
  const b = getCityBudget();
  saveCityBudget({ ...b, maxPerWindow: Math.max(0, Math.min(60, Math.round(Number.isFinite(n) ? n : 3))) });
}

// ---------------------------------------------------------------- cases

export interface CityCaseView {
  id: string;
  events: { n: number; timestamp: string; stage: string | null; channel: string | null; from: string | null; to: string | null; body: string; source?: string }[];
  context?: string | null;
  mode?: "demo" | "practice";
}

/** A case view from the city, or a reason it isn't one. */
export function parseCityCase(body: unknown): { view: CityCaseView; label: string } | { error: string } {
  const b = body as { view?: Partial<CityCaseView>; label?: unknown } | null;
  const v = b?.view;
  if (!v || typeof v.id !== "string" || !v.id || !Array.isArray(v.events) || v.events.length === 0) return { error: "view with id and events is required" };
  if (v.events.some((e) => !e || typeof e.body !== "string")) return { error: "every event needs a body" };
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : v.id;
  return {
    view: { id: v.id.slice(0, 120), events: v.events, ...(typeof v.context === "string" ? { context: v.context } : {}), mode: v.mode === "practice" ? "practice" : "demo" },
    label,
  };
}

/**
 * Write a "running" execution for a city case (origin city, simulated) and start the agent call in the
 * background. Returns the execution id at once; the city polls /api/console/executions/:id.
 * `run` is injectable for tests.
 */
export function startCityCase(
  view: CityCaseView,
  label: string,
  run: (base: ExecutionWrite, body: unknown) => Promise<void> = (base, body) => recordAgentRun(base, body, () => true),
): { id: string; done: Promise<void> } {
  const base: ExecutionWrite = {
    id: randomUUID(),
    sourceKey: null,
    caseId: view.id,
    dataset: CITY_DATASET,
    workflowId: "default-incident",
    status: "running",
    outcome: null,
    startedAt: new Date().toISOString(),
    durationMs: null,
    costUsd: null,
    origin: "city",
    simulated: true,
    title: label,
    nextAction: null,
    gate: null,
    error: null,
    trace: null,
    answerMd: null,
    reasoningMd: null,
    eval: null,
  };
  upsertExecution(base);
  const done = run(base, { ...view, mode: view.mode ?? "demo", flowId: base.workflowId })
    .catch((err: unknown) => {
      upsertExecution({ ...base, status: "error", error: err instanceof Error ? err.message : String(err) });
    })
    .then(() => {
      const row = getDb().prepare("SELECT cost_usd FROM executions WHERE id = ?").get(base.id);
      addCitySpend(row?.cost_usd === null || row?.cost_usd === undefined ? null : Number(row.cost_usd));
    })
    .catch(() => {});
  return { id: base.id, done };
}

/** The last `limit` city executions, newest first (summaries plus the decision card, no trace). */
export function cityRuns(limit = 20): (ExecutionListItem & { card: DecisionCard | null; runId: string | null })[] {
  const rows = listExecutions({ limit, dataset: CITY_DATASET });
  const cards = new Map<string, DecisionCard | null>();
  const runIds = new Map<string, string | null>();
  if (rows.length) {
    const q = getDb().prepare(`SELECT id, card, json_extract(trace, '$.runId') AS run_id FROM executions WHERE id IN (${rows.map(() => "?").join(",")})`).all(...rows.map((r) => r.id));
    for (const r of q) {
      runIds.set(String(r.id), r.run_id === null || r.run_id === undefined ? null : String(r.run_id));
      try {
        cards.set(String(r.id), r.card ? (JSON.parse(String(r.card)) as DecisionCard) : null);
      } catch {
        cards.set(String(r.id), null);
      }
    }
  }
  return rows.map((r) => ({ ...r, card: cards.get(r.id) ?? null, runId: runIds.get(r.id) ?? null }));
}

// ---------------------------------------------------------------- world state

export function getCityState(): { state: unknown; updatedAt: string } | null {
  const row = getDb().prepare("SELECT state, updated_at FROM city_state WHERE id = 1").get();
  if (!row) return null;
  try {
    return { state: JSON.parse(String(row.state)), updatedAt: String(row.updated_at) };
  } catch {
    return null;
  }
}

/** Save the world snapshot. Refuses non-objects and anything over 512 KB. */
export function putCityState(state: unknown): { ok: true; updatedAt: string } | { ok: false; error: string } {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { ok: false, error: "state must be an object" };
  const text = JSON.stringify(state);
  if (text.length > MAX_STATE_BYTES) return { ok: false, error: "state too large" };
  const updatedAt = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO city_state (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    .run(text, updatedAt);
  return { ok: true, updatedAt };
}
