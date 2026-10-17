export type ReviewStatus = "pending" | "decision_recorded" | "resolved";

export interface ReviewOption {
  id: string;
  label: string;
  undoable: boolean;
  effect?: string;
}

export interface ReviewDecision {
  optionId: string;
  optionLabel: string;
  who: string;
  note: string;
  at: string;
  /** Recording approval never implies the owning team's action happened. */
  execution: "pending" | "simulation";
}

export interface ReviewTask {
  id: string;
  caseId: string;
  runId: string;
  cardId: string;
  title: string;
  summary: string;
  routeTo: string;
  mustDecide: string;
  evidence: { who: string; says: string; basis: string }[];
  clash: string | null;
  tried: string[];
  wouldChangeMyMind: string;
  options: ReviewOption[];
  fallback: string;
  receivedAt: string;
  deadlineAt: string;
  urgency: "low" | "medium" | "high";
  risk: number | null;
  status: ReviewStatus;
  decision: ReviewDecision | null;
  simulated: boolean;
  mode: "practice" | "reality" | "demo";
  origin: "runner" | "agent" | "city";
  messages: { from: string; channel: string; body: string; status?: string; note?: string }[];
  timeline: { node: string; summary: string; status: string }[];
  costUsd: number | null;
  durationMs: number | null;
  /** The console case run this card came from, when there is one. A choice re-runs it with the decision. */
  executionId?: string | null;
}

export interface ReviewQueue {
  tasks: ReviewTask[];
  warnings: string[];
  updatedAt: string;
}

/** Separate from city telemetry so the workflow editor can use this without importing WebGL. */
export const REVIEW_CHANNEL = "rivet-human-review";
export type ReviewMessage =
  | { type: "queue:request" }
  | { type: "queue:snapshot"; sessionId: string; tasks: ReviewTask[] }
  | { type: "decision:request"; requestId: string; taskId: string; optionId: string; who: string; note: string }
  | { type: "decision:result"; requestId: string; ok: boolean; error?: string };
