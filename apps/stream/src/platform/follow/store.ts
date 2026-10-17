import { useSyncExternalStore } from "react";
import type { FollowSnapshot } from "./types";

const IDLE: FollowSnapshot = { watching: false, frames: 0, state: null, error: null, frameSize: null };

let snapshot = IDLE;
const listeners = new Set<() => void>();

export function setFollowSnapshot(next: Partial<FollowSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((fn) => fn());
}

export function resetFollowSnapshot() {
  snapshot = IDLE;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useFollowSnapshot() {
  return useSyncExternalStore(subscribe, () => snapshot, () => IDLE);
}

export function topFollower(snap: FollowSnapshot) {
  return snap.state?.people.find((p) => p.follower) ?? null;
}
