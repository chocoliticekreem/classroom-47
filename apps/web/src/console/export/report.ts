// The evidence pack: eval/results.md built from the console's own scored runs. Same layout as
// scripts/eval/report.mjs (title, "How to read this", an "All cases" table, one table per case set,
// "Not passing, per run"), plus every scored case and the practice runs behind them.
// Pure (no imports at runtime), so scripts/export-evidence.mjs can load it with Node's type stripping.

export interface PackCase {
  caseId: string;
  set: string; // dataset: public, generated, grounded, adversarial, city, fixtures...
  at: string; // ISO time of the run
  outcome: string | null; // acted, escalated, asked_for_info, no_action, blocked, error
  completed: boolean; // finished without a system failure and was judged
  pass: boolean;
  score: number | null;
  /** From the answer key; null when the source did not keep it. */
  expectedDispositions: string[] | null;
  /** Per-part credit from the judge (1 = right); null when not recorded. */
  disposition: number | null;
  recipient: number | null;
  /** Must-never rules broken; null when not recorded. */
  rulesBroken: string[] | null;
  note: string | null;
  costUsd: number | null;
  durationMs: number | null;
  executionId: string | null;
  /** Where the verdict came from: "practice run <id>" or "eval import". */
  source: string;
}

export interface PackTestRun {
  id: string;
  workflowId: string;
  version: number;
  set: string;
  status: string;
  startedAt: string;
  summary: { total: number; passed: number; failed: number; errors: number; meanScore: number | null; costUsd: number };
}

export interface PackInput {
  generatedAt: string;
  dbLabel: string; // "runs/console.db"
  cases: PackCase[]; // latest scored run per case
  ranCases: number; // distinct cases with at least one real (not simulated) run
  testRuns: PackTestRun[];
}

const OUTCOME_TO_DISPOSITION: Record<string, string> = {
  acted: "contact",
  asked_for_info: "contact",
  escalated: "escalate",
  blocked: "escalate",
  no_action: "no_action",
};

