// The city events director: runs the seeded schedule, turns bus requests into events, walks each event
// through planned -> live -> ended, mirrors it into the store (events, incidents, closures) and makes
// sure every road it closed is reopened. Owns all the event visuals (one group for the scene).
import * as THREE from "three";
import { emit } from "../../bus";
import { nextId } from "../../registry";
import { edgeMidpoint } from "../../roads";
import { useWorld, type CityEvent } from "../../store";
import { ClosureLedger, orphanClosures, type ClosureStore } from "./closure";
import { CrowdLayer } from "./crowd";
import { Fireworks } from "./fireworks";
import { HeliRig } from "./heli";
import { PropRenderer, VehicleRenderer } from "./render";
import { forceEnd, isClosureKind, isNightHour, newLife, Scheduler, SCHEDULE, stepLife, type EventKind, type Life } from "./schedule";
import { makeShow, type Ctx, type Show } from "./shows";

/** Every reason an event closure can carry (to sweep leftovers after a hot reload). */
const REASONS = new Set(["motorcade", "marathon", "protest march", "carnival parade", "concert crowds", "fireworks"].map((l) => `Road closed: ${l}`));

const store: ClosureStore = {
  blocked: () => useWorld.getState().blocked,
  block: (k, reason) => {
    useWorld.getState().blockEdge(k, reason);
    emit({ type: "road:blocked", edgeKey: k, reason });
  },
  unblock: (k) => {
    useWorld.getState().unblockEdge(k);
    emit({ type: "road:reopened", edgeKey: k });
  },
};

interface Run {
  event: CityEvent;
  show: Show;
  life: Life;
  incidentId: string | null;
  version: number;
  mirroredAt: number;
}

let eventSeq = 0;

export class EventsDirector {
  readonly root = new THREE.Group();
  private ctx: Ctx;
  private vehicles = new VehicleRenderer();
  private props = new PropRenderer();
  private crowd = new CrowdLayer("events-crowd");
  private fwCrowd = new CrowdLayer("events-fw-crowd", { people: 1400, props: 300, placards: 1, stewards: 1 });
  private heli = new HeliRig();
  private fireworks = new Fireworks();
  private anchors = new THREE.Group();
  private scheduler: Scheduler;
  private runs: Run[] = [];
  private simMs = 0; // simulation clock (stops while paused)
  private t = 0;
  private pollIn = 0;
  private sweepIn = 0;

  /** `autoplay` false: only requested events run (tests). */
  constructor(seed = 2026, private readonly autoplay = true) {
    this.root.name = "events";
    this.anchors.name = "events-anchors";
    this.root.add(this.vehicles.group, this.props.mesh, this.crowd.group, this.fwCrowd.group, this.heli.root, this.fireworks.points, this.anchors);
    this.scheduler = new Scheduler(seed, 0);
    this.ctx = {
      vehicles: this.vehicles,
      props: this.props,
      crowd: this.crowd,
      heli: this.heli,
      fwCrowd: this.fwCrowd,
      fireworks: this.fireworks,
      anchors: this.anchors,
      night: () => isNightHour(useWorld.getState().timeOfDay),
      ledger: (reason) => new ClosureLedger(store, reason),
    };
  }

  /** performance.now() equivalent of a sim-clock time (for CityEvent fields). */
  private wall(simMs: number) {
    return performance.now() + (simMs - this.simMs);
  }

  /** Live and planned events (for the dev hook). */
  get active(): readonly CityEvent[] {
    return this.runs.map((r) => r.event);
  }

  private closureRun() {
    return this.runs.find((r) => isClosureKind(r.show.kind));
  }

  /** Start an event now (bus request:event). A new closure event replaces a running one. */
  request(kind: EventKind) {
    if (isClosureKind(kind)) {
      const cur = this.closureRun();
      if (cur) this.finish(cur);
    } else if (this.runs.some((r) => r.show.kind === kind)) return; // already on
    if (this.begin(kind, SCHEDULE.requestLeadMs)) this.scheduler.noteRequested(this.simMs, kind);
  }

  private begin(kind: EventKind, leadMs: number): boolean {
    let show: Show;
    try {
      show = makeShow(kind);
    } catch (err) {
      console.warn(`[Events] can't stage ${kind}:`, err);
      return false;
    }
    const life = newLife(this.simMs, leadMs, leadMs + show.maxMs);
    const event: CityEvent = {
      id: `EV-${String(++eventSeq).padStart(3, "0")}`,
      kind,
      title: show.title,
      status: "planned",
      startsAt: this.wall(life.liveAt),
      endsAt: this.wall(life.maxEndAt),
      route: show.route,
      closedEdges: [],
      x: show.x,
      z: show.z,
    };
    this.runs.push({ event, show, life, incidentId: null, version: -1, mirroredAt: 0 });
    useWorld.getState().upsertEvent(event);
    return true;
  }

