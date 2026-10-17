// City persistence in the console's SQLite DB (GET/PUT /api/console/city/state), so a refresh of /city keeps
// its incidents, closures, events, weather, clock, HUD feed and waiting cases, and the console City tab reads
// the same thing. Vehicles are not saved: they respawn and re-path around the restored closures.
// The (de)serialisation and hydration are pure; the browser glue (load, debounced save, pagehide) is below.
import type { DecisionCard } from "../../../api/src/lib/trace";
import { cardFromTrace } from "./agentBridge";
import type { CityEvent, Incident, QueuedCase, WeatherOverride, WorkflowEvent } from "./store";

export const CITY_STATE_URL = "/api/console/city/state";
export const SAVE_EVERY_MS = 5000;
const MAX_FEED = 80;
const VERSION = 1;

export interface CitySnapshot {
  v: number;
  /** Wall clock (ms epoch) when saved. */
  savedAt: number;
  incidents: (Omit<Incident, "createdAt"> & { ageMs: number })[];
  events: (Omit<CityEvent, "startsAt" | "endsAt"> & { startsInMs: number; endsInMs: number | null })[];
  /** edgeKey -> reason. */
  blocked: Record<string, string>;
  weatherOverride: WeatherOverride;
  timeOfDay: number;
  timeScale: number;
  /** Recent HUD lines; `ageMs` = how long before savedAt it was shown. */
  feed: (Omit<WorkflowEvent, "t"> & { ageMs: number })[];
  /** Cases waiting for the agent. Incidents keep their id so they can be queued again. */
  queue: QueuedCase[];
}

/** The parts of the world store the snapshot reads. */
export interface SnapshotSource {
  incidents: Incident[];
  events: CityEvent[];
  blocked: Record<string, string>;
  weatherOverride: WeatherOverride;
  timeOfDay: number;
  timeScale: number;
  workflow: WorkflowEvent[];
  agentQueue: QueuedCase[];
}

const WEATHERS: WeatherOverride[] = ["auto", "clear", "overcast", "drizzle", "rain", "storm"];

/** World store -> snapshot. `perfNow` is performance.now(), `now` is Date.now(). Cleared incidents and ended events are dropped. */
export function serialiseCity(s: SnapshotSource, perfNow: number, now: number): CitySnapshot {
  return {
    v: VERSION,
    savedAt: now,
    incidents: s.incidents.filter((i) => i.status !== "cleared").map(({ createdAt, ...i }) => ({ ...i, ageMs: Math.max(0, perfNow - createdAt) })),
    events: s.events
      .filter((e) => e.status !== "ended")
      .map(({ startsAt, endsAt, ...e }) => ({ ...e, startsInMs: startsAt - perfNow, endsInMs: endsAt === null ? null : endsAt - perfNow })),
    blocked: { ...s.blocked },
    weatherOverride: s.weatherOverride,
    timeOfDay: s.timeOfDay,
    timeScale: s.timeScale,
    feed: s.workflow.slice(-MAX_FEED).map(({ t, ...e }) => ({ ...e, ageMs: Math.max(0, perfNow - t) })),
    queue: s.agentQueue.map((q) => ({ ...q })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** What hydration puts back in the store. */
export interface Hydration {
  incidents: Incident[];
  events: CityEvent[];
  blocked: Record<string, string>;
  weatherOverride: WeatherOverride;
  timeOfDay: number;
  timeScale: number;
  workflow: WorkflowEvent[];
  /** Queued incident ids to queue again on the agent link (other queued kinds can't be rebuilt). */
  requeueIncidents: string[];
  /** Queued scenario/delay labels that were dropped by the refresh. */
  droppedQueue: string[];
}

/**
 * Snapshot (unknown JSON from the DB) -> store values re-timed against this page's performance.now().
 * Returns null for anything that isn't a snapshot. Closures of restored incidents and events are kept
 * even if `blocked` lost them, so traffic keeps routing around them.
 */
export function hydrateCity(raw: unknown, perfNow: number): Hydration | null {
  if (!isObj(raw) || raw.v !== VERSION) return null;
  const incidents: Incident[] = (Array.isArray(raw.incidents) ? raw.incidents : [])
    .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.id === "string" && typeof i.kind === "string" && typeof i.edgeKey === "string")
    .map((i) => {
      const { ageMs, ...rest } = i;
      return { ...(rest as unknown as Omit<Incident, "createdAt">), x: num(i.x, 0), z: num(i.z, 0), note: typeof i.note === "string" ? i.note : "", createdAt: perfNow - num(ageMs, 0) };
    });
  const events: CityEvent[] = (Array.isArray(raw.events) ? raw.events : [])
    .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.id === "string")
    .map((e) => {
      const { startsInMs, endsInMs, ...rest } = e;
      return {
        ...(rest as unknown as Omit<CityEvent, "startsAt" | "endsAt">),
        closedEdges: Array.isArray(e.closedEdges) ? (e.closedEdges as string[]) : [],
        route: Array.isArray(e.route) ? (e.route as string[]) : [],
        startsAt: perfNow + num(startsInMs, 0),
        endsAt: typeof endsInMs === "number" ? perfNow + endsInMs : null,
      };
    });
  const blocked: Record<string, string> = {};
  if (isObj(raw.blocked)) for (const [k, v] of Object.entries(raw.blocked)) if (typeof v === "string") blocked[k] = v;
  for (const i of incidents) if (!blocked[i.edgeKey]) blocked[i.edgeKey] = i.kind;
  for (const e of events) if (e.status === "live") for (const k of e.closedEdges) if (!blocked[k]) blocked[k] = e.kind;
  const workflow: WorkflowEvent[] = (Array.isArray(raw.feed) ? raw.feed : [])
    .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.id === "string" && typeof e.caseId === "string")
    .map((e) => {
      const { ageMs, ...rest } = e;
      return { ...(rest as unknown as Omit<WorkflowEvent, "t">), t: perfNow - num(ageMs, 0) };
    });
  const queue = (Array.isArray(raw.queue) ? raw.queue : []).filter((q): q is QueuedCase => isObj(q) && typeof q.label === "string");
  return {
    incidents,
    events,
    blocked,
    weatherOverride: WEATHERS.includes(raw.weatherOverride as WeatherOverride) ? (raw.weatherOverride as WeatherOverride) : "auto",
    timeOfDay: Math.min(24, Math.max(0, num(raw.timeOfDay, 17.5))),
    timeScale: Math.min(30, Math.max(0, num(raw.timeScale, 1))),
    workflow,
    requeueIncidents: queue.filter((q) => q.kind === "incident" && q.incidentId && incidents.some((i) => i.id === q.incidentId)).map((q) => q.incidentId!),
    droppedQueue: queue.filter((q) => q.kind !== "incident" || !q.incidentId).map((q) => q.label),
  };
}

