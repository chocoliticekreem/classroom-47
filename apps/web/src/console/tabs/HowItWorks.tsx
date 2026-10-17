"use client";
// Console tab: How it works. A plain, static explainer of the Hamyway flow for judges and visitors.
// Content is hardcoded from docs/framework-map.md (see ../howitworks/content.ts).
import type { ReactNode } from "react";
import { Badge, BigNumber, IconArrowRight, KeyValue, SectionCard, StatusPill, Table, Td, Th, Tr, cx, type Tone } from "../ui";
import {
  BANDS,
  CARD,
  HEADLINE,
  OUTPUTS,
  RUNS,
  SCOPE,
  SCOPE_WORD,
  SEATS,
  STEPS,
  TAG_MEANING,
  TEST_SETS,
  WEIGHTS,
  type Scope,
  type StepTag,
} from "../howitworks/content";

const TAG_TONE: Record<StepTag, Tone> = { CODE: "neutral", SONNET: "blue", JEV: "violet", OPUS: "blue" };

function Tag({ tag }: { tag: StepTag }) {
  return (
    <Badge tone={TAG_TONE[tag]} title={TAG_MEANING[tag]} className="font-mono text-[11px] tracking-wide">
      {tag}
    </Badge>
  );
}

const SCOPE_TONE: Record<Scope, Tone> = { in: "green", partial: "amber", console: "neutral", demo: "neutral", never: "neutral" };

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-rv-small text-white/55">{children}</p>;
}

export default function HowItWorksTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-6 py-8">
        <p className="text-[15px] leading-relaxed text-white/60">
          Hamyway City reads a delivery problem, checks the facts, plans a reply and checks it is safe before anything goes out.
          When it is not sure, a person decides.
        </p>

        <section aria-label="Where it stands" className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {HEADLINE.map((h) => (
            <BigNumber key={h.label} value={h.value} label={h.label} sub={h.sub} />
          ))}
        </section>

        <FlowSection />
        <SeatsSection />
        <StopSection />
        <ProofSection />
        <ScopeSection />
      </div>
    </div>
  );
}

