// The city's only workflow path: every case goes to the REAL agent API through the console
// (POST /api/console/city/cases, recorded in SQLite as origin "city"; agentBridge.runCityCase). No mock, no fallback.
//   incident:created  -> synthetic incident case (backendLink.buildIncidentCase)
//   delivery:delayed  -> grouped per cause over 20 s -> one synthetic delay case (backendLink.buildDelayCase)
//   scenario:staged   -> the public case's messages (+ modifier messages marked simulated_persona)
//   console runs      -> replayed as they are (already run by the console; no new agent call)
// Cases wait in a FIFO queue when over budget, at the concurrency limit, or while the agent is offline,
// and start as slots free up. All I/O is injected, so this is unit-tested without React or the network.
import type { Trace } from "../../../../../api/src/lib/trace";
import { outcomeOf, toCaseView, traceToTimedEvents, type AgentRunResult, type ReplayMeta, type ViewEvent } from "../../agentBridge";
import { buildDelayCase, buildIncidentCase, DelayGrouper, originOf, rememberReplay, type ExecutionDetail } from "../../backendLink";
import type { WorldEvent } from "../../bus";
import { getScenario, type Modifier } from "../../scenarios";
import type { Delivery, Incident, QueuedCase, WorkflowEvent } from "../../store";

export type HudEvent = Omit<WorkflowEvent, "id" | "t">;
type CaseView = { id: string; events: ViewEvent[]; mode?: "demo" | "practice"; context?: string | null };

export interface LinkDeps {
  /** Runs a case; rejects with `{ overBudget: true }` when the shared budget is full (the case waits). */
  runAgent: (view: CaseView, label: string) => Promise<AgentRunResult & { executionId?: string }>;
  /** Follow an execution that was already running before a refresh (agentBridge.followExecution). */
  follow?: (executionId: string) => Promise<AgentRunResult & { executionId?: string }>;
  push: (e: HudEvent) => void;
  emit: (e: WorldEvent) => void;
  /** setTimeout. */
  schedule: (fn: () => void, ms: number) => void;
  /** Agent API health (false or null = offline/unknown: cases wait). */
  online: () => boolean;
  /** Claim one slot from the budget guard; false = over budget, the case keeps waiting. */
  claim: () => boolean;
  onSpend: (trace: Trace) => void;
  onQueue: (queue: QueuedCase[], running: number) => void;
  incident: (id: string) => Incident | undefined;
  deliveries: () => Record<string, Delivery>;
  positions: () => Record<string, { x: number; z: number }>;
  /** Wall clock (ms epoch). */
  now: () => number;
  /** Clock for replay timing (performance.now in the app). */
  clock: () => number;
  maxConcurrent?: number;
  maxQueue?: number;
  delayWindowMs?: number;
}

interface Job extends QueuedCase {
  start: () => Promise<void>;
}

export class CityAgentLink {
  private queue: Job[] = [];
  private running = 0;
  private seq = { inc: 0, sc: 0, delay: 0, run: 0, job: 0 };
  private delays: DelayGrouper;
  /** Console replays waiting for the Scenarios module to stage their scene: scenarioId -> outcome + done time. */
  private consoleScenes = new Map<string, { outcome: ReturnType<typeof outcomeOf>; doneAt: number }>();
  /** runIds already replayed (city and console), so nothing is shown twice. */
  readonly replayedRuns = new Set<string>();
  dropped = 0;
  /** No new starts before this (Date.now()), after the server said over budget. */
  private holdUntil = 0;

  constructor(private d: LinkDeps) {
    this.delays = new DelayGrouper(d.delayWindowMs ?? 20_000);
  }

  get maxConcurrent() {
    return this.d.maxConcurrent ?? 2;
  }

  snapshot(): { queue: QueuedCase[]; running: number } {
    return {
      queue: this.queue.map((j) => ({ id: j.id, label: j.label, kind: j.kind, enqueuedAt: j.enqueuedAt, synthetic: j.synthetic, ...(j.incidentId ? { incidentId: j.incidentId } : {}) })),
      running: this.running,
    };
  }

