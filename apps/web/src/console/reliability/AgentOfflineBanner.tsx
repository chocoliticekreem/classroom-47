"use client";
// One calm line at the top of the console when the agent can't be reached, instead of red
// errors in every panel. Shares the status poll with the sidebar (no extra requests) and hides
// itself as soon as the agent answers again; nobody has to press anything.
import { useEffect } from "react";
import { useStatus } from "../useApi";
import { AGENT_OFFLINE_MESSAGE, agentOfflineFrom, markOfflineBannerShowing, STATUS_PATH } from "./agentStatus";
import { sharedPoller } from "./shared";

export function AgentOfflineBanner({ className }: { className?: string }) {
  // Subscribing keeps the shared status poll alive and re-renders on each answer; the raw
  // snapshot is read because it counts consecutive failures (the hook's `error` may be hidden).
  useStatus({ pollMs: 5000 });
  const offline = agentOfflineFrom(sharedPoller.getSnapshot(STATUS_PATH));

  useEffect(() => (offline ? markOfflineBannerShowing() : undefined), [offline]);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "flex items-center gap-2.5 border-b border-rv-amber/20 bg-rv-amber/[0.06] px-4 py-2 text-[13px] text-white/75",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rv-amber" aria-hidden="true" />
      {AGENT_OFFLINE_MESSAGE}
    </div>
  );
}

export default AgentOfflineBanner;