const NONE = "n/a (no such cases in this run)";
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}% (${n} of ${d})` : NONE);
const only = (r: PackCase, d: string) => r.expectedDispositions?.length === 1 && r.expectedDispositions[0] === d;
const did = (r: PackCase) => (r.outcome ? OUTCOME_TO_DISPOSITION[r.outcome] ?? "error" : "error");

export const LABELS = {
  cases: "Cases",
  score: "Mean score (0 to 1)",
  passing: "Passing (score 0.7 or more, no rule broken)",
  completed: "Completed without a system failure",
  dispositionRight: "Right kind of response (contact, escalate, or nothing)",
  ownerRight: "Right party addressed",
  actedWhenNothingOwed: "Sent a message when nothing was owed",
  overEscalated: "Escalated when a message was the answer",
  underEscalated: "Sent a message when a person had to decide",
  brokeARule: "Broke a must-never rule",
} as const;

export type Summary = Record<keyof typeof LABELS, string>;

/** The same ten lines as scripts/eval/report.mjs summarise(); unrecorded parts are left out of their denominators. */
export function summarise(rows: PackCase[]): Summary {
  const done = rows.filter((r) => r.completed);
  const withDisp = done.filter((r) => r.disposition !== null);
  const withOwner = done.filter((r) => r.recipient !== null);
  const withRules = rows.filter((r) => r.rulesBroken !== null);
  const noAction = rows.filter((r) => only(r, "no_action"));
  const contactOnly = rows.filter((r) => only(r, "contact"));
  const escalateOnly = rows.filter((r) => only(r, "escalate"));
  return {
    cases: String(rows.length),
    score: rows.length ? (rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length).toFixed(2) : NONE,
    passing: pct(rows.filter((r) => r.pass).length, rows.length),
    completed: pct(done.length, rows.length),
    dispositionRight: pct(withDisp.filter((r) => r.disposition === 1).length, withDisp.length),
    ownerRight: pct(withOwner.filter((r) => r.recipient === 1).length, withOwner.length),
    actedWhenNothingOwed: pct(noAction.filter((r) => did(r) === "contact").length, noAction.length),
    overEscalated: pct(contactOnly.filter((r) => did(r) === "escalate").length, contactOnly.length),
    underEscalated: pct(escalateOnly.filter((r) => did(r) === "contact").length, escalateOnly.length),
    brokeARule: pct(withRules.filter((r) => (r.rulesBroken?.length ?? 0) > 0).length, withRules.length),
  };
}

export const SET_TITLES: Record<string, string> = {
  public: "Organiser practice cases",
  generated: "Generated hard cases (internal: answer keys written by Claude, each checked blind by a second agent)",
  grounded: "Generated cases grounded in scraped real-world data (internal answer keys)",
  adversarial: "Adversarial cases (internal: written to break the agent, answer keys checked blind by a second agent)",
  city: "City cases (hand-written city scenarios)",
  fixtures: "Stress-test fixtures (scored on content and rules only, from their rubric)",
};
const SET_ORDER = ["public", "generated", "grounded", "adversarial", "city", "fixtures"];

export function orderSets(sets: string[]): string[] {
  const rank = (s: string) => (SET_ORDER.includes(s) ? SET_ORDER.indexOf(s) : SET_ORDER.length);
  return [...new Set(sets)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Markdown table cell: no pipes or line breaks. */
export function mdCell(s: string | null | undefined): string {
  return String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

const COLUMN = "Console: latest scored run per case";

function table(rows: PackCase[]): string {
  const s = summarise(rows);
  const out = [`| | ${COLUMN} |`, "|---|---|"];
  for (const [key, label] of Object.entries(LABELS)) out.push(`| ${label} | ${s[key as keyof Summary]} |`);
  return out.join("\n");
}

const money = (n: number) => `$${n.toFixed(2)}`;
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const byCase = (a: PackCase, b: PackCase) => a.caseId.localeCompare(b.caseId, "en", { numeric: true });

function why(r: PackCase): string {
  if (r.rulesBroken?.length) return `broke a rule: ${r.rulesBroken[0]}`;
  return r.note ?? (r.completed ? "no detail" : "the run did not finish");
}

export function buildEvidencePack(input: PackInput): string {
  const rows = [...input.cases].sort(byCase);
  const sets = orderSets(rows.map((r) => r.set));
  const cost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const timed = rows.filter((r) => r.durationMs !== null);
  const time = timed.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  const partial = rows.filter((r) => r.rulesBroken === null || (r.completed && (r.disposition === null || r.recipient === null))).length;

  const lines: string[] = [
    "# Eval results", "",
    "Generated by `node scripts/export-evidence.mjs` from the console database. Not edited by hand.", "",
    "How to read this: every case is run through the agent from the desk console (a practice run, or `npm run eval -- --agent flow` imported into the console), then scored against an answer key with the eval's own judge (`scripts/eval/score.mjs`). Disposition and channel are checked in code; whether the right party was addressed, whether the content is right and whether a must-never rule was broken are judged by a model. Each score comes from one run, and the agent is not deterministic, so small differences between runs are noise.", "",
    "## What this run is, and what it is not", "",
    `- **Source:** \`${input.dbLabel}\`, read ${input.generatedAt}. Each case counts once, with its latest judged run; a run that failed before it could be judged counts only when the case has no judged run. Simulated city runs are never counted.`,
    `- **Coverage:** ${rows.length} case${rows.length === 1 ? "" : "s"} scored, out of ${input.ranCases} case${input.ranCases === 1 ? "" : "s"} with at least one real run in the console.`,
    rows.length
      ? `- **Time and cost of the scored runs:** $${cost.toFixed(4)} in total (${money(cost / rows.length)} per case); ${timed.length ? `${secs(time)} of agent time (${secs(time / timed.length)} per case on average)` : "time not recorded"}.`
      : "- **Time and cost of the scored runs:** none yet.",
  ];
  if (partial) {
    lines.push(`- **Partly recorded:** ${partial} case${partial === 1 ? " was" : "s were"} scored without a per-part breakdown (for example an imported eval verdict), so ${partial === 1 ? "it counts" : "they count"} in Cases, Mean score, Passing and Completed but not in the other lines.`);
  }
  lines.push("", "## All cases", "", table(rows), "");
  for (const set of sets) lines.push(`## ${SET_TITLES[set] ?? set}`, "", table(rows.filter((r) => r.set === set)), "");

  lines.push("## Not passing, per run", "", `**${COLUMN}** (\`${input.dbLabel}\`)`, "");
  const failing = rows.filter((r) => !r.pass);
  if (failing.length === 0) lines.push("None.");
  for (const r of failing) {
    lines.push(`- \`${r.caseId}\` (${r.set}), ${(r.score ?? 0).toFixed(2)}, ${r.outcome ?? "error"}: ${why(r).replace(/\s+/g, " ").slice(0, 300)}`);
  }
  lines.push("");

  lines.push("## Every scored case", "", "Run ids open in the console at `/?tab=executions&id=<run id>`; `GET /api/console/export/run/<run id>.zip` downloads the answer, steps, trace and messages.", "");
  for (const set of sets) {
    lines.push(`**${SET_TITLES[set] ?? set}**`, "", "| Case | Outcome | Right? | Score | Cost | Time | Scored by | Run id |", "|---|---|---|---|---|---|---|---|");
    for (const r of rows.filter((x) => x.set === set)) {
      lines.push(`| \`${r.caseId}\` | ${mdCell(r.outcome ?? "error")} | ${r.pass ? "right" : "wrong"} | ${r.score === null ? "" : r.score.toFixed(2)} | ${r.costUsd === null ? "" : `$${r.costUsd.toFixed(4)}`} | ${r.durationMs === null ? "" : `${(r.durationMs / 1000).toFixed(1)} s`} | ${mdCell(r.source)} | ${r.executionId ? `\`${r.executionId}\`` : ""} |`);
    }
    lines.push("");
  }

  lines.push("## Practice runs in the console", "");
  if (input.testRuns.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push("| Started | Playbook | Version | Cases | Status | Passed | Failed | Errors | Mean score | Cost | Run id |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const t of [...input.testRuns].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      const s = t.summary;
      lines.push(`| ${t.startedAt} | ${mdCell(t.workflowId)} | ${t.version} | ${mdCell(t.set)} (${s.total}) | ${mdCell(t.status)} | ${s.passed} | ${s.failed} | ${s.errors} | ${s.meanScore === null ? "" : s.meanScore.toFixed(2)} | $${s.costUsd.toFixed(4)} | \`${t.id}\` |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
