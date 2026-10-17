"use client";
// Voice mount slots for the Executions tab (PRD I3, I5; voice plan Task 6 "for Arvin's mount slots").
//
// The voice layer ships its components in apps/web/src/voice/<Name>.tsx (named or default export) and
// wires each with one line in ./voiceComponents.ts:
//   VoiceNoteButton  { caseId, from, onEvent(e: ViewEvent) }
//   CallDrawer       { request: SessionRequest, state: CallState, simulated, onDone({ events, decision? }) }
//   ApproveByVoice   { card: DecisionCard, caseId, onDecision(d: HumanDecision) }
// Each slot loads its component with a dynamic import on the client. Until it is wired (or if it fails
// or throws), the slot renders a disabled "Voice not connected" placeholder, so the console always builds.
//
// Slots:
//   <VoiceSlot.NoteButton execution onEvent />        case header: driver voice note
//   <VoiceSlot.CallDrawer execution row onDone />      an outbox row on a Call / Phone channel
//   <VoiceSlot.ApproveByVoice execution card onDecision />  an open decision card
//   <VoiceSlot.Mounts execution />                     the call and approve-by-voice cards, wired to POST /api/console/execute re-runs
//   <VoiceSlot.Ring execution />                       with Take calls on: the incoming call when a run just decided to phone someone
//   <VoiceSlot.LiveCallsSwitch />                      the "📞 Take calls" switch (off: fully automatic, calls are only recorded)
// A run with no call and no open decision shows no voice at all (voiceNeeded).
// Driver voice notes come in on New case as attached recordings, not as a box on every run.
import { Component, Suspense, createElement, use, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { CaseViewEvent, ConsoleApi, DecisionCard, ExecuteRequest, ExecutionRecord, HumanDecision, OutboxEntry } from "../types";
import { useConsoleNav } from "./nav";
import { VOICE_LOADERS, registeredVoiceComponent } from "./voiceComponents";
import { Badge, getJson } from "./ui";
import { liveCallsOn, setLiveCalls, subscribeLiveCalls } from "../../voice/liveCalls";
import {
  approvalRerun, callableRows, childRun, callRequest, callRerun, callStateSeed, cardOpen, noAnswerRerun, noteCaseText, partyRole, type VoiceComponentName,
  driverCallMessage, driverCallRequest, driverCallState,
} from "./voiceSlots";

// The voice components' props are owned by the voice layer; the slots pass the documented shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

const loaded = new Map<VoiceComponentName, Promise<AnyComponent | null>>();

const asComponent = (c: unknown): AnyComponent | null =>
  typeof c === "function" || (typeof c === "object" && c !== null) ? (c as AnyComponent) : null;

/** Resolves to the voice component, or null when it is not wired in voiceComponents.ts or fails to load. */
export function loadVoiceComponent(name: VoiceComponentName): Promise<AnyComponent | null> {
  const direct = asComponent(registeredVoiceComponent(name));
  if (direct) return Promise.resolve(direct);
  let p = loaded.get(name);
  if (!p) {
    const loader = VOICE_LOADERS[name];
    p = loader
      ? loader().then((m) => asComponent(m[name] ?? m.default)).catch(() => null)
      : Promise.resolve(null);
    loaded.set(name, p);
  }
  return p;
}

const noopSubscribe = () => () => {};
/** True only after hydration: voice components touch the microphone and WebRTC, so never render them on the server. */
function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Disabled stand-in shown until the voice layer is installed. */
export function VoiceNotConnected({ label, reason }: { label: string; reason?: string }) {
  return (
    <button
      type="button"
      disabled
      title={reason ?? "Voice not connected: the voice layer (apps/web/src/voice) is not installed yet."}
      className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-md bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/35 ring-1 ring-inset ring-white/10"
    >
      <MicIcon />
      {label}
      <span className="text-white/25">· Voice not connected</span>
    </button>
  );
}

class SlotBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <VoiceNotConnected label={this.props.label} reason="The voice component failed to render." /> : this.props.children;
  }
}

function Loaded({ name, label, props }: { name: VoiceComponentName; label: string; props: Record<string, unknown> }) {
  // The promise is cached per name, so the component identity is stable across renders.
  const C = use(loadVoiceComponent(name));
  return C ? createElement(C, props) : <VoiceNotConnected label={label} />;
}

