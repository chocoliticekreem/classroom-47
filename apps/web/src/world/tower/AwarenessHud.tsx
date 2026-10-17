"use client";

import { useEffect } from "react";
import { publishSurroundings } from "./streamBus";
import { useTower } from "./state";

export default function AwarenessHud() {
  const sim = useTower((s) => s.sim);
  const previewCrossing = useTower((s) => s.previewCrossing);
  const previewLeak = useTower((s) => s.previewLeak);
  const accept = useTower((s) => s.accept);
  const discard = useTower((s) => s.discard);

  const flow = sim.live.filter((a) => a.kind === "flow").length;
  const snipers = sim.live.filter((a) => a.kind === "sniper" || a.archetype === "stream_sniper").length;
  const suggestion = "Leave Tower Bridge Road at Tooley Street. The south approach is blocked.";

  useEffect(() => {
    const level = snipers > 0 || sim.incident ? "danger" : flow > 10 ? "busy" : "calm";
    publishSurroundings(`${suggestion} Flow ${flow}. Snipers ${snipers}. ${sim.incident.label}`, level);
  }, [flow, snipers, sim.forkKind, sim.incident]);

  return (
    <aside
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        zIndex: 20,
        maxWidth: 360,
        pointerEvents: "auto",
        color: "#1a1020",
      }}
    >
      <div style={{ background: "#fff", borderRadius: "28px 28px 0 0", padding: "14px 16px 8px", fontWeight: 800 }}>
        Tower Bridge
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(16px)",
          borderRadius: "0 0 28px 28px",
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ color: "#EC1187", fontWeight: 700 }}>{sim.fork ? "Parallel future (not live yet)" : "Live"}</div>
        <div>Pedestrian flow: {flow}</div>
        <div>{sim.incident.label}</div>
        <div>Stream snipers: {snipers}</div>
        <div>{suggestion}</div>
        {sim.forkKind === "crossing" && <div>Preview: 50 people on the Tooley crosswalk</div>}
        {sim.forkKind === "leak" && <div>Preview: 50 people coming to you</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" onClick={previewCrossing}>50 cross here</button>
          <button type="button" onClick={previewLeak}>Tell chat I&apos;m here</button>
          <button type="button" onClick={accept} disabled={!sim.fork}>Let that happen</button>
          <button type="button" onClick={discard} disabled={!sim.fork}>Discard</button>
        </div>
      </div>
    </aside>
  );
}