function FlowSection() {
  return (
    <SectionCard title="One case through the flow" description="Five steps. The risk score from the last step decides what happens.">
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex min-w-0 flex-col gap-2 rounded-lg border border-rv-line bg-rv-panel p-4">
            <div className="flex items-center gap-2 text-rv-caption text-white/40">
              <span className="tabular">{i + 1}</span>
              <span className="flex flex-wrap gap-1">
                {s.tags.map((t) => (
                  <Tag key={t} tag={t} />
                ))}
              </span>
            </div>
            <div className="text-rv-heading font-semibold text-white">{s.title}</div>
            <div className="text-rv-small text-white/60">{s.detail}</div>
            {i < STEPS.length - 1 && (
              <IconArrowRight
                size={14}
                aria-hidden="true"
                className="absolute top-1/2 -right-[11px] z-[1] hidden -translate-y-1/2 text-white/35 md:block"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {BANDS.map((b) => (
          <div key={b.label} className="flex flex-col gap-2 rounded-lg border border-rv-line bg-rv-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="tabular text-rv-small font-medium text-white/80">{b.range}</span>
              <StatusPill status={b.status} label={b.label} />
            </div>
            <div className="text-rv-small text-white/60">{b.result}</div>
          </div>
        ))}
      </div>

      <h3 className="mt-6 mb-3 text-rv-small font-medium text-white/70">Every case writes four files</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {OUTPUTS.map((o) => (
          <div key={o.file} className="min-w-0 rounded-lg border border-rv-line bg-rv-panel p-4">
            <div className="truncate font-mono text-[12px] text-white/85">{o.file}</div>
            <div className="mt-1 text-rv-small text-white/55">{o.what}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-1">
        <Caption>Thresholds live in the flow file, not in prompts.</Caption>
        <Caption>A case that fails anywhere still gets an answer that hands it to a person.</Caption>
        <Caption>
          Tags: {(Object.keys(TAG_MEANING) as StepTag[]).map((t, i) => (
            <span key={t}>
              {i > 0 && " · "}
              <span className="font-mono text-[12px] text-white/70">{t}</span> {TAG_MEANING[t].toLowerCase()}
            </span>
          ))}
        </Caption>
      </div>
    </SectionCard>
  );
}

function SeatsSection() {
  return (
    <SectionCard
      title="Five second opinions"
      description="Five seats, one call, under half a second. Code turns their 12 scores into notes for the planner, or hands the case to a person."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {SEATS.map((s) => (
          <div key={s.seat} className="flex min-w-0 flex-col gap-2 rounded-lg border border-rv-line bg-rv-panel p-4">
            <div className="text-rv-heading font-semibold text-white">{s.seat}</div>
            <ul className="flex flex-col gap-1.5">
              {s.asks.map((q) => (
                <li key={q} className="text-rv-small text-white/60">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function StopSection() {
  return (
    <SectionCard title="When it stops" description="The decision card a person sees. This one is from a real run.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4 rounded-lg border border-rv-amber/30 bg-rv-panel p-5">
          <div className="flex items-center gap-2">
            <StatusPill status="escalated" />
          </div>
          <div>
            <div className="mb-1 text-rv-caption text-white/45">Why a person is needed</div>
            <p className="text-rv-body text-white/85">{CARD.why}</p>
          </div>
          <div>
            <div className="mb-2 text-rv-caption text-white/45">What it turns on</div>
            <KeyValue items={CARD.parties} columns={1} />
          </div>
          <div>
            <div className="mb-1 text-rv-caption text-white/45">Options</div>
            <p className="text-rv-small text-white/70">Each one is marked as can or cannot be undone.</p>
          </div>
          <div>
            <div className="mb-1 text-rv-caption text-white/45">Already done safely</div>
            <p className="text-rv-small text-white/70">{CARD.done}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-rv-body text-white/70">A person decides in one read, without opening the case.</p>
          <div>
            <div className="mb-2 text-rv-caption text-white/45">A card is made when</div>
            <ul className="flex flex-col gap-2">
              {CARD.triggers.map((t) => (
                <li key={t} className="flex gap-2 text-rv-small text-white/70">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-rv-amber" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function ProofSection() {
  const total = WEIGHTS.reduce((n, w) => n + w.weight, 0);
  return (
    <SectionCard title="How we know" description="Our own evaluation against our own answer keys. It is not the judges' score.">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TEST_SETS.map((t) => (
          <BigNumber key={t.label} value={t.value} label={t.label} sub={"sub" in t ? t.sub : undefined} />
        ))}
      </div>

      <h3 className="mt-6 mb-3 text-rv-small font-medium text-white/70">How a case is scored, out of {total}</h3>
      <div className="flex h-9 w-full overflow-hidden rounded-md border border-rv-line" role="img" aria-label="Score weights">
        {WEIGHTS.map((w, i) => (
          <div
            key={w.label}
            style={{ width: `${(w.weight / total) * 100}%` }}
            className={cx(
              "flex min-w-0 items-center justify-between gap-2 px-3 text-rv-caption",
              i % 2 === 0 ? "bg-white/[0.07]" : "bg-white/[0.03]",
              i > 0 && "border-l border-rv-line",
            )}
          >
            <span className="truncate text-white/70">{w.label}</span>
            <span className="tabular font-medium text-white">{w.weight}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-rv-small text-white/55">
        Any message that breaks a &ldquo;must never&rdquo; rule scores the whole case <span className="text-rv-red">0</span>.
      </p>

      <h3 className="mt-6 mb-3 text-rv-small font-medium text-white/70">Four runs on the same 48 cases</h3>
      <div className="overflow-x-auto rounded-lg border border-rv-line">
        <Table>
          <thead>
            <tr>
              <Th>Run</Th>
              <Th>What changed</Th>
              <Th align="right">Score</Th>
              <Th align="right">Passed</Th>
              <Th align="right">Rules broken</Th>
            </tr>
          </thead>
          <tbody>
            {RUNS.map((r, i) => {
              const last = i === RUNS.length - 1;
              return (
                <Tr key={r.run}>
                  <Td className={cx(last && "font-medium text-white")}>{r.run}</Td>
                  <Td muted={!last}>{r.what}</Td>
                  <Td align="right" className={cx(last && "font-semibold text-white")}>
                    {r.score}
                  </Td>
                  <Td align="right">{r.pass}</Td>
                  <Td align="right" className={r.broken > 0 ? "text-rv-red" : "text-rv-green"}>
                    {r.broken}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <Caption>One run each, so a case or two either way is noise.</Caption>
        <Caption>Runs 1 and 2 only judged the first message.</Caption>
      </div>
    </SectionCard>
  );
}

function ScopeSection() {
  return (
    <SectionCard title="What is and isn't in the scored run" flush>
      <Table>
        <thead>
          <tr>
            <Th className="pl-6">Part</Th>
            <Th>Where it runs</Th>
            <Th className="pr-6">Note</Th>
          </tr>
        </thead>
        <tbody>
          {SCOPE.map((s) => (
            <Tr key={s.part}>
              <Td className="pl-6">{s.part}</Td>
              <Td>
                <Badge tone={SCOPE_TONE[s.scope]} dot>
                  {SCOPE_WORD[s.scope]}
                </Badge>
              </Td>
              <Td muted className="pr-6">
                {s.note || "—"}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}
