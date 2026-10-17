import { claimCityBudget, getCityBudget, parseCityCase, startCityCase } from "@/console/server/city";
import { jsonError, readBody } from "@/console/server/http";

// POST /api/console/city/cases { view, label } -> 202 { id, budget }: a city case recorded like Execute
// (origin "city", dataset "city-live", simulated) and run on the agent in the background; poll
// /api/console/executions/:id. 429 { error, budget } when the shared city budget window is full (the case waits).
export async function POST(req: Request) {
  try {
    const parsed = parseCityCase(await readBody(req));
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
    const budget = claimCityBudget();
    if (!budget) return Response.json({ error: "over budget", budget: getCityBudget() }, { status: 429 });
    const { id } = startCityCase(parsed.view, parsed.label);
    return Response.json({ id, budget }, { status: 202 });
  } catch (err) {
    return jsonError(err);
  }
}
