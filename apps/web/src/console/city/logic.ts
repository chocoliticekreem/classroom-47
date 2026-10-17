// Pure helpers for the console City tab: the few plain controls, connection state, and plain sentences
// for what's happening in the city (docs/plans/ui-simplify-brief.md).
import type { CityCommand, CityTelemetry } from "../../world/controlChannel";
import type { Modifier } from "../../world/scenarios";
import { plainNode } from "../../ui/plain";

export type WeatherChoice = "clear" | "overcast" | "rain" | "storm";
export type InjectEvent = Extract<CityCommand, { type: "inject" }>["event"];

export const WEATHERS: { id: WeatherChoice; label: string }[] = [
  { id: "clear", label: "Sunny" },
  { id: "overcast", label: "Cloudy" },
  { id: "rain", label: "Rain" },
  { id: "storm", label: "Storm" },
];

export type TimeChoice = "day" | "evening" | "night";
export const TIMES: { id: TimeChoice; label: string; hour: number }[] = [
  { id: "day", label: "Day", hour: 12 },
  { id: "evening", label: "Evening", hour: 18.5 },
  { id: "night", label: "Night", hour: 22.5 },
];

export type SpeedChoice = "normal" | "fast";
export const SPEEDS: { id: SpeedChoice; label: string; scale: number }[] = [
  { id: "normal", label: "Normal", scale: 1 },
  { id: "fast", label: "Fast", scale: 10 },
];

export const HAPPENINGS: { event: InjectEvent; label: string }[] = [
  { event: "car_crash", label: "Car crash" },
  { event: "truck_crash", label: "Truck crash" },
  { event: "roadworks", label: "Roadworks" },
  { event: "breakdown", label: "Van breaks down" },
  { event: "emergency_landing", label: "Plane emergency" },
];

/** Which weather button is lit for the city's current weather (drizzle counts as rain). */
export function weatherBucket(w: string | undefined): WeatherChoice | null {
  if (w === "clear" || w === "overcast" || w === "rain" || w === "storm") return w;
  if (w === "drizzle") return "rain";
  return null;
}

export function timeBucket(h: number | undefined): TimeChoice | null {
  if (h == null || !Number.isFinite(h)) return null;
  const x = ((h % 24) + 24) % 24;
  if (x >= 6 && x < 17) return "day";
  if (x >= 17 && x < 20.5) return "evening";
  return "night";
}

export function speedBucket(scale: number | undefined): SpeedChoice | null {
  if (scale == null) return null;
  return scale > 1 ? "fast" : "normal";
}

/** Telemetry counts as connected if a snapshot arrived within this window (city posts every 1 s). */
export const STALE_MS = 3000;
export type LinkState = "waiting" | "live" | "stale";

export function linkState(last: CityTelemetry | null, now: number): LinkState {
  if (!last) return "waiting";
  return now - last.at <= STALE_MS ? "live" : "stale";
}

export const LINK_WORDS: Record<LinkState, string> = { live: "Connected", stale: "Not connected", waiting: "Connecting…" };

// ------------------------------------------------------------------ what's happening

const KIND: Record<string, string> = {
  car_crash: "Car crash",
  truck_crash: "Truck crash",
  pileup: "Pile-up",
  roadworks: "Roadworks",
  breakdown: "Van broke down",
  plane_crash: "Plane crash",
  emergency_landing: "Plane emergency",
};

const PHASE: Record<string, Record<string, string>> = {
  crash: { active: "help is coming", responding: "police on the way", clearing: "being cleared" },
  roadworks: { active: "road closed", responding: "crew at work", clearing: "almost done" },
  breakdown: { active: "van stopped", responding: "tow truck on the way", clearing: "being towed" },
  plane: { active: "crews on the way", responding: "crews at the scene", clearing: "being cleared" },
};

function family(kind: string) {
  if (kind === "roadworks") return "roadworks";
  if (kind === "breakdown") return "breakdown";
  if (kind === "plane_crash" || kind === "emergency_landing") return "plane";
  return "crash";
}

/** First capitalised place name after "on"/"at" in a note: "...ran a red on King St and..." -> "King St". */
export function placeFrom(note: string): string | null {
  const m = /\b(?:on|at|near) (?:the )?((?:[A-Z][\w'’.-]*)(?: (?:[A-Z][\w'’.-]*|of|the))*)/.exec(note);
  if (!m) return null;
  return m[1].replace(/ (?:of|the)$/, "");
}

/** "Truck crash on King St, police on the way". */
export function incidentSentence(i: { kind: string; status: string; note: string }): string {
  const what = KIND[i.kind] ?? "Something happened";
  const place = i.kind === "emergency_landing" ? "the airport" : placeFrom(i.note);
  const phase = PHASE[family(i.kind)][i.status] ?? (i.status === "cleared" ? "all clear" : "");
  return `${what}${place ? `${i.kind === "emergency_landing" ? " at" : " on"} ${place}` : ""}${phase ? `, ${phase}` : ""}`;
}

