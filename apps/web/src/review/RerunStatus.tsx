"use client";
// The Decisions desk's line for "your choice is being run again": running, the plain result with a
// link to Case runs, or the error as it came back (never a made-up result).
import Link from "next/link";
import { caseRunHref, type RerunState } from "../console/decisionRerun";
import { ShowOnPlaybook } from "../console/ShowOnPlaybook";

export default function RerunStatus({ state, onRetry }: { state: RerunState; onRetry?: () => void }) {
  if (state.phase === "idle" || state.phase === "confirm") return null;
  if (state.phase === "running") {
    return <div className="review-rerun" role="status"><strong>Running again with your choice…</strong>This can take a minute or two.</div>;
  }
  if (state.phase === "error") {
    return (
      <div className="review-rerun err" role="alert">
        <strong>{state.message}</strong>
        {state.canRetry && onRetry && <button type="button" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  return (
    <div className={`review-rerun ${state.result.tone}`} role="status">
      <strong>{state.result.text}</strong>
      <Link href={caseRunHref(state.execution.id)}>See it in Case runs</Link>
      <ShowOnPlaybook executionId={state.execution.id} className="ml-3" />
    </div>
  );
}
