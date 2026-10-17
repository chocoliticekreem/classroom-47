"use client";
// "Enable sound / Start demo" (PRD J3: sound needs a click). Unlocks the one AudioContext before any call
// audio. Mount it in the HUD or the console (DOM, outside the <Canvas>):
//   <SoundButton />            "Enable sound", then "Sound on"
//   <SoundButton demo />       "Start demo": enables sound, then runs window.__cityVoiceDemo() if the city is open
import { useState } from "react";
import { useWorld } from "../../store";
import { enableSound } from "../../voice";

export default function SoundButton({ demo = false, className }: { demo?: boolean; className?: string }) {
  const soundEnabled = useWorld((s) => s.soundEnabled);
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    const ok = await enableSound();
    setFailed(!ok);
    if (demo) (window as unknown as { __cityVoiceDemo?: () => void }).__cityVoiceDemo?.();
  };

  const label = demo ? "Start demo" : soundEnabled ? "Sound on" : failed ? "Sound blocked" : "Enable sound";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!demo && soundEnabled}
      title={failed ? "The browser refused to start audio. Calls still play silently, with transcripts." : "Unlocks audio for call playback (browsers need a click first)."}
      className={className}
      style={className ? undefined : {
        display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.15)", background: soundEnabled ? "rgba(62,207,142,0.15)" : "#ff6a1a",
        color: soundEnabled ? "#3ecf8e" : "#fff", font: "600 12px/1 Inter, system-ui, sans-serif",
        cursor: !demo && soundEnabled ? "default" : "pointer",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {soundEnabled ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
      </svg>
      {label}
    </button>
  );
}
