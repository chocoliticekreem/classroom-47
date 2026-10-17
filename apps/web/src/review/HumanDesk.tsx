"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState } from "react";
import { decisionRerunBody, type DecisionRerunBody } from "../console/decisionRerun";
import { useDecisionRerun } from "../console/useDecisionRerun";
import { IconCheck, ProvenanceBadge } from "../console/ui";
import { ShowOnPlaybook } from "../console/ShowOnPlaybook";
import { cents, plainOwner, plainStep, riskWord, scrubLeaks } from "../ui/plain";
import { shortLine, sortTasks } from "./model";
import RerunStatus from "./RerunStatus";
import type { ReviewTask } from "./types";
import { useReviewQueue } from "./useReviewQueue";
import { taskCard } from "./voice";
import "./review.css";

// The voice call uses the microphone and WebRTC, so it only loads in the browser.
const ApproveByVoice = dynamic(() => import("../voice/ApproveByVoice").then((m) => m.ApproveByVoice), { ssr: false, loading: () => null });

type Source = "agent" | "simulation";
type Filter = "pending" | "decisions" | "all";

const MESSAGE_STATUS: Record<string, string> = { outbox_recorded: "Sent", proposed: "Planned", held: "Held", blocked: "Stopped", sent: "Sent" };

// ---------------------------------------------------------------- handover words (pure, tested)

export type ClockTone = "late" | "soon" | "ok" | "done";

