// Shared contract for the Hamyway desk console (the n8n-style control panel at "/").
// Server side: apps/web/src/console/server/* + apps/web/src/app/api/console/** (SQLite via node:sqlite).
// Client side: apps/web/src/console/** tabs. Data rule (PRD J0): real outputs only, never mock data
// presented as real. Anything simulated carries `simulated: true` and must be labelled in the UI.
import type { Trace } from "../../../api/src/lib/trace";
import type { DecisionCard } from "../../../api/src/lib/trace";
import type { Flow, FlowEdge, FlowNode, NodeType, Runner } from "../../../api/src/lib/flow";

export type { Trace, DecisionCard, Flow, FlowEdge, FlowNode, NodeType, Runner };

// ---------- voice (PRD Part I, I5; docs/superpowers/plans/2026-10-10-voice-layer.md) ----------

/** Where a voiced event came from. Absent on ordinary written messages. Mirrors apps/api load.ts EventSource. */
export type VoiceSource = "live_human" | "simulated_persona" | "audio_attachment";

/** One case event as the agent API receives it (POST /api/cases view.events[]). Voice events carry `source`. */
export interface CaseViewEvent {
  n: number;
  timestamp: string; // "" means: stamp it on the case's own timeline
  stage: string | null;
  channel: string | null; // "Voice note", "Call", ...
  from: string | null;
  to: string | null;
  body: string;
  source?: VoiceSource;
}

/** A trusted human decision on a decision card (tap or voice). Mirrors apps/api run.ts RunOptions.humanDecision. */
export interface HumanDecision {
  optionId: string;
  label: string;
  by: "tap" | "voice";
  who: string;
  confirmation?: string;
}

/** One outgoing message after the gate, as POST /api/cases returns it (apps/api agent/types.ts OutboxEntry). */
export interface OutboxEntry {
  action: { recipient: string; channel: string; kind: string; purpose: string; message: string };
  status: "recorded" | "failed" | "held_for_human" | "blocked";
  note: string;
}

/** What started a voice execution. */
export interface ExecutionVoice {
  trigger: "note" | "call" | "approval";
  callId?: string;
}

/** Body of POST /api/console/execute. */
export interface ExecuteRequest {
  caseId: string;
  dataset?: string;
  workflowId?: string;
  /** Re-run of this execution: its outbox becomes "Already sent by the desk" events, and the new row links back. */
  parentExecutionId?: string;
  /** Voice events (notes, call transcripts) appended after the case's own events. Missing timestamps are stamped on the case timeline. */
  extraEvents?: CaseViewEvent[];
  /** A trusted human decision for the agent's card (passed to the agent API as `humanDecision`). */
  humanDecision?: HumanDecision;
  /** What voice moment triggered this run; sets origin "voice". */
  voice?: ExecutionVoice;
  /** Agent mode. Defaults to "demo" when any voice input is present (PRD I2: voice is demo-only). */
  mode?: "practice" | "demo";
  /** Real ms since the parent run, for stamping voice events. Defaults to now minus the parent's start. */
  elapsedMs?: number;
}

/** A saved workflow (n8n "workflow"). The default one is apps/api/flows/default-incident.json. */
export interface WorkflowRecord {
  id: string; // "default-incident" or a uuid
  name: string;
  flow: Flow; // nodes + edges + node config (thresholds etc.)
  /** Canvas positions per node id, saved by the editor. */
  positions: Record<string, { x: number; y: number }>;
  active: boolean;
  updatedAt: string; // ISO
  source: "file" | "db"; // file = read from apps/api/flows, db = saved in SQLite
}

/** One run of the agent on one case (n8n "execution"). */
export interface ExecutionRecord {
  id: string;
  caseId: string; // "delivery-024", "gen-007", a Reality Test folder name...
  dataset: string; // "public" | "generated" | "grounded" | "fixtures" | "reality" | "adhoc" | "city"
  workflowId: string;
  status: "running" | "success" | "error";
  outcome: string | null; // Trace run_end outcome
  startedAt: string; // ISO
  durationMs: number | null;
  costUsd: number | null;
  /** Where it came from: a runner file on disk, the eval results, or an "Execute" click in the console. */
  origin: "answers" | "runs" | "examples" | "console" | "city" | "voice";
  simulated: boolean; // true only for city/mock runs; the console must label these
  trace: Trace | null;
  answerMd: string | null;
  reasoningMd: string | null;
  /** Eval verdict when one exists. */
  eval: EvalVerdict | null;
  error?: string | null;
  /** Set when this run re-ran another execution (voice note, call or approval). */
  parentExecutionId?: string | null;
  /** Gated outgoing messages from the agent API response (POST /api/cases `outbox`). */
  outbox?: OutboxEntry[] | null;
  /** The decision card from the agent API response (POST /api/cases `card`), when the agent stopped for a person. */
  card?: DecisionCard | null;
  /** Present when a voice moment triggered this run. */
  voice?: ExecutionVoice | null;
}

