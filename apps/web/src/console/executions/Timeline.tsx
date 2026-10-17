"use client";
// Pieces of a case run: the "A person needs to decide" card, the message card, and (behind
// "Details") the full step-by-step log with timings, costs and the safety check's numbers.
import { useState } from "react";
import { plainGate, plainNode, plainOutcome, riskWord, scrubLeaks } from "../../ui/plain";
import { stepText } from "./plainView";
import type { Trace } from "../types";
import type { DecisionCard } from "../../../../api/src/lib/trace";
import { buildTimeline, cardView, fmtCost, fmtDuration, fmtTokens, gateBar, type CardView, type GateInfo, type TimelineItem } from "./logic";
import { Badge, C } from "./ui";

type NodeItem = Extract<TimelineItem, { kind: "node" }>;

function Rail({ color, last, children, dot = 10 }: { color: string; last?: boolean; children: React.ReactNode; dot?: number }) {
  return (
    <li className="relative flex gap-3">
      <div className="relative flex w-4 shrink-0 justify-center">
        {!last && <span className="absolute bottom-0 top-3 w-px bg-white/10" />}
        <span className="relative mt-1.5 rounded-full" style={{ width: dot, height: dot, background: color }} />
      </div>
      <div className="min-w-0 flex-1 pb-3">{children}</div>
    </li>
  );
}

function Tstamp({ t }: { t: number }) {
  return <span className="text-[10px] tabular-nums text-white/35">+{fmtDuration(t)}</span>;
}

export function GateBar({ gate }: { gate: GateInfo }) {
  const b = gateBar(gate);
  const tone = gate.decision === "allow" ? "ok" : gate.decision === "block" ? "err" : "warn";
  return (
    <div className="mt-2 rounded-md bg-black/20 p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="text-white/60">
          Risk: <span className="font-semibold text-white">{riskWord(gate.risk) || "–"}</span>{" "}
          <span className="tabular-nums text-white/40">({gate.risk.toFixed(2)})</span>
        </span>
        <Badge tone={tone}>{plainGate(gate.decision)}</Badge>
      </div>
      <div className="relative my-1 h-2">
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div className="absolute inset-y-0 left-0" style={{ width: `${b.allow}%`, background: `${C.ok}55` }} />
          <div className="absolute inset-y-0" style={{ left: `${b.allow}%`, width: `${Math.max(0, b.block - b.allow)}%`, background: `${C.warn}55` }} />
          <div className="absolute inset-y-0 right-0" style={{ left: `${b.block}%`, background: `${C.err}55` }} />
        </div>
        <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-white" style={{ left: `${b.risk}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-[10px] tabular-nums text-white/40">
        <span>OK below {gate.allowBelow}</span>
        <span>Ask a person</span>
        <span>Stop above {gate.blockAbove}</span>
      </div>
    </div>
  );
}

