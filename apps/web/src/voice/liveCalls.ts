// The "Live calls" switch: when on, a run that decides to phone someone rings in the console as soon as
// it finishes, instead of only recording the call like any other message. Remembered on this browser;
// off by default, and off wherever browser storage is missing or blocked.
const KEY = "rivet-live-calls";
const EVENT = "rivet-live-calls";

export function liveCallsOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setLiveCalls(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, on ? "on" : "off");
  } catch {
    /* the switch still applies to this page */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** For useSyncExternalStore: tells React when the switch changes, here or in another tab. */
export function subscribeLiveCalls(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
