// Shared world state (low-frequency things only). Per-frame positions live in registry.ts, not here.
// Per-frame speaker loudness lives in voice.ts, never here (PRD J3).
import { create } from "zustand";
import { on, type Party, type VoiceSource, type WorldEvent } from "./bus";
import { addSpend, clampMax, claimRun, mergeStarts, newBudget, type AgentBudget } from "./modules/WorkflowDriver/budget";

export type IncidentKind =
  | "car_crash" | "truck_crash" | "pileup" | "roadworks" | "breakdown" | "plane_crash" | "emergency_landing"
  | "cyclist_hit" // a vehicle hit a cyclist: ambulance priority
  | "event_closure"; // a planned city event (motorcade, marathon, march…) closed roads
export type IncidentStatus = "active" | "responding" | "clearing" | "cleared";

export interface Incident {
  id: string;
  kind: IncidentKind;
  edgeKey: string; // the road it blocks
  x: number;
  z: number;
  status: IncidentStatus;
  createdAt: number; // performance.now() ms
  note: string; // one line for the HUD, e.g. "Van V-12 crashed into a car on King St"
}

/**
 * A patch of the city that's been destroyed (plane crash, explosion). Lifecycle:
 * the cause owner adds it as "destroyed" (buildings inside `radius` collapse into rubble) ->
 * the cause owner sets "rebuilding" once the incident is cleared (scaffold + buildings rise) ->
 * the Buildings module sets "restored" when the rebuild animation finishes, then removes it.
 */
export interface DamageZone {
  id: string;
  x: number;
  z: number;
  radius: number; // metres
  state: "destroyed" | "rebuilding" | "restored";
  cause: string; // e.g. "Cargo jet RV880 crashed"
  createdAt: number; // performance.now() ms
}

/** A planned or live city event (owned by the Events module). Roads it closes are in `blocked` too. */
export interface CityEvent {
  id: string;
  kind: "motorcade" | "marathon" | "protest" | "parade" | "concert" | "fireworks" | "state_visit";
  title: string; // plain words, e.g. "President's motorcade: Airport → White House"
  status: "planned" | "live" | "ended";
  startsAt: number; // performance.now() ms
  endsAt: number | null;
  route: string[]; // road node ids it uses (for map lines / closures)
  closedEdges: string[]; // edge keys currently closed by it
  x: number; // where to look
  z: number;
}

export interface WorkflowEvent {
  id: string;
  t: number; // performance.now() ms
  caseId: string; // e.g. "CASE-0042"
  nodeId: string; // flow node id from apps/api/flows/default-incident.json, e.g. "triage"
  status: "start" | "ok" | "ask" | "block" | "error";
  summary: string;
  /**
   * Who produced it: the mock engine (default) or the real agent in apps/api replayed from its trace.
   * PRD J3 adds the voice sources; "simulated_persona" must always be labelled SIMULATED.
   */
  source?: "mock" | "agent" | "live_human" | "simulated_persona" | "audio_attachment" | "case_file";
  // ---- PRD J3 additive fields (all optional; existing producers keep working) ----
  /** True when the run admitted any simulated input (trace.synthetic). */
  synthetic?: boolean;
  costUsd?: number;
  /** The decision card when status is "ask" on the human node. Mirrors DecisionCard (apps/api/src/lib/trace.ts). */
  card?: {
    cardId: string; summary: string; options: { id: string; label: string; safe?: boolean; effect?: string }[];
    routeTo: string; deadlineMs: number; fallbackOptionId: string;
    // Richer DecisionCard fields from the real agent (optional; the mock never sets them).
    whyStopped?: { reason: string; line: string };
    evidence?: { who: string; says: string; basis: string }[];
    alreadyDone?: string[];
    clash?: string;
    wouldChangeMyMind?: string;
    fallback?: string;
  };
  decision?: "act" | "ask_for_info" | "route_to_owner" | "hold_for_human" | "wait_until" | "refuse";
  /** ISO time for wait_until. */
  due?: string;
  /** Per-action gate and action events. */
  actionId?: string;
  /** Where a real trace came from: a city incident or scenario sent to apps/api, or a console run. */
  origin?: "city_incident" | "city_scenario" | "console" | "voice" | "runs" | "answers" | "examples";
  /** The trace's runId, to find its card in the human review queue. */
  runId?: string;
  /** The console execution (SQLite) this line belongs to, for city cases recorded through the console. */
  executionId?: string;
}

// ---------- voice (PRD J3: calls, transcripts, voice notes, soundEnabled; low frequency only) ----------

