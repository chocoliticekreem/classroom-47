"use client";

import { useEffect } from "react";
import { useLive } from "../live/store";
import { RESCORE_MS, scoreLatest, usePredict } from "./store";
import { Button, Chip, card, label } from "./ui";

export function Score() {
  const baseline = usePredict((s) => s.baseline);
  const score = usePredict((s) => s.score);
  const scoring = usePredict((s) => s.scoring);
  const cams = useLive((s) => s.cams);
  const runId = baseline?.runId;

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(() => void scoreLatest(), RESCORE_MS);
    return () => clearInterval(timer);
  }, [runId]);

  if (!baseline) return null;
  const camName = (id: string) => cams.find((c) => c.id === id)?.name ?? id.replace("JamCams_", "cam ");
  const s = score?.summary;
  const zones = score?.zones ?? [];
  const zoneName = (id: string | null) => baseline.timeline[0].zones.find((z) => z.id === id)?.name ?? "outside zones";

  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, flex: 1 }}>Prediction vs reality</span>
        <Button small disabled={scoring} onClick={() => void scoreLatest()}>
          {scoring ? "Scoring…" : score ? "Re-score" : "Score"}
        </Button>
      </div>
      {!score && <div style={label}>Compares the forecast step that has just arrived with the latest camera counts. Re-scores every 2 min.</div>}
      {score?.error && <div style={{ fontSize: 12, color: "var(--warn)" }}>{score.error.replace(/; first due at \d+/, "")}</div>}
      {s && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip color={s.zonesRight >= s.zonesWrong ? "var(--ok)" : "var(--warn)"}>
            {s.zonesRight} of {s.zonesRight + s.zonesWrong} zones right
          </Chip>
          <span style={label}>
            MAE {s.meanAbsError ?? "—"} people · +{score?.forecastMinute} min step · {score?.compared} cameras
          </span>
        </div>
      )}
      {zones.length > 0 && (
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11, textAlign: "left" }}>
              <th style={{ fontWeight: 500, padding: "4px 0" }}>Zone</th>
              <th style={{ fontWeight: 500, textAlign: "right" }}>Predicted</th>
              <th style={{ fontWeight: 500, textAlign: "right" }}>Actual</th>
              <th style={{ fontWeight: 500, textAlign: "right" }}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.zoneId ?? "none"} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "4px 0" }}>{zoneName(z.zoneId)}</td>
                <td style={{ textAlign: "right" }}>{z.predicted}</td>
                <td style={{ textAlign: "right" }}>{z.actual}</td>
                <td style={{ textAlign: "right", color: z.verdict === "right" ? "var(--ok)" : "var(--warn)", fontWeight: 600 }}>
                  {z.verdict}
                  {z.errorPct !== null ? ` · ${Math.round(z.errorPct)}%` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(score?.cams?.length ?? 0) > 0 && (
        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--muted)" }}>{score?.cams?.length} cameras</summary>
          <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
            {score?.cams?.map((c) => (
              <div key={c.camId} style={{ display: "flex", gap: 8 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camName(c.camId)}</span>
                <span style={label}>pred {c.predictedPeople}</span>
                <span style={{ fontWeight: 600 }}>actual {c.actualPeople}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {score?.comparedAt && <div style={label}>Scored {new Date(score.comparedAt).toLocaleTimeString("en-GB")}</div>}
    </div>
  );
}
