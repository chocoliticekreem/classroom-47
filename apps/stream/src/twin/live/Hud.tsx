"use client";

import { useCompare } from "../compare/store";
import { useFieldStore } from "../sim/useField";
import { distanceM } from "@/platform/around/geo";
import { ORIGIN, WORLD_RADIUS_M } from "../config";
import { useScenario } from "./scenario";
import { useTwinCounts } from "./sim/counts";
import { useLive, useLiveFeeds, useNow } from "./store";

const DUE_SOON_S = 300;

function StreamerStatus() {
  const streamer = useLive((s) => s.streamer);
  const source = useLive((s) => s.streamerSource);
  const accuracy = useLive((s) => s.streamerAccuracyM);
  const ts = useLive((s) => s.streamerTs);
  const speed = useLive((s) => s.streamerSpeed);
  const now = useNow();
  const away = distanceM(ORIGIN.lat, ORIGIN.lon, streamer.lat, streamer.lon);
  const outside = away > WORLD_RADIUS_M;
  const age = ts ? `${Math.max(0, Math.round((now - ts) / 1000))} s ago` : "";
  const label =
    source === "phone"
      ? `Phone GPS · ±${accuracy ?? "?"} m · ${age}`
      : source === "gps"
        ? `This device GPS · ±${accuracy ?? "?"} m · ${age}`
        : "Demo position";
  const pace = speed !== null && speed > 0.3 ? ` · ${(speed * 3.6).toFixed(1)} km/h` : "";
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 11 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Swatch color="var(--ember)" glow />
        <span style={{ color: "var(--muted)", flex: 1 }}>Streamer</span>
        <span style={{ fontWeight: 600 }}>
          {label}
          {pace}
        </span>
      </div>
      {outside && (
        <div style={{ marginTop: 6, color: "var(--warn)", fontWeight: 600 }}>
          Outside the mirrored area ({(away / 1000).toFixed(1)} km from Tower Hill)
        </div>
      )}
    </div>
  );
}

function Swatch({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: 999,
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : "none",
        flex: "none",
      }}
    />
  );
}

export function Hud() {
  useLiveFeeds();
  const cams = useLive((s) => s.cams);
  const clips = useLive((s) => s.clips);
  const stops = useLive((s) => s.stops);
  const disruptions = useLive((s) => s.disruptions);
  const updatedAt = useLive((s) => s.updatedAt);
  const screenMode = useLive((s) => s.screenMode);
  const now = useNow();
  const comparing = useCompare((s) => s.camId !== null);
  const field = useFieldStore();
  const twin = useTwinCounts();
  const scenario = useScenario((s) => s.scenario);
  if (comparing) return null;

  let people = 0;
  let vehicles = 0;
  for (const cam of cams) {
    for (const t of clips[cam.id]?.tracks ?? []) {
      if (t.kind === "person") people++;
      else vehicles++;
    }
  }
  let busesDue = 0;
  for (const s of stops) {
    for (const a of s.arrivals) {
      const rem = a.seconds - (now - s.at) / 1000;
      if (rem > -20 && rem < DUE_SOON_S) busesDue++;
    }
  }
  const uniqueDisruptions = new Set(disruptions.map((d) => JSON.stringify(d.line))).size;
  const analysed = cams.filter((c) => clips[c.id]).length;

  const rows: { label: string; value: string; color: string }[] = [
    { label: "People tracked (cameras)", value: String(people), color: "#ffb37a" },
    { label: "Vehicles tracked (cameras)", value: String(vehicles), color: "#9fd3ff" },
    { label: "Cameras", value: cams.length ? `${analysed}/${cams.length} analysed` : "—", color: "var(--live)" },
    { label: "Buses due < 5 min (TfL)", value: String(busesDue), color: "#c8102e" },
    { label: "Disruptions (TfL)", value: String(uniqueDisruptions), color: "var(--warn)" },
    { label: "Twin agents", value: `${twin.people} people · ${twin.vehicles} vehicles`, color: "#e8d6c2" },
  ];
  const estimate = field
    ? `${Math.round(field.people * field.crowd)} people · ${Math.round(field.vehicles * field.crowd)} vehicles`
    : "estimating…";
  const basis = field
    ? `${field.observed} observed segments, ${field.inferred} inferred${field.crowd !== 1 ? ` · ×${field.crowd} demo` : ""}`
    : "";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 30,
        width: 236,
        padding: "12px 14px",
        borderRadius: 14,
        background: "rgba(12,12,16,0.72)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        color: "var(--text)",
        fontFamily: "var(--font-figtree), system-ui, sans-serif",
        fontSize: 13,
        lineHeight: 1.35,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
        <Swatch color="var(--live)" glow />
        Live · Tower Hill
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
        {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString("en-GB")}` : "Connecting…"}
        {screenMode ? ` · screens: ${screenMode}` : ""}
      </div>
      <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Swatch color={r.color} />
            <span style={{ color: "var(--muted)", flex: 1 }}>{r.label}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch color="#e8d6c2" />
          <span style={{ color: "var(--muted)" }}>City estimate</span>
        </div>
        <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", paddingLeft: 17 }}>{estimate}</div>
        {basis && <div style={{ color: "var(--muted)", fontSize: 11, paddingLeft: 17 }}>{basis}</div>}
      </div>
      {scenario && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid var(--border)",
            fontSize: 12,
            color: scenario.source === "demo" ? "var(--warn)" : "var(--text)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Swatch color={scenario.source === "demo" ? "var(--warn)" : "#4f7cff"} glow />
            <span style={{ fontWeight: 600 }}>{scenario.source === "demo" ? "Demo scenario" : "Responding to real incident"}</span>
          </div>
          <div style={{ paddingLeft: 17 }}>{scenario.label}</div>
        </div>
      )}
      <StreamerStatus />
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
          color: "var(--muted)",
          fontSize: 11,
          display: "grid",
          gap: 3,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch color="var(--ember)" glow /> Streamer beacon
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch color="var(--ember)" /> Camera view cone · YOLO tracks move inside it
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch color="var(--live)" /> Closed road · <Swatch color="var(--warn)" /> works
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch color="#9fd3ff" /> Boats · illustrative river traffic, not live data
        </div>
      </div>
    </div>
  );
}
