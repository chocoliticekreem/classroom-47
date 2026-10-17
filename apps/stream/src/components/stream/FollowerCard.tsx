"use client";

import { Eye, ShieldAlert } from "lucide-react";
import { topFollower, useFollowSnapshot } from "@/platform/follow/store";

function duration(s: number) {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/** Live-tab status for the follower watch. Copy stays "possible": a colour match is a hint, not an accusation. */
export function FollowerCard() {
  const snap = useFollowSnapshot();
  if (!snap.watching) return null;

  const follower = topFollower(snap);
  const tracked = snap.state?.people.length ?? 0;

  if (follower) {
    const severity = follower.appearances >= 5 || follower.moved_m >= 300 ? "red" : "amber";
    const tone = severity === "red" ? "border-live/50 bg-live/10 text-live" : "border-warn/50 bg-warn/10 text-warn";
    const where = follower.moved_m >= 50 ? `, while you walked ${Math.round(follower.moved_m)} m` : "";
    return (
      <section className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`} role="status">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Possible follower</p>
          <p className="mt-0.5 text-[14px] leading-6 text-text">
            Someone has been behind you for {duration(follower.visible_s)} across{" "}
            {plural(follower.appearances, "sighting")}
            {where}. Same outfit each time; this is not an identification.
          </p>
          <p className="mt-1 font-mono text-[10px] tracking-normal text-muted">
            {snap.state?.followers === 1 ? "1 person" : `${snap.state?.followers} people`} flagged · {plural(tracked, "person", "people")}{" "}
            tracked · consider changing route or ending the stream
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <Eye className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text">
          Watching for followers · {plural(tracked, "person", "people")} tracked
        </p>
        <p className="mt-0.5 text-[14px] leading-6 text-muted">
          {snap.error
            ? snap.error
            : snap.frames === 0
              ? "Reading your camera…"
              : "Flags anyone who stays in frame for a long time or keeps coming back as you move. Nothing is stored."}
        </p>
      </div>
    </section>
  );
}