function BasisQuote({ e }: { e: CardView["evidence"][number] }) {
  const box =
    e.style === "solid" ? "border border-solid border-white/25 bg-white/[0.04]"
    : e.style === "blue" ? "border border-solid border-[#6aa7ff]/50 bg-[#6aa7ff]/[0.06]"
    : "border border-dashed border-[#f5b83d]/60 bg-[#f5b83d]/[0.05]";
  const chip =
    e.style === "solid" ? "bg-white/85 text-[#1f1f23]"
    : e.style === "blue" ? "bg-[#6aa7ff]/20 text-[#6aa7ff]"
    : "border border-dashed border-[#f5b83d]/70 text-[#f5b83d]";
  return (
    <li className={`rounded-md px-3 py-2 ${box}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-white/85">{e.who}</span>
        <span className={`ml-auto shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${chip}`}>{e.label}</span>
      </div>
      <q className="mt-0.5 block text-[13px] leading-relaxed text-white/70 before:content-['“'] after:content-['”']">{e.says}</q>
    </li>
  );
}

/** "A person needs to decide": the reason in one line, then big options. The rest is behind "More". */
export function DecisionCardView({ card, onChoose, picked }: {
  card: DecisionCard;
  /** When set, the option tiles are buttons: the choice re-runs the case (DecideRerun.tsx). */
  onChoose?: (option: { id: string; label: string }) => void;
  /** The option being confirmed or sent; every tile is locked while it is set. */
  picked?: string | null;
}) {
  const v = cardView(card);
  const [more, setMore] = useState(false);
  const hasMore = v.evidence.length > 0 || v.done.items.length > 0 || !!card.wouldChangeMyMind || !!card.fallback || !!v.summary || !!v.clash;
  return (
    <section className="rounded-xl border border-[#f5b83d]/40 bg-[#2a2a30] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-white">A person needs to decide</h3>
        <span className="text-sm text-white/55">
          {card.routeTo && <>Asked: <span className="text-white/85">{scrubLeaks(card.routeTo)}</span></>}
          {card.deadlineMins ? <> · within {card.deadlineMins} min</> : null}
        </span>
      </div>
      {(v.headline.line || v.headline.chip) && (
        <p className="mt-2 text-[15px] leading-snug text-white/85">
          {v.headline.chip && <span className="mr-2 align-middle"><Badge tone={v.headline.chip.tone}>{v.headline.chip.label}</Badge></span>}
          {v.headline.line}
        </p>
      )}
      {v.options.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {v.options.map((o) => {
            const Tile = onChoose ? "button" : "div";
            const on = o.chosen || picked === o.id;
            return (
            <Tile
              key={o.id}
              {...(onChoose ? { type: "button" as const, disabled: !!picked, onClick: () => onChoose({ id: o.id, label: o.label }) } : {})}
              className={`rounded-lg border px-4 py-3 text-left ${on ? "border-[#ff6a1a] bg-[#ff6a1a]/10" : "border-white/15 bg-white/[0.03]"} ${
                onChoose ? (picked ? (on ? "" : "opacity-40") : "cursor-pointer transition-colors hover:border-[#ff6a1a] hover:bg-[#ff6a1a]/10") : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-[15px] font-semibold text-white">{o.label}</span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {o.chosen && <Badge tone="accent">Chosen</Badge>}
                  <Badge tone={o.undoable ? "ok" : "err"}>{o.undoable ? "Can undo" : "Can't undo"}</Badge>
                </span>
              </div>
              {o.effect && <p className="mt-1 text-[13px] leading-snug text-white/60">{o.effect}</p>}
            </Tile>
            );
          })}
        </div>
      )}
      {hasMore && (
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-3 text-xs text-white/45 hover:text-white/80">
          {more ? "▾ Less" : "▸ More"}
        </button>
      )}
      {more && (
        <div className="mt-2 space-y-3 text-[13px] text-white/75">
          {v.summary && <p className="leading-relaxed">{v.summary}</p>}
          {v.clash && <p><span className="text-white/45">The stories differ: </span>{v.clash}</p>}
          {v.evidence.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-white/45">What we know</div>
              <ul className="space-y-1">
                {v.evidence.map((e, i) => <BasisQuote key={i} e={e} />)}
              </ul>
            </div>
          )}
          {v.done.items.length > 0 && (
            <div>
              <div className="mb-0.5 text-xs text-white/45">{v.done.title}</div>
              <ul className="space-y-0.5">
                {v.done.items.map((t, i) => (
                  <li key={i} className="flex gap-1.5"><span className="text-[#3ecf8e]">✓</span><span>{t}</span></li>
                ))}
              </ul>
            </div>
          )}
          {card.wouldChangeMyMind && <p><span className="text-white/45">What would settle it: </span>{scrubLeaks(card.wouldChangeMyMind)}</p>}
          {card.fallback && <p><span className="text-white/45">If nobody answers: </span>{scrubLeaks(card.fallback)}</p>}
        </div>
      )}
    </section>
  );
}

export function MessageCard({ title, to, how, message, failed }: { title: string; to: string; how: string; message: string; failed?: boolean }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#2a2a30] p-5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white/60">{title}</h3>
        {failed && <Badge tone="err">Didn&apos;t go out</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-[14px]">
        <dt className="text-white/45">To</dt>
        <dd className="text-white">{to}</dd>
        <dt className="text-white/45">How</dt>
        <dd className="text-white">{how}</dd>
        <dt className="text-white/45">Message</dt>
        <dd className="whitespace-pre-wrap leading-relaxed text-white/85">{message}</dd>
      </dl>
    </section>
  );
}