/** The eval's verdict on one execution (scripts/eval/score.mjs). The v2 parts are absent on rows scored before they existed. */
export interface EvalVerdict {
  pass: boolean;
  score: number;
  notes?: string;
  /** True when a must_not rule was broken (score forced to 0); null when the source does not say. */
  critical?: boolean | null;
  /** The judge's own short note. */
  verdict?: string | null;
  /** The must_not rules the judge says were broken. */
  brokenRules?: string[];
}

/** A row of the evidence grid: every tested case across every dataset. */
export interface EvidenceRow {
  caseId: string;
  dataset: string;
  title: string | null;
  decision: string | null; // outcome / decision type
  nextAction: string | null; // "Email → Delivery investigations, Plover Arc"
  gate: string | null; // "allow" | "ask" | "block"
  pass: boolean | null; // null = not evaluated
  score: number | null;
  costUsd: number | null; // real, from the evaluated run, else the latest run that states it
  durationMs: number | null;
  executionId: string | null;
  // ---- dashboard v2 additions ----
  /** True when a must_not was broken (score forced to 0) or the judge flagged a critical failure; null = not evaluated. */
  critical: boolean | null;
  /** The judge's note on the latest verdict. */
  verdict: string | null;
  /** must_not rules broken in the latest verdict. */
  brokenRules: string[];
  /** The case's difficulty pattern from its file (scripts/eval/mutations.mjs); null for public cases and fixtures. */
  mutation: string | null;
}

export interface EvidenceTotals {
  cases: number;
  evaluated: number;
  passed: number;
  costUsd: number;
  /** Rows whose latest verdict broke a rule. */
  criticalFailures: number;
  /** Per dataset: cases with a run, judged right (pass), judged wrong (fail). */
  byDataset: { dataset: string; run: number; right: number; wrong: number }[];
}

/** One Reality Test case: a folder of ANSWERS/ (apps/api/src/agent/cli.ts). */
export interface RealityCase {
  n: string; // the organisers' case folder name
  caseId: string;
  title: string | null;
  outcome: string | null; // run_end outcome; "error" when the run failed
  decision: string | null; // the ANSWER.md "Decision:" line
  escalated: boolean; // held for a person (outcome escalated or a decision card)
  failed: boolean; // the run did not finish or ended in error
  costUsd: number | null;
  durationMs: number | null;
  executionId: string | null;
}

export interface RealitySummary {
  total: number; // cases the run was given (max of folders and RUNLOG.md rows)
  finished: number; // folders whose run finished without error
  cases: number; // case folders imported
  byOutcome: Record<string, number>;
  escalated: number;
  failed: number;
  costUsd: number;
  durationMs: number;
  runId: string | null; // from RUNLOG.md
  hasIndex: boolean; // ANSWERS/INDEX.md exists
}

/** ANSWERS/RUNLOG.md, parsed. Null when there is no run log. */
export interface RealityRunlog {
  runId: string | null;
  rows: { caseName: string; result: string; outcome: string | null; seconds: number | null; costUsd: number | null }[];
}

/** API (all JSON, under /api/console). */
export interface ConsoleApi {
  "GET /api/console/workflows": { workflows: WorkflowRecord[] };
  "PUT /api/console/workflows/:id": { workflow: WorkflowRecord }; // body: WorkflowRecord
  "GET /api/console/executions?limit&dataset": { executions: Omit<ExecutionRecord, "trace" | "answerMd" | "reasoningMd">[] };
  "GET /api/console/executions/:id": { execution: ExecutionRecord };
  "POST /api/console/execute": { execution: ExecutionRecord }; // body: ExecuteRequest -> runs via apps/api POST /api/cases
  "POST /api/console/import": { imported: number }; // rescan ANSWERS/, runs/, examples/ into SQLite
  "GET /api/console/evidence": { rows: EvidenceRow[]; totals: EvidenceTotals };
  "GET /api/console/reality": { cases: RealityCase[]; summary: RealitySummary; runlog: RealityRunlog | null };
  "GET /api/console/reality/:caseId": { answerMd: string | null; reasoningMd: string | null }; // read from ANSWERS/<n>/; 404 if no folder
  "GET /api/console/cases?dataset&q": { cases: { id: string; dataset: string; title: string | null }[] };
  "GET /api/console/status": { agentApi: boolean; agentUrl: string; dbPath: string; counts: Record<string, number> };
}