/** The live countdown to the deadline: "12:04 left", "1 h 5 min left", "3 min late", or "Decided". */
export function countdown(task: Pick<ReviewTask, "status" | "deadlineAt">, now: number): { text: string; tone: ClockTone } {
  if (task.status !== "pending") return { text: task.status === "resolved" ? "Done in the city" : "Decided", tone: "done" };
  const ms = Date.parse(task.deadlineAt) - now;
  if (!Number.isFinite(ms)) return { text: "No deadline", tone: "ok" };
  if (ms <= 0) {
    const m = Math.max(1, Math.round(-ms / 60_000));
    return { text: m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min late` : `${m} min late`, tone: "late" };
  }
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return { text: h ? `${h} h ${m} min left` : `${m}:${String(sec).padStart(2, "0")} left`, tone: ms < 10 * 60_000 ? "soon" : "ok" };
}

/** A readable name for the case: the title, or the summary's first words when the title is only an id. */
export function headline(task: Pick<ReviewTask, "title" | "caseId" | "summary" | "mustDecide">): string {
  const title = scrubLeaks(task.title).replace(/^case:\s*/i, "");
  if (title && title !== task.caseId && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(title)) return title;
  return shortLine(task.summary, 10) || shortLine(task.mustDecide, 10) || task.caseId;
}

/** One line of "What we already did": "Messaged Calla Mossop (Customer portal)" plus why, when known. */
export function doneLine(item: string): { main: string; why: string } {
  const clean = scrubLeaks(item);
  const m = clean.match(/^Message (?:recorded|sent|queued) (?:for|to) (.+?) via (.+?):\s*(.*)$/i);
  if (m) return { main: `Messaged ${m[1]} (${m[2]})`, why: shortLine(m[3], 12) };
  return { main: shortLine(clean, 16), why: "" };
}

/** "What we don't know": the clash, claims nobody has checked, and what would settle it (max 3). */
export function unknowns(task: Pick<ReviewTask, "clash" | "evidence" | "wouldChangeMyMind">): string[] {
  const out: string[] = [];
  const clash = shortLine(task.clash, 16);
  if (clash) out.push(`The stories don't match. ${clash}`);
  for (const e of task.evidence.filter((x) => x.basis === "unverified_claim").slice(0, 2)) {
    const says = shortLine(e.says, 12);
    if (says) out.push(`${scrubLeaks(e.who) || "Someone"} says: "${says}" Not checked yet.`);
  }
  const settle = shortLine(task.wouldChangeMyMind, 16);
  if (settle) out.push(`What would settle it: ${settle.charAt(0).toLowerCase()}${settle.slice(1)}`);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- pieces

function Clock({ task, now, big = false }: { task: ReviewTask; now: number; big?: boolean }) {
  const { text, tone } = countdown(task, now);
  return <span className={`review-clock ${tone}${big ? " big" : ""}`}>{text}</span>;
}

function byTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function CaseDetail({ task, now, onDecide }: {
  task: ReviewTask; now: number; onDecide: (task: ReviewTask, optionId: string, who: string, note: string) => Promise<ReviewTask | null>;
}) {
  const [selected, setSelected] = useState("");
  const [who, setWho] = useState(() => {
    try { return localStorage.getItem("rivet-reviewer") ?? ""; } catch { return ""; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // After a live card is saved, the case is run again by the agent with this choice (send once).
  const rerun = useDecisionRerun();
  const rerunBody = useRef<DecisionRerunBody | null>(null);
  const option = task.options.find((o) => o.id === selected);
  const readonly = task.mode === "reality";
  const canDecide = task.status === "pending" && !readonly;
  const late = countdown(task, now).tone === "late";
  const owner = plainOwner(task.routeTo);
  const why = shortLine(task.mustDecide, 40) || "Choose what happens next.";
  const situation = shortLine(task.summary, 45);
  const done = task.tried.map(doneLine).filter((d) => d.main);
  const unknown = unknowns(task);
  const fallback = shortLine(task.fallback, 20);
  const deadline = byTime(task.deadlineAt);
  const steps = task.timeline.map((s) => plainStep(s.node, s.summary)).filter((s): s is string => Boolean(s));
  const risk = riskWord(task.risk);
  const cost = cents(task.costUsd);
  const chosen = task.decision ? task.options.find((o) => o.id === task.decision?.optionId) : undefined;
  async function save(optionId: string, name: string, noteText: string, by: "tap" | "voice" = "tap") {
    const picked = task.options.find((o) => o.id === optionId);
    setSaving(true); setError(null);
    try {
      const saved = await onDecide(task, optionId, name, noteText);
      try { localStorage.setItem("rivet-reviewer", name); } catch { /* approval still succeeds */ }
      setSuccess(true);
      const executionId = saved?.executionId ?? task.executionId;
      if (saved && executionId) {
        const body = decisionRerunBody({ parentExecutionId: executionId, option: picked, person: name });
        rerunBody.current = { ...body, humanDecision: { ...body.humanDecision, by } };
        void rerun.run(rerunBody.current, picked);
      }
    } catch (e) { setError(scrubLeaks(e instanceof Error ? e.message : "") || "Your decision wasn't saved. Try again."); }
    finally { setSaving(false); }
  }
  const retry = () => { if (rerunBody.current) void rerun.run(rerunBody.current); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!option || !who.trim() || saving) return;
    await save(option.id, who.trim(), "");
  }
  return (
    <article className="review-detail" aria-label="A person needs to decide">
      <header className="review-case-heading">
        <div className="review-caption">
          <ProvenanceBadge simulated={task.simulated} />
          <ShowOnPlaybook executionId={rerun.state.phase === "done" ? rerun.state.execution.id : task.executionId} className="ml-auto" />
        </div>
        <h2>{headline(task)}</h2>
        <div className="review-case-meta">
          <span>Needs <strong>{owner}</strong></span>
          <span className="review-meta-clock">{task.status === "pending" && deadline && <span>Decide by {deadline}</span>}<Clock task={task} now={now} big /></span>
        </div>
      </header>

      <section className="review-handover" aria-label="Handover">
        {situation && <div className="review-why">
          <div className="review-label">What happened</div>
          <p>{situation}</p>
        </div>}
        <div className="review-why" style={situation ? { marginTop: 18 } : undefined}>
          <div className="review-label">Why it needs you</div>
          <p>{why}</p>
        </div>
        {task.status === "pending" && fallback && <p className={`review-fallback ${late ? "late" : ""}`}><strong>{late ? "This is late." : "If nobody decides:"}</strong> {late && "If nobody decides: "}{fallback}</p>}
      </section>

      {task.decision ? (
        <section className="review-confirmation" role="status">
          <div className="review-done-head">
            <span className="review-done-check"><IconCheck size={22} /></span>
            <div>
              <div className="review-label">{task.decision.execution === "simulation" ? "Done in the city" : "Decision saved"}</div>
              <h3>{task.decision.optionLabel}</h3>
            </div>
          </div>
          <p>By {task.decision.who}{task.decision.note ? `: ${task.decision.note}` : ""}</p>
          {chosen?.effect && shortLine(chosen.effect, 30) && <p className="review-muted">{shortLine(chosen.effect, 30)}</p>}
          {task.decision.execution === "pending" && rerun.state.phase === "idle" && <p className="review-muted">{owner} will carry it out.</p>}
          <RerunStatus state={rerun.state} onRetry={retry} />
        </section>
      ) : (
        <form className="review-choice" onSubmit={submit}>
          <div className="review-label">Choose one</div>
          {readonly && <p className="review-readonly">Test day result. View only.</p>}
          <fieldset disabled={!canDecide || saving || success}>
            <legend className="sr-only">Choose what happens next</legend>
            {task.options.map((o, i) => {
              const effect = shortLine(o.effect, 28);
              return (
                <label key={o.id} className={`review-option ${selected === o.id ? "selected" : ""}`}>
                  <input type="radio" name={`decision-${task.id}`} value={o.id} checked={selected === o.id} onChange={() => setSelected(o.id)} />
                  <span className="review-option-key" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                  <span className="review-option-copy">
                    <strong>{o.label}</strong>
                    {effect && <span className="review-option-effect">{effect}</span>}
                    <small className={o.undoable ? "" : "warn"}>{o.undoable ? "Can be undone" : "Can't be undone"}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {canDecide && task.options.length > 0 && !success && (
            <div className="review-voice">
              <span>Or say it out loud</span>
              <ApproveByVoice
                card={taskCard(task, now)}
                caseId={task.caseId}
                managerName={who.trim() || "Desk manager"}
                onDecision={(d: { optionId: string; who: string; confirmation?: string }) => {
                  setSelected(d.optionId);
                  void save(d.optionId, who.trim() || d.who, d.confirmation ? `By voice: ${d.confirmation}` : "By voice", "voice");
                }}
              />
            </div>
          )}
          {!task.options.length && <p className="review-readonly">No choices here. Keep it on hold and ask {owner}.</p>}
          {canDecide && task.options.length > 0 && !success && <>
            <div className="review-inputs">
              <label>Your name<input value={who} onChange={(e) => setWho(e.target.value)} maxLength={120} autoComplete="name" placeholder="Your name" required disabled={saving} /></label>
            </div>
            <button className="review-primary" disabled={!option || !who.trim() || saving} type="submit">{saving ? "Saving…" : !option ? "Pick one above" : !who.trim() ? "Add your name" : task.origin === "city" ? `Do it in the city: ${option.label}` : `Go with: ${option.label}`}</button>
          </>}
          {error && <p className="review-error" role="alert">{error}</p>}
          {success && !task.decision && <p className="review-saving" role="status">Saved. Updating…</p>}
          {!task.decision && <RerunStatus state={rerun.state} onRetry={retry} />}
        </form>
      )}

      <details className="review-more">
        <summary>Details</summary>
        <div className="review-more-body">
          <section><h4>What we already did</h4>
            {done.length ? <ul className="review-done-list">{done.map((d, i) => <li key={i}><span className="review-tick" aria-hidden="true">✓</span><span>{d.main}{d.why && <small>{d.why}</small>}</span></li>)}</ul>
              : <p className="review-muted">Nothing sent yet. All on hold.</p>}
          </section>
          {unknown.length > 0 && <section><h4>What we don&apos;t know</h4>
            <ul className="review-unknown-list">{unknown.map((u, i) => <li key={i}><span className="review-q" aria-hidden="true">?</span><span>{u}</span></li>)}</ul>
          </section>}
          {task.evidence.length > 0 && <section><h4>What people said</h4><ul>{task.evidence.map((e, i) => <li key={i}><strong>{scrubLeaks(e.who)}:</strong> {scrubLeaks(e.says)}</li>)}</ul></section>}
          {task.clash && <section><h4>The stories don&apos;t match</h4><p>{scrubLeaks(task.clash)}</p></section>}
          {scrubLeaks(task.wouldChangeMyMind) && <section><h4>What would settle it</h4><p>{scrubLeaks(task.wouldChangeMyMind)}</p></section>}
          <section><h4>If nobody decides</h4><p>{scrubLeaks(task.fallback)}</p></section>
          {task.messages.length > 0 && <section><h4>Messages</h4>{task.messages.map((m, i) => <div key={i} className="review-message"><div className="review-caption"><span>To {scrubLeaks(m.from) || "someone"}{m.channel ? ` · ${scrubLeaks(m.channel)}` : ""}</span>{m.status && <span>{MESSAGE_STATUS[m.status] ?? scrubLeaks(m.status)}</span>}</div><p>{m.body}</p></div>)}</section>}
          {steps.length > 0 && <section><h4>Steps</h4><ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol></section>}
          {(risk || cost || task.durationMs !== null) && <p className="review-caption">{[risk && `Risk: ${risk}`, cost, task.durationMs !== null && `${(task.durationMs / 1000).toFixed(1)}s`].filter(Boolean).join(" · ")}</p>}
        </div>
      </details>
    </article>
  );
}

function AllClear({ decided, onShowDecided }: { decided: number; onShowDecided?: () => void }) {
  return (
    <div className="review-all-clear" role="status">
      <span className="review-all-clear-mark"><IconCheck size={26} /></span>
      <h2>Nothing needs you right now</h2>
      <p>When the agent stops on a case, it shows up here.</p>
      {decided > 0 && onShowDecided && <button type="button" onClick={onShowDecided}>See {decided} decided</button>}
    </div>
  );
}

export default function HumanDesk({ embedded = false, onClose, initialTaskId = "", initialSource = "agent" }: {
  embedded?: boolean; onClose?: () => void; initialTaskId?: string; initialSource?: Source;
}) {
  const { tasks, warnings, loading, error, now, refresh, decide } = useReviewQueue();
  const [source, setSource] = useState<Source>(initialSource);
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialTaskId);
  const detailRef = useRef<HTMLDivElement>(null);
  const sourceTasks = sortTasks(tasks.filter((t) => source === "simulation" ? t.simulated : !t.simulated));
  const pending = sourceTasks.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => now > Date.parse(t.deadlineAt)).length;
  const shown = sourceTasks.filter((t) =>
    (filter === "all" || (filter === "pending" ? t.status === "pending" : t.status !== "pending")) &&
    `${t.title} ${t.caseId} ${t.summary} ${t.routeTo} ${plainOwner(t.routeTo)}`.toLowerCase().includes(search.toLowerCase()));
  const selected = shown.find((t) => t.id === selectedId || t.caseId === selectedId) ?? shown[0];
  const allClear = filter === "pending" && !search && !pending.length;
  function selectTask(task: ReviewTask) {
    setSelectedId(task.id);
    if (window.matchMedia("(max-width: 760px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    if (!embedded) {
      const url = new URL(window.location.href);
      url.searchParams.set("case", task.id); url.searchParams.set("source", source);
      window.history.replaceState(null, "", url);
    }
  }
  async function apply(task: ReviewTask, option: string, who: string, note: string) {
    const saved = await decide(task, option, who, note);
    setFilter("decisions"); setSelectedId(task.id);
    return saved;
  }
  const showDecided = () => { setFilter("decisions"); setSelectedId(""); };
  return (
    <div className={`review-desk ${embedded ? "review-embedded" : ""}`}>
      {!embedded && <header className="review-topbar">
        <Link href="/" className="review-brand" aria-label="Hamyway City home"><span className="review-brand-mark">H</span>Hamyway City</Link>
        <nav aria-label="Pages"><Link href="/?tab=workflows" onClick={onClose}>Playbooks</Link><Link href="/city">City</Link><span aria-current="page">Decisions</span></nav>
        {onClose && <button onClick={onClose} className="review-close" aria-label="Close decisions">×</button>}
      </header>}
      <div className="review-page-heading">
        <div>
          <h1>Decisions</h1>
          <p>{pending.length ? <><strong>{pending.length}</strong> {pending.length === 1 ? "case needs" : "cases need"} a person{overdue > 0 && <span className="review-late-count"> · {overdue} late</span>}</> : "Nothing is waiting for a person."}</p>
        </div>
        <div className="review-heading-actions">
          <div className="review-source-switch" aria-label="Which cases">{(["agent", "simulation"] as const).map((value) => <button key={value} className={source === value ? "active" : ""} aria-pressed={source === value} onClick={() => { setSource(value); setSelectedId(""); }}>{value === "agent" ? "Live" : "Practice cases"}</button>)}</div>
          {embedded && onClose && <button onClick={onClose} className="review-close" aria-label="Close decisions">×</button>}
        </div>
      </div>
      {source === "simulation" && <p className="review-note">Practice cases come from the city. Keep the city open.</p>}
      {error && <div className="review-error-banner" role="alert">{scrubLeaks(error) || "Couldn't load the cases."}<button type="button" onClick={() => void refresh()}>Try again</button></div>}
      {warnings.length > 0 && <p className="review-note">Some cases couldn&apos;t load.</p>}
      <div className="review-layout">
        <aside className="review-queue" aria-label="Cases">
          <div className="review-filters" aria-label="Show">
            {(["pending", "decisions", "all"] as const).map((value) => <button key={value} onClick={() => { setFilter(value); setSelectedId(""); }} aria-pressed={filter === value} className={filter === value ? "active" : ""}>{value === "pending" ? <>Waiting{pending.length > 0 && <span className="review-count">{pending.length}</span>}</> : value === "decisions" ? "Decided" : "All"}</button>)}
            <button className="review-refresh" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">↻</button>
          </div>
          {sourceTasks.length > 8 && <label className="review-search"><span className="sr-only">Search cases</span><input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>}
          <div className="review-case-list">
            {loading && !tasks.length ? <div className="review-empty" role="status">Loading…</div> : shown.length ? shown.map((task) => {
              const urgent = task.status === "pending" ? task.urgency : "done";
              return <button key={task.id} className={`review-case-row u-${urgent} ${selected?.id === task.id ? "selected" : ""}`} onClick={() => selectTask(task)} aria-pressed={selected?.id === task.id}>
                <div className="review-row-top"><h3>{headline(task)}</h3>{task.urgency === "high" && task.status === "pending" && <span className="review-priority">Urgent</span>}</div>
                <div className="review-row-footer"><span>Needs {plainOwner(task.routeTo)}</span><Clock task={task} now={now} /></div>
              </button>;
            }) : <div className="review-empty"><h3>{search ? "No matches" : filter === "pending" ? "Nothing needs you right now" : "No decisions yet"}</h3>{allClear && source === "simulation" && <Link href="/city" target="_blank">Open the city</Link>}</div>}
          </div>
        </aside>
        <div className="review-detail-wrap" ref={detailRef}>{selected ? <CaseDetail key={selected.id} task={selected} now={now} onDecide={apply} />
          : loading && !tasks.length ? <div className="review-detail-empty" role="status">Loading…</div>
          : !pending.length ? <AllClear decided={sourceTasks.length - pending.length} onShowDecided={filter === "pending" ? showDecided : undefined} />
          : <div className="review-detail-empty"><h2>{search ? "No matches" : "No decisions yet"}</h2><p>Pick a case on the left.</p></div>}</div>
      </div>
    </div>
  );
}