export interface CallRecord {
  callId: string;
  caseId: string;
  caller: Party;
  callee: Party;
  source: VoiceSource;
  purpose: string;
  status: "ringing" | "connected" | "ended";
  ringingAt: number; // performance.now() ms
  connectedAt?: number;
  endedAt?: number;
  reason?: "completed" | "no_answer" | "failed" | "human_took_over";
  summary?: string;
}

export interface TranscriptLine {
  callId: string;
  caseId: string;
  seq: number;
  speaker: Party;
  text: string;
  source: VoiceSource;
  audioUrl?: string;
  durationMs?: number;
  arrivedAt: number; // performance.now() ms
  /**
   * When the line started being heard; drives the reveal (voice.ts revealedText):
   * replay with audio and simulated personas wait for the audio manager's onStart (null until then);
   * live turns start on arrival.
   */
  startedAt: number | null;
}

export interface VoiceNote {
  noteId: string;
  caseId: string;
  from: Party;
  source: VoiceSource;
  transcript: string;
  audioUrl?: string;
  durationMs?: number;
  at: number; // performance.now() ms
}

export interface VoiceSlice {
  calls: Record<string, CallRecord>;
  /** callId -> lines in seq order. */
  transcripts: Record<string, TranscriptLine[]>;
  voiceNotes: VoiceNote[]; // newest last, capped at 50
  /** Set once the "Enable sound / Start demo" button unlocked the AudioContext. */
  soundEnabled: boolean;
}

const MAX_CALLS = 20;
const MAX_LINES = 200;

/** Lines whose text waits for their audio to start (replay audio, simulated personas). */
export function waitsForAudio(u: { audioUrl?: string; source: VoiceSource }): boolean {
  return Boolean(u.audioUrl) || u.source === "simulated_persona";
}

/** Pure: the voice slice after a bus event, or null when the event does not touch it. */
export function voiceReduce(s: VoiceSlice, e: WorldEvent, now: number): Partial<VoiceSlice> | null {
  switch (e.type) {
    case "call:ringing": {
      const rec: CallRecord = { callId: e.callId, caseId: e.caseId, caller: e.caller, callee: e.callee, source: e.source, purpose: e.purpose, status: "ringing", ringingAt: now };
      const kept = Object.values(s.calls).filter((c) => c.callId !== e.callId).sort((a, b) => a.ringingAt - b.ringingAt).slice(-(MAX_CALLS - 1));
      const calls: Record<string, CallRecord> = {};
      for (const c of kept) calls[c.callId] = c;
      calls[e.callId] = rec;
      const transcripts: Record<string, TranscriptLine[]> = {};
      for (const id of Object.keys(calls)) if (s.transcripts[id]) transcripts[id] = s.transcripts[id];
      return { calls, transcripts };
    }
    case "call:connected": {
      const c = s.calls[e.callId];
      if (!c) return null;
      return { calls: { ...s.calls, [e.callId]: { ...c, status: "connected", connectedAt: now } } };
    }
    case "call:ended": {
      const c = s.calls[e.callId];
      if (!c) return null;
      return { calls: { ...s.calls, [e.callId]: { ...c, status: "ended", endedAt: now, reason: e.reason, ...(e.summary ? { summary: e.summary } : {}) } } };
    }
    case "voice:utterance": {
      const line: TranscriptLine = {
        callId: e.callId, caseId: e.caseId, seq: e.seq, speaker: e.speaker, text: e.text, source: e.source,
        ...(e.audioUrl ? { audioUrl: e.audioUrl } : {}),
        ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
        arrivedAt: now,
        startedAt: waitsForAudio(e) ? null : now,
      };
      const prev = (s.transcripts[e.callId] ?? []).filter((l) => l.seq !== e.seq);
      const lines = [...prev, line].sort((a, b) => a.seq - b.seq).slice(-MAX_LINES);
      return { transcripts: { ...s.transcripts, [e.callId]: lines } };
    }
    case "voice:note_in": {
      const note: VoiceNote = {
        noteId: e.noteId, caseId: e.caseId, from: e.from, source: e.source, transcript: e.transcript,
        ...(e.audioUrl ? { audioUrl: e.audioUrl } : {}),
        ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
        at: now,
      };
      return { voiceNotes: [...s.voiceNotes.filter((n) => n.noteId !== e.noteId).slice(-49), note] };
    }
    default:
      return null;
  }
}

/** Weather the HUD/console forces on the Sky module; "auto" runs Sky's own looping cycle. */
export type WeatherOverride = "auto" | "clear" | "overcast" | "drizzle" | "rain" | "storm";

