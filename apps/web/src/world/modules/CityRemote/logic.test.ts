import { describe, expect, it, vi } from "vitest";
import { applyCommand, buildTelemetry, isCommand, type RemoteDeps, type RemoteState } from "./logic";
import type { WorldEvent } from "../../bus";

function state(over: Partial<RemoteState> = {}): RemoteState {
  return {
    timeOfDay: 12, timeScale: 1, paused: false, agentMode: "mock",
    incidents: [], blocked: {}, deliveries: {}, workflow: [],
    setTimeOfDay: vi.fn(), setTimeScale: vi.fn(), setPaused: vi.fn(), setAgentMode: vi.fn(), setFocus: vi.fn(),
    ...over,
  };
}
function deps(s: RemoteState, tour = false) {
  const events: WorldEvent[] = [];
  const d: RemoteDeps = {
    getState: () => s,
    emit: (e) => events.push(e),
    chase: vi.fn(),
    tourOn: () => tour,
    toggleTour: vi.fn(),
  };
  return { d, events };
}

describe("applyCommand", () => {
  it("no-ops weather when the store has no override setter, applies it when it does", () => {
    const s = state();
    expect(applyCommand({ type: "weather", weather: "rain" }, deps(s).d)).toBe(false);
    const set = vi.fn();
    const s2 = state({ setWeatherOverride: set });
    applyCommand({ type: "weather", weather: "storm" }, deps(s2).d);
    applyCommand({ type: "weather", weather: "auto" }, deps(s2).d);
    expect(set.mock.calls).toEqual([["storm"], ["auto"]]);
  });

  it("sets time (wrapped), scale, pause, agent mode and focus", () => {
    const s = state();
    const { d } = deps(s);
    applyCommand({ type: "time", hour: 25 }, d);
    applyCommand({ type: "timeScale", scale: 10 }, d);
    applyCommand({ type: "pause", paused: true }, d);
    applyCommand({ type: "agentMode", mode: "real" }, d);
    applyCommand({ type: "focus", x: 4, z: -8 }, d);
    expect(s.setTimeOfDay).toHaveBeenCalledWith(1);
    expect(s.setTimeScale).toHaveBeenCalledWith(10);
    expect(s.setPaused).toHaveBeenCalledWith(true);
    expect(s.setAgentMode).toHaveBeenCalledWith("real");
    expect(s.setFocus).toHaveBeenCalledWith({ x: 4, z: -8 });
    expect(applyCommand({ type: "timeScale", scale: 0 }, d)).toBe(false);
  });

  it("maps injections to bus requests and the chase hook", () => {
    const s = state();
    const { d, events } = deps(s);
    for (const event of ["car_crash", "truck_crash", "pileup", "roadworks", "breakdown", "emergency_landing", "plane_crash", "chase", "motorcade"] as const)
      applyCommand({ type: "inject", event }, d);
    expect(events).toEqual([
      { type: "request:crash", kind: "car_crash" },
      { type: "request:crash", kind: "truck_crash" },
      { type: "request:crash", kind: "pileup" },
      { type: "request:roadworks" },
      { type: "request:breakdown" },
      { type: "request:plane", kind: "emergency_landing" },
      { type: "request:plane", kind: "plane_crash" },
      { type: "request:event", kind: "motorcade" },
    ]);
    expect(d.chase).toHaveBeenCalledTimes(1);
  });

  it("emits scenario requests with modifiers", () => {
    const { d, events } = deps(state());
    applyCommand({ type: "scenario", scenarioId: "delivery-024", modifiers: ["noise"] }, d);
    expect(events).toEqual([{ type: "request:scenario", scenarioId: "delivery-024", modifiers: ["noise"] }]);
  });

  it("toggles the tour only when it differs", () => {
    const off = deps(state(), false).d;
    applyCommand({ type: "tour", on: false }, off);
    expect(off.toggleTour).not.toHaveBeenCalled();
    applyCommand({ type: "tour", on: true }, off);
    expect(off.toggleTour).toHaveBeenCalledTimes(1);
  });
});

describe("buildTelemetry", () => {
  it("counts deliveries and vehicles, drops cleared incidents, keeps last 20 workflow events with source", () => {
    const s = state({
      blocked: { "a|b": "crash", "c|d": "works" },
      incidents: [
        { id: "I1", kind: "car_crash", edgeKey: "a|b", x: 1, z: 2, status: "active", createdAt: 0, note: "n1" },
        { id: "I2", kind: "roadworks", edgeKey: "c|d", x: 3, z: 4, status: "cleared", createdAt: 0, note: "n2" },
      ],
      deliveries: {
        a: { id: "a", truckId: "t", stop: "s", status: "en_route", etaS: 1 },
        b: { id: "b", truckId: "t", stop: "s", status: "en_route", etaS: 1 },
        c: { id: "c", truckId: "t", stop: "s", status: "delayed", etaS: 1 },
      },
      workflow: Array.from({ length: 25 }, (_, i) => ({
        id: `e${i}`, t: i, caseId: "CASE-1", nodeId: "triage", status: "ok" as const, summary: `s${i}`,
        source: i === 24 ? ("agent" as const) : undefined,
      })),
    });
    const t = buildTelemetry(s, ["car", "car", "van"], "drizzle", 123);
    expect(t.type).toBe("telemetry");
    expect(t.at).toBe(123);
    expect(t.weather).toBe("drizzle");
    expect(t.closedRoads).toBe(2);
    expect(t.incidents.map((i) => i.id)).toEqual(["I1"]);
    expect(t.deliveries).toEqual({ en_route: 2, delayed: 1, delivered: 0, loading: 0, failed: 0 });
    expect(t.vehicles).toEqual({ car: 2, van: 1 });
    expect(t.workflow).toHaveLength(20);
    expect(t.workflow[0].summary).toBe("s5");
    expect(t.workflow[0].source).toBe("mock");
    expect(t.workflow[19].source).toBe("agent");
  });

  it("reports the weather override when one is set, else the live sky weather", () => {
    expect(buildTelemetry(state({ weatherOverride: "storm" }), [], "clear", 0).weather).toBe("storm");
    expect(buildTelemetry(state({ weatherOverride: "auto" }), [], "drizzle", 0).weather).toBe("drizzle");
  });
});

describe("isCommand", () => {
  it("accepts commands, rejects telemetry and junk", () => {
    expect(isCommand({ type: "ping" })).toBe(true);
    expect(isCommand({ type: "telemetry" })).toBe(false);
    expect(isCommand({ type: "nope" })).toBe(false);
    expect(isCommand(null)).toBe(false);
  });
});
