"use client";

import { useEffect, useRef, type RefObject } from "react";
import { publish } from "@/platform/bus";
import { resetFollowSnapshot, setFollowSnapshot } from "./store";
import type { FollowState } from "./types";

/** One frame a second is plenty: a follower is a minutes-long pattern, and YOLO on the laptop stays cheap. */
const SAMPLE_MS = 1000;
/** Downscaled width sent to the service; last_box comes back in this coordinate space. */
export const FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;

function sessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return Promise.resolve(null);
  const scale = FRAME_WIDTH / video.videoWidth;
  canvas.width = FRAME_WIDTH;
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/**
 * While `enabled`, samples the player's own video every second and sends it to the follower service,
 * keeping the shared FollowSnapshot current. Publishes `follower.alert` once per newly flagged person.
 * Only for the streamer's own camera (webcam or an uploaded IRL recording): a street cam is not "behind you".
 */
export function useFollowerWatch(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  point: { lat: number; lon: number },
) {
  // The session must outlive location changes: moving is exactly what makes a follower visible.
  const pointRef = useRef(point);
  useEffect(() => {
    pointRef.current = point;
  }, [point]);

  useEffect(() => {
    if (!enabled) {
      resetFollowSnapshot();
      return;
    }
    const session = sessionId();
    const canvas = document.createElement("canvas");
    const started = Date.now();
    const alerted = new Set<number>();
    let frames = 0;
    let busy = false;
    let cancelled = false;
    setFollowSnapshot({ watching: true, frames: 0, state: null, error: null, frameSize: null });

    const tick = async () => {
      const video = videoRef.current;
      if (!video || busy || cancelled) return;
      busy = true;
      try {
        const blob = await grab(video, canvas);
        if (!blob) return;
        const params = new URLSearchParams({
          session,
          t: String(Date.now() - started),
          lat: String(pointRef.current.lat),
          lon: String(pointRef.current.lon),
        });
        const res = await fetch(`/api/follow/frame?${params}`, { method: "POST", body: blob });
        const body = (await res.json()) as FollowState & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setFollowSnapshot({ error: body.error ?? "Follower service unavailable" });
          return;
        }
        frames += 1;
        setFollowSnapshot({
          frames,
          error: null,
          state: { people: body.people, followers: body.followers },
          frameSize: { width: video.videoWidth, height: video.videoHeight },
        });
        for (const p of body.people) {
          if (!p.follower || alerted.has(p.id)) continue;
          alerted.add(p.id);
          publish({
            type: "follower.alert",
            personId: p.id,
            visibleS: p.visible_s,
            appearances: p.appearances,
            movedM: p.moved_m,
          });
        }
      } catch {
        if (!cancelled) setFollowSnapshot({ error: "Follower service unavailable" });
      } finally {
        busy = false;
      }
    };

    const id = setInterval(tick, SAMPLE_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      resetFollowSnapshot();
    };
  }, [videoRef, enabled]);
}
