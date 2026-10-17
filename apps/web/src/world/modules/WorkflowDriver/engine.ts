// Mock Delivery Ops agent. Pure and deterministic: seeded RNG, time only moves via advance(dtMs).
// Turns city happenings into cases and walks each one through the flow nodes, emitting WorkflowEvents.
import type { IncidentKind, WorkflowEvent } from "../../store";
import type { Modifier } from "../../scenarios";
import { CUSTOMER_TEMPLATES, NAMES, STREETS } from "./scenarios";
import { scenarioSpec } from "./fromScenario";

// ---------- Public types (the HUD may import these) ----------

export type NodeId =
  | "ingest" | "history" | "triage" | "clash" | "group" | "missing_info"
  | "planner" | "gate" | "human" | "action" | "verify" | "log";
export type Runner = "code" | "jev" | "claude";
export type StepStatus = WorkflowEvent["status"];
export type GateDecision = "allow" | "ask" | "block";
export type CaseKind = "incident" | "grouped_delay" | "single_delay" | "customer" | "scenario";
export type CaseState = "queued" | "running" | "awaiting_human" | "done" | "blocked";
/** Same values as bus scenario:resolved.outcome. */
export type Outcome = "acted" | "asked_for_info" | "escalated" | "blocked" | "no_action";

/** One finished node run (start events are not recorded here; see Case.currentNode). */
export interface StepSummary {
  nodeId: NodeId;
  runner: Runner;
  status: StepStatus;
  summary: string; // <= 90 chars
  t: number; // clock() at emit
}

export interface DecisionCard {
  options: string[];
  safe: string; // auto-picked after humanTimeoutMs; always undoable
  reason?: string;
  routeTo?: string;
  chosen?: string;
  auto?: boolean; // true when nobody answered in time
  deadlineAt?: number; // engine time, shared by the HUD and human review desk
}

export interface Case {
  id: string; // CASE-0001
  kind: CaseKind;
  title: string;
  createdAt: number; // engine time (ms)
  state: CaseState;
  currentNode: NodeId | null;
  risk: number; // 0..1
  gate: GateDecision;
  clash: boolean;
  costUsd: number; // mock, 0.0003..0.004
  steps: StepSummary[];
  decision?: DecisionCard;
  incidentId?: string;
  deliveryIds: string[];
  /** Set once the case finishes. */
  outcome?: Outcome;
  // Scenario cases only (from bus scenario:staged):
  scenarioId?: string; // "delivery-024"
  runId?: string;
  modifiers?: Modifier[];
  at?: { x: number; z: number };
  vehicleId?: string;
}

export interface ScenarioInput {
  runId: string;
  scenarioId: string;
  modifiers: Modifier[];
  x?: number;
  z?: number;
  vehicleId?: string;
}

export const FLOW_NODES: NodeId[] = [
  "ingest", "history", "triage", "clash", "group", "missing_info",
  "planner", "gate", "human", "action", "verify", "log",
];

export const NODE_RUNNER: Record<NodeId, Runner> = {
  ingest: "code", history: "code", triage: "jev", clash: "jev", group: "code", missing_info: "jev",
  planner: "claude", gate: "jev", human: "claude", action: "code", verify: "jev", log: "code",
};

export interface IncidentInput {
  id: string;
  kind: IncidentKind;
  edgeKey: string;
  note?: string;
  /** Hamyway deliveries on affected routes; random 3..8 when omitted/0. */
  affected?: number;
}

export interface CaseOverrides {
  risk?: number;
  verifyFails?: boolean;
}

export interface EngineOptions {
  emit: (e: WorkflowEvent) => void;
  seed?: number;
  /** Timestamp for emitted events. Defaults to engine time. Pass performance.now in the app. */
  clock?: () => number;
  background?: boolean; // spontaneous customer messages (default true)
  backgroundMinMs?: number; // 12000
  backgroundMaxMs?: number; // 20000
  delayWindowMs?: number; // 20000
  humanTimeoutMs?: number; // 6000
  maxConcurrent?: number; // 6
  firstCaseNo?: number; // 1
  idPrefix?: string; // event id prefix
  /** Called once when a case reaches the end of its flow (outcome is set). */
  onCaseDone?: (c: Case) => void;
}

export const CUSTOMER_TEMPLATE_IDS = CUSTOMER_TEMPLATES.map((t) => t.id);

