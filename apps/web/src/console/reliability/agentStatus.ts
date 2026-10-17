"use client";
// "Is the agent offline?" from the shared status poll, plus a tiny store saying whether the
// offline banner is on screen. While it is, data hooks hide connection errors (the banner
// already says it once, calmly) and keep showing their last good data.
import { useSyncExternalStore } from "react";
import { isConnectionError } from "./http";
import type { PollSnapshot } from "./poller";
import { sharedPoller } from "./shared";

export const STATUS_PATH = "/api/console/status";
export const AGENT_OFFLINE_MESSAGE = "The agent is offline. Cases will wait.";
/** Consecutive connection failures of the status poll before we call it offline (avoids flicker). */
export const OFFLINE_AFTER_FAILURES = 2;

/** Pure: offline = the console says the agent isn't answering, or the console itself keeps failing. */
export function agentOfflineFrom(snap: PollSnapshot<{ agentApi?: boolean } | unknown>): boolean {
  const data = snap.data as { agentApi?: boolean } | undefined;
  if (snap.error && isConnectionError(snap.error) && snap.failures >= OFFLINE_AFTER_FAILURES) return true;
  return data?.agentApi === false;
}

/** Non-React check (e.g. to word a failed "Run a case"). */
export function isAgentKnownOffline(): boolean {
  return agentOfflineFrom(sharedPoller.getSnapshot(STATUS_PATH));
}

// ---- banner-visible store ----
let bannersShowing = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The banner calls this while it is showing; returns the undo. */
export function markOfflineBannerShowing(): () => void {
  bannersShowing++;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    bannersShowing--;
    emit();
  };
}

function subscribeBanner(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while the offline banner is on screen: hooks should not repeat the error. */
export function useOfflineBannerShowing(): boolean {
  return useSyncExternalStore(subscribeBanner, () => bannersShowing > 0, () => false);
}
