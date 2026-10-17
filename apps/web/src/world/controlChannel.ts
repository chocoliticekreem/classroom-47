// Live link between the desk console ("/", City tab) and the 3D city ("/city"), in the same browser,
// via BroadcastChannel. The console sends commands; the city applies them and streams telemetry back.
export const CITY_CHANNEL = "rivet-city";

export type CityCommand =
  | { type: "weather"; weather: "auto" | "clear" | "overcast" | "drizzle" | "rain" | "storm" }
  | { type: "time"; hour: number }
  | { type: "timeScale"; scale: number }
  | { type: "pause"; paused: boolean }
  | { type: "inject"; event: "car_crash" | "truck_crash" | "pileup" | "roadworks" | "breakdown" | "emergency_landing" | "plane_crash" | "chase" | "motorcade" }
  | { type: "scenario"; scenarioId: string; modifiers: string[] }
  | { type: "agentMode"; mode: "mock" | "real" }
  | { type: "focus"; x: number; z: number }
  | { type: "tour"; on: boolean }
  | { type: "ping" };

export interface CityTelemetry {
  type: "telemetry";
  at: number; // Date.now()
  timeOfDay: number;
  weather: string;
  paused: boolean;
  timeScale: number;
  agentMode: "mock" | "real";
  incidents: { id: string; kind: string; status: string; note: string; x: number; z: number }[];
  closedRoads: number;
  deliveries: { en_route: number; delayed: number; delivered: number; loading: number; failed: number };
  vehicles: Record<string, number>; // count by registry kind
  workflow: { caseId: string; nodeId: string; status: string; summary: string; source?: string }[]; // last 20
}

export type CityMessage = CityCommand | CityTelemetry;
