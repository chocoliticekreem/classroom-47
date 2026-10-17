"use client";
// Big numbers from real results (GET /api/console/evidence). City-made cases never count.
import { formatCount, Skeleton, cx } from "../ui";
import { percent, type HomeNumbers } from "./logic";

type Tone = "green" | "amber" | "red" | "blue" | undefined;

export default function Numbers({ n, loading }: { n: HomeNumbers; loading: boolean }) {
  const tiles: { value: string; word: string; tone?: Tone; caption?: string }[] = [
    { value: formatCount(n.handled), word: n.handled === 1 ? "case handled" : "cases handled" },
    { value: formatCount(n.sent), word: "sent", tone: n.sent ? "green" : undefined },
    { value: formatCount(n.asked), word: "asked a question", tone: n.asked ? "blue" : undefined },
    { value: formatCount(n.needPerson), word: "needed a person", tone: n.needPerson ? "amber" : undefined },
    { value: formatCount(n.stopped), word: "stopped for safety", tone: n.stopped ? "red" : undefined },
  ];
  if (n.rightRate !== null)
    tiles.push({
      value: percent(n.rightRate),
      word: "right on test cases",
      tone: "green",
      caption: `${formatCount(n.passed)} of ${formatCount(n.evaluated)} checked`,
    });

  return (
    <div
      className={cx(
        "grid grid-cols-2 gap-3 sm:grid-cols-3",
        tiles.length === 6 ? "xl:grid-cols-6" : "xl:grid-cols-5",
      )}
    >
      {tiles.map((t) => (
        <div key={t.word} className="rounded-xl border border-white/[0.07] bg-rv-card px-5 py-5">
          {loading ? (
            <Skeleton className="h-10 w-20" />
          ) : (
            <div
              className={cx(
                "tabular text-[44px] leading-none font-semibold tracking-tight",
                t.tone === "green"
                  ? "text-rv-green"
                  : t.tone === "amber"
                    ? "text-rv-amber"
                    : t.tone === "red"
                      ? "text-rv-red"
                      : t.tone === "blue"
                        ? "text-rv-blue"
                        : "text-white",
              )}
            >
              {t.value}
            </div>
          )}
          <div className="mt-3 text-[15px] text-white/70">{t.word}</div>
          {t.caption && !loading && <div className="mt-0.5 text-xs text-white/35">{t.caption}</div>}
        </div>
      ))}
    </div>
  );
}
