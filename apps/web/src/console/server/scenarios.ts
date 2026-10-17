// Scenario sets for the test-and-improve loop. Pure: callers pass the catalogue in.
import type { ScenarioSetId } from "../types";
import type { CaseWithMutation } from "./catalogue";

/** The contract's set ids plus "city" (data/city, 50 hand-written city cases). Contract change requested. */
export type SetId = ScenarioSetId | "city";

/** Five public cases from different scenes: slot change, disputed failed attempt, damage, returns, customs. */
export const QUICK_CASES = ["delivery-001", "delivery-013", "delivery-022", "delivery-031", "delivery-045"];

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

export const SET_LABELS: Record<SetId, string> = {
  quick: "Quick: 5 sample cases, one of each kind",
  fixtures: "Hard cases: 12 tricky ones written by hand",
  adversarial: "Trick cases: written to catch it out",
  generated: "Generated hard cases",
  city: "City cases: closures, road incidents, events, secure deliveries",
  haiku: "Extra written cases: right answers not checked by a person",
  bulk: "Bulk (rule-made)",
  custom: "Pick cases by name",
};

export function clampLimit(limit: unknown): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

/** The cases in a set before any filter or limit. Generated includes the grounded ones (same folder). */
export function setMembers(set: SetId, all: CaseWithMutation[], caseIds: string[] = []): CaseWithMutation[] {
  switch (set) {
    case "quick":
      return QUICK_CASES.map((id) => all.find((c) => c.id === id && c.dataset === "public")).filter((c): c is CaseWithMutation => Boolean(c));
    case "fixtures":
      return all.filter((c) => c.dataset === "fixtures");
    case "adversarial":
      return all.filter((c) => c.dataset === "adversarial");
    case "city":
      return all.filter((c) => c.dataset === "city");
    case "haiku":
      return all.filter((c) => c.dataset === "haiku");
    case "bulk":
      return all.filter((c) => c.dataset === "bulk");
    case "generated":
      return all.filter((c) => c.dataset === "generated" || c.dataset === "grounded");
    case "custom": {
      const out: CaseWithMutation[] = [];
      for (const id of caseIds) {
        const hit = all.find((c) => c.id === id);
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    }
  }
}

/** Mutations present in a list, sorted, for the filter dropdown. */
export function mutationsOf(cases: CaseWithMutation[]): string[] {
  return [...new Set(cases.map((c) => c.mutation).filter((m): m is string => Boolean(m)))].sort();
}

/** Takes `limit` cases, round-robin across mutations so a small run still covers several patterns. */
export function spread(cases: CaseWithMutation[], limit: number): CaseWithMutation[] {
  const groups = new Map<string, CaseWithMutation[]>();
  for (const c of cases) {
    const k = c.mutation ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const queues = [...groups.values()];
  const out: CaseWithMutation[] = [];
  for (let i = 0; out.length < limit && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < limit) out.push(q[i]);
  }
  return out;
}

export class SetError extends Error {
  readonly status = 400;
}

/**
 * The cases a test run will execute. `filter` is a comma-separated mutation list (generated,
 * adversarial). Unknown custom ids are an error, not silently dropped.
 */
export function resolveSet(
  input: { set: SetId; filter?: string | null; caseIds?: string[] | null; limit?: unknown },
  all: CaseWithMutation[],
): CaseWithMutation[] {
  if (!(input.set in SET_LABELS)) throw new SetError(`unknown scenario set "${input.set}"`);
  const limit = clampLimit(input.limit);
  if (input.set === "custom") {
    const ids = (input.caseIds ?? []).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new SetError("a custom set needs caseIds");
    const unknown = ids.filter((id) => !all.some((c) => c.id === id));
    if (unknown.length) throw new SetError(`unknown case ids: ${unknown.join(", ")}`);
    return setMembers("custom", all, ids).slice(0, limit);
  }
  let members = setMembers(input.set, all);
  const wanted = (input.filter ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (wanted.length) {
    const known = new Set(mutationsOf(members));
    const bad = wanted.filter((m) => !known.has(m));
    if (bad.length) throw new SetError(`no ${input.set} cases with mutation ${bad.join(", ")}`);
    members = members.filter((c) => c.mutation && wanted.includes(c.mutation));
  }
  if (!members.length) throw new SetError(`the ${input.set} set has no cases`);
  return input.set === "quick" || input.set === "fixtures" ? members.slice(0, limit) : spread(members, limit);
}

export function listSets(all: CaseWithMutation[]) {
  return (["quick", "fixtures", "adversarial", "generated", "city", "haiku", "bulk", "custom"] as const).map((id) => {
    const members = id === "custom" ? all : setMembers(id, all);
    const filters = id === "generated" || id === "adversarial" || id === "city" || id === "haiku" || id === "bulk" ? mutationsOf(members) : undefined;
    return { id, label: SET_LABELS[id], count: members.length, ...(filters ? { filters } : {}) };
  });
}
