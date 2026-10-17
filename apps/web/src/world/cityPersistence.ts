// Browser side of the city's SQLite persistence (cityState.ts has the pure parts). restoreCity() runs once
// before the 3D modules mount; startCitySaver() saves every ~5 s (when something changed) and on pagehide.
import { hydrateCity, loadCityState, missingRunLines, saveCityState, serialiseCity, SAVE_EVERY_MS, type CityRun } from "./cityState";
import { restoreQueue } from "./modules/WorkflowDriver/handle";
import { useWorld } from "./store";

const newId = () => `rst-${Math.random().toString(36).slice(2, 10)}`;

/** runIds whose review-queue task is no longer pending (decided here or in the console). */
async function decidedRuns(): Promise<Set<string>> {
  try {
    const r = await fetch("/api/review/tasks", { cache: "no-store" });
    if (!r.ok) return new Set();
    const body = (await r.json()) as { tasks?: { runId?: string; status?: string }[] };
    return new Set((body.tasks ?? []).filter((t) => t.runId && t.status && t.status !== "pending").map((t) => t.runId!));
  } catch {
    return new Set();
  }
}

/**
 * Load the saved city and the recent city runs from SQLite into the world store. Never throws; resolves
 * when done (or straight away when there is nothing saved / the console API is down).
 */
export async function restoreCity(stillWanted: () => boolean = () => true): Promise<void> {
  const [res, decided] = await Promise.all([loadCityState(), decidedRuns()]);
  if (!res || !stillWanted()) return; // too late: the city already started without it
  const st = useWorld.getState();
  if (res.budget) st.syncAgentBudget(res.budget.starts, res.budget.spentUsd, res.budget.maxPerWindow);
  const now = performance.now();
  const h = hydrateCity(res.state, now);
  const runs: CityRun[] = Array.isArray(res.runs) ? res.runs : [];
  const feed = h?.workflow ?? [];
  const lines = missingRunLines(runs, feed, decided).map((e, i) => ({ ...e, id: newId(), t: now + i }));
  if (h) {
    st.hydrate({
      incidents: h.incidents,
      events: h.events,
      blocked: h.blocked,
      weatherOverride: h.weatherOverride,
      timeOfDay: h.timeOfDay,
      timeScale: h.timeScale,
      workflow: [...feed, ...lines],
    });
  } else if (lines.length) {
    for (const l of lines) st.pushWorkflow(l);
  }
  restoreQueue({
    requeueIncidents: h?.requeueIncidents ?? [],
    resume: runs.filter((r) => r.status === "running").map((r) => ({ executionId: r.id, label: r.title ?? r.caseId })),
  });
}

/** Save the world to SQLite every SAVE_EVERY_MS while it changes, and once more on pagehide. Returns a stop function. */
export function startCitySaver(): () => void {
  let dirty = false;
  const unsub = useWorld.subscribe((s, p) => {
    if (s.incidents !== p.incidents || s.events !== p.events || s.blocked !== p.blocked || s.workflow !== p.workflow ||
      s.agentQueue !== p.agentQueue || s.weatherOverride !== p.weatherOverride || s.timeScale !== p.timeScale) dirty = true;
  });
  const save = (keepalive = false) => {
    dirty = false;
    void saveCityState(serialiseCity(useWorld.getState(), performance.now(), Date.now()), fetch, keepalive);
  };
  // Time of day moves every frame, so it alone doesn't mark the city dirty; it rides along with other saves.
  const timer = setInterval(() => dirty && save(), SAVE_EVERY_MS);
  const onHide = () => save(true);
  window.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", onHide);
    unsub();
  };
}