  private goLive(run: Run) {
    try {
      run.show.start(this.ctx);
    } catch (err) {
      console.warn(`[Events] ${run.show.kind} failed to start:`, err);
      run.show.stop();
      forceEnd(run.life, this.simMs);
      this.finish(run);
      return;
    }
    const closed = run.show.closed();
    run.event = { ...run.event, status: "live", startsAt: performance.now(), closedEdges: closed, x: run.show.x, z: run.show.z };
    run.version = run.show.closureVersion;
    const w = useWorld.getState();
    w.upsertEvent(run.event);
    if (run.show.note) {
      const edgeKey = closed[0] ?? `${run.show.route[0]}|${run.show.route[1]}`;
      const [x, z] = closed[0] ? edgeMidpoint(closed[0]) : [run.show.x, run.show.z];
      const id = nextId("INC");
      run.incidentId = id;
      w.addIncident({ id, kind: "event_closure", edgeKey, x, z, status: "active", createdAt: performance.now(), note: run.show.note });
      emit({ type: "incident:created", incidentId: id });
    }
    emit({ type: "event:started", eventId: run.event.id });
  }

  private finish(run: Run) {
    run.show.stop();
    forceEnd(run.life, this.simMs);
    this.runs = this.runs.filter((r) => r !== run);
    const w = useWorld.getState();
    const wasLive = run.event.status === "live";
    run.event = { ...run.event, status: "ended", endsAt: performance.now(), closedEdges: [] };
    w.upsertEvent(run.event);
    if (run.incidentId) {
      w.updateIncident(run.incidentId, { status: "cleared" });
      emit({ type: "incident:cleared", incidentId: run.incidentId });
    }
    if (wasLive) emit({ type: "event:ended", eventId: run.event.id });
  }

  /** Mirror closures and position into the CityEvent (at most every 0.75 s). */
  private mirror(run: Run) {
    const now = performance.now();
    if (run.version === run.show.closureVersion || now - run.mirroredAt < 750) return;
    run.version = run.show.closureVersion;
    run.mirroredAt = now;
    run.event = { ...run.event, closedEdges: run.show.closed(), x: run.show.x, z: run.show.z };
    useWorld.getState().upsertEvent(run.event);
  }

  /** Reopen event closures nobody owns any more (hot reload leftovers, a show that died). */
  sweep() {
    const owned = new Set<string>();
    for (const r of this.runs) for (const k of r.show.closed()) owned.add(k);
    for (const k of orphanClosures(useWorld.getState().blocked, REASONS, owned)) store.unblock(k);
  }

  step(delta: number) {
    const w = useWorld.getState();
    if (w.paused) return;
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.simMs += dt * 1000;
    this.t += dt;

    this.pollIn -= dt;
    if (this.pollIn <= 0 && this.autoplay) {
      this.pollIn = 0.5;
      const closure = !!this.closureRun();
      const fw = this.runs.some((r) => r.show.kind === "fireworks");
      const kind = this.scheduler.poll(this.simMs, w.timeOfDay, closure, fw);
      if (kind) this.begin(kind, SCHEDULE.plannedLeadMs);
    }

    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i];
      if (!run) continue;
      const done = run.life.phase === "live" ? run.show.update(dt) : false;
      const act = stepLife(run.life, this.simMs, done);
      if (act === "go_live") this.goLive(run);
      else if (act === "end") this.finish(run);
      else if (run.life.phase === "live") this.mirror(run);
    }

    this.sweepIn -= dt;
    if (this.sweepIn <= 0) {
      this.sweepIn = 1.5;
      for (const r of this.runs) if (r.life.phase === "live") r.show.reassert();
      this.sweep();
    }

    this.vehicles.tick(this.t);
    this.fireworks.tick(dt);
  }

  /** End everything (unmount): every closure reopens. */
  dispose() {
    for (const r of [...this.runs]) this.finish(r);
    this.sweep();
    this.vehicles.dispose();
    this.props.dispose();
    this.crowd.dispose();
    this.fwCrowd.dispose();
    this.heli.dispose();
    this.fireworks.dispose();
  }
}
