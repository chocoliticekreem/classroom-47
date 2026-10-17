"use client";
// HUD scenario launcher: every case set from the server (set dropdown, search, 50 at a time + More),
// coverage meter, modifier chips, Run. Non-public cases are staged as a generic scene (genericScenario.ts).
// Also the cinematic-tour badge (reads CameraRig's cameraRigStatus).
import { memo, useEffect, useRef, useState } from "react";
import { emit, on } from "../../bus";
import { cleanTitle } from "../../genericScenario";
import { MODIFIERS, SCENARIOS, type Modifier } from "../../scenarios";
import { cameraRigStatus } from "../CameraRig/director";
import { AutoCasesToggle } from "./autoCases";
import { fetchPage, prepareCase, useCatalogueTotal, type PickerCase, type PickerPage } from "./catalogueClient";
import { GLASS } from "./parts";

const MOD_KEYS = Object.keys(MODIFIERS) as Modifier[];

export interface Coverage {
  cases: number;
  mods: number;
}

/** Tally of distinct scenarios and modifiers staged so far (from scenario:staged events). */
export function useScenarioCoverage(): Coverage {
  const [cov, setCov] = useState(() => ({
    cases: new Set<string>(),
    mods: new Set<Modifier>(),
  }));
  useEffect(
    () =>
      on((e) => {
        if (e.type !== "scenario:staged") return;
        setCov((c) => {
          const fresh = !c.cases.has(e.scenarioId) || e.modifiers.some((m) => !c.mods.has(m));
          if (!fresh) return c;
          return {
            cases: new Set(c.cases).add(e.scenarioId),
            mods: new Set([...c.mods, ...e.modifiers]),
          };
        });
      }),
    [],
  );
  return { cases: cov.cases.size, mods: cov.mods.size };
}

function Meter({ n, total, color }: { n: number; total: number; color: string }) {
  return (
    <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-white/10">
      <span className="block h-full transition-[width] duration-500" style={{ width: `${(n / total) * 100}%`, background: color }} />
    </span>
  );
}

export function ScenarioButton({ open, onToggle, cov }: { open: boolean; onToggle: () => void; cov: Coverage }) {
  const total = useCatalogueTotal();
  return (
    <>
      <AutoCasesToggle />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={`Pick a practice case to run. ${cov.cases} of ${fmt(total)} played.`}
        className={`flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition ${
          open
            ? "border-[#ff6a1a]/70 bg-[#ff6a1a]/15 text-white"
            : "border-white/10 bg-white/[0.04] text-white/85 hover:border-[#ff6a1a]/60 hover:bg-[#ff6a1a]/10 hover:text-white"
        }`}
      >
        Practice cases
        <span className="rounded bg-black/30 px-1 text-[10px] tabular-nums text-white/60">
          {cov.cases} / {fmt(total)}
        </span>
      </button>
    </>
  );
}

const fmt = (n: number) => n.toLocaleString("en-GB");

/** Coverage strip in the scenario panel ("cases played", PRD J4: not "covered", which reads like an eval). */
function CoverageStrip({ cov, total }: { cov: Coverage; total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.07] px-3 py-1.5 text-[10px] tabular-nums text-white/55">
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <Meter n={cov.cases} total={Math.max(1, total)} color="#ff6a1a" />
        {cov.cases} of {fmt(total)} played
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <Meter n={cov.mods} total={MOD_KEYS.length} color="#2dd4bf" />
        {cov.mods} of {MOD_KEYS.length} twists tried
      </span>
    </div>
  );
}

const SELECT =
  "min-w-0 rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-white focus:border-[#ff6a1a]/60 focus:outline-none";

