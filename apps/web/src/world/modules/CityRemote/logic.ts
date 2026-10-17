// Pure logic for CityRemote: apply a console command to the city, and build a telemetry snapshot.
// No React, no three, no BroadcastChannel here, so it's unit-testable.
import type { CityCommand, CityTelemetry } from "../../controlChannel";
import type { WorldEvent } from "../../bus";
import type { Delivery, Incident, WorkflowEvent } from "../../store";

type Weather = Extract<CityCommand, { type: "weather" }>["weather"];

/** The bits of the world store CityRemote touches. `setWeatherOverride` may not exist yet (feature-detected). */
export interface RemoteState {
  timeOfDay: number;
  timeScale: number;
  paused: boolean;
  agentMode: "mock" | "real";
  incidents: Incident[];
  blocked: Record<string, string>;
  deliveries: Record<string, Delivery>;
  workflow: WorkflowEvent[];
  weatherOverride?: string | null;
  setTimeOfDay: (h: number) => void;
  setTimeScale: (x: number) => void;
  setPaused: (p: boolean) => void;
  setAgentMode: (m: "mock" | "real") => void;
  setFocus: (f: { x: number; z: number } | null) => void;
  setWeatherOverride?: (w: unknown) => void;
}

export interface RemoteDeps {
  getState: () => RemoteState;
  emit: (e: WorldEvent) => void;
  chase: () => void;
  tourOn: () => boolean;
  toggleTour: () => void;
}

/** Applies one command. Returns false when it was ignored (unknown, invalid or unsupported). */
export function applyCommand(cmd: CityCommand, d: RemoteDeps): boolean {
  const s = d.getState();
  switch (cmd.type) {
    case "weather": {
      if (typeof s.setWeatherOverride !== "function") return false;
      s.setWeatherOverride(cmd.weather as Weather); // the store's WeatherOverride uses "auto" for "no override"
      return true;
    }
    case "time":
      if (!Number.isFinite(cmd.hour)) return false;
      s.setTimeOfDay(((cmd.hour % 24) + 24) % 24);
      return true;
    case "timeScale":
      if (!Number.isFinite(cmd.scale) || cmd.scale <= 0) return false;
      s.setTimeScale(cmd.scale);
      return true;
    case "pause":
      s.setPaused(!!cmd.paused);
      return true;
    case "inject":
      switch (cmd.event) {
        case "car_crash":
        case "truck_crash":
        case "pileup":
          d.emit({ type: "request:crash", kind: cmd.event });
          return true;
        case "roadworks":
          d.emit({ type: "request:roadworks" });
          return true;
        case "breakdown":
          d.emit({ type: "request:breakdown" });
          return true;
        case "emergency_landing":
        case "plane_crash":
          d.emit({ type: "request:plane", kind: cmd.event });
          return true;
        case "chase":
          d.chase();
          return true;
        case "motorcade":
          d.emit({ type: "request:event", kind: "motorcade" });
          return true;
        default:
          return false;
      }
    case "scenario":
      d.emit({
        type: "request:scenario",
        scenarioId: cmd.scenarioId,
        modifiers: cmd.modifiers as Extract<WorldEvent, { type: "request:scenario" }>["modifiers"],
      });
      return true;
    case "agentMode":
      if (cmd.mode !== "mock" && cmd.mode !== "real") return false;
      s.setAgentMode(cmd.mode);
      return true;
    case "focus":
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return false;
      s.setFocus({ x: cmd.x, z: cmd.z });
      return true;
    case "tour":
      if (d.tourOn() !== !!cmd.on) d.toggleTour();
      return true;
    case "ping":
      return true; // the caller replies with a fresh snapshot
    default:
      return false;
  }
}

/** Snapshot of the city for the console. `vehicleKinds` is one kind per live vehicle (from the registry). */
export function buildTelemetry(
  s: RemoteState,
  vehicleKinds: Iterable<string>,
  weather: string,
  now: number,
): CityTelemetry {
  const deliveries = { en_route: 0, delayed: 0, delivered: 0, loading: 0, failed: 0 };
  for (const d of Object.values(s.deliveries)) if (d.status in deliveries) deliveries[d.status] += 1;
  const vehicles: Record<string, number> = {};
  for (const k of vehicleKinds) vehicles[k] = (vehicles[k] ?? 0) + 1;
  return {
    type: "telemetry",
    at: now,
    timeOfDay: s.timeOfDay,
    weather: s.weatherOverride && s.weatherOverride !== "auto" ? String(s.weatherOverride) : weather,
    paused: s.paused,
    timeScale: s.timeScale,
    agentMode: s.agentMode,
    incidents: s.incidents
      .filter((i) => i.status !== "cleared")
      .map((i) => ({ id: i.id, kind: i.kind, status: i.status, note: i.note, x: i.x, z: i.z })),
    closedRoads: Object.keys(s.blocked).length,
    deliveries,
    vehicles,
    workflow: s.workflow.slice(-20).map((e) => ({
      caseId: e.caseId,
      nodeId: e.nodeId,
      status: e.status,
      summary: e.summary,
      source: e.source ?? "mock",
    })),
  };
}

/** Narrow an unknown channel message to a command (the channel also carries telemetry and junk). */
export function isCommand(m: unknown): m is CityCommand {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return typeof t === "string" && t !== "telemetry" &&
    ["weather", "time", "timeScale", "pause", "inject", "scenario", "agentMode", "focus", "tour", "ping"].includes(t);
}