// ---------------------------------------------------------------- city runs from SQLite

/** A row of GET /api/console/city/state `runs`. */
export interface CityRun {
  id: string;
  caseId: string;
  title: string | null;
  status: "running" | "success" | "error";
  outcome: string | null;
  startedAt: string;
  costUsd: number | null;
  error: string | null;
  card: DecisionCard | null;
  runId: string | null;
}

export interface CityStateResponse {
  state: unknown;
  updatedAt: string | null;
  budget: { maxPerWindow: number; windowMs: number; starts: number[]; spentUsd: number; runs: number } | null;
  runs: CityRun[];
}

/**
 * Executions the restored feed doesn't mention yet (oldest first), one HUD line each, so nothing that ran
 * disappears on refresh. A run that stopped for a person gets its real card back unless the review queue
 * says it was already decided (`decidedRuns`). Restored "ask" lines whose card was decided since get a
 * closing line, so the HUD and the console count the same open decisions.
 */
export function missingRunLines(
  runs: readonly CityRun[],
  feed: readonly Pick<WorkflowEvent, "caseId" | "status" | "runId" | "executionId">[],
  decidedRuns: ReadonlySet<string> = new Set(),
): Omit<WorkflowEvent, "id" | "t">[] {
  const known = new Set(feed.map((e) => e.executionId).filter(Boolean));
  const knownRuns = new Set(feed.map((e) => e.runId).filter(Boolean));
  const out: Omit<WorkflowEvent, "id" | "t">[] = [];
  for (const r of [...runs].reverse()) {
    if (known.has(r.id) || (r.runId && knownRuns.has(r.runId))) continue;
    const caseId = r.title ?? r.caseId;
    const base = { caseId, source: "agent" as const, origin: "city_incident" as const, synthetic: true, executionId: r.id, ...(r.runId ? { runId: r.runId } : {}) };
    if (r.status === "running") out.push({ ...base, nodeId: "ingest", status: "start", summary: "Still running on the agent…" });
    else if (r.status === "error") out.push({ ...base, nodeId: "log", status: "error", summary: "Couldn't reach the agent. Nothing was sent." });
    else if (r.card && !(r.runId && decidedRuns.has(r.runId))) {
      const card = cardFromTrace(r.card, `${r.runId ?? r.id}:human`);
      out.push({ ...base, nodeId: "human", status: "ask", summary: `A person needs to decide: ${r.card.whyStopped?.line ?? r.card.summary}`.slice(0, 120), card, decision: "hold_for_human" });
    } else if (r.card) out.push({ ...base, nodeId: "log", status: "ok", summary: "Done: a person decided" });
    else out.push({ ...base, nodeId: "log", status: "ok", summary: `Done: ${r.outcome ?? "finished"}`, ...(r.costUsd !== null ? { costUsd: r.costUsd } : {}) });
  }
  // Open questions in the restored feed that a person answered since (here or in the console).
  const latest = new Map<string, (typeof feed)[number]>();
  for (const e of feed) latest.set(e.caseId, e);
  for (const e of latest.values()) {
    if (e.status === "ask" && e.runId && decidedRuns.has(e.runId)) {
      out.push({ caseId: e.caseId, nodeId: "log", status: "ok", summary: "Done: a person decided", source: "agent", origin: "city_incident", synthetic: true, runId: e.runId });
    }
  }
  return out;
}

// ---------------------------------------------------------------- browser glue

type Fetch = typeof fetch;

export async function loadCityState(f: Fetch = fetch): Promise<CityStateResponse | null> {
  try {
    const r = await f(CITY_STATE_URL, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as CityStateResponse;
  } catch {
    return null;
  }
}

export async function saveCityState(snapshot: CitySnapshot, f: Fetch = fetch, keepalive = false): Promise<boolean> {
  try {
    const r = await f(CITY_STATE_URL, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: snapshot }), keepalive });
    return r.ok;
  } catch {
    return false;
  }
}
