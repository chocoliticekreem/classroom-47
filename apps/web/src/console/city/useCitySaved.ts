"use client";
// The city as SQLite has it (GET /api/console/city/state + the review queue), polled every 4 s. The /city page
// restores from the same rows, so the console City tab and the city agree even before the iframe connects.
import { useEffect, useState } from "react";
import type { SavedCityRun } from "./logic";

export interface SavedCity {
  incidents: { id: string; kind: string; status: string; note: string; x: number; z: number }[];
  closedRoads: number;
  runs: SavedCityRun[];
  decidedRuns: Set<string>;
  budget: { maxPerWindow: number; starts: number[]; spentUsd: number } | null;
}

export function parseSaved(body: unknown, tasks: unknown): SavedCity {
  const b = (body ?? {}) as { state?: { incidents?: unknown; blocked?: unknown } | null; runs?: unknown; budget?: SavedCity["budget"] };
  const incidents = Array.isArray(b.state?.incidents) ? (b.state.incidents as SavedCity["incidents"]).filter((i) => i && typeof i.id === "string") : [];
  const blocked = b.state?.blocked && typeof b.state.blocked === "object" ? Object.keys(b.state.blocked as object).length : 0;
  const list = (tasks as { tasks?: { runId?: string; status?: string }[] } | null)?.tasks ?? [];
  return {
    incidents,
    closedRoads: blocked,
    runs: Array.isArray(b.runs) ? (b.runs as SavedCityRun[]) : [],
    decidedRuns: new Set(list.filter((t) => t.runId && t.status && t.status !== "pending").map((t) => t.runId!)),
    budget: b.budget ?? null,
  };
}

export function useCitySaved(): SavedCity | null {
  const [saved, setSaved] = useState<SavedCity | null>(null);
  useEffect(() => {
    let alive = true;
    const get = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const load = async () => {
      const [state, tasks] = await Promise.all([get("/api/console/city/state"), get("/api/review/tasks")]);
      if (alive && state) setSaved(parseSaved(state, tasks));
    };
    void load();
    const t = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return saved;
}
