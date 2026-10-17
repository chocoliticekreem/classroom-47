"use client";
// Console tab: Overview, shown as "Home". The opening shot of the demo: in a few seconds a viewer
// sees an AI desk handling delivery problems, safely.
//   1. one plain line on what Hamyway does
//   2. big numbers from real results (GET /api/console/evidence; city-made cases never count)
//   3. "Needs you now": live decisions from the review queue, one click to decide
//   4. live activity: the latest case runs in plain sentences, every 3 s
//   5. three shortcuts: New case, Practice a playbook, Open the live city
// Pieces live in console/home/**; the maths is in home/logic.ts (tested).
import { useCallback, useMemo, useState } from "react";
import { useReviewQueue } from "../../review/useReviewQueue";
import type { ReviewTask } from "../../review/types";
import { useEvidence } from "../useApi";
import { ErrorState, RealBadge } from "../ui";
import { homeNumbers, openDecisions } from "../home/logic";
import Numbers from "../home/Numbers";
import NeedsYou from "../home/NeedsYou";
import Activity from "../home/Activity";
import Shortcuts from "../home/Shortcuts";
import DecideDrawer from "../home/DecideDrawer";

const EVIDENCE_POLL_MS = 5000;

export default function OverviewTab() {
  const evidence = useEvidence({ pollMs: EVIDENCE_POLL_MS });
  const numbers = useMemo(() => homeNumbers(evidence.data?.rows ?? []), [evidence.data]);

  const queue = useReviewQueue();
  const decisions = useMemo(() => openDecisions(queue.tasks), [queue.tasks]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const closeDrawer = useCallback(() => setDeciding(null), []);
  const decide = useCallback((t: ReviewTask) => setDeciding(t.id), []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-6 py-8">
        <p className="text-[15px] leading-relaxed text-white/60">
          Hamyway City handles delivery problems: it reads the messages, checks the stories, and sends the right message, or
          asks a person.
        </p>

        <section aria-label="Totals">
          <div className="mb-3 flex items-center gap-2">
            <RealBadge />
            <span className="text-[13px] text-white/40">Real cases only</span>
          </div>
          {evidence.error && !evidence.data ? (
            <ErrorState title="Couldn't load the numbers" error={evidence.error} onRetry={evidence.reload} />
          ) : !evidence.loading && numbers.handled === 0 ? (
            <div className="rounded-xl border border-white/[0.07] bg-rv-card px-6 py-6 text-[15px] text-white/60">
              No cases handled yet. Start one with <span className="font-medium text-white/85">New case</span> below.
            </div>
          ) : (
            <Numbers n={numbers} loading={evidence.loading} />
          )}
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section aria-label="Needs you now">
            <SectionTitle count={queue.loading ? undefined : decisions.length}>Needs you now</SectionTitle>
            <NeedsYou
              tasks={decisions}
              loading={queue.loading}
              error={queue.error}
              now={queue.now}
              onRetry={() => void queue.refresh()}
              onDecide={decide}
            />
          </section>

          <section aria-label="Live activity">
            <SectionTitle>Live activity</SectionTitle>
            <Activity />
          </section>
        </div>

        <section aria-label="Shortcuts">
          <Shortcuts />
        </section>
      </div>

      {deciding && <DecideDrawer taskId={deciding} onClose={closeDrawer} />}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-white/90">
      {children}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-rv-orange px-2 text-[12px] leading-[20px] font-semibold text-white">{count}</span>
      )}
    </h2>
  );
}
