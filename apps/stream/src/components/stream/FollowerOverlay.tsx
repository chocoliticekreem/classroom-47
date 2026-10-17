"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { topFollower, useFollowSnapshot } from "@/platform/follow/store";
import { FRAME_WIDTH } from "@/platform/follow/useFollowerWatch";

/**
 * Draws the flagged person's last box over the video. The video is object-cover inside its box,
 * so the frame is scaled to cover and centred before the 640-px-space box is mapped onto it.
 */
export function FollowerOverlay() {
  const snap = useFollowSnapshot();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const follower = topFollower(snap);
  const frame = snap.frameSize;
  if (!follower?.last_box || !frame || size.width === 0) {
    return <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden />;
  }

  const scale = Math.max(size.width / frame.width, size.height / frame.height);
  const offsetX = (size.width - frame.width * scale) / 2;
  const offsetY = (size.height - frame.height * scale) / 2;
  const toFrame = frame.width / FRAME_WIDTH;
  const [x1, y1, x2, y2] = follower.last_box.map((v) => v * toFrame);
  const stale = (follower.last_seen_s_ago ?? 0) > 2;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className={`absolute rounded-[3px] border-2 transition-all duration-300 ${
          stale ? "border-warn/50" : "border-warn shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
        }`}
        style={{
          left: offsetX + x1 * scale,
          top: offsetY + y1 * scale,
          width: (x2 - x1) * scale,
          height: (y2 - y1) * scale,
        }}
      >
        <span className="absolute -top-5 left-0 whitespace-nowrap rounded-[3px] bg-warn px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-normal text-bg">
          Possible follower · {Math.round(follower.visible_s / 60) || "<1"} min
        </span>
      </div>
    </div>
  );
}
