// Traffic light timing for downtown intersections. Pure and deterministic, so the traffic
// module (which obeys it) and the traffic-light visuals (which show it) always agree.
import { getNode } from "./roads";

export const SIGNAL_CYCLE_MS = 16000; // full cycle
export const AMBER_MS = 2000; // last 2 s of each half is amber

export type SignalColour = "green" | "amber" | "red";

/** Which axis has green: "x" (east-west traffic) or "z" (north-south). Offset per junction so the city isn't in sync. */
function phase(nodeId: string, timeMs: number) {
  const n = getNode(nodeId);
  const offset = ((n.x * 7 + n.z * 13) % SIGNAL_CYCLE_MS + SIGNAL_CYCLE_MS) % SIGNAL_CYCLE_MS;
  const p = (timeMs + offset) % SIGNAL_CYCLE_MS;
  const half = SIGNAL_CYCLE_MS / 2;
  const axis = p < half ? "x" : "z";
  const amber = p % half > half - AMBER_MS;
  return { axis, amber } as const;
}

/** Only downtown intersections have lights. */
export function hasSignal(nodeId: string) {
  return nodeId.startsWith("g_");
}

/** Colour seen by a vehicle approaching `nodeId` from `fromNodeId`. Non-signal junctions are always green. */
export function signalFor(nodeId: string, fromNodeId: string, timeMs: number): SignalColour {
  if (!hasSignal(nodeId)) return "green";
  const n = getNode(nodeId);
  const f = getNode(fromNodeId);
  const approachAxis = Math.abs(n.x - f.x) > Math.abs(n.z - f.z) ? "x" : "z";
  const { axis, amber } = phase(nodeId, timeMs);
  if (approachAxis !== axis) return "red";
  return amber ? "amber" : "green";
}
