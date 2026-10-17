import { withExecutionLinks } from "@/console/server/runLinks";
import { listTasks, registerTrace, ReviewError } from "@/review/server";

export async function GET(request: Request) {
  void request.url; // Request-time filesystem data with Cache Components.
  try {
    const queue = await listTasks();
    // Each card links to the console case run it came from, so a choice can re-run that case.
    return Response.json({ ...queue, tasks: withExecutionLinks(queue.tasks) }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return Response.json({ error: "The review queue could not be loaded. Try again." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Use the review desk to register a case" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 5_000_000) return Response.json({ error: "Trace is too large" }, { status: 413 });
    return Response.json({ task: await registerTrace(JSON.parse(text)) });
  } catch (e) {
    const status = e instanceof ReviewError ? e.status : e instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: e instanceof ReviewError ? e.message : "The case could not be registered" }, { status });
  }
}
