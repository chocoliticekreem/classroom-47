"use client";

import { useState } from "react";
import { Bus, Car, Radio, TriangleAlert, User, X } from "lucide-react";
import type { AroundBusStop, AroundCam, AroundDisruption, CamReading } from "@/platform/around/types";
import { crowdLevel, formatCountdown } from "./markers";

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

const PANEL =
  "absolute overflow-hidden rounded-xl border border-line-strong bg-surface/95 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur";

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md bg-bg/80 text-text hover:bg-bg"
    >
      <X className="size-3.5" />
    </button>
  );
}

const CROWD_TONE = { calm: "text-ok", busy: "text-warn", crowded: "text-live" } as const;

interface CamCardProps {
  cam: AroundCam;
  reading: CamReading | undefined;
  isYourFeed: boolean;
  onClose: () => void;
}

export function CamCard({ cam, reading, isYourFeed, onClose }: CamCardProps) {
  const [view, setView] = useState<"live" | "ai">("live");
  const aiReady = Boolean(reading?.frame);
  const showAi = view === "ai" && aiReady;
  const level = reading ? crowdLevel(reading.people) : null;

  return (
    <article className={`${PANEL} left-3 top-3 w-[min(300px,calc(100%-24px))]`}>
      <div className="relative aspect-video bg-black">
        {showAi && reading ? (
          // eslint-disable-next-line @next/next/no-img-element -- live annotated frame, cache-busted
          <img
            src={`/api/around/frame?id=${encodeURIComponent(cam.id)}&t=${reading.at}`}
            alt={`AI detections for ${cam.name}`}
            className="size-full object-cover"
          />
        ) : (
          <video
            key={cam.id}
            src={cam.videoUrl}
            poster={cam.imageUrl}
            muted
            autoPlay
            loop
            playsInline
            className="size-full object-cover"
          />
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-bg/80 px-1.5 py-0.5 text-[10px] font-semibold text-text">
          <span className="animate-live size-1.5 rounded-full bg-live" />
          {showAi ? "AI view" : "Live"}
        </span>
        <div className="absolute right-2 top-2">
          <CloseButton label="Close camera" onClick={onClose} />
        </div>
        <div className="absolute bottom-2 left-2 flex rounded-md bg-bg/85 p-0.5 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => setView("live")}
            className={`rounded px-2 py-0.5 ${view === "live" ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
          >
            Live clip
          </button>
          <button
            type="button"
            onClick={() => setView("ai")}
            disabled={!aiReady}
            title={aiReady ? "Show YOLO detections" : "Analysing…"}
            className={`rounded px-2 py-0.5 disabled:cursor-default disabled:opacity-40 ${
              showAi ? "bg-ember text-bg" : "text-muted hover:text-text"
            }`}
          >
            AI view
          </button>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-[13px] font-semibold text-text">{cam.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
          <span className="font-mono">{formatDistance(cam.distanceM)} away</span>
          <span className="text-dim">·</span>
          <span>TfL JamCam</span>
          {isYourFeed && (
            <span className="ml-auto flex items-center gap-1 rounded-md bg-ember-soft px-1.5 py-0.5 text-[10px] font-semibold text-ember">
              <Radio className="size-3" />
              Your feed
            </span>
          )}
        </p>
        <p className="mt-1.5 flex items-center gap-2 font-mono text-[12px] text-text/90">
          {reading && level ? (
            <>
              <User className="size-3.5 text-muted" />
              {reading.people}
              <Car className="ml-1 size-3.5 text-muted" />
              {reading.vehicles}
              <span className={`ml-auto capitalize ${CROWD_TONE[level]}`}>{level}</span>
            </>
          ) : (
            <span className="text-muted">Counting people and vehicles…</span>
          )}
        </p>
      </div>
    </article>
  );
}

interface BusStopCardProps {
  stop: AroundBusStop;
  now: number;
  fetchedAt: number;
  onClose: () => void;
}

export function liveSeconds(seconds: number, fetchedAt: number, now: number) {
  return seconds - Math.floor((now - fetchedAt) / 1000);
}

export function BusStopCard({ stop, now, fetchedAt, onClose }: BusStopCardProps) {
  const arrivals = stop.arrivals
    .map((a) => ({ ...a, seconds: liveSeconds(a.seconds, fetchedAt, now) }))
    .filter((a) => a.seconds > -60)
    .slice(0, 5);
  return (
    <article className={`${PANEL} bottom-3 right-3 w-[min(300px,calc(100%-24px))]`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[#e0352b] text-[10px] font-bold text-white">
          {stop.indicator.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || <Bus className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text">{stop.name}</p>
          <p className="font-mono text-[11px] text-muted">{formatDistance(stop.distanceM)} away</p>
        </div>
        <CloseButton label="Close stop" onClick={onClose} />
      </div>
      <ul className="border-t border-line">
        {arrivals.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-muted">No buses due in the next 30 minutes.</li>
        )}
        {arrivals.map((a, i) => (
          <li key={`${a.line}-${a.destination}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="min-w-7 rounded bg-[#e0352b] px-1.5 py-0.5 text-center font-mono text-[11px] font-bold text-white">
              {a.line}
            </span>
            <span className="min-w-0 flex-1 truncate text-text/90">{a.destination}</span>
            <span className={`font-mono ${a.seconds <= 30 ? "text-ok" : "text-text"}`}>
              {formatCountdown(a.seconds)}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

interface DisruptionCardProps {
  item: AroundDisruption;
  pinned: boolean;
  onClose: () => void;
}

export function DisruptionCard({ item, pinned, onClose }: DisruptionCardProps) {
  const serious = item.severity === "Serious" || item.severity === "Severe";
  return (
    <div
      className={`${PANEL} bottom-3 left-3 flex w-[min(340px,calc(100%-24px))] items-start gap-2.5 px-3 py-2.5 ${
        pinned ? "" : "pointer-events-none"
      }`}
    >
      <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${serious ? "text-live" : "text-warn"}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-text">{item.street}</p>
        <p className="text-[12px] text-muted">
          {item.category} · {item.closure} · {item.severity}
        </p>
        {item.comments && (
          <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-text/75">{item.comments}</p>
        )}
      </div>
      {pinned && <CloseButton label="Close disruption" onClick={onClose} />}
    </div>
  );
}
