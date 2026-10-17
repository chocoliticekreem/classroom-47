"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AroundCam } from "@/platform/around/types";
import { calibrationFor, camFrame } from "../live/project";
import { useLive } from "../live/store";
import { syncClock, useCompare } from "./store";

const FRAME_REFRESH_MS = 15_000;

const panel: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "50%",
  height: "100%",
  background: "var(--surface)",
  borderRight: "1px solid var(--border-strong)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const caption: CSSProperties = {
  position: "absolute",
  bottom: 20,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(12,12,16,0.78)",
  border: "1px solid var(--border-strong)",
  backdropFilter: "blur(10px)",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

function Dot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: 999, background: color, boxShadow: `0 0 8px ${color}` }} />;
}

/** Size of a frame of the given aspect fitted inside a box (object-fit: contain), as CSS percentages. */
function containBox(boxW: number, boxH: number, aspect: number) {
  if (boxW <= 0 || boxH <= 0) return { width: "100%", height: "100%" };
  return boxW / boxH > aspect
    ? { width: `${((boxH * aspect) / boxW) * 100}%`, height: "100%" }
    : { width: "100%", height: `${(boxW / aspect / boxH) * 100}%` };
}

export function CompareOverlay() {
  const camId = useCompare((s) => s.camId);
  const cam = useLive((s) => s.cams.find((c) => c.id === camId));
  if (!cam) return null;
  return <ComparePanel key={cam.id} cam={cam} />;
}

/** Keyed by camera id so the video/fallback state resets when the camera changes. */
function ComparePanel({ cam }: { cam: AroundCam }) {
  const close = useCompare((s) => s.close);
  const clip = useLive((s) => s.clips[cam.id]);
  const [failed, setFailed] = useState(false);
  const [frameAt, setFrameAt] = useState(0);
  const [clipT, setClipT] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const frame = camFrame(cam);
  const cal = calibrationFor(cam.id);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width / 2, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    syncClock.video = el;
    const tick = setInterval(() => setClipT(el.currentTime), 250);
    return () => {
      clearInterval(tick);
      if (syncClock.video === el) syncClock.video = null;
    };
  }, [failed]);

  useEffect(() => {
    if (!failed) return;
    syncClock.video = null;
    const t = setInterval(() => setFrameAt(Date.now()), FRAME_REFRESH_MS);
    return () => clearInterval(t);
  }, [failed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  let people = 0;
  let vehicles = 0;
  for (const t of clip?.tracks ?? []) {
    if (t.kind === "person") people++;
    else vehicles++;
  }

  return (
    <div
      ref={root}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 25,
        color: "var(--text)",
        fontFamily: "var(--font-figtree), system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div style={{ ...panel, pointerEvents: "auto" }}>
        {failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${cam.name} latest frame`}
            src={`/api/around/frame?id=${encodeURIComponent(cam.id)}&t=${frameAt}`}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <video
            key={cam.videoUrl}
            ref={video}
            src={cam.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            onError={() => {
              setFailed(true);
              setFrameAt(Date.now());
            }}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        )}
        <div style={{ ...caption, left: 72 }}>
          <Dot color="var(--live)" />
          Real CCTV
          <span style={{ color: "var(--muted)", fontWeight: 500 }}>
            · {cam.name}
            {failed ? " · latest frame (clip blocked)" : ` · ${clipT.toFixed(1)} s`}
          </span>
        </div>
      </div>

      {/* The real frame's edges, drawn on the twin half: everything inside lines up with the left half. */}
      <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...containBox(box.w, box.h, frame.aspect), border: "1px dashed rgba(255,255,255,0.45)", boxSizing: "border-box" }} />
      </div>

      <div style={{ ...caption, left: "calc(50% + 20px)" }}>
        <Dot color="var(--ember)" />
        Simulated from real tracks
        <span style={{ color: "var(--muted)", fontWeight: 500 }}>
          · <span style={{ color: "#ffb37a" }}>{people} people</span>, <span style={{ color: "#9fd3ff" }}>{vehicles} vehicles</span>
          {clip ? ` · ${clip.duration.toFixed(1)} s clip` : " · analysing…"}
          {failed ? " · wall clock" : " · synced to the clip"}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(12,12,16,0.78)",
            border: "1px solid var(--border-strong)",
            backdropFilter: "blur(10px)",
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>Compare CCTV</span>
          <span style={{ color: "var(--muted)" }}>
            {" · "}
            {cal
              ? `pose calibrated by Nemotron 3.5 Super VL: facing ${Math.round(cal.headingDeg)}°, tilted ${cal.pitchDeg}°, ${cal.heightM} m up, ${cal.hfovDeg}° lens`
              : `uncalibrated: default ${Math.round((Math.atan(frame.tanH) * 360) / Math.PI)}° lens, ${frame.heightM} m up`}
          </span>
        </div>
        <button
          type="button"
          onClick={close}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--bg)",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Exit compare
        </button>
      </div>
    </div>
  );
}
