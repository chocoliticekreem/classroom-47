import type { ChatMessage, StreamLocation } from "@/lib/types";

/**
 * Cross-tab event bus. The stream page, the 3D city (Arvin) and any sim/agent tab
 * open on the same origin share one channel, so they integrate without a backend.
 */
export type BusEvent =
  | { type: "stream.location"; location: StreamLocation }
  | { type: "stream.viewers"; viewers: number }
  | { type: "chat.message"; message: ChatMessage }
  | { type: "location.reveal"; location: StreamLocation; viewers: number; at: number }
  | { type: "sim.request"; location: StreamLocation; viewers: number; prompt: string }
  | { type: "surroundings.update"; summary: string; level: "calm" | "busy" | "danger" };

const CHANNEL = "classroom-47";

let channel: BroadcastChannel | null = null;
const local = new Set<(e: BusEvent) => void>();

function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

export function publish(event: BusEvent) {
  getChannel()?.postMessage(event);
  local.forEach((fn) => fn(event));
}

export function subscribe(fn: (e: BusEvent) => void) {
  const ch = getChannel();
  const onMessage = (m: MessageEvent<BusEvent>) => fn(m.data);
  ch?.addEventListener("message", onMessage);
  local.add(fn);
  return () => {
    ch?.removeEventListener("message", onMessage);
    local.delete(fn);
  };
}
