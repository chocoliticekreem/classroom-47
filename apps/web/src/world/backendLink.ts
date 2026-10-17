// Links the 3D city to the real backend. Three feeds, all replayed through agentBridge.traceToTimedEvents:
//   1. City incidents -> a synthetic case view (every event `source: "simulated_persona"`, mode "demo",
//      so apps/api labels the trace synthetic) -> same-origin POST /api/console/city/cases, which records it in
//      the console's SQLite (origin "city", dataset "city-live") and runs it on the agent -> the city follows
//      /api/console/executions/:id -> trace replay. World state itself persists via cityState.ts.
//   2. Console runs (Execute and test runs) -> polled from the same-origin /api/console/executions every 4 s;
//      each NEW finished execution with a trace is replayed once.
//   3. Decision cards -> recorded through the human review queue's API (/api/review/tasks...), the same
//      endpoints useReviewQueue uses. A card from a console case run is then re-run with the choice
//      (WorkflowHud/rerun.ts); the toast replays that re-run itself, so the poller skips it.
// Data rule (PRD J0): every replayed event carries source "agent" plus origin and synthetic flags; nothing
// here invents results. The pure parts (builder, poller, decision recording) take their I/O as arguments.
import type { DecisionCard, Trace } from "../../../api/src/lib/trace";
import type { ViewEvent } from "./agentBridge";
import type { Delivery, Incident, IncidentKind, WorkflowEvent } from "./store";

// ---------------------------------------------------------------- 1. incident -> case view

export interface IncidentCaseView {
  id: string;
  context: string;
  events: ViewEvent[];
  mode: "demo";
}

export interface IncidentCase {
  view: IncidentCaseView;
  /** Deliveries named in the case (most affected first). */
  affected: Delivery[];
}

const KIND_PHRASE: Record<IncidentKind, string> = {
  car_crash: "a car crash",
  truck_crash: "a lorry crash",
  pileup: "a multi-vehicle pile-up",
  roadworks: "emergency roadworks",
  breakdown: "a van breakdown",
  plane_crash: "an aircraft crash near the airport",
  emergency_landing: "an emergency landing at the airport",
  cyclist_hit: "a cyclist hit by a vehicle",
  event_closure: "roads closed for a city event",
};