/** A city case waiting for the real agent (modules/WorkflowDriver/link.ts). */
export interface QueuedCase {
  id: string;
  label: string; // "INC-004 · car crash"
  kind: "incident" | "scenario" | "delay";
  enqueuedAt: number; // Date.now()
  /** Built from city events (simulated_persona inputs): the trace will be labelled synthetic. */
  synthetic: boolean;
  /** For kind "incident": the incident, so a refresh can queue it again (cityState.ts). */
  incidentId?: string;
}

export interface Delivery {
  id: string; // "DL-1042"
  truckId: string;
  stop: string; // road node id
  status: "loading" | "en_route" | "delayed" | "delivered" | "failed";
  etaS: number; // seconds of sim time remaining (rough)
}

interface WorldState extends VoiceSlice {
  /** Roads closed right now: edgeKey -> reason. Read with blockedSet(). */
  blocked: Record<string, string>;
  incidents: Incident[];
  events: CityEvent[];
  damage: DamageZone[];
  deliveries: Record<string, Delivery>;
  workflow: WorkflowEvent[]; // newest last, capped at 200
  selectedVehicle: string | null; // camera follows this vehicle id
  focus: { x: number; z: number } | null; // camera flies here (e.g. an incident)
  timeOfDay: number; // 0..24 hours
  timeScale: number; // clock speed multiplier (HUD fast-forward): 1, 3, 10, 30
  /**
   * Always "real": every city case goes to the agent API (POST /api/cases) and its trace is replayed.
   * The city has no mock mode any more; the field stays for the CityRemote/console telemetry contract.
   */
  agentMode: "mock" | "real";
  /** Whether the agent API answered its health check (null = not checked yet). */
  agentOnline: boolean | null;
  /** Budget guard for real cases started by the city (modules/WorkflowDriver/budget.ts). */
  agentBudget: AgentBudget;
  /** Cases waiting for the agent (FIFO): over budget, at the concurrency limit, or agent offline. */
  agentQueue: QueuedCase[];
  /** Real cases running on the agent API right now. */
  agentRunning: number;
  paused: boolean;
  /** Forced weather (Sky eases to it over ~2 s and holds it); "auto" resumes the cycle. */
  weatherOverride: WeatherOverride;

  blockEdge: (key: string, reason: string) => void;
  unblockEdge: (key: string) => void;
  addIncident: (i: Incident) => void;
  upsertEvent: (e: CityEvent) => void;
  addDamage: (d: DamageZone) => void;
  updateDamage: (id: string, patch: Partial<DamageZone>) => void;
  removeDamage: (id: string) => void;
  updateIncident: (id: string, patch: Partial<Incident>) => void;
  upsertDelivery: (d: Delivery) => void;
  pushWorkflow: (e: WorkflowEvent) => void;
  select: (vehicleId: string | null) => void;
  setFocus: (f: { x: number; z: number } | null) => void;
  setTimeOfDay: (h: number) => void;
  setTimeScale: (x: number) => void;
  setAgentMode: (m: "mock" | "real") => void;
  setAgentOnline: (v: boolean) => void;
  setAgentQueue: (queue: QueuedCase[], running: number) => void;
  /** Claim a real-agent slot now; false when over budget (the case waits in the queue). */
  claimAgentRun: (now?: number) => boolean;
  addAgentSpend: (usd: number) => void;
  setAgentBudgetMax: (n: number) => void;
  /** Merge another tab's start times (shared budget across open city tabs). */
  syncAgentBudget: (starts: number[], spentUsd?: number, maxPerWindow?: number) => void;
  setPaused: (p: boolean) => void;
  setWeatherOverride: (w: WeatherOverride) => void;
  /** Replace the persisted parts with a saved city (cityState.ts hydrateCity), before modules start. */
  hydrate: (h: Pick<WorldState, "incidents" | "events" | "blocked" | "weatherOverride" | "timeOfDay" | "timeScale" | "workflow">) => void;
  /** Voice (PRD J3). applyVoiceEvent is fed by the bus automatically (see the bottom of this file). */
  applyVoiceEvent: (e: WorldEvent) => void;
  /** The audio manager's onStart for a line: its text may now be revealed. */
  markUtteranceStarted: (callId: string, seq: number, at: number) => void;
  setSoundEnabled: (v: boolean) => void;
}