export const ScenarioPanel = memo(function ScenarioPanel({ onClose, cov }: { onClose: () => void; cov: Coverage }) {
  const [set, setSet] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<PickerPage | null>(null);
  const [rows, setRows] = useState<PickerCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickerCase | null>(null);
  const [starting, setStarting] = useState(false);
  const [mods, setMods] = useState<Modifier[]>([]);
  const reqSeq = useRef(0);
  const toggle = (m: Modifier) => setMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  // First page whenever the set or the search changes (search debounced).
  useEffect(() => {
    const seq = ++reqSeq.current;
    const t = setTimeout(
      () => {
        setLoading(true);
        fetchPage(set, q, 0)
          .then((p) => {
            if (seq !== reqSeq.current) return;
            setPage(p);
            setRows(p.cases);
            setError(null);
          })
          .catch(() => seq === reqSeq.current && setError("Couldn't load the cases."))
          .finally(() => seq === reqSeq.current && setLoading(false));
      },
      q ? 200 : 0,
    );
    return () => clearTimeout(t);
  }, [set, q]);

  const more = () => {
    const seq = reqSeq.current;
    setLoading(true);
    fetchPage(set, q, rows.length)
      .then((p) => {
        if (seq !== reqSeq.current) return;
        setPage(p);
        setRows((cur) => [...cur, ...p.cases]);
      })
      .catch(() => setError("Couldn't load more cases."))
      .finally(() => setLoading(false));
  };

  const run = async (c: PickerCase | null = picked) => {
    if (!c || starting) return;
    setStarting(true);
    try {
      const scenarioId = await prepareCase(c);
      emit({ type: "request:scenario", scenarioId, modifiers: mods });
      setError(null);
    } catch {
      setError(`Couldn't load ${c.id}.`);
    } finally {
      setStarting(false);
    }
  };

  const total = page?.total ?? SCENARIOS.length;
  const setLabel = new Map(page?.sets.map((s) => [s.id, s.label]) ?? []);
  const datasetLabel = (d: string) => setLabel.get(d === "grounded" ? "generated" : d) ?? d;

  return (
    <aside className={`${GLASS} hud-panel flex max-h-full w-full flex-col overflow-hidden`}>
      <header className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-white">Practice cases</h2>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </header>
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-3 py-1.5">
        <select value={set} onChange={(e) => setSet(e.target.value)} aria-label="Case set" className={`${SELECT} shrink-0`}>
          <option value="all">All sets ({fmt(total)})</option>
          {page?.sets.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.count}>
              {s.label} ({fmt(s.count)})
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${SELECT} flex-1 placeholder:text-white/35`} />
      </div>
      <CoverageStrip cov={cov} total={total} />

      <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && <div className="px-2 pb-2 text-[11px] text-red-300/85">{error}</div>}
        {page && !rows.length && !loading && (
          <div className="px-2 py-3 text-center text-[11px] text-white/40">{q ? `No case matches “${q}”.` : "No cases in this set yet."}</div>
        )}
        <ul>
          {rows.map((c) => (
            <li key={`${c.dataset}:${c.id}`}>
              <button
                type="button"
                onClick={() => setPicked(c)}
                onDoubleClick={() => void run(c)}
                title={`${c.id} · ${datasetLabel(c.dataset)}`}
                className={`flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left transition ${
                  picked?.id === c.id && picked.dataset === c.dataset ? "bg-[#ff6a1a]/20 text-white" : "text-white/75 hover:bg-white/[0.05]"
                }`}
              >
                <span className="w-[68px] shrink-0 truncate text-[10px] text-white/35">{c.id.replace("delivery-", "#")}</span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{cleanTitle(c.title, c.id)}</span>
                {set === "all" && <span className="shrink-0 text-[9px] text-white/30">{datasetLabel(c.dataset)}</span>}
              </button>
            </li>
          ))}
        </ul>
        {page && rows.length < page.matched && (
          <button
            type="button"
            onClick={more}
            disabled={loading}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] py-1 text-[11px] text-white/70 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : `More (${fmt(rows.length)} of ${fmt(page.matched)})`}
          </button>
        )}
        {!page && loading && <div className="px-2 py-3 text-center text-[11px] text-white/40">Loading…</div>}
      </div>

      <footer className="border-t border-white/[0.07] px-3 py-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {MOD_KEYS.map((m) => {
            const onIt = mods.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggle(m)}
                title={MODIFIERS[m].label}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                  onIt ? "border-teal-300/70 bg-teal-400/20 text-teal-100" : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
                }`}
              >
                {MODIFIERS[m].label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!picked || starting}
          onClick={() => void run()}
          className="flex w-full items-center justify-center gap-2 truncate rounded-lg bg-[#ff6a1a] px-3 py-2 text-[13px] font-semibold text-black transition hover:bg-[#ff7d38] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
        >
          {starting
            ? "Loading the case…"
            : picked
              ? `Run this case${mods.length ? ` with ${mods.length} twist${mods.length > 1 ? "s" : ""}` : ""}`
              : "Pick a case"}
        </button>
      </footer>
    </aside>
  );
});

/** Small pill shown while CameraRig's cinematic tour is on (polls the plain status object). */
export function TourBadge() {
  const [tour, setTour] = useState(cameraRigStatus.tour);
  useEffect(() => {
    const id = setInterval(() => setTour(cameraRigStatus.tour), 300);
    return () => clearInterval(id);
  }, []);
  if (!tour) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-sky-200">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
      Tour
    </span>
  );
}