export function gateDecision(risk: number): GateDecision {
  if (risk < 0.3) return "allow";
  if (risk < 0.8) return "ask";
  return "block";
}

/** Options from a human "ask" summary like "Decide: Refund £20 / Redeliver tomorrow / Investigate". */
export function parseDecisionCard(summary: string): string[] | null {
  const m = /^Decide[^:]*:\s*(.+)$/.exec(summary);
  return m ? m[1].split(" / ").map((s) => s.trim()) : null;
}

// ---------- Internals ----------

const MAX_SUMMARY = 90;
const clip = (s: string) => (s.length <= MAX_SUMMARY ? s : s.slice(0, MAX_SUMMARY - 1) + "…");

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function fill(s: string, vars: Record<string, string>) {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Everything needed to script one case. */
export interface Spec {
  kind: CaseKind;
  title: string;
  ingestRunner: Runner;
  ingest: string;
  history: string;
  intent: string;
  priority: "low" | "medium" | "high";
  p: number;
  clash?: string;
  group: string;
  missing?: string;
  plan: string;
  risk: [number, number];
  card: string[];
  safe: string;
  blockReason: string;
  action: string;
  target: string;
  verifyOk: string;
  incidentId?: string;
  deliveryIds: string[];
  // Optional path controls (used by scenario cases):
  riskRange?: [number, number]; // overrides risk
  verifyFails?: boolean; // forced; otherwise 25% random
  verifyFailText?: string;
  gateNote?: string; // appended to the gate summary
  reviewReason?: string; // the decision that needs human authority, not just a risky topic
  reviewOwner?: string;
  actBeforeReview?: boolean; // safe coordination goes out while the remaining decision is held
  noAction?: boolean; // skip action + verify
  outcome?: Outcome; // forced outcome unless the gate blocks
  caseLabel?: string; // appended to the case id, e.g. "delivery-024"
  scenario?: ScenarioInput;
}

interface PlanStep {
  nodeId: NodeId;
  runner: Runner;
  durMs: number;
  status: StepStatus;
  start: string;
  summary: string;
}

interface Run {
  c: Case;
  steps: PlanStep[];
  idx: number;
  phase: "idle" | "running" | "await";
  until: number;
  choice?: string;
  outcome: Outcome;
}

const START_TEXT: Record<NodeId, string> = {
  ingest: "Ingest: reading the message",
  history: "History: looking up order and past contacts",
  triage: "Triage: Jev scoring intent and priority",
  clash: "Clash: comparing driver, tracking and customer",
  group: "Group: scanning open cases",
  missing_info: "Missing info: checking what we still need",
  planner: "Planner: Claude drafting the next action",
  gate: "Gate: Jev scoring risk",
  human: "Human: Claude writing a decision card",
  action: "Action: sending",
  verify: "Verify: waiting for acknowledgement",
  log: "Log: writing the case record",
};

const INCIDENT_SPECS: Partial<Record<IncidentKind, Omit<Spec, "kind" | "title" | "incidentId" | "deliveryIds" | "group" | "ingestRunner"> & { headline: string; clashChance: number }>> = {
  roadworks: {
    headline: "Roadworks closed {street}",
    ingest: "Ingest: council alert · {street} closed for roadworks",
    history: "History: {n} Hamyway City deliveries routed via {street}",
    intent: "route_disruption", priority: "high", p: 0.94,
    clashChance: 0, clash: "",
    missing: "Missing info: reopen time unknown · ask council works desk",
    plan: "Plan: reroute {n} vans around {street} · tell recipients, no exact ETAs",
    risk: [0.08, 0.26],
    card: ["Reroute all", "Hold at depot", "Investigate"], safe: "Reroute all",
    blockReason: "route data stale",
    action: "Replan → {n} vans rerouted · SMS {n} recipients 'running late'",
    target: "driver apps",
    verifyOk: "Verify: new routes accepted by {n}/{n} driver apps",
  },
  car_crash: {
    headline: "Car crash on {street}",
    ingest: "Ingest: police feed · car crash on {street}, lane closed",
    history: "History: {n} Hamyway City deliveries due via {street} in 30 min",
    intent: "road_incident", priority: "high", p: 0.92,
    clashChance: 0.5, clash: "Clash: driver 'just a bump' vs police 'road closed 2h'",
    plan: "Plan: reroute {n} vans · log for insurer · no blame in messages",
    risk: [0.08, 0.24],
    card: ["Reroute + log", "Hold deliveries", "Investigate"], safe: "Reroute + log",
    blockReason: "liability unclear",
    action: "Replan → {n} vans avoid {street} · incident log filed",
    target: "driver apps",
    verifyOk: "Verify: {n}/{n} vans on new routes",
  },
  truck_crash: {
    headline: "Hamyway City truck crash on {street}",
    ingest: "Ingest: telematics hard-brake + 999 call · truck on {street}",
    history: "History: truck carried {n} parcels · driver 4 h on shift",
    intent: "vehicle_collision", priority: "high", p: 0.97,
    clashChance: 0.6, clash: "Clash: dashcam shows red light vs driver 'it was amber'",
    missing: "Missing info: injury status · ask ops lead, not the driver",
    plan: "Plan: spare truck, transfer {n} parcels, notify insurer",
    risk: [0.55, 0.75],
    reviewReason: "A Hamyway City driver may be injured after a collision. The ops lead must decide the welfare response and any parcel transfer.",
    reviewOwner: "On-call lead",
    card: ["Spare truck + transfer", "Hold parcels", "Notify insurer only"], safe: "Hold parcels",
    blockReason: "possible injury · ops lead takes over",
    action: "Dispatch → spare truck T-04 to {street} · insurer notified",
    target: "fleet desk",
    verifyOk: "Verify: T-04 en route · insurer ref INS-{rt}",
  },
  pileup: {
    headline: "Multi-car pileup on {street}",
    ingest: "Ingest: police feed + 4 driver alerts · pileup on {street}",
    history: "History: {n} Hamyway City deliveries queued behind {street}",
    intent: "road_incident", priority: "high", p: 0.96,
    clashChance: 0.5, clash: "Clash: map says 1 lane open vs police 'full closure'",
    missing: "Missing info: are any Hamyway City drivers involved? · ask fleet desk",
    plan: "Plan: hold vans clear of {street}, reroute {n} · tell recipients, no ETAs",
    risk: [0.08, 0.24],
    card: ["Reroute all", "Hold vans in place", "Investigate"], safe: "Hold vans in place",
    blockReason: "driver involvement unknown",
    action: "Replan → {n} vans rerouted around {street} · SMS recipients",
    target: "driver apps",
    verifyOk: "Verify: {n}/{n} vans clear of {street}",
  },
  plane_crash: {
    headline: "Light aircraft down near {street}",
    ingest: "Ingest: emergency broadcast · aircraft down near {street}",
    history: "History: {n} Hamyway City deliveries inside the cordon",
    intent: "major_incident", priority: "high", p: 0.98,
    clashChance: 0.4, clash: "Clash: news says 'airport area' vs police cordon at {street}",
    missing: "Missing info: cordon size and duration · follow police updates",
    plan: "Plan: pull {n} vans out of the cordon, pause drops, wait for police",
    risk: [0.55, 0.75],
    reviewReason: "A major incident affects deliveries inside a police cordon. The on-call lead must decide the service suspension with the authorities.",
    reviewOwner: "On-call lead",
    card: ["Pause all drops", "Reroute outside cordon", "Investigate"], safe: "Pause all drops",
    blockReason: "major incident · ops lead takes over",
    action: "Dispatch → {n} vans paused outside cordon",
    target: "fleet desk",
    verifyOk: "Verify: all vans outside cordon",
  },
  emergency_landing: {
    headline: "Emergency landing closed {street}",
    ingest: "Ingest: police feed · aircraft landed on {street}, road shut",
    history: "History: {n} Hamyway City deliveries routed via {street}",
    intent: "road_closure", priority: "high", p: 0.95,
    clashChance: 0.3, clash: "Clash: driver video shows road open vs police 'closed 3h'",
    plan: "Plan: reroute {n} vans around {street} · no exact ETAs to recipients",
    risk: [0.08, 0.24],
    card: ["Reroute all", "Hold at depot", "Investigate"], safe: "Reroute all",
    blockReason: "closure length unknown",
    action: "Replan → {n} vans avoid {street} · SMS {n} recipients 'running late'",
    target: "driver apps",
    verifyOk: "Verify: new routes accepted by {n}/{n} driver apps",
  },
  breakdown: {
    headline: "Van {van} broke down on {street}",
    ingest: "Ingest: driver app · van {van} won't start on {street}",
    history: "History: {van} has {n} parcels left · last service 9 days ago",
    intent: "vehicle_breakdown", priority: "high", p: 0.93,
    clashChance: 0.3, clash: "Clash: telematics 'engine running' vs driver 'engine dead'",
    plan: "Plan: ask fleet desk for recovery and a spare van · promise nothing",
    risk: [0.08, 0.24],
    card: ["Send spare van", "Hold to tomorrow", "Tow + transfer"], safe: "Send spare van",
    blockReason: "driver safety unconfirmed",
    action: "Fleet queue → fleet desk: request recovery and a spare van at {street}",
    target: "fleet desk",
    verifyOk: "Verify: V-03 en route · tow confirmed",
  },
};

const NO_CLASH = "Clash: none · driver, tracking and customer agree";
const NO_MISSING = "Missing info: none · have address, slot and contact";
const NO_GROUP = "Group: no related open cases";

export class WorkflowEngine {
  private readonly o: Required<Omit<EngineOptions, "clock">> & { clock?: () => number };
  private readonly rand: () => number;
  private t = 0;
  private nextCaseNo: number;
  private eventSeq = 0;
  private nextBgAt: number;
  private all: Case[] = [];
  private queue: Run[] = [];
  private active: Run[] = [];
  private delayBuckets = new Map<string, { ids: string[]; firstAt: number }>();
  private lastIncidentCase: { id: string; label: string } | null = null;

  constructor(opts: EngineOptions) {
    this.o = {
      seed: 1, background: true, backgroundMinMs: 12_000, backgroundMaxMs: 20_000, delayWindowMs: 20_000,
      humanTimeoutMs: 6_000, maxConcurrent: 6, firstCaseNo: 1, idPrefix: "wf", onCaseDone: () => {}, ...opts,
    };
    this.rand = mulberry32(this.o.seed);
    this.nextCaseNo = this.o.firstCaseNo;
    this.nextBgAt = this.between(this.o.backgroundMinMs, this.o.backgroundMaxMs);
  }

  /** Engine time in ms (only advances while not paused). */
  get now() {
    return this.t;
  }

  /** All known cases, oldest first (finished ones are kept, capped at 40). */
  cases(): readonly Case[] {
    return this.all;
  }

  advance(dtMs: number) {
    this.t += dtMs;
    if (this.o.background && this.t >= this.nextBgAt) {
      this.nextBgAt = this.t + this.between(this.o.backgroundMinMs, this.o.backgroundMaxMs);
      if (this.queue.length < 2) this.customerMessage();
    }
    this.flushDelays();
    while (this.active.length < this.o.maxConcurrent && this.queue.length) {
      const r = this.queue.shift()!;
      r.c.state = "running";
      this.active.push(r);
    }
    for (const r of this.active) this.progress(r);
    this.active = this.active.filter((r) => r.c.state === "running" || r.c.state === "awaiting_human");
  }

  // ---------- Triggers ----------

  incident(i: IncidentInput) {
    const s = INCIDENT_SPECS[i.kind] ?? INCIDENT_SPECS.car_crash!; // legacy mock (tests only): new kinds reuse the crash wording
    const note = (i.note ?? "").trim();
    const street = /\b(?:on|at|closed) ((?:the )?[A-Z][A-Za-z']*(?: [A-Z][A-Za-z']*)*)/.exec(note)?.[1] ?? this.streetFor(i.edgeKey);
    const n = String(i.affected && i.affected > 0 ? i.affected : 3 + Math.floor(this.rand() * 6));
    const van = /\b[VT]-\d+\b/.exec(note)?.[0] ?? `V-${10 + Math.floor(this.rand() * 30)}`;
    const vars = { street, n, van, rt: String(40000 + Math.floor(this.rand() * 9999)) };
    const headline = note || fill(s.headline, vars);
    const clash = this.rand() < s.clashChance ? s.clash : undefined;
    const spec: Spec = {
      ...s,
      kind: "incident",
      title: `${headline}: ${n} Hamyway City deliveries on affected routes`,
      ingestRunner: "code",
      clash: clash && fill(clash, vars),
      group: `Group: ${n} deliveries share 1 cause → 1 case`,
      ingest: fill(s.ingest, vars), history: fill(s.history, vars), plan: fill(s.plan, vars),
      missing: s.missing && fill(s.missing, vars),
      action: fill(s.action, vars), verifyOk: fill(s.verifyOk, vars),
      incidentId: i.id, deliveryIds: [],
    };
    const c = this.open(spec);
    this.lastIncidentCase = { id: c.id, label: i.kind.replace("_", " ") };
    return c;
  }

  delayed(deliveryId: string, reason: string) {
    for (const b of this.delayBuckets.values()) if (b.ids.includes(deliveryId)) return;
    const key = reason.trim() || "unknown cause";
    const b = this.delayBuckets.get(key);
    if (b) b.ids.push(deliveryId);
    else this.delayBuckets.set(key, { ids: [deliveryId], firstAt: this.t });
  }

  customerMessage(templateId?: string, overrides: CaseOverrides = {}) {
    const tpl = templateId
      ? CUSTOMER_TEMPLATES.find((x) => x.id === templateId) ?? CUSTOMER_TEMPLATES[0]
      : this.pick(CUSTOMER_TEMPLATES);
    const vars = {
      name: this.pick(NAMES),
      dl: `DL-${1000 + Math.floor(this.rand() * 2000)}`,
      street: this.pick(STREETS),
      rt: String(40000 + Math.floor(this.rand() * 9999)),
    };
    const f = (s: string) => fill(s, vars);
    return this.open(
      {
        kind: "customer",
        title: f(tpl.title),
        ingestRunner: tpl.photos ? "claude" : "code",
        ingest: f(tpl.ingest), history: f(tpl.history),
        intent: tpl.intent, priority: tpl.priority, p: tpl.p,
        clash: tpl.clash && f(tpl.clash),
        group: NO_GROUP,
        missing: tpl.missing && f(tpl.missing),
        plan: f(tpl.plan), risk: tpl.risk, card: tpl.card, safe: tpl.safe, blockReason: tpl.blockReason,
        reviewReason: tpl.reviewReason, reviewOwner: tpl.reviewOwner, noAction: tpl.noAction,
        action: f(tpl.action), target: f(tpl.target), verifyOk: f(tpl.verifyOk),
        deliveryIds: [vars.dl],
      },
      overrides,
    );
  }

  /** A real delivery case acted out in the city (bus scenario:staged). Modifiers drive the path. */
  scenario(input: ScenarioInput) {
    return this.open(scenarioSpec(input, () => this.rand()));
  }

  /** Answer a waiting decision card (from the HUD). Returns false if the case isn't waiting. */
  decide(caseId: string, option: string): boolean {
    const r = this.active.find((x) => x.c.id === caseId);
    if (!r || r.c.state !== "awaiting_human" || r.choice !== undefined || !r.c.decision?.options.includes(option) || this.t >= r.until) return false;
    r.choice = option;
    return true;
  }

  // ---------- Case building ----------

  private flushDelays() {
    for (const [reason, b] of this.delayBuckets) {
      if (this.t - b.firstAt < this.o.delayWindowMs) continue;
      this.delayBuckets.delete(reason);
      if (b.ids.length >= 2) this.openGroupedDelay(reason, b.ids);
      else this.openSingleDelay(reason, b.ids[0]);
    }
  }

  private openGroupedDelay(cause: string, ids: string[]) {
    const n = ids.length;
    const shown = ids.slice(0, 2).join(", ") + (n > 2 ? ` +${n - 2}` : "");
    this.open({
      kind: "grouped_delay",
      title: `${n} deliveries delayed, 1 cause: ${cause}`,
      ingestRunner: "code",
      ingest: `Ingest: ${n} delay events in 20 s · same cause`,
      history: `History: ${shown} · all late, ${cause}`,
      intent: "bulk_delay", priority: "high", p: 0.9,
      group: `Group: ${n} deliveries, 1 cause → 1 case, not ${n}`,
      plan: `Plan: one delay notice to ${n} recipients · no exact ETAs`,
      risk: [0.08, 0.24], card: ["Notify all", "Rebook tomorrow", "Investigate"], safe: "Notify all",
      blockReason: "cause unconfirmed",
      action: `SMS → ${n} recipients: 'running late, revised window not confirmed'`,
      target: "SMS gateway",
      verifyOk: `Verify: ${n}/${n} SMS delivered`,
      deliveryIds: ids,
    });
  }

  private openSingleDelay(cause: string, dl: string) {
    const linked = this.lastIncidentCase;
    this.open({
      kind: "single_delay",
      title: `Where's my parcel? ${dl} running late (${cause})`,
      ingestRunner: "code",
      ingest: `Ingest: chat · "where's my parcel?" · ${dl}`,
      history: `History: ${dl} delayed · ${cause}`,
      intent: "where_is_my_parcel", priority: "medium", p: 0.88,
      group: linked ? `Group: linked to ${linked.id} (${linked.label})` : NO_GROUP,
      plan: "Plan: explain the delay, revised window not confirmed, no exact ETA",
      risk: [0.05, 0.22], card: ["Send delay notice", "Rebook tomorrow", "Investigate"], safe: "Send delay notice",
      blockReason: "tracking unreliable",
      action: `Portal → recipient: ${dl} delayed, revised window not confirmed`,
      target: "recipient",
      verifyOk: "Verify: message delivered and read",
      deliveryIds: [dl],
    });
  }

  private open(spec: Spec, ov: CaseOverrides = {}): Case {
    const no = `CASE-${String(this.nextCaseNo++).padStart(4, "0")}`;
    const id = spec.caseLabel ? `${no} · ${spec.caseLabel}` : no;
    const range = spec.riskRange ?? spec.risk;
    const risk = ov.risk ?? round2(range[0] + this.rand() * (range[1] - range[0]));
    const gate = gateDecision(risk);
    const verifyFails = ov.verifyFails ?? spec.verifyFails ?? this.rand() < 0.25;
    const sc = spec.scenario;
    const c: Case = {
      id, kind: spec.kind, title: clip(spec.title), createdAt: this.t, state: "queued", currentNode: null,
      risk, gate, clash: !!spec.clash, costUsd: 0, steps: [], incidentId: spec.incidentId, deliveryIds: spec.deliveryIds,
      decision: gate === "ask" ? { options: spec.card, safe: spec.safe, reason: spec.reviewReason ?? "The proposed action needs approval from the owning team before the desk can commit to it.", routeTo: spec.reviewOwner } : undefined,
      ...(sc && {
        scenarioId: sc.scenarioId, runId: sc.runId, modifiers: sc.modifiers, vehicleId: sc.vehicleId,
        at: sc.x !== undefined && sc.z !== undefined ? { x: sc.x, z: sc.z } : undefined,
      }),
    };
    const outcome: Outcome =
      gate === "block" ? "blocked" : spec.outcome ?? (gate === "ask" ? "escalated" : "acted");
    const steps: PlanStep[] = [];
    const add = (nodeId: NodeId, status: StepStatus, summary: string, runner = NODE_RUNNER[nodeId]) =>
      steps.push({ nodeId, runner, status, durMs: this.duration(runner), start: START_TEXT[nodeId], summary: clip(summary) });

    const p = Math.min(0.99, Math.max(0.6, spec.p + (this.rand() - 0.5) * 0.06));
    add("ingest", "ok", spec.ingest, spec.ingestRunner);
    add("history", "ok", spec.history);
    add("triage", "ok", `Triage: ${spec.intent} · ${spec.priority} · p ${p.toFixed(2)}`);
    // Only the human decision card uses "ask" (the HUD pops a toast for every ask event).
    add("clash", "ok", spec.clash ?? NO_CLASH, spec.clash ? "claude" : "jev");
    add("group", "ok", spec.group);
    add("missing_info", "ok", spec.missing ?? NO_MISSING);
    add("planner", "ok", spec.plan);
    const r = risk.toFixed(2);
    const note = spec.gateNote ? ` · ${spec.gateNote}` : "";
    if (gate === "allow") add("gate", "ok", `Gate: risk ${r} < 0.3 · allow${note}`);
    else if (gate === "ask") add("gate", "ok", `Gate: risk ${r} · ask a human${note}`);
    else add("gate", "block", `Gate: risk ${r} ≥ 0.8 · block · ${spec.blockReason}`);
    const actionSteps = () => {
      add("action", "ok", spec.action);
      if (verifyFails) add("verify", "error", spec.verifyFailText ?? `Verify: no ack from ${spec.target} yet · retrying`);
      add("verify", "ok", spec.verifyOk);
    };
    const beforeReview = gate === "ask" && spec.actBeforeReview && !spec.noAction;
    if (beforeReview) actionSteps();
    if (gate === "ask") add("human", "ask", `Decide: ${spec.card.join(" / ")}`);
    if (gate !== "block" && !spec.noAction && !beforeReview) actionSteps();
    // Mock cost: Claude writes/plans, Jev scores, code is free.
    let cost = 0.0001;
    for (const s of steps) cost += s.runner === "claude" ? 0.0006 + this.rand() * 0.0005 : s.runner === "jev" ? 0.00004 + this.rand() * 0.00004 : 0;
    c.costUsd = Math.min(0.004, Math.max(0.0003, Math.round(cost * 10000) / 10000));
    const cost$ = `$${c.costUsd.toFixed(4)}`;
    const n = steps.length + 1;
    add("log", "ok",
      outcome === "blocked" ? `Log: ${no} blocked · handed to ops lead · ${n} steps · ${cost$}`
      : outcome === "no_action" ? `Log: ${no} closed · no action needed · ${n} steps · ${cost$}`
      : outcome === "asked_for_info" ? `Log: ${no} waiting on info · ${n} steps · ${cost$}`
      : `Log: ${no} closed · ${n} steps · ${cost$}`);

    this.all.push(c);
    if (this.all.length > 40) {
      const i = this.all.findIndex((x) => x.state === "done" || x.state === "blocked");
      if (i >= 0) this.all.splice(i, 1);
    }
    this.queue.push({ c, steps, idx: 0, phase: "idle", until: 0, outcome });
    return c;
  }

  // ---------- Stepping ----------

  private progress(r: Run) {
    for (;;) {
      const s = r.steps[r.idx];
      if (r.phase === "idle") {
        r.c.currentNode = s.nodeId;
        this.emit(r.c, s.nodeId, "start", s.start);
        r.phase = "running";
        r.until = this.t + s.durMs;
        return;
      }
      if (r.phase === "running") {
        if (this.t < r.until) return;
        this.record(r.c, s, s.status, s.summary);
        if (s.nodeId === "human") {
          r.phase = "await";
          r.until = this.t + this.o.humanTimeoutMs;
          r.c.decision!.deadlineAt = r.until;
          r.c.state = "awaiting_human";
          return;
        }
      } else {
        if (r.choice === undefined && this.t < r.until) return;
        const card = r.c.decision!;
        card.auto = r.choice === undefined;
        card.chosen = r.choice ?? card.safe;
        r.c.state = "running";
        this.record(r.c, s, "ok", card.auto
          ? `Human: no reply in ${Math.round(this.o.humanTimeoutMs / 1000)}s · auto '${card.chosen}' (undoable)`
          : `Human: ops chose '${card.chosen}'`);
      }
      r.idx++;
      r.phase = "idle";
      if (r.idx >= r.steps.length) {
        r.c.state = r.c.gate === "block" ? "blocked" : "done";
        r.c.currentNode = null;
        r.c.outcome = r.outcome;
        this.o.onCaseDone?.(r.c);
        return;
      }
    }
  }

  private record(c: Case, s: PlanStep, status: StepStatus, summary: string) {
    const ev = this.emit(c, s.nodeId, status, summary);
    c.steps.push({ nodeId: s.nodeId, runner: s.runner, status, summary: ev.summary, t: ev.t });
  }

  private emit(c: Case, nodeId: NodeId, status: StepStatus, summary: string): WorkflowEvent {
    const e: WorkflowEvent = {
      id: `${this.o.idPrefix}-${++this.eventSeq}`,
      t: this.o.clock ? this.o.clock() : this.t,
      caseId: c.id,
      nodeId,
      status,
      summary: clip(summary),
    };
    this.o.emit(e);
    return e;
  }

  // ---------- Helpers ----------

  private duration(runner: Runner) {
    // Real Jev is ~150 ms, but every node stays on screen >= 500 ms so it reads.
    if (runner === "claude") return this.between(1500, 3000);
    if (runner === "jev") return this.between(500, 700);
    return this.between(500, 750);
  }

  private between(a: number, b: number) {
    return Math.round(a + this.rand() * (b - a));
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)];
  }

  private streetFor(edgeKey: string) {
    return STREETS[hash(edgeKey) % STREETS.length];
  }
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}
