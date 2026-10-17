// Colours and labels shared by the HUD parts.
import type { IncidentKind, IncidentStatus } from "../../store";
import type { NodeStatus } from "./flow";

export const ORANGE = "#ff6a1a";

export const STATUS_COLOR: Record<NodeStatus, string> = {
  start: ORANGE,
  ok: "#34d399",
  ask: "#fbbf24",
  block: "#f43f5e",
  error: "#ef4444",
};

export const INCIDENT_STATUS_STYLE: Record<Exclude<IncidentStatus, "cleared">, string> = {
  active: "bg-rose-500/15 text-rose-300",
  responding: "bg-sky-400/15 text-sky-300",
  clearing: "bg-amber-400/15 text-amber-300",
};

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  car_crash: "Car crash",
  truck_crash: "Truck crash",
  roadworks: "Roadworks",
  breakdown: "Breakdown",
  pileup: "Pileup",
  emergency_landing: "Emergency landing",
  plane_crash: "Plane crash",
  cyclist_hit: "Cyclist hit",
  event_closure: "City event",
};

export const INCIDENT_COLOR: Record<IncidentKind, string> = {
  car_crash: "#f43f5e",
  truck_crash: "#fb7185",
  roadworks: "#fbbf24",
  breakdown: ORANGE,
  pileup: "#e11d48",
  emergency_landing: "#38bdf8",
  plane_crash: "#dc2626",
  cyclist_hit: "#f97316",
  event_closure: "#6366f1",
};