export const useWorld = create<WorldState>((set) => ({
  blocked: {},
  incidents: [],
  events: [],
  damage: [],
  deliveries: {},
  workflow: [],
  selectedVehicle: null,
  focus: null,
  timeOfDay: 17.5,
  timeScale: 1,
  agentMode: "real",
  agentOnline: null,
  agentBudget: newBudget(),
  agentQueue: [],
  agentRunning: 0,
  paused: false,
  weatherOverride: "auto",
  calls: {},
  transcripts: {},
  voiceNotes: [],
  soundEnabled: false,

  blockEdge: (key, reason) => set((s) => ({ blocked: { ...s.blocked, [key]: reason } })),
  unblockEdge: (key) =>
    set((s) => {
      const next = { ...s.blocked };
      delete next[key];
      return { blocked: next };
    }),
  addIncident: (i) => set((s) => ({ incidents: [...s.incidents.slice(-49), i] })),
  upsertEvent: (e) => set((s) => ({ events: [...s.events.filter((x) => x.id !== e.id), e].slice(-30) })),
  addDamage: (d) => set((s) => ({ damage: [...s.damage, d] })),
  updateDamage: (id, patch) => set((s) => ({ damage: s.damage.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  removeDamage: (id) => set((s) => ({ damage: s.damage.filter((d) => d.id !== id) })),
  updateIncident: (id, patch) =>
    set((s) => ({ incidents: s.incidents.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  upsertDelivery: (d) => set((s) => ({ deliveries: { ...s.deliveries, [d.id]: d } })),
  pushWorkflow: (e) => set((s) => ({ workflow: [...s.workflow.slice(-199), e] })),
  select: (selectedVehicle) => set({ selectedVehicle }),
  setFocus: (focus) => set({ focus }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  setTimeScale: (timeScale) => set({ timeScale }),
  // No mock mode: a remote "mock" command is ignored, the city stays on the real agent.
  setAgentMode: () => set({ agentMode: "real" }),
  setAgentOnline: (agentOnline) => set({ agentOnline }),
  claimAgentRun: (now = Date.now()) => {
    const next = claimRun(useWorld.getState().agentBudget, now);
    if (next) set({ agentBudget: next });
    return next !== null;
  },
  setAgentQueue: (agentQueue, agentRunning) => set({ agentQueue, agentRunning }),
  addAgentSpend: (usd) => set((s) => ({ agentBudget: addSpend(s.agentBudget, usd) })),
  setAgentBudgetMax: (n) => set((s) => ({ agentBudget: { ...s.agentBudget, maxPerWindow: clampMax(n) } })),
  syncAgentBudget: (starts, spentUsd, maxPerWindow) =>
    set((s) => ({
      agentBudget: {
        ...s.agentBudget,
        starts: mergeStarts(s.agentBudget.starts, starts, Date.now(), s.agentBudget.windowMs),
        ...(spentUsd !== undefined && spentUsd > s.agentBudget.spentUsd ? { spentUsd } : {}),
        ...(maxPerWindow !== undefined ? { maxPerWindow: clampMax(maxPerWindow) } : {}),
      },
    })),
  setPaused: (paused) => set({ paused }),
  setWeatherOverride: (weatherOverride) => set({ weatherOverride }),
  hydrate: (h) => set({ ...h, incidents: h.incidents.slice(-50), events: h.events.slice(-30), workflow: h.workflow.slice(-200) }),
  applyVoiceEvent: (e) =>
    set((s) => voiceReduce(s, e, typeof performance !== "undefined" ? performance.now() : Date.now()) ?? s),
  markUtteranceStarted: (callId, seq, at) =>
    set((s) => {
      const lines = s.transcripts[callId];
      if (!lines?.some((l) => l.seq === seq && l.startedAt === null)) return s;
      return { transcripts: { ...s.transcripts, [callId]: lines.map((l) => (l.seq === seq ? { ...l, startedAt: at } : l)) } };
    }),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
}));

// The voice slice follows the bus, so calls and transcripts are recorded whichever page or module is mounted.
// Re-subscribed on hot reload so a stale store never keeps listening.
{
  const g = globalThis as unknown as { __worldVoiceOff?: () => void };
  g.__worldVoiceOff?.();
  g.__worldVoiceOff = on((e) => useWorld.getState().applyVoiceEvent(e));
}

/** Current blocked edges as a Set, for findPath(). Call inside useFrame via useWorld.getState(). */
export function blockedSet(): Set<string> {
  return new Set(Object.keys(useWorld.getState().blocked));
}

/** Max real cases running at once per city tab. */
export const AGENT_MAX_CONCURRENT = 2;

/** True when the agent can take another case right now: online, nothing queued, a slot free. Scenario autoplay waits for this. */
export function agentIdle(s: Pick<WorldState, "agentOnline" | "agentQueue" | "agentRunning"> = useWorld.getState()): boolean {
  return s.agentOnline === true && s.agentQueue.length === 0 && s.agentRunning < AGENT_MAX_CONCURRENT;
}
