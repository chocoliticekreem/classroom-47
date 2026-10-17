"use client";

// Stream page <-> Tower Hill. Channel name matches the stream app. Do not import apps/stream.
import { useTower } from "./state";

const CHANNEL = "classroom-47";

function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CHANNEL);
}

export function publishSurroundings(summary: string, level: "calm" | "busy" | "danger"): void {
  const ch = openChannel();
  if (!ch) return;
  ch.postMessage({ type: "surroundings.update", summary, level });
  ch.close();
}

export function startStreamBus(): () => void {
  const ch = openChannel();
  if (!ch) return () => {};

  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as { type?: string; scenario?: string } | null;
    if (!data || typeof data !== "object") return;
    const { type, scenario } = data;
    if (type === "streamer:location_leaked" || (type === "reality:fork" && scenario === "leak_location_50")) {
      useTower.getState().previewLeak();
      return;
    }
    if (type === "reality:fork" && scenario === "crosswalk_surge_50") {
      useTower.getState().previewCrossing();
    }
  };

  ch.addEventListener("message", onMessage);
  return () => {
    ch.removeEventListener("message", onMessage);
    ch.close();
  };
}
