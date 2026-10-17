// Pure mapping from the eval's judgement and verdict (scripts/eval/score.mjs) to a TestRunCase.
import type { OutboxEntry, TestRunCase } from "../types";
import type { AgentResult, Expected, Judgement, Verdict } from "./evalModules";

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "contact: Email → Dispatch, Plover Arc Logistics (+1 more)" or "escalate / no_action". */
export function shortExpected(e: Expected): string {
  const disp = e.acceptable_dispositions.join(" / ") || "?";
  const first = e.acceptable_actions[0];
  if (!first || !e.acceptable_dispositions.includes("contact")) return disp;
  const more = e.acceptable_actions.length > 1 ? ` (+${e.acceptable_actions.length - 1} more)` : "";
  const target = first.channel ? `${first.channel} → ${first.recipient}` : first.recipient;
  return clip(`${disp}: ${target}${more}`);
}

/**
 * Every message the run actually sent, in order: the outbox entries with status "recorded", exactly
 * as scripts/eval/agents.mjs flow() builds `messages`. Undefined when the API returned no outbox, so
 * scoreCase falls back to nextAction as the eval does for a trace-only result.
 */
export function messagesFromOutbox(outbox: OutboxEntry[] | null | undefined): AgentResult["messages"] {
  if (!Array.isArray(outbox)) return undefined;
  return outbox.filter((o) => o.status === "recorded").map((o) => ({ recipient: o.action.recipient, channel: o.action.channel, message: o.action.message }));
}

/** The eval's AgentResult for a run: the trace's reading plus every sent message. */
export function withMessages(fromTrace: AgentResult, outbox: OutboxEntry[] | null | undefined): AgentResult {
  const messages = messagesFromOutbox(outbox);
  return messages ? { ...fromTrace, messages } : fromTrace;
}

/** "acted: Email → Dispatch, Plover Arc Logistics (+1 more message)" or "escalated: <handoff>". */
export function shortGot(r: AgentResult | null): string | null {
  if (!r) return null;
  const sent = r.messages?.length ? r.messages : r.nextAction ? [r.nextAction] : [];
  if (sent.length) {
    const more = sent.length > 1 ? ` (+${sent.length - 1} more message${sent.length > 2 ? "s" : ""})` : "";
    return clip(`${r.outcome}: ${sent[0].channel} → ${sent[0].recipient}${more}`);
  }
  return clip(r.handoff ? `${r.outcome}: ${r.handoff}` : r.outcome);
}

/** The 12 stress-test fixtures carry a rubric (rubric.json), not a disposition or recipient key. */
export interface FixtureRubric {
  required_outcomes?: string[];
  acceptable_alternatives?: string[];
  prohibited_actions?: string[];
  critical_failures?: string[];
}

/**
 * A fixture rubric in the judge's answer-key shape. The rubric names no disposition or recipient,
 * so every disposition is listed and the alternatives go in as free-text actions; the fixture is then
 * scored on content and rules only (scoreFixture), never on a disposition we would have to invent.
 */
export function fixtureExpected(r: FixtureRubric): Expected {
  return {
    acceptable_dispositions: ["contact", "escalate", "no_action"],
    acceptable_actions: (r.acceptable_alternatives ?? []).map((summary) => ({ recipient: "the party this alternative names", channel: "any", summary })),
    must: r.required_outcomes ?? [],
    must_not: [...(r.prohibited_actions ?? []), ...(r.critical_failures ?? [])],
    reference_message: null,
  };
}

const CONTENT_CREDIT = { wrong: 0, partial: 0.5, right: 1 } as const;

/** Fixture verdict: content credit from the judge, forced to 0 by any broken rule. */
export function scoreFixture(result: AgentResult, judgement: Judgement | null, passAt: number): Verdict {
  if (result.outcome === "error" || !judgement) return { score: 0, pass: false, critical: false, completed: false, parts: {} };
  const critical = judgement.violations.length > 0;
  const content = CONTENT_CREDIT[judgement.content];
  const score = critical ? 0 : content;
  return { score, pass: !critical && score >= passAt, critical, completed: true, parts: { content } };
}

export interface CaseOutcome {
  result: AgentResult | null; // null when the agent run itself failed
  agentError: string | null;
  judgement: Judgement | null;
  judgeError: string | null;
  verdict: Verdict | null;
  expected: Expected | null;
  costUsd: number | null;
  durationMs: number | null;
}

/** Fills the scored fields of a TestRunCase. */
export function toTestCase(base: Pick<TestRunCase, "caseId" | "dataset" | "executionId">, o: CaseOutcome): TestRunCase {
  const common = {
    ...base,
    expected: o.expected ? shortExpected(o.expected) : null,
    got: shortGot(o.result),
    costUsd: o.costUsd,
    durationMs: o.durationMs,
  };
  const error = o.agentError ?? (o.result?.outcome === "error" ? (o.result.handoff ?? "the agent run ended in error") : null);
  if (error) {
    return { ...common, status: "error", score: o.verdict?.score ?? null, breakdown: null, mustNotBroken: [], verdict: `agent error: ${error}` };
  }
  if (!o.judgement || !o.verdict || !o.verdict.completed) {
    return { ...common, status: "error", score: null, breakdown: null, mustNotBroken: [], verdict: `not judged: ${o.judgeError ?? "no judgement"}` };
  }
  const missed = o.judgement.must_missed.length ? ` Missed: ${o.judgement.must_missed.join("; ")}` : "";
  return {
    ...common,
    status: o.verdict.pass ? "passed" : "failed",
    score: o.verdict.score,
    breakdown: o.verdict.parts,
    mustNotBroken: o.judgement.violations.map((v) => v.rule),
    verdict: clip(`${o.judgement.note}${missed}`, 400),
  };
}

/** Run totals over the cases scored so far. */
export function summarise(cases: TestRunCase[]) {
  const scored = cases.filter((c) => c.status === "passed" || c.status === "failed");
  const costs = cases.map((c) => c.costUsd ?? 0);
  return {
    total: cases.length,
    passed: cases.filter((c) => c.status === "passed").length,
    failed: cases.filter((c) => c.status === "failed").length,
    errors: cases.filter((c) => c.status === "error").length,
    meanScore: scored.length ? Math.round((scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length) * 1000) / 1000 : null,
    costUsd: Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6,
    ...reuseTotals(cases),
  };
}

/** Reuse counts, present only when a case was reused (older runs keep their exact shape). */
function reuseTotals(cases: TestRunCase[]): { reused?: number; repeats?: { passed: number; failed: number; scoreSum: number } } {
  const reused = cases.filter((c) => c.reused);
  if (!reused.length) return {};
  const rep = reused.filter((c) => c.reused?.countedBefore && (c.status === "passed" || c.status === "failed"));
  return {
    reused: reused.length,
    repeats: {
      passed: rep.filter((c) => c.status === "passed").length,
      failed: rep.filter((c) => c.status === "failed").length,
      scoreSum: Math.round(rep.reduce((s, c) => s + (c.score ?? 0), 0) * 1e6) / 1e6,
    },
  };
}