// ------------------------------------------------------------------ cases

export interface CaseRow {
  caseId: string;
  title: string; // "Case 42"
  status: string; // plain status word
  tone: "working" | "done" | "person" | "stopped";
  live: boolean; // from the real agent
}

const EXTRA_STEPS: Record<string, string> = { human: "Ask a person", log: "Done" };
const stepName = (id: string) => EXTRA_STEPS[id] ?? plainNode(id);

/** Latest status per case, newest case first. Never shows the raw step summaries. */
export function caseRows(workflow: CityTelemetry["workflow"], max = 6): CaseRow[] {
  const latest = new Map<string, CityTelemetry["workflow"][number]>();
  const live = new Set<string>();
  for (const e of workflow) {
    latest.delete(e.caseId); // re-insert so Map order = last activity
    latest.set(e.caseId, e);
    if (e.source === "agent") live.add(e.caseId);
  }
  const rows: CaseRow[] = [];
  for (const [caseId, e] of latest) {
    let status: string;
    let tone: CaseRow["tone"];
    if (e.status === "error") [status, tone] = ["Something went wrong", "stopped"];
    else if (e.status === "block") [status, tone] = ["Stopped", "stopped"];
    else if (e.status === "ask") [status, tone] = ["Needs a person", "person"];
    else if (e.status === "ok" && (e.nodeId === "case_log" || e.nodeId === "log")) [status, tone] = ["Done", "done"];
    else if (e.status === "ok" && e.nodeId === "action") [status, tone] = ["Sent", "done"];
    else [status, tone] = [`${stepName(e.nodeId).replace(/\?$/, "")}…`, "working"];
    const n = /(\d+)\s*$/.exec(caseId);
    rows.push({ caseId, title: n ? `Case ${Number(n[1])}` : "Case", status, tone, live: live.has(caseId) });
  }
  return rows.reverse().slice(0, max);
}

// ------------------------------------------------------------------ practice cases

export const TWISTS: Record<Modifier, string> = {
  conflicting_stories: "Stories don't match",
  failed_action: "Sending fails",
  missing_context: "Missing details",
  noise: "Extra noise",
  needs_human: "Needs a person",
  out_of_policy: "Asks for too much",
  prompt_injection: "Tries to trick it",
  privacy_request: "Asks for private info",
  repeat_complaint: "Asked before",
  cascade: "Many at once",
  time_pressure: "Deadline soon",
  do_nothing: "Already handled",
};

/** Case-insensitive match on id and title. Empty query returns everything. */
export function filterScenarios<T extends { id: string; title: string }>(list: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((s) => `${s.id} ${s.title}`.toLowerCase().includes(needle));
}

export function isTelemetry(m: unknown): m is CityTelemetry {
  return !!m && typeof m === "object" && (m as { type?: unknown }).type === "telemetry" && typeof (m as { at?: unknown }).at === "number";
}

// ------------------------------------------------------------------ cases from SQLite (shared with /city)

/** A city run as GET /api/console/city/state lists it (the same rows the /city HUD restores from). */
export interface SavedCityRun {
  id: string;
  caseId: string;
  title: string | null;
  status: "running" | "success" | "error";
  outcome: string | null;
  card: unknown;
  runId: string | null;
}

/**
 * Case rows from the city's SQLite runs, newest first: the same source the /city HUD restores from, so both
 * screens agree. "Needs a person" only while the review queue still has the decision open (`decidedRuns`).
 */
export function runRows(runs: readonly SavedCityRun[], decidedRuns: ReadonlySet<string> = new Set(), max = 6): CaseRow[] {
  return runs.slice(0, max).map((r) => {
    let status: string;
    let tone: CaseRow["tone"];
    if (r.status === "running") [status, tone] = ["Working on it…", "working"];
    else if (r.status === "error") [status, tone] = ["Something went wrong", "stopped"];
    else if (r.card && !(r.runId && decidedRuns.has(r.runId))) [status, tone] = ["Needs a person", "person"];
    else if (r.outcome === "blocked") [status, tone] = ["Stopped", "stopped"];
    else if (r.outcome === "acted") [status, tone] = ["Sent", "done"];
    else [status, tone] = ["Done", "done"];
    const label = r.title ?? r.caseId;
    const n = /^[A-Z]+-(\d+)/.exec(label);
    // City cases are built from city events (simulated inputs): always "Practice", never "Live".
    return { caseId: r.id, title: n ? `Case ${Number(n[1])}` : label, status, tone, live: false };
  });
}

/** How many city decisions are still open, from the same rows. */
export function openDecisions(runs: readonly SavedCityRun[], decidedRuns: ReadonlySet<string> = new Set()): number {
  return runs.filter((r) => r.status === "success" && r.card && !(r.runId && decidedRuns.has(r.runId))).length;
}