// ---------------------------------------------------------------------------------------------
// Test & improve loop (Workflows tab): run a workflow version over a set of scenarios, score each
// case with the team's eval judge (scripts/eval/score.mjs), then ask the Architect to improve the
// flow from the failures, save it as a new version and re-test. Stored in SQLite.

export interface WorkflowVersion {
  workflowId: string;
  version: number; // 1, 2, 3...
  flow: Flow;
  createdAt: string;
  createdBy: "user" | "architect" | "improve";
  note: string | null; // what changed and why (from the improve step)
  parentVersion: number | null;
}

export type ScenarioSetId =
  | "quick" // 5 public cases spread across case types
  | "fixtures" // the 12 hand-written edge-case fixtures
  | "adversarial" // Oriol's adversarial cases
  | "generated" // generated hard cases (optionally filtered by mutation)
  | "city" // the 50 hand-written city cases (data/city)
  | "haiku" // Haiku-made cases (data/haiku), model-written answer keys, unreviewed
  | "bulk" // 2,500 rule-made cases (data/bulk, scripts/eval/gen-bulk.mjs), answer keys derived by rule
  | "custom"; // explicit case ids

export interface TestRunCase {
  caseId: string;
  dataset: string;
  executionId: string | null;
  status: "queued" | "running" | "passed" | "failed" | "error";
  score: number | null; // 0..1 from scoreCase
  breakdown: { disposition?: number; recipient?: number; channel?: number; content?: number } | null;
  mustNotBroken: string[]; // rules broken (score forced to 0)
  verdict: string | null; // judge's short reason
  expected: string | null; // short form of the answer key
  got: string | null; // short form of the agent's decision / next action
  costUsd: number | null;
  durationMs: number | null;
  /** The case's title from the catalogue, shown in plain words while it runs. */
  title?: string | null;
  /** Wall-clock start and end of this case in the run (agent + scoring), ISO. */
  startedAt?: string | null;
  finishedAt?: string | null;
  /** Set when this case was not run again: the same playbook (same flow JSON) already ran it and was judged.
   *  `executionId` is the original run; costUsd is 0 (nothing new spent); the original cost is kept here. */
  reused?: {
    originalCostUsd: number | null;
    /** True when this version's results already include that run, so it is not new evidence. */
    countedBefore: boolean;
  } | null;
}

export interface TestRun {
  id: string;
  workflowId: string;
  version: number;
  set: ScenarioSetId;
  filter: string | null; // e.g. a mutation name for "generated"
  status: "running" | "done" | "error" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  cases: TestRunCase[];
  summary: {
    total: number; passed: number; failed: number; errors: number; meanScore: number | null; costUsd: number;
    /** Cases reused from an earlier run of the same playbook (no new agent call). */
    reused?: number;
    /** Reused cases this version had already counted: subtract them so the learning curve counts each run once. */
    repeats?: { passed: number; failed: number; scoreSum: number };
  };
}

export interface ImproveProposal {
  workflowId: string;
  fromVersion: number;
  testRunId: string | null;
  feedbackId?: string;
  feedbackExecutionId?: string;
  flow: Flow; // proposed revised flow (validated)
  problems: string[]; // validation problems, if any
  changes: string[]; // human-readable change list (nodes added/removed, thresholds moved, branches added)
  rationale: string; // why, tied to the failures
}

export interface ConsoleTestApi {
  "GET /api/console/scenario-sets": { sets: { id: ScenarioSetId; label: string; count: number; filters?: string[] }[] };
  "POST /api/console/testruns": { testRun: TestRun }; // body: { workflowId, version?, set, filter?, caseIds?, limit? (default 5, max 20) }
  "GET /api/console/testruns?workflowId": { testRuns: Omit<TestRun, "cases">[] };
  "GET /api/console/testruns/:id": { testRun: TestRun };
  "POST /api/console/testruns/:id/cancel": { ok: true };
  "GET /api/console/workflows/:id/versions": { versions: WorkflowVersion[] };
  "POST /api/console/improve": { proposal: ImproveProposal }; // body: { workflowId, testRunId }
  "POST /api/console/workflows/:id/versions": { version: WorkflowVersion }; // body: { flow, createdBy, note, parentVersion }
}
