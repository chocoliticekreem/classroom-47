// Tiny event bus for one-off happenings. State lives in store.ts; this is for "something just happened".
import type { WorkflowEvent } from "./store";

// ---------- voice and decisions (PRD Part J3) ----------
/** Who voiced something. "case_file" = read from the case's own files; "simulated_persona" is always labelled SIMULATED. */
export type VoiceSource = "live_human" | "simulated_persona" | "audio_attachment" | "case_file";
/** A party on a call or note. The named roles map to places in the city; any other string is a named person. */
export type Party = "driver" | "recipient" | "manager" | "dispatch" | "desk_agent" | string;
/** The decision card carried by `decision:needed` (mirrors DecisionCard in apps/api/src/lib/trace.ts). */
export type BusDecisionCard = NonNullable<WorkflowEvent["card"]>;

/** The scenario outcomes. Widened (J3) beyond the mock's five for the real agent's decision types. */
export type ScenarioOutcome = "acted" | "asked_for_info" | "escalated" | "blocked" | "no_action" | "waiting" | "refused" | "routed";

export type WorldEvent =
  | { type: "incident:created"; incidentId: string }
  | { type: "incident:cleared"; incidentId: string }
  | { type: "road:blocked"; edgeKey: string; reason: string }
  | { type: "road:reopened"; edgeKey: string }
  | { type: "delivery:delayed"; deliveryId: string; reason: string }
  | { type: "delivery:completed"; deliveryId: string }
  | { type: "vehicle:crashed"; vehicleId: string; incidentId: string }
  // Requests from the UI (demo buttons). The owning module listens and acts.
  | { type: "request:crash"; kind: "car_crash" | "truck_crash" | "pileup" }
  | { type: "request:plane"; kind: "emergency_landing" | "plane_crash" }
  // City events (Events module): start one now.
  | { type: "request:event"; kind: "motorcade" | "marathon" | "protest" | "parade" | "concert" | "fireworks" | "state_visit" }
  | { type: "event:started"; eventId: string }
  | { type: "event:ended"; eventId: string }
  | { type: "request:cyclist_hit" }
  | { type: "request:roadworks" }
  | { type: "request:breakdown" }
  // Something in the city picked a case: the side panel selects it.
  | { type: "ui:selectCase"; caseId: string }
  // Scenarios (see scenarios.ts): the HUD fires one; the Scenarios module acts it out in the city and
  // emits scenario:staged with where it happened; the WorkflowDriver turns it into a workflow case.
  | { type: "request:scenario"; scenarioId: string; modifiers: import("./scenarios").Modifier[] }
  | { type: "scenario:staged"; runId: string; scenarioId: string; modifiers: import("./scenarios").Modifier[]; x: number; z: number; vehicleId?: string }
  | { type: "scenario:resolved"; runId: string; scenarioId: string; outcome: ScenarioOutcome }
  // Voice and decisions (PRD J3). Producers: the trace adapter (traceToCity) and window.__cityVoiceDemo().
  // Consumers: the VoiceFx module (city effects) and the store's voice slice (calls, transcripts, notes).
  | { type: "decision:needed"; caseId: string; card: BusDecisionCard }
  | { type: "decision:voice"; caseId: string; optionId: string; by: Party; source: VoiceSource; callId?: string }
  | { type: "voice:note_in"; caseId: string; noteId: string; from: Party; source: VoiceSource; transcript: string; audioUrl?: string; durationMs?: number }
  | { type: "call:ringing"; caseId: string; callId: string; caller: Party; callee: Party; source: VoiceSource; purpose: string }
  | { type: "call:connected"; caseId: string; callId: string }
  | { type: "voice:utterance"; caseId: string; callId: string; seq: number; speaker: Party; text: string; source: VoiceSource; audioUrl?: string; durationMs?: number }
  | { type: "call:ended"; caseId: string; callId: string; reason: "completed" | "no_answer" | "failed" | "human_took_over"; summary?: string }
  // NUMA London Streamer Parallel Reality & Synthetic Crowd Events
  | { type: "streamer:teleport"; x: number; z: number; district?: import("./streamerContract").LondonDistrictId }
  | { type: "streamer:set_destination"; x: number; z: number }
  | { type: "reality:fork"; scenario: import("./streamerContract").WhatIfScenarioId; label: string }
  | { type: "reality:reset_to_live" }
  | { type: "reality:apply_safe_route" }
  | {
      type: "sim:spawn_synthetic_crowd";
      count: number;
      archetype: import("./streamerContract").SyntheticArchetype;
      nearStreamer?: boolean;
      crossStreet?: boolean;
      subreddit?: string;
    }
  | { type: "persona:select"; agentId: string | null };

/** One member of the WorldEvent union by its type, e.g. EventOf<"call:ringing">. */
export type EventOf<T extends WorldEvent["type"]> = Extract<WorldEvent, { type: T }>;

type Handler = (e: WorldEvent) => void;
const handlers = new Set<Handler>();

export function emit(e: WorldEvent) {
  for (const h of handlers) h(e);
}

/** Subscribe; returns unsubscribe. Use inside useEffect. */
export function on(h: Handler) {
  handlers.add(h);
  return () => {
    handlers.delete(h);
  };
}
