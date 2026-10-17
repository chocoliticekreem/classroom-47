"use client";
// A live voice call with the Desk Caller agent, in the browser (WebRTC). Every promise the agent wants
// to make is checked by the safety gate through the propose_commitment tool, and shown here as it
// happens. When the call ends, the transcript and anything recorded become case events.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useRef, useState } from "react";
import { auditTranscript, callTool, DENIAL, openSession, type CallStateInput, type HumanDecision, type SessionRequest, type ViewEvent } from "./api";
import { createInflight } from "./inflight";
import { micErrorMessage, transcriptReducer, type Line } from "./transcript";
import { auditLine } from "./audit";
import { callStatusWord } from "./callStatus";

export interface CallResult { callId: string; events: ViewEvent[]; decision?: HumanDecision }

interface Props {
  request: SessionRequest;
  state: CallStateInput;
  simulated?: boolean;
  label?: string;
  onDone: (result: CallResult) => void;
}

export function CallDrawer(props: Props) {
  return (
    <ConversationProvider>
      <CallInner {...props} />
    </ConversationProvider>
  );
}

function CallInner({ request, state, simulated = false, label = "Start call", onDone }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [checks, setChecks] = useState<{ text: string; allowed: boolean; rule?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<HumanDecision | null>(null);
  const call = useRef<(CallStateInput & { callId: string }) | null>(null);
  const linesRef = useRef<Line[]>([]);
  const extra = useRef<ViewEvent[]>([]);
  const decision = useRef<HumanDecision | undefined>(undefined);
  const finished = useRef(true);
  const inflight = useRef(createInflight());
  const [finishing, setFinishing] = useState(false);
  const [audit, setAudit] = useState<ReturnType<typeof auditLine>>(null);

  // A client tool handler: asks our API and returns its answer (always a string) to the voice agent.
  const tool = (name: string) => (params: Record<string, unknown>): Promise<string> => {
    // Tracked, so ending the call waits for this to finish before handing results to the console.
    return inflight.current.track((async () => {
      if (!call.current) return DENIAL;
      const res = await callTool(name, { ...call.current, decided: decision.current?.optionId }, params);
      if (name === "propose_commitment") setChecks((c) => [...c, { text: String(params.text ?? ""), allowed: res.allowed === true, rule: res.rule }]);
      if (res.event) extra.current.push(res.event);
      if (res.decision && !decision.current) { decision.current = res.decision; setDecided(res.decision); }
      return res.result;
    })());
  };

  const conversation = useConversation({
    clientTools: {
      submit_decision: tool("submit_decision"),
      propose_commitment: tool("propose_commitment"),
      record_fact: tool("record_fact"),
      request_human: tool("request_human"),
    },
    // The ref is updated directly (not inside a state updater, which React may run late), so finish() sees every line.
    onMessage: (m) => { linesRef.current = transcriptReducer(linesRef.current, m); setLines(linesRef.current); },
    onDisconnect: () => { void finish(); },
    onError: (message) => setError(typeof message === "string" ? message : "The call hit an error"),
  });

  async function start() {
    if (finishing) return;
    setError(null);
    setLines((linesRef.current = []));
    setChecks([]);
    setDecided(null);
    setAudit(null);
    extra.current = [];
    decision.current = undefined;
    try {
      // Ask for the microphone inside the click, so the browser allows audio for this page.
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    } catch (err) {
      setError(micErrorMessage(err).replace("type the note instead", "use tap approval instead"));
      return;
    }
    try {
      const session = await openSession(request);
      call.current = { ...state, callId: session.callId };
      finished.current = false;
      conversation.startSession({ conversationToken: session.token, connectionType: "webrtc", dynamicVariables: session.dynamicVariables });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The call could not start");
    }
  }

  async function finish() {
    if (finished.current || !call.current) return;
    finished.current = true;
    setFinishing(true);
    try {
      // A decision or fact still being saved when the call ends must not be lost.
      await inflight.current.settle();
      const current = call.current;
      const lines = linesRef.current;
      const recorded = [...extra.current];
      const chosen = decision.current;
      const done = await callTool("finish", current, {}, { lines });
      // The transcript is safe; now every line the agent said is checked. A failed check adds no event.
      const checked = await auditTranscript(current, lines);
      setAudit(auditLine(checked));
      onDone({ callId: current.callId, events: [...(done.events ?? []), ...recorded, ...(checked?.event ? [checked.event] : [])], decision: chosen });
    } finally {
      setFinishing(false);
    }
  }

  const live = conversation.status === "connected" || conversation.status === "connecting";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#2a2a30] p-3 text-sm text-white">
      <div className="flex items-center gap-2">
        <span className="font-medium">{request.purpose === "approval" ? "Approval call" : "Call"}: {request.calleeName}</span>
        <span className="text-white/50">({callStatusWord(conversation.status, live && conversation.isSpeaking)})</span>
        {simulated && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">Simulated</span>}
        <span className="ml-auto">
          {live ? (
            <span className="flex items-center gap-2">
              <button type="button"
                onClick={() => conversation.setMuted(!conversation.isMuted)}
                className={`rounded px-3 py-1 ${conversation.isMuted ? "bg-amber-500/25 text-amber-200" : "border border-white/20"}`}
                title="Mute your microphone, for example in a noisy room. The agent keeps talking; it cannot hear you until you unmute."
              >
                {conversation.isMuted ? "🔇 Unmute" : "🎙 Mute"}
              </button>
              <button type="button" onClick={() => conversation.endSession()} className="rounded bg-red-600 px-3 py-1">End call</button>
            </span>
          ) : (
            <button type="button" onClick={start} disabled={finishing} className="rounded bg-[#ff6a1a] px-3 py-1 font-medium disabled:opacity-50">{finishing ? "Saving the call…" : `📞 ${label}`}</button>
          )}
        </span>
      </div>
      {error && <p className="text-amber-300">{error}</p>}
      {decided && (
        <p className="rounded bg-emerald-500/15 px-2 py-1 text-emerald-300">
          Decided by voice: {decided.label} (“{decided.confirmation}”)
        </p>
      )}
      {checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {checks.map((c, i) => (
            <li key={i} className={c.allowed ? "text-emerald-300" : "text-red-300"}>
              {c.allowed ? "✓ allowed" : "✕ denied by the safety gate"}: “{c.text}”{c.rule ? ` (${c.rule})` : ""}
            </li>
          ))}
        </ul>
      )}
      {audit && (
        <p className={audit.tone === "ok" ? "text-emerald-300" : audit.tone === "bad" ? "text-red-300" : "text-amber-300"}>{audit.text}</p>
      )}
      <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {lines.map((l, i) => (
          <li key={i}><span className="text-white/40">{l.role === "agent" ? "Desk agent" : request.calleeName}:</span> {l.message}</li>
        ))}
      </ol>
    </div>
  );
}
