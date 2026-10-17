// The city's decision toast, step two: after the choice is saved in the review queue, the case is run
// again by the real agent with that choice (same-origin POST /api/console/execute, parentExecutionId +
// humanDecision), and the new trace is replayed in the city feed under "Re-run with your choice".
// Only a card that came from a console case run can be re-run; a city-made case has no run to repeat.
import type { Trace } from "../../../../../api/src/lib/trace";
import { decisionRerunBody, postDecisionRerun, rerunResult, type FetchLike, type RerunResult } from "../../../console/decisionRerun";
import type { ExecutionRecord } from "../../../console/types";
import { traceToTimedEvents, type TimedEvent } from "../../agentBridge";
import { rerunParents, type FetchJson, type ReplayRecord } from "../../backendLink";

/** The console case run behind a card: the replay knows it, else the review queue's link. */
export async function findExecutionId(
  args: { runId: string; caseId: string; taskId?: string; replay?: ReplayRecord },
  fetchJson: FetchJson,
): Promise<string | null> {
  if (args.replay?.executionId) return args.replay.executionId;
  try {
    const q = (await fetchJson("/api/review/tasks")) as { tasks?: { id: string; runId: string; caseId: string; executionId?: string | null }[] } | null;
    const t = q?.tasks?.find((x) => (args.taskId && x.id === args.taskId) || (x.runId === args.runId && x.caseId === args.caseId));
    return t?.executionId ?? null;
  } catch {
    return null;
  }
}

export type CityRerun =
  | { status: "none" } // no case run to repeat
  | { status: "done"; execution: ExecutionRecord; result: RerunResult }
  | { status: "failed"; reason: string };

/** Runs the case again with the choice. Never throws; a failure is reported as it came back. */
export async function rerunWithChoice(
  args: { executionId: string | null; option: { id: string; label: string }; person: string },
  fetchImpl: FetchLike,
): Promise<CityRerun> {
  if (!args.executionId) return { status: "none" };
  rerunParents.add(args.executionId);
  try {
    const body = decisionRerunBody({ parentExecutionId: args.executionId, option: args.option, person: args.person });
    const execution = await postDecisionRerun(body, fetchImpl);
    return { status: "done", execution, result: rerunResult(execution) };
  } catch (e) {
    rerunParents.delete(args.executionId);
    return { status: "failed", reason: e instanceof Error ? e.message : "Couldn't run it again." };
  }
}

/** The feed lines for the re-run: a header line, then the new trace replayed under the same case. */
export function rerunFeed(execution: Pick<ExecutionRecord, "simulated"> & { trace: Trace | null }, caseLabel: string): TimedEvent[] {
  if (!execution.trace) return [];
  const synthetic = execution.simulated || execution.trace.synthetic === true;
  const tag = { source: "agent" as const, runId: execution.trace.runId, origin: "console" as const, ...(synthetic ? { synthetic: true } : {}) };
  const head: TimedEvent = { atMs: 0, event: { caseId: caseLabel, nodeId: "ingest", status: "start", summary: "Re-run with your choice", ...tag } };
  const rest = traceToTimedEvents(execution.trace, caseLabel, { origin: "console", synthetic }).map((t) => ({ ...t, atMs: t.atMs + 400 }));
  return [head, ...rest];
}