/** Shown while the voice component loads (it is fetched on first use). */
function VoiceLoading({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] text-white/40 ring-1 ring-inset ring-white/10">
      <MicIcon />
      {label} · loading…
    </span>
  );
}

/** Renders the named voice component if present, else the placeholder. */
function Slot({ name, label, props }: { name: VoiceComponentName; label: string; props: Record<string, unknown> }) {
  const client = useIsClient();
  const placeholder = <VoiceLoading label={label} />;
  if (!client) return placeholder;
  return (
    <SlotBoundary label={label}>
      <Suspense fallback={placeholder}>
        <Loaded name={name} label={label} props={props} />
      </Suspense>
    </SlotBoundary>
  );
}

function NoteButton({ execution, from = "Driver", onEvent }: { execution: ExecutionRecord; from?: string; onEvent: (e: CaseViewEvent) => void }) {
  return (
    <Slot
      name="VoiceNoteButton"
      label="Voice note"
      props={{ caseId: execution.caseId, caseText: noteCaseText(execution), from, recordLabel: `🎙 Record as the ${from.toLowerCase()}`, onEvent }}
    />
  );
}

function CallDrawer({
  execution, row, simulated = false, label, onDone,
}: {
  execution: ExecutionRecord;
  row: OutboxEntry;
  simulated?: boolean;
  label?: string;
  onDone: (r: { events: CaseViewEvent[]; decision?: HumanDecision; callId?: string }) => void;
}) {
  return (
    <Slot
      name="CallDrawer"
      label={`Call ${row.action.recipient}`}
      props={{ request: callRequest(execution, row), state: callStateSeed(execution, row.action.recipient, simulated), simulated, label: label ?? `Start call as ${row.action.recipient}`, onDone }}
    />
  );
}

function ApproveByVoice({ execution, card, onDecision }: { execution: ExecutionRecord; card: DecisionCard; onDecision: (d: HumanDecision) => void }) {
  return <Slot name="ApproveByVoice" label="Approve by voice" props={{ card, caseId: execution.caseId, onDecision }} />;
}

/** Re-runs the case with what a voice moment produced, then opens the new run. */
function useVoiceRerun() {
  const { go } = useConsoleNav();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rerun = async (what: string, body: ExecuteRequest) => {
    setBusy(what);
    setError(null);
    const since = Date.now();
    let opened = false;
    const open = (id: string) => {
      if (opened) return;
      opened = true;
      go("executions", { id }, true);
    };
    // Open the new run as soon as it exists: its steps show live while the agent works on what was
    // said, then "Watch it think" plays it back. The POST below only answers once the run is done.
    const poll = setInterval(() => {
      getJson<ConsoleApi["GET /api/console/executions?limit&dataset"]>("/api/console/executions?limit=10")
        .then((list) => {
          const child = childRun(list.executions, body.parentExecutionId, since);
          if (child) open(child.id);
        })
        .catch(() => {});
    }, 1_000);
    try {
      const r = await getJson<ConsoleApi["POST /api/console/execute"]>("/api/console/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      open(r.execution.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearInterval(poll);
      setBusy(null);
    }
  };

  return { go, busy, error, rerun };
}

/** The "📞 Take calls" setting, remembered on this browser. */
export function useLiveCalls(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribeLiveCalls, liveCallsOn, () => false), setLiveCalls];
}

/** "📞 Take calls": when on, a run that decides to phone someone pops the call up for you to take. */
function LiveCallsSwitch() {
  const [on, set] = useLiveCalls();
  return (
    <label
      className="inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-white/65"
      title="On: when a run decides to phone someone, the call pops up for you to take, as that person. Off: fully automatic; the call is only recorded, as in the scored Reality Test."
    >
      <input type="checkbox" checked={on} onChange={(ev) => set(ev.target.checked)} className="accent-[#ff6a1a]" />
      📞 Take calls
    </label>
  );
}

/** The incoming call when Take calls is on and the run just decided to phone someone. Take it and the
 * case re-runs with what was said; don't, and it re-runs knowing nobody answered. */
