import { connection } from "next/server";
import { cityRuns, getCityBudget, getCityState, putCityState } from "@/console/server/city";
import { jsonError, readBody } from "@/console/server/http";

// GET /api/console/city/state -> { state, updatedAt, budget, runs }: the saved city world (null before the
// first save), the shared city budget, and the last 20 city executions (newest first, with decision cards).
// The /city page hydrates from it and the console City tab reads it, so both show the same thing.
export async function GET() {
  await connection();
  try {
    const saved = getCityState();
    return Response.json({ state: saved?.state ?? null, updatedAt: saved?.updatedAt ?? null, budget: getCityBudget(), runs: cityRuns(20) });
  } catch (err) {
    return jsonError(err);
  }
}

// PUT /api/console/city/state { state } -> { ok, updatedAt }. Debounced from the city every ~5 s and on pagehide.
export async function PUT(req: Request) {
  try {
    const body = await readBody<{ state?: unknown }>(req);
    const r = putCityState(body?.state);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json(r);
  } catch (err) {
    return jsonError(err);
  }
}
