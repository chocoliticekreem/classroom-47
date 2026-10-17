"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { TwinGeometry } from "../config";

export type GeometryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TwinGeometry };

let cached: TwinGeometry | null = null;

export function useGeometryLoader(): GeometryState {
  const [state, setState] = useState<GeometryState>(() =>
    cached ? { status: "ready", data: cached } : { status: "loading" },
  );

  useEffect(() => {
    if (cached) return;
    const ctrl = new AbortController();
    fetch("/api/twin/osm", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/twin/osm responded ${res.status}`);
        return (await res.json()) as TwinGeometry;
      })
      .then((data) => {
        cached = data;
        setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, []);

  return state;
}

export const GeometryContext = createContext<TwinGeometry | null>(null);

export function useGeometry(): TwinGeometry {
  const g = useContext(GeometryContext);
  if (!g) throw new Error("useGeometry must be used inside GeometryContext");
  return g;
}