function Ring({ execution }: { execution: ExecutionRecord }) {
  const [live] = useLiveCalls();
  const { busy, error, rerun } = useVoiceRerun();
  const row = callableRows(execution.outbox)[0];
  if (!live || !row) return null;
  const who = row.action.recipient;
  const role = partyRole(who, execution);
  return (
    <section className="rounded-xl border border-[#ff6a1a]/50 bg-[#ff6a1a]/10 p-4" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold text-white">📞 Hamyway City is calling {who}{role ? `, the ${role}` : ""}</div>
          {row.action.purpose && <p className="mt-1 text-[14px] text-white/70">Why: {row.action.purpose}</p>}
          <p className="mt-1 text-[14px] text-white/70">Take it and you answer as {who}; when you hang up, the case runs again with what was said. Don&apos;t take it and the case runs again knowing nobody answered.</p>
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void rerun("missed call", noAnswerRerun(execution, row))}
          className="shrink-0 rounded-md border border-white/20 px-3 py-1 text-[13px] text-white/75 hover:text-white disabled:opacity-50"
          title="Nobody answers: the case runs again and the agent picks another way."
        >
          Don&apos;t take it
        </button>
      </div>
      <div className="mt-3">
        <CallDrawer execution={execution} row={row} label="Take call" onDone={(r) => rerun("call", callRerun(execution, r))} />
      </div>
      {busy && <p className="mt-2 text-[12px] text-[#ff6a1a]">Re-running the case with the {busy}…</p>}
      {error && <p className="mt-2 text-[12px] text-[#ff5c5c]">{error}</p>}
    </section>
  );
}

/** The voice cards under what the agent sent: each voice moment re-runs the case and opens the new run. */
function Mounts({ execution }: { execution: ExecutionRecord }) {
  const e = execution;
  const { go, busy, error, rerun } = useVoiceRerun();

  const calls = callableRows(e.outbox);
  const card = cardOpen(e.card) ? e.card : null;

  return (
    <div className="flex flex-col gap-3">
      {calls.map((row, i) => (
        <VoiceCard key={`${row.action.recipient}-${i}`} icon="📞" title={`The agent decided to phone ${row.action.recipient}${partyRole(row.action.recipient, e) ? `, the ${partyRole(row.action.recipient, e)}` : ""}`}>
          {row.action.purpose && <p>Why: {row.action.purpose}</p>}
          <p>You play {row.action.recipient}. Our AI desk agent calls you. Anything it promises is checked before it says it.</p>
          <CallDrawer execution={e} row={row} onDone={(r) => rerun("call", callRerun(e, r))} />
        </VoiceCard>
      ))}
      {card && (
        <VoiceCard icon="✅" title="A person must decide">
          <p>Say your choice out loud. The agent reads it back before it counts.</p>
          <ApproveByVoice execution={e} card={card} onDecision={(d) => rerun("approval", approvalRerun(e, d))} />
        </VoiceCard>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {e.voice && <Badge tone="info" title={e.voice.callId ? `call ${e.voice.callId}` : undefined}>by voice: {e.voice.trigger}</Badge>}
        {e.parentExecutionId && (
          <button type="button" className="text-[11px] text-white/45 underline-offset-2 hover:text-white/80 hover:underline" onClick={() => go("executions", { id: e.parentExecutionId! }, true)}>
            the run before this one
          </button>
        )}
        {busy && <span className="text-[12px] text-[#ff6a1a]">Re-running the case with the {busy}…</span>}
        {error && <span className="max-w-72 truncate text-[12px] text-[#ff5c5c]" title={error}>{error}</span>}
      </div>
    </div>
  );
}

/** New case: you phone the desk as a driver on the road. When you hang up, the call is added to the case as one call transcript. */
function DriverCall({ name = "Tom", onCall }: { name?: string; onCall: (message: NonNullable<ReturnType<typeof driverCallMessage>>) => void }) {
  return (
    <Slot
      name="CallDrawer"
      label="Call the desk as the driver"
      props={{
        request: driverCallRequest(name),
        state: driverCallState(name),
        label: "Call the desk as the driver",
        onDone: (r: { events: CaseViewEvent[] }) => {
          const message = driverCallMessage(r.events, name);
          if (message) onCall(message);
        },
      }}
    />
  );
}

/** One thing a person can do by voice: what it is, who they play, then the control. */
function VoiceCard({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[14px] font-medium text-white/90">
        <span className="mr-1.5">{icon}</span>
        {title}
      </div>
      <div className="mt-1 flex flex-col gap-2 text-[13px] text-white/55">{children}</div>
    </div>
  );
}

export const VoiceSlot = { NoteButton, CallDrawer, ApproveByVoice, Mounts, Ring, LiveCallsSwitch, DriverCall };
export default VoiceSlot;
