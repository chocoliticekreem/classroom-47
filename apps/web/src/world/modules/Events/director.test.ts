import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { on, type WorldEvent } from "../../bus";
import { allVehicles } from "../../registry";
import { useWorld } from "../../store";
import { EventsDirector } from "./director";
import { SCHEDULE } from "./schedule";

beforeAll(() => {
  // the helicopter's canvas liveries need a document; a blank 2D context is fine here
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
});

const eventClosures = () => Object.entries(useWorld.getState().blocked).filter(([, r]) => r.startsWith("Road closed: "));

function run(d: EventsDirector, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds * 10; i++) {
    d.step(0.1);
    each?.();
  }
}

describe("EventsDirector lifecycle", () => {
  let bus: WorldEvent[] = [];
  let off: () => void = () => {};
  let d: EventsDirector;

  beforeEach(() => {
    useWorld.setState({ blocked: {}, incidents: [], events: [], paused: false, timeOfDay: 14 });
    bus = [];
    off = on((e) => bus.push(e));
    d = new EventsDirector(1, false);
  });

  afterEach(() => {
    d.dispose();
    off();
  });

  it("motorcade: planned -> live (incident + rolling closure) -> ended with every road reopened", () => {
    d.request("motorcade");
    const ev = () => useWorld.getState().events.find((e) => e.kind === "motorcade")!;
    expect(ev().status).toBe("planned");
    expect(eventClosures()).toEqual([]);

    run(d, SCHEDULE.requestLeadMs / 1000 + 0.2);
    expect(ev().status).toBe("live");
    expect(bus.some((e) => e.type === "event:started")).toBe(true);
    const inc = useWorld.getState().incidents.find((i) => i.kind === "event_closure")!;
    expect(inc.status).toBe("active");
    expect(inc.note).toBe("President's motorcade: roads closing on its route");
    expect(bus.some((e) => e.type === "incident:created" && e.incidentId === inc.id)).toBe(true);
    expect(eventClosures().length).toBeGreaterThan(2);
    expect(eventClosures().every(([, r]) => r === "Road closed: motorcade")).toBe(true);

    const route = ev().route;
    const firstEdge = [route[0], route[1]].sort().join("|");
    expect(firstEdge in useWorld.getState().blocked).toBe(true);
    let reopenedBehind = false;
    let maxClosed = 0;
    let motorcadeVehicles = 0;
    run(d, 300, () => {
      const e = ev();
      if (e.status !== "live") return;
      maxClosed = Math.max(maxClosed, eventClosures().length);
      if (!(firstEdge in useWorld.getState().blocked)) reopenedBehind = true;
      motorcadeVehicles = Math.max(motorcadeVehicles, [...allVehicles()].filter((v) => v.id.startsWith("MOTORCADE")).length);
    });
    expect(ev().status).toBe("ended");
    expect(reopenedBehind).toBe(true);
    expect(motorcadeVehicles).toBe(12);
    expect(maxClosed).toBeLessThan(40); // a window, not the whole route
    expect(eventClosures()).toEqual([]);
    expect([...allVehicles()].filter((v) => v.id.startsWith("MOTORCADE"))).toEqual([]);
    expect(useWorld.getState().incidents.find((i) => i.id === inc.id)!.status).toBe("cleared");
    expect(bus.some((e) => e.type === "event:ended")).toBe(true);
    expect(bus.some((e) => e.type === "incident:cleared" && e.incidentId === inc.id)).toBe(true);
  });

  it("marathon closes the whole course for ~2 minutes and leaves other closures alone", () => {
    useWorld.getState().blockEdge("g_0_1|g_1_1", "Crash on King St");
    d.request("marathon");
    run(d, 5);
    const ev = useWorld.getState().events.find((e) => e.kind === "marathon")!;
    expect(ev.status).toBe("live");
    const blocked = useWorld.getState().blocked;
    for (let k = 0; k + 1 < ev.route.length; k++) expect([ev.route[k], ev.route[k + 1]].sort().join("|") in blocked).toBe(true);
    expect(blocked["g_0_1|g_1_1"]).toBe("Crash on King St");
    run(d, 100);
    expect(useWorld.getState().events.find((e) => e.id === ev.id)!.status).toBe("live");
    run(d, 30);
    expect(useWorld.getState().events.find((e) => e.id === ev.id)!.status).toBe("ended");
    expect(eventClosures()).toEqual([]);
    expect(useWorld.getState().blocked["g_0_1|g_1_1"]).toBe("Crash on King St");
  });

  it("only one closure event at a time: a requested one replaces the running one", () => {
    d.request("parade");
    run(d, 5);
    d.request("protest");
    const evs = useWorld.getState().events;
    expect(evs.find((e) => e.kind === "parade")!.status).toBe("ended");
    expect(eventClosures()).toEqual([]);
    run(d, 5);
    expect(useWorld.getState().events.find((e) => e.kind === "protest")!.status).toBe("live");
    expect(eventClosures().every(([, r]) => r === "Road closed: protest march")).toBe(true);
    d.dispose();
    expect(eventClosures()).toEqual([]);
  });

  it("every event kind runs to the end and reopens its roads", () => {
    for (const kind of ["protest", "parade", "concert", "fireworks"] as const) {
      d.request(kind);
      run(d, 280);
      const e = useWorld.getState().events.filter((x) => x.kind === kind).pop()!;
      expect(e.status, kind).toBe("ended");
      expect(eventClosures(), kind).toEqual([]);
    }
  });

  it("pausing freezes the director", () => {
    d.request("marathon");
    useWorld.setState({ paused: true });
    run(d, 10);
    expect(useWorld.getState().events.find((e) => e.kind === "marathon")!.status).toBe("planned");
  });

  it("the schedule starts the motorcade on its own, and later events without overlap", () => {
    const auto = new EventsDirector(5);
    let overlap = false;
    run(auto, 1200, () => {
      const live = useWorld.getState().events.filter((e) => e.status !== "ended" && e.kind !== "fireworks");
      if (live.length > 1) overlap = true;
    });
    const kinds = useWorld.getState().events.map((e) => e.kind);
    expect(kinds[0]).toBe("motorcade");
    expect(new Set(kinds).size).toBeGreaterThan(2);
    expect(overlap).toBe(false);
    auto.dispose();
    expect(eventClosures()).toEqual([]);
  });

  it("sweeps leftover event closures nobody owns", () => {
    useWorld.getState().blockEdge("g_2_2|g_3_2", "Road closed: motorcade");
    d.sweep();
    expect(eventClosures()).toEqual([]);
  });
});