function OutputDetails({ output }: { output: unknown }) {
  const [open, setOpen] = useState(false);
  if (!output) return null;
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[10px] text-white/35 hover:text-white/70">
        {open ? "▾" : "▸"} Raw output
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-white/70">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}

function NodeStep({ n, text }: { n: NodeItem; text: string | null }) {
  return (
    <div className="rounded-lg bg-[#2a2a30] px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-medium text-white">{plainNode(n.nodeType)}</span>
        {n.status === "error" && <Badge tone="err">Failed</Badge>}
        {n.status === "skipped" && <Badge>Skipped</Badge>}
        {n.status === "running" && <Badge tone="accent">Working</Badge>}
        <span className="ml-auto flex items-baseline gap-2 text-[10px] tabular-nums text-white/45">
          <span>{fmtDuration(n.latencyMs)}</span>
          {n.costUsd ? <span>{fmtCost(n.costUsd)}</span> : null}
          <Tstamp t={n.t} />
        </span>
      </div>
      {text && text !== plainNode(n.nodeType) && <p className="mt-0.5 text-xs leading-relaxed text-white/65">{text}</p>}
      {n.calls.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {n.calls.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-black/20 px-2 py-1 text-[10px] tabular-nums text-white/55">
              <span className="text-white/75">AI call</span>
              <span>{fmtTokens(c.tokensIn)} in · {fmtTokens(c.tokensOut)} out</span>
              <span>{fmtCost(c.costUsd)}</span>
              <span>{fmtDuration(c.latencyMs)}</span>
              {!c.ok && <span className="text-[#ff5c5c]">failed</span>}
            </div>
          ))}
        </div>
      )}
      {n.gate && <GateBar gate={n.gate} />}
      {!n.gate && <OutputDetails output={n.output} />}
    </div>
  );
}

/** Full step log, shown only under "Details". */
export default function Timeline({ trace }: { trace: Trace | null }) {
  const items = buildTimeline(trace);
  if (!items.length) return <p className="p-4 text-xs text-white/45">No step log for this case run.</p>;
  const typeOf = new Map(items.flatMap((i) => (i.kind === "node" ? [[i.nodeId, i.nodeType] as const] : [])));
  const name = (id: string) => plainNode(typeOf.get(id) ?? id);
  return (
    <ol className="py-2">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        switch (it.kind) {
          case "run_start":
            return (
              <Rail key={i} color={C.info} last={last}>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-white/70">Messages in</span>
                  <span className="min-w-0 truncate text-[13px] text-white">{scrubLeaks(it.title)}</span>
                </div>
                {it.inputs.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {it.inputs.map((inp) => (
                      <li key={inp.n} className="rounded bg-black/20 px-2 py-1 text-[11px] text-white/65">
                        <span className="text-white/85">{inp.from}</span> <span className="text-white/35">· {inp.channel}</span>
                        <span className="block truncate text-white/55">{inp.excerpt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Rail>
            );
          case "node": {
            const text = stepText(it);
            if (text === null && it.status !== "error") return null;
            const color = it.status === "error" ? C.err : it.status === "running" ? C.accent : it.status === "skipped" ? C.muted : C.ok;
            return (
              <Rail key={i} color={color} last={last}>
                <NodeStep n={it} text={text} />
              </Rail>
            );
          }
          case "edge":
            return (
              <Rail key={i} color="#55555f" last={last} dot={6}>
                <div className="-mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
                  <span>{name(it.from)}</span>
                  <span className="text-white/25">→</span>
                  <span>{name(it.to)}</span>
                  {it.when && <span className="text-white/55">({plainGate(it.when)})</span>}
                </div>
              </Rail>
            );
          case "run_end":
            return (
              <Rail key={i} color={it.outcome === "error" ? C.err : C.accent} last={last} dot={12}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold text-white/70">Finished</span>
                  <span className="text-xs text-white">{plainOutcome(it.outcome)}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-white/45">
                    {fmtDuration(it.totalLatencyMs)} · {fmtCost(it.totalCostUsd)}
                  </span>
                </div>
                {it.error && <p className="mt-1 text-xs text-[#ff5c5c]">{scrubLeaks(it.error)}</p>}
              </Rail>
            );
        }
      })}
    </ol>
  );
}
