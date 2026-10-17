// Budget guard for real-agent cases started by the city (incidents and staged scenarios). Pure.
// At most `maxPerWindow` real cases may start in any rolling `windowMs`; anything over waits in the agent
// queue (modules/WorkflowDriver/link.ts) until a slot frees up. There is no mock fallback. Spend is the sum of each finished trace's run_end.totalCostUsd.

export const BUDGET_WINDOW_MS = 10 * 60_000;
export const DEFAULT_MAX_PER_WINDOW = 3; // ~$25 left on the key today: keep the city cheap

export interface AgentBudget {
  maxPerWindow: number;
  windowMs: number;
  /** Start times (Date.now() ms) of real cases inside the window. */
  starts: number[];
  /** Real spend in USD, from run_end.totalCostUsd of finished city cases. */
  spentUsd: number;
  /** Real cases started / finished with a cost, since the page opened. */
  runs: number;
  /** Unused since the mock fallback was removed; kept at 0 for compatibility. */
  overBudget: number;
}

export function newBudget(maxPerWindow = DEFAULT_MAX_PER_WINDOW): AgentBudget {
  return { maxPerWindow, windowMs: BUDGET_WINDOW_MS, starts: [], spentUsd: 0, runs: 0, overBudget: 0 };
}

/** Starts still inside the window at `now`. */
export function liveStarts(b: Pick<AgentBudget, "starts" | "windowMs">, now: number): number[] {
  return b.starts.filter((t) => now - t < b.windowMs && t <= now + 1000);
}

export function budgetLeft(b: AgentBudget, now: number): number {
  return Math.max(0, b.maxPerWindow - liveStarts(b, now).length);
}

/** When the next slot frees up (ms epoch), or null if one is free now. */
export function nextSlotAt(b: AgentBudget, now: number): number | null {
  const live = liveStarts(b, now).sort((x, y) => x - y);
  if (live.length < b.maxPerWindow) return null;
  return live[live.length - b.maxPerWindow] + b.windowMs;
}

/** Try to start a real case: the new budget, or null when over budget (the caller falls back to the mock). */
export function claimRun(b: AgentBudget, now: number): AgentBudget | null {
  const live = liveStarts(b, now);
  if (live.length >= b.maxPerWindow) return null;
  return { ...b, starts: [...live, now], runs: b.runs + 1 };
}

/** Add a finished trace's cost (ignores non-finite or negative values). */
export function addSpend(b: AgentBudget, usd: number): AgentBudget {
  return Number.isFinite(usd) && usd > 0 ? { ...b, spentUsd: b.spentUsd + usd } : b;
}

export function clampMax(n: number): number {
  return Math.max(0, Math.min(60, Math.round(Number.isFinite(n) ? n : DEFAULT_MAX_PER_WINDOW)));
}

/** Merge start times from another tab (shared via localStorage) so two open cities share one budget. */
export function mergeStarts(a: number[], b: number[], now: number, windowMs: number): number[] {
  return [...new Set([...a, ...b])].filter((t) => now - t < windowMs).sort((x, y) => x - y);
}
