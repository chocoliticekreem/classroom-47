"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Clock, Film, MapPin, RotateCcw, Square, Upload, Users } from "lucide-react";
import { JAMCAMS } from "@/lib/locations";
import type { StreamContext, StreamSource } from "@/lib/types";

interface PlayerProps {
  source: StreamSource;
  onSourceChange: (s: StreamSource) => void;
  ctx: StreamContext;
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

function formatViewers(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function Player({ source, onSourceChange, ctx }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const now = useClock();

  useEffect(() => {
    if (source.kind !== "webcam") return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video) video.srcObject = s;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const denied = e instanceof DOMException && e.name === "NotAllowedError";
        setCamError(denied ? "Camera access was denied. Allow it in your browser and try again." : "No camera available.");
        onSourceChange({ kind: "idle" });
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [source.kind, retryKey, onSourceChange]);

  useEffect(() => {
    if (source.kind !== "file") return;
    const url = source.url;
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const change = (s: StreamSource) => {
    setError(null);
    setCamError(null);
    onSourceChange(s);
  };

  const sourceLabel =
    source.kind === "webcam" ? "Webcam" : source.kind === "idle" ? "" : source.label;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black">
      {source.kind === "idle" ? (
        <IdleCard onPick={change} camError={camError} />
      ) : (
        <>
          <video
            key={`${source.kind === "webcam" ? "cam" : source.url}-${retryKey}`}
            ref={videoRef}
            src={source.kind === "webcam" ? undefined : source.url}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setError("The stream stopped responding.")}
            className="size-full object-cover"
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />

          <div className="absolute left-4 top-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-live px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
              <span className="animate-live size-1.5 rounded-full bg-white" />
              Live
            </span>
            <span className="flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
              <Users className="size-3" aria-hidden />
              {formatViewers(ctx.viewers)}
            </span>
          </div>

          <div className="absolute right-4 top-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
              <MapPin className="size-3 text-ember" aria-hidden />
              {ctx.location.name} · {ctx.location.area}
            </span>
            {now && (
              <span className="flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 font-mono text-xs text-white backdrop-blur">
                <Clock className="size-3" aria-hidden />
                {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>

          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between">
            <span className="rounded-md bg-black/55 px-2 py-0.5 text-xs text-white/80 backdrop-blur">
              {sourceLabel}
            </span>
            <button
              type="button"
              onClick={() => change({ kind: "idle" })}
              className="flex items-center gap-1.5 rounded-md bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-live"
            >
              <Square className="size-3 fill-current" aria-hidden />
              End stream
            </button>
          </div>

          {error && (
            <div className="absolute inset-0 grid place-items-center bg-black/75 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-text">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setRetryKey((k) => k + 1);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-sm font-semibold text-bg"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Retry
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IdleCard({ onPick, camError }: { onPick: (s: StreamSource) => void; camError: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(JAMCAMS[0].url);

  return (
    <div className="grid size-full place-items-center bg-[radial-gradient(ellipse_at_center,var(--surface-2),var(--bg))] p-6">
      <div className="w-full max-w-lg">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ember">Offline</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Start streaming</h2>
        <p className="mt-1 text-sm text-muted">Pick a source. You can switch any time.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <SourceButton icon={<Camera className="size-5" />} title="Webcam" hint="Go live from this device" onClick={() => onPick({ kind: "webcam" })} />
          <SourceButton
            icon={<Film className="size-5" />}
            title="TfL JamCam"
            hint="Live London street feed"
            onClick={() => {
              const picked = JAMCAMS.find((j) => j.url === cam) ?? JAMCAMS[0];
              onPick({ kind: "url", url: picked.url, label: picked.label });
            }}
          />
          <SourceButton icon={<Upload className="size-5" />} title="Upload video" hint="Play an IRL recording" onClick={() => fileRef.current?.click()} />
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-muted">
          JamCam
          <select
            value={cam}
            onChange={(e) => setCam(e.target.value)}
            className="flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-ember"
          >
            {JAMCAMS.map((j) => (
              <option key={j.url} value={j.url}>
                {j.label}
              </option>
            ))}
          </select>
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick({ kind: "file", url: URL.createObjectURL(f), label: f.name });
            e.target.value = "";
          }}
        />

        {camError && <p className="mt-4 rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-xs text-live">{camError}</p>}
      </div>
    </div>
  );
}

function SourceButton({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-ember/60 hover:bg-surface-2"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-ember-soft text-ember">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
