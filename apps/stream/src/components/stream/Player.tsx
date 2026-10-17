"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Film, RotateCcw, Square, Upload } from "lucide-react";
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

function coords(lat: number, lon: number) {
  return `${lat.toFixed(4)}N ${Math.abs(lon).toFixed(4)}${lon < 0 ? "W" : "E"}`;
}

function Corners({ className = "border-white/70" }: { className?: string }) {
  return (
    <div className="pointer-events-none absolute inset-3" aria-hidden>
      <span className={`hud-corner left-0 top-0 border-l border-t ${className}`} />
      <span className={`hud-corner right-0 top-0 border-r border-t ${className}`} />
      <span className={`hud-corner bottom-0 left-0 border-b border-l ${className}`} />
      <span className={`hud-corner bottom-0 right-0 border-b border-r ${className}`} />
    </div>
  );
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
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
      {source.kind === "idle" ? (
        <IdleCard onPick={change} camError={camError} ctx={ctx} now={now} />
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
          <div className="grain scanlines pointer-events-none absolute inset-0" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
          <Corners />

          <div className="absolute left-4 top-4 flex items-center gap-2 font-mono text-[11px] sm:left-6 sm:top-6">
            <span className="flex h-6 items-center gap-1.5 rounded-[4px] bg-live px-2 font-semibold tracking-normal text-white">
              <span className="animate-live size-1.5 rounded-full bg-white" />
              Live
            </span>
            <span className="flex h-6 items-center gap-1.5 rounded-[4px] border border-white/15 bg-black/50 px-2 text-white backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-ember" />
              {formatViewers(ctx.viewers)}
              <span className="hidden text-white/50 sm:inline">watching</span>
            </span>
          </div>

          <div className="absolute right-4 top-4 flex flex-col items-end gap-1 font-mono text-[11px] text-white sm:right-6 sm:top-6">
            {now && (
              <span className="rounded-[4px] border border-white/15 bg-black/50 px-2 py-1 tracking-normal backdrop-blur-sm">
                {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                <span className="ml-1.5 hidden text-white/45 sm:inline">BST</span>
              </span>
            )}
          </div>

          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3 sm:inset-x-6 sm:bottom-6">
            <div className="min-w-0">
              <p className="font-display text-[20px] font-semibold leading-none tracking-[-0.02em] text-white sm:text-[24px]">
                {ctx.location.name}
              </p>
              <p className="mt-1.5 flex items-center gap-2 font-mono text-[10px] tracking-normal text-white/60">
                <span className="text-ember">{ctx.location.area}</span>
                <span className="hidden sm:inline">{coords(ctx.location.lat, ctx.location.lon)}</span>
                <span className="hidden text-white/40 md:inline">· {sourceLabel}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => change({ kind: "idle" })}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border border-white/15 bg-black/50 px-2.5 font-mono text-[11px] tracking-normal text-white backdrop-blur-sm transition-colors hover:border-live hover:bg-live"
            >
              <Square className="size-2.5 fill-current" aria-hidden />
              End
            </button>
          </div>

          {error && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="font-mono text-[11px] tracking-normal text-live">Signal lost</p>
                <p className="text-sm text-text">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setRetryKey((k) => k + 1);
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-ember px-3 py-1.5 text-sm font-semibold text-bg"
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

function IdleCard({
  onPick,
  camError,
  ctx,
  now,
}: {
  onPick: (s: StreamSource) => void;
  camError: string | null;
  ctx: StreamContext;
  now: Date | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative size-full bg-surface">
      <div className="hud-grid absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,var(--ember-soft),transparent)]" aria-hidden />
      <Corners className="border-white/25" />

      <div className="absolute left-6 top-6 flex items-center gap-2 font-mono text-[10px] tracking-normal text-muted">
        <span className="size-1.5 rounded-full bg-dim" />
        Standby
      </div>
      <div className="absolute right-6 top-6 hidden font-mono text-[10px] tracking-normal text-muted sm:block">
        {ctx.location.area} · {coords(ctx.location.lat, ctx.location.lon)}
      </div>
      {now && (
        <div className="absolute bottom-6 right-6 hidden font-mono text-[10px] tracking-normal text-dim sm:block">
          {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}

      <div className="relative grid size-full place-items-center p-6 sm:p-10">
        <div className="w-full max-w-xl">
          <p className="font-mono text-[10px] tracking-normal text-ember">No signal</p>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[36px]">
            Go live from {ctx.location.name}.
          </h2>
          <p className="mt-2 max-w-md text-[13px] leading-5 text-muted">
            Pick a feed. Chat and the city watch the moment you open the signal.
          </p>

          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            <SourceButton
              index="01"
              icon={<Camera className="size-4" />}
              title="Webcam"
              hint="This device"
              onClick={() => onPick({ kind: "webcam" })}
            />
            <SourceButton
              index="02"
              icon={<Film className="size-4" />}
              title="TfL JamCam"
              hint="Nearest street cam"
              accent
              onClick={() => {
                onPick({ kind: "url", url: ctx.location.camera.url, label: ctx.location.camera.label });
              }}
            />
            <SourceButton
              index="03"
              icon={<Upload className="size-4" />}
              title="Upload"
              hint="IRL recording"
              onClick={() => fileRef.current?.click()}
            />
          </div>


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

          {camError && (
            <p className="mt-4 rounded-[4px] border border-live/30 bg-live/10 px-3 py-2 text-xs text-live">{camError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceButton({
  index,
  icon,
  title,
  hint,
  accent,
  onClick,
}: {
  index: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-[6px] border px-3 py-2.5 text-left transition-colors sm:flex-col sm:items-start sm:gap-4 sm:py-3 ${
        accent
          ? "border-ember/50 bg-ember-soft hover:border-ember"
          : "border-line bg-bg/60 hover:border-line-strong hover:bg-surface-2"
      }`}
    >
      <span className="flex w-full items-center justify-between sm:w-auto">
        <span className={`grid size-8 place-items-center rounded-[4px] ${accent ? "bg-ember text-bg" : "bg-surface-2 text-text"}`}>
          {icon}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="font-mono text-[9px] tracking-normal text-dim">{index}</span>
        </span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  );
}
