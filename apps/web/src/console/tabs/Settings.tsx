"use client";
// Console tab: Settings. Plain words only (docs/plans/ui-simplify-brief.md).
//   How careful is the agent?  one dial for the active playbook's safety checks; saved as a new version
//   Spending                   real money from case runs (read-only)
//   Connections                agent / voice / second opinions, presence only (read-only)
//   Data                       "Import new results" and cases per set
//   About                      version, commit, links
import { useMemo, useState } from "react";
import {
  activeWorkflow,
  caseSetCounts,
  currentThresholds,
  describeThresholds,
  flowCareful,
  money,
  safetyChecks,
  spendSummary,
  withCareful,
} from "../settings/logic";
import type { SettingsInfo } from "../settings/server";
import { consoleApi, useAction, useApi, useExecutions, useStatus, useWorkflows } from "../useApi";
import { carefulToThresholds, carefulWord } from "../workflows/careful";
import { createVersion, listVersions } from "../workflows/api";
import { Button, ErrorState, IconImport, Panel, Skeleton, StatusDot, cx, formatCount, useConsole } from "../ui";
import pkg from "../../../package.json";

const README_URL = "https://github.com/arvin-shafiei/hamyway-city#readme";

export default function SettingsTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold text-white/90">Settings</h1>
        <CarefulSection />
        <SpendingSection />
        <ConnectionsSection />
        <DataSection />
        <AboutSection />
      </div>
    </div>
  );
}

// ---------- How careful is the agent? ----------

