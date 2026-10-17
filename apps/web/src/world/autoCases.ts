// "Auto" in the top bar: plays real practice cases in the city on a timer, instead of the Scenarios module's
// own autoplay. Order: the organisers' 50 sample cases first, then round-robin across the other sets (a random
// case from each). A case starts only when the agent is idle and the shared budget (3 per 10 min) has a slot,
// at most one every AUTO_INTERVAL_MS. Pure planning here; the HUD (WorkflowHud/autoCases.tsx) drives it.

export const AUTO_INTERVAL_MS = 3 * 60_000;
/** First case this long after Auto is switched on (or the page opens). */
export const AUTO_FIRST_MS = 15_000;
export const AUTO_STORAGE_KEY = "rivet.city.autoCases";

/** Read per frame by the Scenarios module: while the HUD drives Auto, its own autoplay stays off. */
export const autoCasesStatus = { driving: false };

export interface SetCount {
  id: string;
  count: number;
}

/** Which case the step-th auto pick is: the sample set in order first, then one random case per other set in turn. */
export function planPick(step: number, sets: SetCount[], rand: () => number, first = "public"): { set: string; offset: number } | null {
  const lead = sets.find((s) => s.id === first && s.count > 0);
  if (lead && step < lead.count) return { set: lead.id, offset: step };
  const rest = sets.filter((s) => s.id !== first && s.count > 0);
  if (!rest.length) return lead ? { set: lead.id, offset: step % lead.count } : null;
  const s = rest[(step - (lead?.count ?? 0)) % rest.length];
  return { set: s.id, offset: Math.min(s.count - 1, Math.floor(rand() * s.count)) };
}

/** Whether to start the next auto case now. */
export function shouldFire(x: { on: boolean; now: number; nextAt: number; idle: boolean; budgetLeft: number; busy: boolean }): boolean {
  return x.on && !x.busy && x.idle && x.budgetLeft > 0 && x.now >= x.nextAt;
}
