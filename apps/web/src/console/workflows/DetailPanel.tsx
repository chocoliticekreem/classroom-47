"use client";
// Right panel for a step: its name, what it does, how careful a safety check is, and the case
// run's result in plain words. Runners, raw settings and run data sit behind "Advanced".
// Also edits a link's label when a link is selected.
import { useState } from "react";
import type { FlowEdge, FlowNode, Runner } from "../types";
import { Icon } from "./icons";
import { ALL_RUNNERS, metaFor, nodeTitle, plainWhen } from "./nodeTypes";
import { carefulToThresholds, carefulWord, thresholdsToCareful } from "./careful";
import { riskWord } from "../../ui/plain";
import { lastRunView, passedLabel, runnerWords, settingRows, type NodeTally } from "./runStats";
import { fmtMs, fmtUsd, inputsOf, type NodeRun, type RunOverlay } from "./status";
import { Badge, Btn, JsonView, RunnerChip, SectionLabel } from "./bits";

type Tab = "params" | "input" | "output";

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function GateSliders({ config, risk, onChange }: {
  config: Record<string, unknown>; risk: number | null; onChange: (c: Record<string, unknown>) => void;
}) {
  const allow = num(config.allow_below, 0.3);
  const block = num(config.block_above, 0.8);
  const set = (k: "allow_below" | "block_above", v: number) => {
    const next = { ...config, [k]: Math.round(v * 100) / 100 };
    if (k === "allow_below" && v > block) next.block_above = next.allow_below;
    if (k === "block_above" && v < allow) next.allow_below = next.block_above;
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-white/5">
        <div className="absolute inset-y-0 left-0 bg-[#22c55e]/70" style={{ width: `${allow * 100}%` }} />
        <div className="absolute inset-y-0 bg-[#f59e0b]/70" style={{ left: `${allow * 100}%`, width: `${(block - allow) * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-[#ef4444]/70" style={{ width: `${(1 - block) * 100}%` }} />
        {risk !== null && (
          <div className="absolute inset-y-[-2px] w-[3px] rounded bg-white shadow" style={{ left: `calc(${risk * 100}% - 1px)` }} title={`risk ${risk.toFixed(2)} in this run`} />
        )}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wide">
        <span className="text-[#4ade80]">send</span><span className="text-[#fbbf24]">ask a person</span><span className="text-[#f87171]">stop</span>
      </div>
      {([["allow_below", "Send on its own below", allow, "#22c55e"], ["block_above", "Stop at or above", block, "#ef4444"]] as const).map(([k, label, v, c]) => (
        <label key={k} className="block">
          <div className="flex items-center justify-between text-[12px] text-white/75">
            <span>{label}</span>
            <span className="tabular-nums font-semibold" style={{ color: c }}>{v.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01} value={v}
            onChange={(e) => set(k, Number(e.target.value))}
            className="mt-1 w-full" style={{ accentColor: c }}
          />
        </label>
      ))}
      {risk !== null && <div className="text-[11px] text-white/50">White marker: how risky the shown case was ({risk.toFixed(2)}).</div>}
    </div>
  );
}

function JsonEditor({ value, onApply }: { value: Record<string, unknown> | undefined; onApply: (v: Record<string, unknown> | undefined) => void }) {
  const initial = value === undefined ? "{}" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const dirty = text !== initial;
  const apply = () => {
    try {
      const v = text.trim() ? JSON.parse(text) : {};
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("config must be a JSON object");
      setErr(null);
      onApply(Object.keys(v).length ? v : undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "invalid JSON");
    }
  };
  return (
    <div>
      <textarea
        value={text} spellCheck={false}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") apply(); e.stopPropagation(); }}
        className={`h-56 w-full resize-y rounded-md border bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-white/85 outline-none ${err ? "border-[#ef4444]/70" : "border-white/10 focus:border-[#ff6a1a]/60"}`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Btn variant="outline" onClick={apply} disabled={!dirty}>Apply</Btn>
        {dirty && <Btn onClick={() => { setText(initial); setErr(null); }}>Reset</Btn>}
        <span className="ml-auto text-[10px] text-white/35">⌘/Ctrl + Enter</span>
      </div>
      {err && <div className="mt-1.5 text-[11px] text-[#f87171]">{err}</div>}
    </div>
  );
}

function RunStats({ run }: { run: NodeRun }) {
  const tone = run.status === "ok" ? "green" : run.status === "error" ? "red" : run.status === "running" ? "orange" : "grey";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={tone}>{run.status}</Badge>
        <span className="text-[11px] tabular-nums text-white/60">{fmtMs(run.latencyMs)} · {fmtUsd(run.costUsd)} · {run.runs} item{run.runs === 1 ? "" : "s"}</span>
      </div>
      {run.summary && <div className="text-[12px] leading-snug text-white/85">{run.summary}</div>}
    </div>
  );
}

function ModelCalls({ run }: { run: NodeRun }) {
  if (!run.modelCalls.length) return <div className="text-[11px] text-white/40">No model calls (code only, or a view over an earlier call).</div>;
  return (
    <table className="w-full text-left text-[11px] tabular-nums">
      <thead className="text-white/40">
        <tr><th className="py-1 font-medium">Runner</th><th className="font-medium">Model</th><th className="text-right font-medium">Latency</th><th className="text-right font-medium">Tokens</th><th className="text-right font-medium">Cost</th></tr>
      </thead>
      <tbody>
        {run.modelCalls.map((c, i) => (
          <tr key={i} className="border-t border-white/5 text-white/75" title={c.error}>
            <td className="py-1"><RunnerChip runner={c.runner} /></td>
            <td className="max-w-[110px] truncate">{c.model}{!c.ok && <span className="ml-1 text-[#f87171]">failed</span>}</td>
            <td className="text-right">{fmtMs(c.latencyMs)}</td>
            <td className="text-right">{c.tokensIn}/{c.tokensOut}</td>
            <td className="text-right">{fmtUsd(c.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NoRun({ overlay }: { overlay: RunOverlay | null }) {
  return (
    <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-[12px] text-white/45">
      {overlay ? "This step didn't run in this case." : "Pick a case run at the top to see what happened here."}
    </div>
  );
}

/** The developer view of a step: runners, raw settings and the case run's data. Behind "Advanced". */
function NodeAdvanced({ node, overlay, onChange }: {
  node: FlowNode;
  overlay: RunOverlay | null;
  onChange: (patch: Partial<Omit<FlowNode, "id">>) => void;
}) {
  const [tab, setTab] = useState<Tab>("params");
  const meta = metaFor(node.type);
  const run = overlay?.nodes[node.id] ?? null;
  const gateOut = run?.output && run.output.type === "safety_gate" ? (run.output as { risk?: number }) : null;
  const risk = typeof gateOut?.risk === "number" ? gateOut.risk : null;
  const configSig = JSON.stringify(node.config ?? null);

  const toggleRunner = (r: Runner) => {
    const has = node.runs_on.includes(r);
    onChange({ runs_on: has ? node.runs_on.filter((x) => x !== r) : ALL_RUNNERS.filter((x) => x === r || node.runs_on.includes(x)) });
  };

  return (
    <div className="flex min-h-0 flex-col border-t border-white/10">
      <div className="px-4 pt-2 text-[11px] text-white/35"><code>{node.id}</code> · {node.type}</div>
      <div className="flex gap-1 border-b border-white/10 px-3">
        {([["params", "Parameters"], ["input", "Input"], ["output", "Output"]] as const).map(([k, l]) => (
          <button
            key={k} type="button" onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[12px] font-medium ${tab === k ? "border-[#ff6a1a] text-white" : "border-transparent text-white/50 hover:text-white/80"}`}
          >
            {l}{k !== "params" && run && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e] align-middle" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {tab === "params" && (
          <>
            <p className="text-[12px] leading-snug text-white/55">{meta.description}</p>
            <div>
              <SectionLabel>Runs on</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {ALL_RUNNERS.map((r) => <RunnerChip key={r} runner={r} active={node.runs_on.includes(r)} onClick={() => toggleRunner(r)} />)}
              </div>
            </div>
            {node.type === "safety_gate" && (
              <div>
                <SectionLabel>Thresholds (risk 0–1)</SectionLabel>
                <GateSliders config={node.config ?? {}} risk={risk} onChange={(c) => onChange({ config: c })} />
              </div>
            )}
            <div>
              <SectionLabel>Config (JSON)</SectionLabel>
              <JsonEditor key={`${node.id}:${configSig}`} value={node.config} onApply={(c) => onChange({ config: c })} />
            </div>
          </>
        )}

        {tab === "input" && (
          !overlay ? <NoRun overlay={null} /> : (() => {
            const ins = inputsOf(overlay, node.id);
            const isFirst = run?.order === 0;
            if (isFirst && overlay.start) {
              return (
                <div className="space-y-3">
                  <SectionLabel>Case inputs · {overlay.start.title}</SectionLabel>
                  {overlay.start.inputs.length === 0 && <div className="text-[12px] text-white/45">Nothing listed.</div>}
                  {overlay.start.inputs.map((i) => (
                    <div key={i.n} className="rounded-md border border-white/10 bg-black/20 p-2.5">
                      <div className="text-[11px] text-white/45">#{i.n} · {i.channel} · {i.from}</div>
                      <div className="mt-1 text-[12px] leading-snug text-white/80">{i.excerpt}</div>
                    </div>
                  ))}
                </div>
              );
            }
            if (!ins.length) return <NoRun overlay={overlay} />;
            return (
              <div className="space-y-4">
                {ins.map((r) => {
                  const e = overlay.edges.find((x) => x.from === r.nodeId && x.to === node.id);
                  return (
                    <div key={r.nodeId} className="space-y-2">
                      <SectionLabel>From {metaFor(r.nodeType).label} <code className="normal-case">{r.nodeId}</code>{e?.when ? ` · ${e.when}` : ""}</SectionLabel>
                      <RunStats run={r} />
                      {r.output && <JsonView value={r.output} />}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}

        {tab === "output" && (
          !run ? <NoRun overlay={overlay} /> : (
            <div className="space-y-4">
              <RunStats run={run} />
              <div>
                <SectionLabel>Output</SectionLabel>
                {run.output ? <JsonView value={run.output} /> : <div className="text-[11px] text-white/40">No structured output; see the summary above.</div>}
              </div>
              <div>
                <SectionLabel>Model calls</SectionLabel>
                <ModelCalls run={run} />
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CarefulSlider({ config, risk, onChange }: {
  config: Record<string, unknown>; risk: number | null; onChange: (c: Record<string, unknown>) => void;
}) {
  const value = thresholdsToCareful(config);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-white/85">How careful?</span>
        <span className="text-[13px] font-semibold text-[#ff8a4c]">{carefulWord(value)}</span>
      </div>
      <input
        type="range" min={0} max={1} step={0.05} value={value} aria-label="How careful"
        onChange={(e) => onChange({ ...config, ...carefulToThresholds(Number(e.target.value)) })}
        className="mt-2 w-full" style={{ accentColor: "#ff6a1a" }}
      />
      <div className="flex justify-between text-[11.5px] text-white/45"><span>Relaxed</span><span>Strict</span></div>
      <p className="mt-2 text-[12px] leading-snug text-white/50">Stricter means more replies wait for a person.</p>
      {risk !== null && <p className="mt-1 text-[12px] text-white/60">In this case run the risk was {riskWord(risk)}.</p>}
    </div>
  );
}

type InspectorTab = "about" | "settings" | "run";

const MARK_STYLE = {
  ok: { text: "Done", cls: "text-rv-green", dot: "bg-rv-green" },
  warn: { text: "Held for a person", cls: "text-rv-amber", dot: "bg-rv-amber" },
  error: { text: "Went wrong", cls: "text-rv-red", dot: "bg-rv-red" },
} as const;

function TallyBar({ tally, runs }: { tally: NodeTally | undefined; runs: number }) {
  if (!runs) return <p className="text-rv-caption text-white/45">No case runs of this playbook yet.</p>;
  const t = tally ?? { passed: 0, ok: 0, warn: 0, error: 0 };
  const pct = (n: number) => `${(n / runs) * 100}%`;
  return (
    <div>
      <div className="text-rv-small text-white/80">{passedLabel(tally, runs)}</div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={passedLabel(tally, runs)}>
        <div className="bg-rv-green" style={{ width: pct(t.ok) }} />
        <div className="bg-rv-amber" style={{ width: pct(t.warn) }} />
        <div className="bg-rv-red" style={{ width: pct(t.error) }} />
      </div>
      {t.passed > 0 && (
        <div className="mt-1.5 flex gap-3 text-rv-caption text-white/50 tabular">
          {t.ok > 0 && <span><span className="text-rv-green">{t.ok}</span> fine</span>}
          {t.warn > 0 && <span><span className="text-rv-amber">{t.warn}</span> held for a person</span>}
          {t.error > 0 && <span><span className="text-rv-red">{t.error}</span> went wrong</span>}
        </div>
      )}
    </div>
  );
}

function ReadOnlySlider({ label, value }: { label: string; value: number }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-rv-small text-white/75">
        <span>{label}</span><span className="tabular font-semibold text-white/90">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={0} max={1} step={0.01} value={value} readOnly disabled aria-label={label} className="mt-1 w-full opacity-70" style={{ accentColor: "#8b8b96" }} />
    </label>
  );
}

export function NodePanel({ node, overlay, flow, tally, runs, runName, onChange, onDelete, onClose }: {
  node: FlowNode;
  overlay: RunOverlay | null;
  flow?: { nodes: Pick<FlowNode, "id" | "type">[] } | null;
  /** How many of the last `runs` case runs passed through this step. */
  tally?: NodeTally;
  runs?: number;
  /** The case shown on the canvas ("delivery-013"), for the Last run tab. */
  runName?: string | null;
  onChange: (patch: Partial<Omit<FlowNode, "id">>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const run = overlay?.nodes[node.id] ?? null;
  const [tab, setTab] = useState<InspectorTab>(run ? "run" : "about");
  const [advanced, setAdvanced] = useState(false);
  const meta = metaFor(node.type);
  const gateOut = run?.output && run.output.type === "safety_gate" ? (run.output as { risk?: number }) : null;
  const risk = typeof gateOut?.risk === "number" ? gateOut.risk : null;
  const view = lastRunView(overlay, node.id, flow);
  const rows = settingRows(node);
  const mark = view?.mark ? MARK_STYLE[view.mark] : null;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-rv-line bg-rv-sidebar" aria-label="Step details">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06]" style={{ color: meta.color }}>
          <Icon name={meta.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-rv-heading font-semibold text-white">{nodeTitle(node)}</div>
          <div className="mt-0.5 text-rv-caption text-white/50">{meta.group} step</div>
        </div>
        <button type="button" onClick={onDelete} title="Remove this step" aria-label="Remove this step" className="rounded p-1.5 text-white/45 hover:bg-[#ef4444]/15 hover:text-[#f87171]"><Icon name="trash" size={15} /></button>
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close" className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white"><Icon name="close" size={15} /></button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-rv-line px-3" role="tablist">
        {([["about", "What it does"], ["settings", "Settings"], ["run", "Last run"]] as const).map(([k, l]) => (
          <button
            key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-rv-small font-medium ${tab === k ? "border-rv-orange text-white" : "border-transparent text-white/50 hover:text-white/80"}`}
          >
            {l}
            {k === "run" && mark && <span className={`h-1.5 w-1.5 rounded-full ${mark.dot}`} />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "about" && (
          <div className="space-y-5 px-4 py-4">
            <p className="text-rv-body leading-relaxed text-white/85">{meta.description}</p>
            <div>
              <SectionLabel>How it works</SectionLabel>
              <p className="text-rv-small text-white/70">{runnerWords(node.runs_on) || "Fixed rules"}</p>
            </div>
            {meta.outputs && meta.outputs.length > 1 && (
              <div>
                <SectionLabel>Where it can lead</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {meta.outputs.map((o) => <Badge key={o} tone={o === "allow" ? "green" : o === "ask" ? "amber" : o === "block" ? "red" : "grey"}>{plainWhen(o)}</Badge>)}
                </div>
              </div>
            )}
            <div>
              <SectionLabel>Recent cases</SectionLabel>
              <TallyBar tally={tally} runs={runs ?? 0} />
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div className="space-y-5 px-4 py-4">
            {node.type === "safety_gate" ? (
              <>
                <CarefulSlider config={node.config ?? {}} risk={risk} onChange={(c) => onChange({ config: c })} />
                <div>
                  <SectionLabel>Exact limits (risk 0 to 1)</SectionLabel>
                  <GateSliders config={node.config ?? {}} risk={risk} onChange={(c) => onChange({ config: c })} />
                </div>
              </>
            ) : rows.length === 0 ? (
              <p className="text-rv-small text-white/50">This step has nothing to set. It works the same way every time.</p>
            ) : (
              <div className="space-y-4">
                {rows.map((r) => r.threshold !== undefined
                  ? <ReadOnlySlider key={r.key} label={r.label} value={r.threshold} />
                  : (
                    <div key={r.key} className="flex items-baseline justify-between gap-3 text-rv-small">
                      <span className="text-white/60">{r.label}</span>
                      <span className="truncate text-right text-white/90">{r.text}</span>
                    </div>
                  ))}
                <p className="text-rv-caption text-white/40">Change these in Advanced below.</p>
              </div>
            )}
            <button type="button" onClick={() => setAdvanced((a) => !a)} className="inline-flex items-center gap-1 text-rv-caption text-white/45 hover:text-white/80">
              <Icon name="chevron" size={11} className={advanced ? "rotate-90" : ""} /> Advanced
            </button>
          </div>
        )}
        {tab === "settings" && advanced && <NodeAdvanced node={node} overlay={overlay} onChange={onChange} />}

        {tab === "run" && (
          <div className="space-y-4 px-4 py-4">
            {!overlay ? (
              <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-rv-small text-white/50">
                Pick a case in <span className="text-white/80">Show a run</span> at the top to see what happened here.
              </div>
            ) : !view ? (
              <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-rv-small text-white/50">
                This step didn&apos;t run in {runName ? <code className="text-white/70">{runName}</code> : "this case"}.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {mark && <span className={`text-rv-small font-semibold ${mark.cls}`}>{mark.text}</span>}
                  {runName && <code className="truncate text-rv-caption text-white/40">{runName}</code>}
                  {view.cost && <span className="ml-auto shrink-0 text-rv-caption tabular text-white/40">{view.cost}</span>}
                </div>
                <div>
                  <SectionLabel>What came in</SectionLabel>
                  <div className="space-y-2">
                    {view.input.length === 0 && <p className="text-rv-small text-white/45">Nothing recorded.</p>}
                    {view.input.map((i, k) => (
                      <div key={k} className="rounded-md border border-rv-line bg-rv-panel px-3 py-2">
                        <div className="text-rv-caption text-white/45">From {i.from}</div>
                        {i.lines.map((l, j) => <div key={j} className="mt-0.5 text-rv-small leading-snug text-white/80">{l}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-center text-white/25" aria-hidden><Icon name="chevron" size={14} className="rotate-90" /></div>
                <div>
                  <SectionLabel>What it did</SectionLabel>
                  <div className="rounded-md border border-rv-line bg-rv-card px-3 py-2">
                    {view.output.length === 0 && <p className="text-rv-small text-white/45">Nothing recorded.</p>}
                    <ul className="space-y-1">
                      {view.output.map((l, j) => <li key={j} className={`text-rv-small leading-snug ${j === 0 ? "font-medium text-white" : "text-white/75"}`}>{l}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function EdgePanel({ edge, onWhen, onDelete, onClose }: {
  edge: FlowEdge; onWhen: (when: string) => void; onDelete: () => void; onClose: () => void;
}) {
  const [text, setText] = useState(edge.when ?? "");
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#19191d]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-white">Link</div>
          <div className="truncate text-[12px] text-white/45">{edge.when ? plainWhen(edge.when) : "Always"}</div>
        </div>
        <button type="button" onClick={onDelete} title="Remove this link" className="rounded p-1.5 text-white/45 hover:bg-[#ef4444]/15 hover:text-[#f87171]"><Icon name="trash" size={15} /></button>
        <button type="button" onClick={onClose} title="Close" className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white"><Icon name="close" size={15} /></button>
      </div>
      <div className="space-y-2 border-t border-white/10 px-4 py-4">
        <SectionLabel>Label</SectionLabel>
        <input
          value={text} onChange={(e) => setText(e.target.value)}
          onBlur={() => onWhen(text)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onWhen(text); }}
          placeholder="always"
          className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[12px] text-white outline-none focus:border-[#ff6a1a]/60"
        />
        <p className="text-[11.5px] text-white/40">Leave empty if this link is always taken.</p>
      </div>
    </aside>
  );
}