  private changed() {
    const s = this.snapshot();
    this.d.onQueue(s.queue, s.running);
  }

  private enqueue(job: Omit<Job, "id" | "enqueuedAt">) {
    this.seq.job++;
    this.queue.push({ ...job, id: `job-${this.seq.job}`, enqueuedAt: this.d.now() });
    const max = this.d.maxQueue ?? 40;
    while (this.queue.length > max) {
      this.queue.shift();
      this.dropped++;
    }
    this.pump();
  }

  /** Start queued cases while the agent is online, a slot is free and the budget allows. Call on a timer too. */
  pump() {
    while (this.queue.length && this.running < this.maxConcurrent && this.d.online() && this.d.now() >= this.holdUntil) {
      if (!this.d.claim()) break;
      const job = this.queue.shift()!;
      this.running++;
      job
        .start()
        .catch((e: unknown) => {
          // The shared (SQLite) budget is full: back to the front of the queue, retry in 15 s.
          if ((e as { overBudget?: boolean } | null)?.overBudget) {
            this.queue.unshift(job);
            this.holdUntil = this.d.now() + 15_000;
          }
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
    this.changed();
  }

  /** Replay a real trace into the HUD; returns when (ms from now) the last event shows. */
  replay(result: Pick<AgentRunResult, "trace" | "card" | "outbox">, caseLabel: string, meta: ReplayMeta, executionId?: string): number {
    this.replayedRuns.add(result.trace.runId);
    rememberReplay({ caseLabel, trace: result.trace, card: result.card, outbox: result.outbox, origin: meta.origin, executionId });
    const timed = traceToTimedEvents(result.trace, caseLabel, meta);
    for (const t of timed) {
      const event = executionId ? { ...t.event, executionId } : t.event;
      this.d.schedule(() => this.d.push(event), t.atMs);
    }
    return timed.length ? timed[timed.length - 1].atMs : 0;
  }

  /** Run one view on the agent and replay it; errors become one labelled error line (no invented outcome). */
  private async runCase(view: CaseView, caseId: string, tag: Pick<HudEvent, "origin" | "synthetic">, startLine: string): Promise<(AgentRunResult & { executionId?: string }) | null> {
    const base = { source: "agent" as const, ...tag };
    this.d.push({ caseId, nodeId: "ingest", status: "start", summary: startLine, ...base });
    try {
      const result = await this.d.runAgent(view, caseId);
      this.d.onSpend(result.trace);
      return result;
    } catch (e) {
      if ((e as { overBudget?: boolean } | null)?.overBudget) {
        this.d.push({ caseId, nodeId: "ingest", status: "start", summary: "Waiting: the city's agent budget is used up for now.", ...base });
        throw e;
      }
      this.d.push({ caseId, nodeId: "log", status: "error", summary: "Couldn't reach the agent. Nothing was sent.", ...base });
      return null;
    }
  }

  // ---------------------------------------------------------------- city events

  incident(incidentId: string) {
    const inc = this.d.incident(incidentId);
    if (!inc) return;
    this.seq.inc++;
    const no = this.seq.inc;
    const label = `INC-${String(no).padStart(3, "0")} · ${inc.kind.replace("_", " ")}`;
    this.enqueue({
      label, kind: "incident", synthetic: true, incidentId,
      start: async () => {
        // Built when it starts, so the deliveries are current.
        const { view, affected } = buildIncidentCase(this.d.incident(incidentId) ?? inc, this.d.deliveries(), { now: new Date(this.d.now()), seq: no, positions: this.d.positions() });
        const dls = affected.map((d) => d.id).join(", ");
        const r = await this.runCase(view, label, { origin: "city_incident", synthetic: true }, `Practice case from the city${dls ? ` (${dls})` : ""}. Waiting for the answer…`);
        if (r) this.replay(r, label, { origin: "city_incident", synthetic: true }, r.executionId);
      },
    });
  }

  delayed(deliveryId: string, reason: string) {
    this.delays.add(deliveryId, reason, this.d.now());
  }

  /** Turn closed delay groups into cases. Call on a timer. */
  flushDelays() {
    for (const g of this.delays.due(this.d.now())) {
      this.seq.delay++;
      const no = this.seq.delay;
      const label = `DLY-${String(no).padStart(3, "0")} · ${g.ids.length} late`;
      this.enqueue({
        label, kind: "delay", synthetic: true,
        start: async () => {
          const { view } = buildDelayCase(g.reason, g.ids, this.d.deliveries(), { now: new Date(this.d.now()), seq: no });
          const r = await this.runCase(view, label, { origin: "city_incident", synthetic: true }, `${g.ids.length} late, cause: ${g.reason}. Waiting for the answer…`);
          if (r) this.replay(r, label, { origin: "city_incident", synthetic: true }, r.executionId);
        },
      });
    }
  }

  staged(ev: { runId: string; scenarioId: string; modifiers: Modifier[] }) {
    // A console run being acted out: its real trace is already in the feed; just resolve the scene.
    const scene = this.consoleScenes.get(ev.scenarioId);
    if (scene) {
      this.consoleScenes.delete(ev.scenarioId);
      const wait = Math.max(1500, scene.doneAt - this.d.clock());
      this.d.schedule(() => this.d.emit({ type: "scenario:resolved", runId: ev.runId, scenarioId: ev.scenarioId, outcome: scene.outcome }), wait);
      return;
    }
    const scenario = getScenario(ev.scenarioId);
    if (!scenario) return;
    this.seq.sc++;
    const label = `AGT-${String(this.seq.sc).padStart(3, "0")} · ${ev.scenarioId}`;
    const synthetic = ev.modifiers.length > 0;
    const tag = { origin: "city_scenario" as const, ...(synthetic ? { synthetic: true } : {}) };
    this.enqueue({
      label, kind: "scenario", synthetic,
      start: async () => {
        const r = await this.runCase(toCaseView(scenario, ev.modifiers), label, tag, "Waiting for the answer…");
        if (!r) return;
        const last = this.replay(r, label, tag, r.executionId);
        this.d.schedule(() => this.d.emit({ type: "scenario:resolved", runId: ev.runId, scenarioId: ev.scenarioId, outcome: outcomeOf(r.trace) }), last + 200);
      },
    });
  }

  /** A city case still running in the console when the page was refreshed: follow it and replay it. */
  resume(executionId: string, label: string) {
    const follow = this.d.follow;
    if (!follow) return;
    const tag = { origin: "city_incident" as const, synthetic: true };
    void follow(executionId)
      .then((r) => {
        if (this.replayedRuns.has(r.trace.runId)) return;
        this.d.onSpend(r.trace);
        this.replay(r, label, tag, executionId);
      })
      .catch(() => this.d.push({ caseId: label, nodeId: "log", status: "error", summary: "Couldn't reach the agent. Nothing was sent.", source: "agent", ...tag, executionId }));
  }

  /** A finished console execution (already run): replay it, and act its scene out if it has one. */
  consoleExecution(ex: ExecutionDetail) {
    if (!ex.trace) return;
    this.seq.run++;
    const label = `RUN-${String(this.seq.run).padStart(3, "0")} · ${ex.caseId}`;
    const meta: ReplayMeta = { origin: originOf(ex), synthetic: ex.simulated || ex.trace.synthetic === true };
    const last = this.replay({ trace: ex.trace, card: ex.card ?? null, outbox: ex.outbox ?? null }, label, meta, ex.id);
    if (getScenario(ex.caseId)) {
      this.consoleScenes.set(ex.caseId, { outcome: outcomeOf(ex.trace), doneAt: this.d.clock() + last });
      this.d.emit({ type: "request:scenario", scenarioId: ex.caseId, modifiers: [] });
    }
  }
}
