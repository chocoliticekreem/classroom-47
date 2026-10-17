import { withExecutionLinks } from "@/console/server/runLinks";
import { decideTask, ReviewError } from "@/review/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Use the review desk to record a decision" }, { status: 403 });
  try {
    const { id } = await context.params;
    const text = await request.text();
    if (text.length > 5000) return Response.json({ error: "Decision is too large" }, { status: 413 });
    const [task] = withExecutionLinks([await decideTask(id, JSON.parse(text))]);
    return Response.json({ task });
  } catch (e) {
    const status = e instanceof ReviewError ? e.status : e instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: e instanceof ReviewError ? e.message : "The decision was not saved. Try again." }, { status });
  }
}