function CarefulSection() {
  const workflows = useWorkflows();
  const wf = activeWorkflow(workflows.data?.workflows);
  const saved = flowCareful(wf?.flow);
  const [value, setValue] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const save = useAction(async (careful: number) => {
    if (!wf) return;
    const rec = withCareful(wf, careful);
    await consoleApi.saveWorkflow(rec);
    // Every save is also a version (the test loop runs versions); never blocks the save.
    const vs = await listVersions(rec.id);
    const latest = vs.ok ? vs.data?.versions?.[0] : undefined;
    await createVersion(rec.id, {
      flow: rec.flow,
      createdBy: "user",
      note: `Set to ${carefulWord(careful)} in Settings`,
      parentVersion: latest?.version ?? null,
    });
    workflows.reload();
    setValue(null);
    setDone(`Saved. The agent is now ${carefulWord(careful).toLowerCase()}.`);
  });

  const dial = value ?? saved ?? 0.5;
  const changed = saved !== null && value !== null && Math.abs(value - saved) >= 0.01;
  const shown = value === null ? currentThresholds(wf?.flow) : carefulToThresholds(value);
  const words = shown ? describeThresholds(shown) : null;

  return (
    <Panel title="How careful is the agent?" subtitle={wf ? `Playbook: ${wf.name}` : undefined}>
      {workflows.error && !workflows.data ? (
        <ErrorState compact title="Couldn't load the playbook" error={workflows.error} onRetry={workflows.reload} />
      ) : workflows.loading ? (
        <Skeleton className="h-24" />
      ) : !wf || safetyChecks(wf.flow).length === 0 ? (
        <p className="text-[13px] text-white/55">This playbook has no safety check.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-16 text-[13px] text-white/55">Relaxed</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={dial}
              aria-label="How careful is the agent"
              aria-valuetext={carefulWord(dial)}
              onChange={(e) => {
                setDone(null);
                setValue(Number(e.target.value));
              }}
              className="flex-1 accent-[#ff6a1a]"
            />
            <span className="w-16 text-right text-[13px] text-white/55">Strict</span>
          </div>
          <div className="text-center text-sm font-semibold text-white/90">{carefulWord(dial)}</div>
          {words && (
            <ul className="flex flex-col gap-1.5 text-[13px] text-white/75">
              <Rule tone="green">{words.send}</Rule>
              <Rule tone="amber">{words.ask}</Rule>
              <Rule tone="red">{words.stop}</Rule>
            </ul>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              disabled={!changed}
              loading={save.pending}
              onClick={() => value !== null && void save.run(value)}
            >
              Save
            </Button>
            {changed && (
              <Button variant="ghost" onClick={() => setValue(null)}>
                Undo
              </Button>
            )}
            {save.error && <span className="text-[13px] text-rv-red">{save.error}</span>}
            {done && !changed && <span className="text-[13px] text-rv-green">{done}</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Rule({ tone, children }: { tone: "green" | "amber" | "red"; children: string }) {
  return (
    <li className="flex items-center gap-2">
      <StatusDot tone={tone} />
      {children}
    </li>
  );
}

// ---------- Spending ----------

function SpendingSection() {
  const ex = useExecutions({ limit: 5000 }, { pollMs: 15000 });
  const spend = useMemo(() => spendSummary(ex.data?.executions ?? []), [ex.data]);
  return (
    <Panel title="Spending" subtitle="From real case runs">
      {ex.error && !ex.data ? (
        <ErrorState compact error={ex.error} onRetry={ex.reload} />
      ) : ex.loading ? (
        <Skeleton className="h-14" />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat value={money(spend.todayUsd)} label={`Today · ${formatCount(spend.todayRuns)} case runs`} />
          <Stat value={money(spend.avgUsd)} label="Average per case" />
        </div>
      )}
    </Panel>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="tabular text-2xl font-semibold text-white/90">{value}</div>
      <div className="text-[12px] text-white/50">{label}</div>
    </div>
  );
}

// ---------- Connections ----------

function ConnectionsSection() {
  const info = useApi<SettingsInfo>("/api/console/settings", { pollMs: 10000 });
  const d = info.data;
  return (
    <Panel title="Connections">
      {info.error && !d ? (
        <ErrorState compact error={info.error} onRetry={info.reload} />
      ) : !d ? (
        <Skeleton className="h-16" />
      ) : (
        <ul className="flex flex-col gap-2.5 text-[13px]">
          <Light label="Agent" on={d.agent} yes="Live" no="Offline" />
          <Light label="Voice" on={d.voice} yes="Ready" no="Not available" />
          <Light label="Second opinions" on={d.secondOpinions} yes="On" no="Off" />
        </ul>
      )}
    </Panel>
  );
}

function Light({ label, on, yes, no }: { label: string; on: boolean; yes: string; no: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-36 text-white/75">{label}</span>
      <StatusDot tone={on ? "green" : "neutral"} />
      <span className={cx(on ? "text-white/85" : "text-white/45")}>{on ? yes : no}</span>
    </li>
  );
}

// ---------- Data ----------

function DataSection() {
  const status = useStatus({ pollMs: 0 });
  const ex = useExecutions({ limit: 5000 });
  const imp = useAction(consoleApi.importRuns);
  const [note, setNote] = useState<string | null>(null);
  const sets = useMemo(() => caseSetCounts(status.data?.counts, ex.data?.executions), [status.data, ex.data]);

  const runImport = async () => {
    setNote(null);
    const r = await imp.run();
    if (!r) return;
    setNote(r.imported === 1 ? "1 new result added." : `${formatCount(r.imported)} new results added.`);
    status.reload();
    ex.reload();
  };

  return (
    <Panel
      title="Data"
      actions={
        <Button size="sm" icon={<IconImport size={14} />} loading={imp.pending} onClick={() => void runImport()}>
          Import new results
        </Button>
      }
    >
      {(note || imp.error) && (
        <p className={cx("mb-3 text-[13px]", imp.error ? "text-rv-red" : "text-rv-green")}>{imp.error ?? note}</p>
      )}
      {status.error && !status.data ? (
        <ErrorState compact error={status.error} onRetry={status.reload} />
      ) : status.loading ? (
        <Skeleton className="h-20" />
      ) : sets.length === 0 ? (
        <p className="text-[13px] text-white/55">No cases yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-white/45">
              <th className="pb-2 font-medium">Case set</th>
              <th className="pb-2 text-right font-medium">Cases</th>
              <th className="pb-2 text-right font-medium">Case runs</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.dataset} className="border-t border-white/[0.06]">
                <td className="py-1.5 text-white/80">{s.label}</td>
                <td className="tabular py-1.5 text-right text-white/80">{formatCount(s.cases)}</td>
                <td className="tabular py-1.5 text-right text-white/55">{formatCount(s.runs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------- About ----------

function AboutSection() {
  const { navigate } = useConsole();
  const info = useApi<SettingsInfo>("/api/console/settings");
  return (
    <Panel title="About">
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="text-white/75">
          Hamyway City {pkg.version}
          {info.data?.commit && <span className="ml-2 text-[12px] text-white/40">build {info.data.commit}</span>}
        </div>
        <div className="flex gap-4">
          <a href={README_URL} target="_blank" rel="noreferrer" className="text-rv-orange hover:underline">
            Read me
          </a>
          <button type="button" onClick={() => navigate("reality")} className="text-rv-orange hover:underline">
            Reality Test
          </button>
        </div>
      </div>
    </Panel>
  );
}
