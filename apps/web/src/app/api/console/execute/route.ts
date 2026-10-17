import { jsonError } from "@/console/server/http";
import { execute } from "@/console/server/execute";
import { parseExtraEvents } from "@/console/server/rerun";
import type { ExecutionVoice, HumanDecision } from "@/console/types";

// POST /api/console/execute  body: ExecuteRequest (src/console/types.ts) -> { execution }.
//   { caseId, dataset?, workflowId?, parentExecutionId?, extraEvents?, humanDecision?, voice?, mode?, elapsedMs? }
// Sends the eval's view of the case to the agent API (AGENT_API_URL, default http://localhost:4000)
// and waits for the trace (up to 5 minutes). The row shows as "running" in the list meanwhile.
// Voice re-runs: `parentExecutionId` adds the parent's sent messages as desk events and links the new row,
// `extraEvents` are appended on the case's own timeline, and `humanDecision` goes to the agent API as a
// trusted input: apps/api treats the card's human step as answered (RunOptions.humanDecision), and any
// message the chosen option implies still passes the safety gate.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parentExecutionId = typeof body.parentExecutionId === "string" && body.parentExecutionId ? body.parentExecutionId : null;
  if ((typeof body.caseId !== "string" || !body.caseId) && !parentExecutionId) {
    return Response.json({ error: "body.caseId is required" }, { status: 400 });
  }
  const extraEvents = parseExtraEvents(body.extraEvents);
  if (!extraEvents) {
    return Response.json({ error: "body.extraEvents must be an array of events, each with a non-empty body" }, { status: 400 });
  }
  const humanDecision = parseHumanDecision(body.humanDecision);
  if (humanDecision === false) {
    return Response.json({ error: "body.humanDecision needs optionId, label, who and by (\"tap\" or \"voice\")" }, { status: 400 });
  }
  const voice = parseVoice(body.voice);
  if (voice === false) {
    return Response.json({ error: "body.voice.trigger must be \"note\", \"call\" or \"approval\"" }, { status: 400 });
  }
  if (body.mode !== undefined && body.mode !== "practice" && body.mode !== "demo") {
    return Response.json({ error: "body.mode must be \"practice\" or \"demo\"" }, { status: 400 });
  }
  try {
    const execution = await execute({
      caseId: typeof body.caseId === "string" ? body.caseId : null,
      dataset: typeof body.dataset === "string" ? body.dataset : null,
      workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
      parentExecutionId,
      extraEvents,
      humanDecision,
      voice,
      mode: (body.mode as "practice" | "demo" | undefined) ?? null,
      elapsedMs: typeof body.elapsedMs === "number" && Number.isFinite(body.elapsedMs) ? body.elapsedMs : null,
    });
    return Response.json({ execution });
  } catch (err) {
    return jsonError(err);
  }
}

/** null = absent, false = malformed. */
function parseHumanDecision(raw: unknown): HumanDecision | null | false {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return false;
  const d = raw as Record<string, unknown>;
  if (typeof d.optionId !== "string" || !d.optionId || typeof d.label !== "string" || typeof d.who !== "string") return false;
  if (d.by !== "tap" && d.by !== "voice") return false;
  return {
    optionId: d.optionId,
    label: d.label,
    by: d.by,
    who: d.who,
    ...(typeof d.confirmation === "string" ? { confirmation: d.confirmation } : {}),
  };
}

function parseVoice(raw: unknown): ExecutionVoice | null | false {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return false;
  const v = raw as Record<string, unknown>;
  if (v.trigger !== "note" && v.trigger !== "call" && v.trigger !== "approval") return false;
  return { trigger: v.trigger, ...(typeof v.callId === "string" ? { callId: v.callId } : {}) };
}