function driverReport(kind: IncidentKind, dls: Delivery[]): string {
  const ids = dls.map((d) => d.id).join(", ");
  const onBoard = ids ? ` On board for this run: ${ids}.` : "";
  switch (kind) {
    case "breakdown":
      return `Van's broken down, won't restart. Hazards on, waiting for recovery. I can't move the parcels myself.${onBoard} No idea how long recovery will take.`;
    case "roadworks":
      return `Road's shut for roadworks, cones right across. Sat nav keeps sending me back into it. Going to be late on the next drops.${onBoard}`;
    case "plane_crash":
    case "emergency_landing":
      return `Airport cargo road is closed, police turning everyone back. I'm stuck in the queue with collections and drops still to do.${onBoard}`;
    default:
      return `Stuck behind ${KIND_PHRASE[kind]}, emergency services on scene and the road is closed. Nobody's moving.${onBoard} Next drops will be late.`;
  }
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Pick the deliveries a city incident plausibly affects: active ones (en_route/delayed) whose stop is on the
 * blocked road first, then the active ones whose truck is closest to the incident, up to `max`.
 */
export function affectedDeliveries(
  incident: Pick<Incident, "edgeKey" | "x" | "z">,
  deliveries: Record<string, Delivery>,
  positions: Record<string, { x: number; z: number }> = {},
  max = 3,
): Delivery[] {
  const ends = new Set(incident.edgeKey.split("|"));
  const active = Object.values(deliveries).filter((d) => d.status === "en_route" || d.status === "delayed");
  const dist = (d: Delivery) => {
    const p = positions[d.truckId];
    return p ? Math.hypot(p.x - incident.x, p.z - incident.z) : Number.POSITIVE_INFINITY;
  };
  return active
    .map((d) => ({ d, onRoad: ends.has(d.stop) ? 0 : 1, dist: dist(d) }))
    .sort((a, b) => a.onRoad - b.onRoad || a.dist - b.dist || a.d.id.localeCompare(b.d.id))
    .slice(0, max)
    .map((x) => x.d);
}

/**
 * The case the agent gets for a city incident. Context: the incident note and the affected deliveries
 * from the store. Events: a driver report and a customer "where's my parcel". Every event is tagged
 * `simulated_persona` and the view runs in mode "demo", so the backend marks the trace synthetic.
 * No expected answer, plan or outcome is included (nothing to leak: the city has no answer key for
 * incidents, and the mock engine's plan text is never used).
 */
export function buildIncidentCase(
  incident: Incident,
  deliveries: Record<string, Delivery>,
  opts: { now: Date; seq: number; positions?: Record<string, { x: number; z: number }> },
): IncidentCase {
  const affected = affectedDeliveries(incident, deliveries, opts.positions);
  const now = opts.now.getTime();
  const lines = affected.map((d) => {
    const eta = new Date(now + Math.max(0, d.etaS) * 1000);
    return `- ${d.id}: ${d.status.replace("_", " ")}, vehicle ${d.truckId}, stop ${d.stop}, planned arrival ${hhmm(eta)} UTC`;
  });
  const context = [
    `Live incident reported by the city operations feed at ${hhmm(opts.now)} UTC (${incident.kind.replace("_", " ")}).`,
    `Incident: ${incident.note || KIND_PHRASE[incident.kind]}`,
    `Road affected: ${incident.edgeKey}.`,
    affected.length ? `Hamyway deliveries on routes near the incident:\n${lines.join("\n")}` : "No Hamyway delivery is confirmed on the affected road yet.",
  ].join("\n");

  const lead = affected[0];
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const events: ViewEvent[] = [
    {
      n: 1, timestamp: iso(4 * 60_000), stage: "Context", channel: "Driver app",
      from: lead ? `Driver, vehicle ${lead.truckId}` : "Driver, Hamyway van", to: "Rivet Delivery Desk",
      body: driverReport(incident.kind, affected), source: "simulated_persona",
    },
    {
      n: 2, timestamp: iso(60_000), stage: "Escalation", channel: "Customer portal",
      from: lead ? `Customer, recipient of ${lead.id}` : "Customer",
      to: "Rivet Delivery Desk",
      body: lead
        ? `Where's my parcel? Tracking for ${lead.id} said it would be here by now and it hasn't moved. Is it still coming today? Do I need to stay in?`
        : "Where's my parcel? Tracking hasn't updated for ages and I was told it would arrive this afternoon. Is it still coming today?",
      source: "simulated_persona",
    },
  ];
  return { view: { id: `city-inc-${opts.seq}-${incident.id}`, context, events, mode: "demo" }, affected };
}

/**
 * One case per delay cause: every delivery the fleet reported late for the same reason, grouped.
 * Events (all `simulated_persona`, mode "demo"): a dispatch note naming the cause and the deliveries,
 * and a customer "where's my parcel" for the first one. Context lists the deliveries from the store.
 */
export function buildDelayCase(
  reason: string,
  ids: readonly string[],
  deliveries: Record<string, Delivery>,
  opts: { now: Date; seq: number },
): { view: IncidentCaseView; ids: string[] } {
  const now = opts.now.getTime();
  const known = ids.map((id) => deliveries[id]).filter((d): d is Delivery => !!d);
  const lines = ids.map((id) => {
    const d = deliveries[id];
    return d
      ? `- ${d.id}: ${d.status.replace("_", " ")}, vehicle ${d.truckId}, stop ${d.stop}, planned arrival ${hhmm(new Date(now + Math.max(0, d.etaS) * 1000))} UTC`
      : `- ${id}: reported late`;
  });
  const cause = reason.trim() || "cause not reported";
  const context = [
    `Delay report from the city operations feed at ${hhmm(opts.now)} UTC.`,
    `${ids.length} deliver${ids.length === 1 ? "y" : "ies"} reported late, cause given by the fleet: ${cause}.`,
    `Deliveries:\n${lines.join("\n")}`,
  ].join("\n");
  const first = ids[0];
  const lead = known[0];
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const events: ViewEvent[] = [
    {
      n: 1, timestamp: iso(3 * 60_000), stage: "Context", channel: "Dispatch chat",
      from: lead ? `Driver, vehicle ${lead.truckId}` : "Dispatch", to: "Rivet Delivery Desk",
      body: `Running late on ${ids.join(", ")}. Reason: ${cause}. Can't give a firm new time yet.`, source: "simulated_persona",
    },
    {
      n: 2, timestamp: iso(60_000), stage: "Escalation", channel: "Customer portal",
      from: `Customer, recipient of ${first}`, to: "Rivet Delivery Desk",
      body: `Where's my parcel? ${first} was due by now and tracking hasn't moved. Is it still coming today?`, source: "simulated_persona",
    },
  ];
  return { view: { id: `city-delay-${opts.seq}`, context, events, mode: "demo" }, ids: [...ids] };
}

/**
 * Groups delivery:delayed events by cause over a short window, so N late deliveries with one cause make one
 * case. A delivery already waiting in an open group is ignored.
 */
export class DelayGrouper {
  private buckets = new Map<string, { ids: string[]; firstAt: number }>();
  constructor(private windowMs = 20_000) {}

  add(deliveryId: string, reason: string, now: number) {
    for (const b of this.buckets.values()) if (b.ids.includes(deliveryId)) return;
    const key = reason.trim() || "unknown cause";
    const b = this.buckets.get(key);
    if (b) b.ids.push(deliveryId);
    else this.buckets.set(key, { ids: [deliveryId], firstAt: now });
  }

  /** Groups whose window has closed, removed from the grouper. */
  due(now: number): { reason: string; ids: string[] }[] {
    const out: { reason: string; ids: string[] }[] = [];
    for (const [reason, b] of this.buckets) {
      if (now - b.firstAt < this.windowMs) continue;
      this.buckets.delete(reason);
      out.push({ reason, ids: b.ids });
    }
    return out;
  }
}

// ---------------------------------------------------------------- 2. console executions

/** A row of GET /api/console/executions (summary, no trace). */
export interface ExecutionRow {
  id: string;
  caseId: string;
  status: "running" | "success" | "error";
  origin: string;
  simulated: boolean;
  costUsd: number | null;
  startedAt: string;
  parentExecutionId?: string | null;
}

/** Parents whose decision re-run the HUD toast replays itself (WorkflowHud/rerun.ts); the poller skips those. */
export const rerunParents = new Set<string>();

/** GET /api/console/executions/:id -> execution with trace and card. */
export interface ExecutionDetail extends ExecutionRow {
  trace: Trace | null;
  card?: DecisionCard | null;
  outbox?: unknown[] | null;
}

export type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;

export const EXECUTIONS_URL = "/api/console/executions?limit=10";
export const POLL_MS = 4000;

/**
 * Finds console executions that are new since the page opened. The first poll only seeds what already
 * exists (no replay of history). Running rows are retried until they finish. A finished row is fetched
 * once; it's replayed only if its trace exists and its runId wasn't replayed already (the console can
 * re-import a city run's review record from runs/api, so dedupe is by runId as well as by id).
 */
export class ExecutionPoller {
  private seen = new Set<string>();
  private seeded = false;
  constructor(private fetchJson: FetchJson, private runIds: Set<string>) {}

  async poll(): Promise<ExecutionDetail[]> {
    const body = (await this.fetchJson(EXECUTIONS_URL)) as { executions?: ExecutionRow[] } | null;
    const rows = Array.isArray(body?.executions) ? body.executions : [];
    if (!this.seeded) {
      this.seeded = true;
      for (const r of rows) if (r.status !== "running") this.seen.add(r.id);
      return [];
    }
    const fresh: ExecutionDetail[] = [];
    // Oldest first, so replays come out in the order they ran.
    for (const r of [...rows].reverse()) {
      if (this.seen.has(r.id) || r.status === "running") continue;
      this.seen.add(r.id);
      // City cases (origin "city") are followed and replayed by the city link itself (agentBridge.runCityCase).
      if (r.origin === "city") continue;
      if (r.parentExecutionId && rerunParents.has(r.parentExecutionId)) continue;
      const d = (await this.fetchJson(`/api/console/executions/${encodeURIComponent(r.id)}`)) as { execution?: ExecutionDetail } | null;
      const ex = d?.execution;
      if (!ex?.trace?.events?.length) continue;
      if (this.runIds.has(ex.trace.runId)) continue;
      this.runIds.add(ex.trace.runId);
      fresh.push(ex);
    }
    return fresh;
  }
}

/** HUD origin for a console execution. */
export function originOf(ex: Pick<ExecutionRow, "origin">): WorkflowEvent["origin"] {
  const o = ex.origin;
  return o === "voice" || o === "runs" || o === "answers" || o === "examples" ? o : "console";
}

// ---------------------------------------------------------------- provenance labels

/**
 * One plain provenance label per case (docs/plans/ui-simplify-brief.md): "Live" for the real agent's
 * results, "Practice case" for cases built from city events (simulated_persona inputs, synthetic trace).
 * Anything not from the agent gets no "Live" label.
 */
export function provenanceLabel(e: Pick<WorkflowEvent, "source" | "synthetic" | "origin"> | null | undefined): string {
  if (!e || !e.source || e.source === "mock" || e.source === "simulated_persona") return "Not live";
  return e.synthetic ? "Practice case" : "Live";
}

// ---------------------------------------------------------------- 3. decisions -> review queue

export interface ReplayRecord {
  caseLabel: string;
  trace: Trace;
  card: DecisionCard | null;
  outbox: unknown[] | null;
  origin: WorkflowEvent["origin"];
  executionId?: string;
}

/** Full traces of real replays, outside the store's capped event list (PRD J4.3). */
const replays = new Map<string, ReplayRecord>();
const MAX_REPLAYS = 60;

export function rememberReplay(r: ReplayRecord) {
  replays.delete(r.caseLabel);
  replays.set(r.caseLabel, r);
  while (replays.size > MAX_REPLAYS) replays.delete(replays.keys().next().value as string);
}

export function replayFor(caseLabel: string): ReplayRecord | undefined {
  return replays.get(caseLabel);
}

export function replayByRun(runId: string, caseId?: string): ReplayRecord | undefined {
  for (const r of replays.values()) if (r.trace.runId === runId && (!caseId || r.trace.caseId === caseId)) return r;
  return undefined;
}

export type DecisionOutcome =
  | { status: "recorded"; taskId: string; note: string }
  | { status: "not_sent"; reason: string };

/** What the HUD knows about the review task (subset of review/types ReviewTask). */
interface TaskRef { id: string; runId: string; caseId: string; status: string; options: { id: string }[] }

/**
 * Record a choice on a real decision card through the review queue's API (the same endpoints as
 * review/useReviewQueue): find the task by runId + caseId in GET /api/review/tasks, register the trace
 * with POST /api/review/tasks if the queue doesn't have it, then POST /api/review/tasks/:id/decision.
 * Never throws: on any failure the choice stays local and the caller labels it "not sent".
 */
export async function recordDecision(
  args: { runId: string; caseId: string; optionId: string; who: string; note?: string; replay?: ReplayRecord },
  fetchJson: FetchJson,
): Promise<DecisionOutcome> {
  try {
    const q = (await fetchJson("/api/review/tasks")) as { tasks?: TaskRef[] } | null;
    let task = q?.tasks?.find((t) => t.runId === args.runId && t.caseId === args.caseId);
    if (!task && args.replay) {
      const reg = (await fetchJson("/api/review/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace: args.replay.trace, result: { card: args.replay.card, outbox: args.replay.outbox } }),
      })) as { task?: TaskRef | null; error?: string } | null;
      task = reg?.task ?? undefined;
    }
    if (!task) return { status: "not_sent", reason: "The review queue has no card for this run" };
    if (task.status !== "pending") return { status: "not_sent", reason: "A decision is already recorded on this card" };
    if (!task.options.some((o) => o.id === args.optionId)) return { status: "not_sent", reason: "That option is not on the queued card" };
    const res = (await fetchJson(`/api/review/tasks/${encodeURIComponent(task.id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId: args.optionId, who: args.who, note: args.note ?? "" }),
    })) as { task?: TaskRef; error?: string } | null;
    if (!res?.task) return { status: "not_sent", reason: res?.error ?? "The review queue did not save the decision" };
    return { status: "recorded", taskId: task.id, note: "Recorded in the human review queue." };
  } catch (e) {
    return { status: "not_sent", reason: e instanceof Error ? e.message : "The review queue is unreachable" };
  }
}

/** fetch() that resolves to the parsed JSON body (errors carry the body's `error`). */
export const browserFetchJson: FetchJson = async (url, init) => {
  const r = await fetch(url, { cache: "no-store", ...init });
  const body = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) throw new Error(body?.error ?? `${url} ${r.status}`);
  return body;
};
