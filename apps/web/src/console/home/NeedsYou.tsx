"use client";
// "Needs you now": live decisions waiting for a person, read from the review queue
// (useReviewQueue, read-only here). "Decide" opens the Decisions drawer on that case.
import { plainOwner } from "../../ui/plain";
import { deadlineLabel, shortLine } from "../../review/model";
import type { ReviewTask } from "../../review/types";
import { Button, EmptyState, ErrorState, IconCheck, Skeleton, StatusDot, cx } from "../ui";

const MAX_CARDS = 4;

export default function NeedsYou({
  tasks,
  loading,
  error,
  now,
  onRetry,
  onDecide,
}: {
  tasks: ReviewTask[];
  loading: boolean;
  error: string | null;
  now: number;
  onRetry: () => void;
  onDecide: (task: ReviewTask) => void;
}) {
  if (loading)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  if (error && tasks.length === 0) return <ErrorState title="Couldn't load decisions" error="Try again in a moment." onRetry={onRetry} />;
  if (tasks.length === 0)
    return (
      <div className="rounded-xl border border-white/[0.07] bg-rv-card">
        <EmptyState icon={<IconCheck size={20} />} title="Nothing waits for you">
          Hamyway City asks here when a case needs a person.
        </EmptyState>
      </div>
    );

  const shown = tasks.slice(0, MAX_CARDS);
  const more = tasks.length - shown.length;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((t) => {
        const late = now > 0 && now > Date.parse(t.deadlineAt);
        const question = shortLine(t.mustDecide, 14) || shortLine(t.summary, 14);
        return (
          <article
            key={t.id}
            className={cx(
              "flex items-center gap-4 rounded-xl border bg-rv-card px-5 py-4",
              t.urgency === "high" || late ? "border-rv-amber/40" : "border-white/[0.07]",
            )}
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] font-semibold text-white">{shortLine(t.title, 10) || t.caseId}</h3>
              {question && <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-white/65">{question}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/40">
                <span>For {plainOwner(t.routeTo)}</span>
                {now > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={cx("inline-flex items-center gap-1.5", late && "text-rv-amber")}>
                      <StatusDot tone={late ? "amber" : "neutral"} size={6} />
                      {deadlineLabel(t, now)}
                    </span>
                  </>
                )}
              </p>
            </div>
            <Button
              onClick={() => onDecide(t)}
              className="h-11 border-rv-orange/60 px-6 text-[15px] text-white hover:border-rv-orange"
              aria-label={`Decide: ${shortLine(t.title, 10) || t.caseId}`}
            >
              Decide
            </Button>
          </article>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          onClick={() => onDecide(tasks[MAX_CARDS])}
          className="self-start text-[13px] text-white/50 hover:text-white"
        >
          {more} more waiting
        </button>
      )}
    </div>
  );
}
