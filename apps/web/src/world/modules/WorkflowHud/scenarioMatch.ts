// Pure helpers for the HUD's scenario features: case→scenario lookup, expected-vs-chosen matching, list grouping.
import type { CaseScenario, Where } from "../../scenarios";
import type { WorkflowEvent } from "../../store";

type Expected = NonNullable<CaseScenario["expected"]>;

/** "CASE-delivery-024-r3" → "delivery-024". */
export function scenarioIdOf(caseId: string): string | null {
  const m = /delivery-\d{3}/.exec(caseId);
  return m ? m[0] : null;
}

const ACTION_RANK: Record<string, number> = { action: 3, human: 2, planner: 1 };

/** The mock agent's chosen action for a case: latest action event, else human, else planner. */
export function chosenAction(events: readonly WorkflowEvent[], caseId: string): WorkflowEvent | null {
  let best: WorkflowEvent | null = null;
  let bestRank = 0;
  for (const e of events) {
    if (e.caseId !== caseId) continue;
    const r = ACTION_RANK[e.nodeId] ?? 0;
    if (r && r >= bestRank) {
      best = e;
      bestRank = r;
    }
  }
  return best;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Recipient's lead name: "Delivery investigations, Plover Arc Logistics" → "delivery investigations". */
const leadName = (r: string) => norm(r.split(",")[0]);

/** True when the chosen action text names the expected channel and recipient (null fields are skipped). */
export function matchExpected(actionText: string, expected: Expected): boolean {
  const t = norm(actionText);
  if (!expected.channel && !expected.recipient) return false;
  if (expected.channel && !t.includes(norm(expected.channel))) return false;
  if (expected.recipient && !t.includes(leadName(expected.recipient))) return false;
  return true;
}

/** "Email → Delivery investigations, Plover Arc" (drops trailing Logistics/Goods), or the summary if no target. */
export function formatExpected(e: Expected): string {
  if (!e.channel && !e.recipient) return e.summary;
  const who = e.recipient ? e.recipient.replace(/\s+(Logistics|Goods)$/, "") : "?";
  return `${e.channel ?? "?"} → ${who}`;
}

export function groupScenarios(list: readonly CaseScenario[]): [Where, CaseScenario[]][] {
  const m = new Map<Where, CaseScenario[]>();
  for (const s of list) {
    const g = m.get(s.where);
    if (g) g.push(s);
    else m.set(s.where, [s]);
  }
  return [...m.entries()];
}

export function filterScenarios(list: readonly CaseScenario[], q: string): CaseScenario[] {
  const n = norm(q);
  if (!n) return [...list];
  return list.filter((s) => s.id.includes(n) || s.title.toLowerCase().includes(n));
}

/**
 * True when the case has at least one event replayed from the real agent's trace (`source: "agent"`).
 * PRD J4: the "Expected" check and any match chip appear only for such cases, because the mock planner
 * copies the answer key and would always "match".
 */
export function hasRealTrace(events: readonly WorkflowEvent[], caseId: string): boolean {
  for (const e of events) if (e.caseId === caseId && e.source === "agent") return true;
  return false;
}
