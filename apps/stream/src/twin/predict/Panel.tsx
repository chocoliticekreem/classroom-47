"use client";

import { useCompare } from "../compare/store";
import { ModeChip, Report } from "./Report";
import { Score } from "./Score";
import { runForecast, setMinute, shownRun, usePredict } from "./store";
import { Button, Row, card, label } from "./ui";
import { Diff, WhatIf } from "./WhatIf";

const CSS = `
.predict-panel { position: absolute; top: 60px; right: 16px; width: 340px; max-height: calc(100% - 136px); z-index: 30;
  display: flex; flex-direction: column; border-radius: 14px; background: rgba(12,12,16,0.78); border: 1px solid var(--border);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: var(--text);
  font-family: var(--font-figtree), system-ui, sans-serif; font-size: 13px; line-height: 1.35; pointer-events: auto; }
.predict-panel.closed { width: auto; max-height: none; }
.predict-body { overflow-y: auto; display: grid; gap: 8px; padding: 0 12px 12px; }
.predict-range { width: 100%; accent-color: var(--ember); margin: 0; }
@media (max-width: 640px) { .predict-panel { top: auto; bottom: 112px; left: 12px; right: 12px; width: auto; max-height: 48vh; } }
`;

function Scrubber() {
  const minute = usePredict((s) => s.minute);
  const playing = usePredict((s) => s.playing);
  const ghosts = usePredict((s) => s.ghosts);
  const whatIf = usePredict((s) => s.whatIf);
  const shown = usePredict((s) => s.shown);
  const run = usePredict(shownRun);
  if (!run) return null;
  const m = Math.round(minute);
  const step = run.timeline.find((s) => s.minute === m) ?? run.timeline[0];
  const at = new Date(run.at + m * 60_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={card}>
      <Row>
        <span style={{ fontWeight: 600, color: m > 0 ? "#ff6a3d" : "var(--text)" }}>{m === 0 ? "Now" : `Predicted +${m} min`}</span>
        <span style={label}>{at} · {step.walking} groups walking</span>
        <span style={{ marginLeft: "auto" }}>
          <Button small onClick={() => usePredict.setState({ playing: !playing, minute: !playing && minute >= 30 ? 0 : minute })}>
            {playing ? "Pause" : "Play"}
          </Button>
        </span>
      </Row>
      <input
        className="predict-range"
        type="range"
        min={0}
        max={30}
        step={1}
        value={m}
        aria-label="Forecast minute"
        onChange={(e) => {
          usePredict.setState({ playing: false });
          setMinute(Number(e.target.value));
        }}
      />
      <Row>
        <span style={label}>Ember streets busier than now, blue quieter</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {whatIf && (
            <>
              <Button small active={shown === "baseline"} onClick={() => usePredict.setState({ shown: "baseline" })}>
                Baseline
              </Button>
              <Button small active={shown === "whatIf"} onClick={() => usePredict.setState({ shown: "whatIf" })}>
                What-if
              </Button>
            </>
          )}
          <Button small active={ghosts} onClick={() => usePredict.setState({ ghosts: !ghosts })}>
            Ghosts
          </Button>
        </span>
      </Row>
    </div>
  );
}

export function PredictPanel() {
  const comparing = useCompare((s) => s.camId !== null);
  const open = usePredict((s) => s.panelOpen);
  const loading = usePredict((s) => s.loading);
  const error = usePredict((s) => s.error);
  const baseline = usePredict((s) => s.baseline);
  const whatIf = usePredict((s) => s.whatIf);
  const run = usePredict(shownRun);
  if (comparing) return null;

  return (
    <>
      <style>{CSS}</style>
      <div className={`predict-panel${open ? "" : " closed"}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "#ff6a3d", boxShadow: "0 0 8px #ff6a3d" }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, whiteSpace: "nowrap" }}>Predict · 30 min</span>
          {run && <ModeChip run={run} />}
          <button
            type="button"
            onClick={() => usePredict.setState({ panelOpen: !open })}
            aria-label={open ? "Collapse" : "Expand"}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}
          >
            {open ? "−" : "+"}
          </button>
        </div>
        {open && (
          <div className="predict-body">
            <Row>
              <Button primary disabled={loading} onClick={() => void runForecast("baseline")}>
                {loading ? "Simulating…" : baseline ? "Re-run baseline" : "Predict next 30 min"}
              </Button>
              {loading && (
                <span style={label}>
                  seeding from live cameras, playing {baseline ? `${baseline.personas.length} ` : "a swarm of "}persona groups forward
                </span>
              )}
            </Row>
            {error && <div style={{ ...card, color: "var(--live)", fontSize: 12 }}>{error}</div>}
            {!run && !loading && !error && (
              <div style={label}>
                Seeds a parallel Tower Hill from the live field, lets persona groups walk it forward and reports what changes. Nothing invented: every count traces to a feed.
              </div>
            )}
            <Scrubber />
            {baseline && whatIf && <Diff baseline={baseline} whatIf={whatIf} />}
            {run && <Report run={run} />}
            <WhatIf />
            <Score />
          </div>
        )}
      </div>
    </>
  );
}
