"use client";

import { create } from "zustand";
import type { Intervention, InterventionKind, PredictRun, ScoreResult } from "./types";

export const RESCORE_MS = 120_000;

interface PredictState {
  baseline: PredictRun | null;
  whatIf: PredictRun | null;
  /** Which run the ghost layer and the report show. */
  shown: "baseline" | "whatIf";
  loading: boolean;
  error: string | null;
  minute: number;
  playing: boolean;
  ghosts: boolean;
  interventions: Intervention[];
  placing: InterventionKind | null;
  score: ScoreResult | null;
  scoring: boolean;
  panelOpen: boolean;
}

export const usePredict = create<PredictState>(() => ({
  baseline: null,
  whatIf: null,
  shown: "baseline",
  loading: false,
  error: null,
  minute: 0,
  playing: false,
  ghosts: true,
  interventions: [],
  placing: null,
  score: null,
  scoring: false,
  panelOpen: true,
}));

export function shownRun(s: PredictState): PredictRun | null {
  return s.shown === "whatIf" && s.whatIf ? s.whatIf : s.baseline;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Predict failed (${res.status})`);
  return data;
}

export async function runForecast(kind: "baseline" | "whatIf") {
  const { interventions } = usePredict.getState();
  usePredict.setState({ loading: true, error: null, playing: false });
  try {
    const body = kind === "whatIf" ? { horizonMin: 30, interventions } : { horizonMin: 30 };
    const run = await postJson<PredictRun>("/api/predict", body);
    usePredict.setState(
      kind === "whatIf"
        ? { whatIf: run, shown: "whatIf", loading: false, minute: 30 }
        : { baseline: run, whatIf: null, shown: "baseline", loading: false, score: null, minute: 0 },
    );
  } catch (e) {
    usePredict.setState({ loading: false, error: (e as Error).message });
  }
}

export async function scoreLatest() {
  const run = usePredict.getState().baseline;
  if (!run) return;
  usePredict.setState({ scoring: true, error: null });
  try {
    const score = await postJson<ScoreResult>("/api/predict/score", { runId: run.runId });
    usePredict.setState({ score, scoring: false });
  } catch (e) {
    usePredict.setState({ scoring: false, error: (e as Error).message });
  }
}

export function setMinute(minute: number) {
  usePredict.setState({ minute: Math.max(0, Math.min(30, minute)) });
}

export function placeIntervention(x: number, z: number) {
  const { placing, interventions } = usePredict.getState();
  if (!placing) return;
  const iv: Intervention = { kind: placing, where: { x: Math.round(x), z: Math.round(z) }, note: "", atMin: 0 };
  usePredict.setState({ interventions: [...interventions, iv], placing: null });
}

export function updateIntervention(index: number, patch: Partial<Intervention>) {
  const list = usePredict.getState().interventions.slice();
  list[index] = { ...list[index], ...patch };
  usePredict.setState({ interventions: list });
}

export function removeIntervention(index: number) {
  usePredict.setState((s) => ({ interventions: s.interventions.filter((_, i) => i !== index) }));
}
