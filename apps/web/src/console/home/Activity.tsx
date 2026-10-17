"use client";
// Live activity: the latest case runs in plain sentences (GET /api/console/executions, every 3 s).
// Runs that appear after the first load slide in at the top.
import { useMemo, useState } from "react";
import { useExecutions } from "../useApi";
import {
  EmptyState,
  ErrorState,
  IconExecutions,
  SimulatedBadge,
  Skeleton,
  StatusDot,
  cx,
  formatRelative,
  formatTimestamp,
  useConsole,
} from "../ui";
import { activityLine, newIds } from "./logic";

const POLL_MS = 3000;
const SHOW = 7;

const SLIDE_CSS = `
@keyframes rv-home-slide { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
.rv-home-new { animation: rv-home-slide 380ms ease-out both; }
.rv-home-new-bg { animation: rv-home-flash 2.4s ease-out both; }
@keyframes rv-home-flash { from { background: rgba(255,106,26,0.10); } to { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .rv-home-new, .rv-home-new-bg { animation: none; } }
`;

export default function Activity() {
  const { navigate } = useConsole();
  const ex = useExecutions({ limit: SHOW }, { pollMs: POLL_MS });
  const rows = useMemo(() => (ex.data?.executions ?? []).slice(0, SHOW), [ex.data]);

  // Which runs are new since the last poll. Adjusted during render when a new response lands
  // (React's "store info from previous renders" pattern), so no effect or ref is needed.
  const [seen, setSeen] = useState<{ at: number | undefined; ids: Set<string> | null; fresh: Set<string> }>({
    at: undefined,
    ids: null,
    fresh: new Set(),
  });
  if (ex.updatedAt !== undefined && ex.updatedAt !== seen.at) {
    const fresh = newIds(seen.ids, rows);
    setSeen({
      at: ex.updatedAt,
      ids: new Set([...(seen.ids ?? []), ...rows.map((r) => r.id)]),
      fresh: fresh.length ? new Set(fresh) : seen.fresh,
    });
  }

  const now = ex.updatedAt ?? 0;

  let body;
  if (ex.loading)
    body = (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  else if (ex.error && !ex.data)
    body = <ErrorState title="Couldn't load case runs" error={ex.error} onRetry={ex.reload} compact />;
  else if (rows.length === 0)
    body = (
      <EmptyState icon={<IconExecutions size={20} />} title="No case runs yet">
        Start one with New case.
      </EmptyState>
    );
  else
    body = (
      <ul>
        {rows.map((r, i) => {
          const line = activityLine(r);
          const fresh = seen.fresh.has(r.id);
          return (
            <li key={r.id} className={cx(i > 0 && "border-t border-white/[0.05]", fresh && "rv-home-new")}>
              <button
                type="button"
                onClick={() => navigate("executions", { id: r.id })}
                className={cx("flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-white/[0.03]", fresh && "rv-home-new-bg")}
              >
                <span className="pt-[7px]">
                  <StatusDot tone={line.tone} pulse={r.status === "running"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] text-white/90">{line.sentence}</span>
                    {line.simulated && <SimulatedBadge />}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-white/45">
                    {line.afterDecision ? "After a person decided: " : ""}
                    {line.about}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-xs text-white/35" title={formatTimestamp(r.startedAt)}>
                  {formatRelative(r.startedAt, now)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-rv-card">
      <style>{SLIDE_CSS}</style>
      {body}
    </div>
  );
}
