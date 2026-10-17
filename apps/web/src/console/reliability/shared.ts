// The app-wide poller every console data hook shares, wired to page visibility and network events.
import { request } from "./http";
import { Poller } from "./poller";

export const sharedPoller = new Poller((path, signal) => request("GET", path, undefined, { signal }));

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => sharedPoller.wake());
  window.addEventListener("online", () => sharedPoller.wake({ retryNow: true }));
  window.addEventListener("focus", () => sharedPoller.wake());
}
