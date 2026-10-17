"use client";
// Console tab: "New case". The real-world way in: paste an email thread, add messages one by one,
// drop files (text is read here, a call recording is transcribed), check the preview, then run
// the agent. POST /api/console/intake saves the case (dataset "adhoc") and starts it on the
// console execute path; the page then opens the run in Case runs. Logic: console/intake/*.ts (tested).
import { useMemo, useState } from "react";
import { Button, ErrorState, IconPlay, Panel, Spinner, useConsole } from "../ui";
import { EXAMPLES } from "../intake/examples";
import { AddMessage, ChannelSelect, Files, FIELD, Preview, type FileRow } from "../intake/parts";
import { attachmentKind, buildIntakeRequest, mergeMessages, MAX_ATTACHMENT_CHARS, type DraftAttachment, type DraftMessage } from "../intake/request";
import { splitThread } from "../intake/split";
import VoiceSlot from "../executions/VoiceSlot";

type Phase = "idle" | "saving" | "opening";

let fileSeq = 0;
const NOT_READ_MEDIA = "Not read: the agent can only take text from this page";

export default function IntakeTab() {
  const { navigate, workflowId } = useConsole();
  const [paste, setPaste] = useState("");
  const [pasteChannel, setPasteChannel] = useState("Email");
  const [added, setAdded] = useState<DraftMessage[]>([]);
  const [files, setFiles] = useState<(FileRow & { text: string | null })[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const pasted = useMemo(() => (paste.trim() ? splitThread(paste, { channel: pasteChannel }) : []), [paste, pasteChannel]);
  const messages = useMemo(() => mergeMessages(pasted, added), [pasted, added]);
  const attachments = useMemo<DraftAttachment[]>(
    () => files.map((f) => ({ name: f.name, kind: f.kind, size: f.size, text: f.state === "read" ? f.text : null })),
    [files],
  );
  const request = useMemo(() => buildIntakeRequest({ messages, attachments, now, workflowId }), [messages, attachments, now, workflowId]);
  const working = files.some((f) => f.state === "working");
  const busy = phase !== "idle";

  function setFile(key: string, patch: Partial<FileRow & { text: string | null }>) {
    setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  async function addFiles(list: File[]) {
    for (const file of list) {
      const kind = attachmentKind(file.name, file.type);
      const key = `${file.name}-${++fileSeq}`;
      const row = { key, name: file.name, kind, size: file.size, text: null as string | null };
      if (kind === "text") {
        const text = await file.text().catch(() => "");
        const ok = Boolean(text.trim()) && !text.includes("\u0000");
        setFiles((fs) => [...fs, {
          ...row,
          text: ok ? text : null,
          state: ok ? "read" : "not-read",
          note: ok ? (text.length > MAX_ATTACHMENT_CHARS ? "Sent as text (first part only)" : "Sent as text") : "Not read: empty or not plain text",
        }]);
      } else if (kind === "audio") {
        setFiles((fs) => [...fs, { ...row, state: "working", note: "Turning speech into text…" }]);
        void transcribe(file, key);
      } else {
        setFiles((fs) => [...fs, { ...row, state: "not-read", note: kind === "other" ? "Not read: this file type isn't supported" : NOT_READ_MEDIA }]);
      }
    }
  }

  async function transcribe(file: File, key: string) {
    const form = new FormData();
    form.set("audio", file, file.name);
    form.set("from", "Caller");
    form.set("caseText", messages.map((m) => m.body).join("\n"));
    try {
      const res = await fetch("/api/console/intake/transcribe", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { text?: string; unclear?: boolean; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? "Could not transcribe the recording.");
      setAdded((a) => [...a, { channel: "Call transcript", from: `Caller (${file.name})`, to: null, subject: null, date: null, body: body.text!, source: "audio_attachment" }]);
      setFile(key, { state: "transcribed", note: body.unclear ? "Added as a call transcript (hard to hear)" : "Added as a call transcript" });
    } catch (err) {
      setFile(key, { state: "not-read", note: `Not read: ${err instanceof Error ? err.message : "transcription failed"}` });
    }
  }

  function applyExample(i: number) {
    const ex = EXAMPLES[i];
    setPaste(ex.paste);
    setPasteChannel("Email");
    setAdded(ex.messages);
    setFiles([]);
    setError(null);
  }

  function clearAll() {
    setPaste("");
    setAdded([]);
    setFiles([]);
    setError(null);
  }

  async function run() {
    if (!request.events.length || busy || working) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/console/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => ({}))) as { executionId?: string; error?: string };
      if (!res.ok || !body.executionId) throw new Error(body.error ?? `The server answered ${res.status}.`);
      setPhase("opening");
      navigate("executions", { id: body.executionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  const readFiles = request.attachments.map((a) => a.name);
  const notRead = files.filter((f) => f.state === "not-read").map((f) => f.name);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <h1 className="text-rv-title font-medium text-white">New case</h1>
            <p className="mt-1 text-[14px] text-white/55">Paste the emails or messages about a delivery problem. The agent decides what to do.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-white/40">Try an example:</span>
              {EXAMPLES.map((ex, i) => (
                <Button key={ex.id} size="sm" onClick={() => applyExample(i)} disabled={busy}>{ex.label}</Button>
              ))}
            </div>
          </div>

          <Panel title="Paste an email or thread" actions={<div className="w-44"><ChannelSelect value={pasteChannel} onChange={setPasteChannel} /></div>}>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={10}
              placeholder={"From: Sorin Vaal\nTo: Rivet Delivery Desk\nDate: 2026-02-25 09:10\n\nNo one in my household has the parcel…"}
              className={`${FIELD} py-2 font-mono text-[12.5px] leading-relaxed`}
            />
            <p className="mt-2 text-[12px] text-white/40">
              {pasted.length > 1 ? `Split into ${pasted.length} messages.` : "Each From: block or quoted reply becomes its own message."}
            </p>
          </Panel>

          <Panel title="Phone the desk as the driver">
            <p className="mb-3 text-[13px] text-white/55">
              You&apos;re a driver on the road. Tell the desk what&apos;s stopping the delivery and what you can do, in any language. When you hang up, the call is added below and the agent handles the rest.
            </p>
            <VoiceSlot.DriverCall onCall={(m) => setAdded((a) => [...a, m])} />
          </Panel>

          <Panel title="Add a message" subtitle={added.length ? `${added.length} added` : undefined}>
            <AddMessage onAdd={(m) => setAdded((a) => [...a, m])} />
            {added.length > 0 && (
              <ul className="mt-4 flex flex-col gap-1.5">
                {added.map((m, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-white/65">
                    <span className="min-w-0 flex-1 truncate">{m.channel} · {m.from ?? "Unknown sender"}: {m.body}</span>
                    <Button size="sm" variant="ghost" onClick={() => setAdded((a) => a.filter((_, j) => j !== i))}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Files">
            <Files rows={files} onFiles={(l) => void addFiles(l)} onRemove={(k) => setFiles((fs) => fs.filter((f) => f.key !== k))} />
          </Panel>
        </div>

        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <Panel
            title="What the agent will read"
            subtitle={request.events.length ? `${request.events.length} message${request.events.length === 1 ? "" : "s"}` : undefined}
            actions={(paste || added.length || files.length) ? <Button size="sm" variant="ghost" onClick={clearAll} disabled={busy}>Clear</Button> : undefined}
            bodyClassName="max-h-[60vh] overflow-y-auto"
          >
            <Preview events={request.events} files={readFiles} notRead={notRead} />
          </Panel>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              variant="primary"
              className="h-11 text-[15px]"
              icon={<IconPlay size={14} />}
              loading={busy}
              disabled={!request.events.length || working}
              onClick={() => void run()}
            >
              Run the agent
            </Button>
            <div className="flex justify-center">
              <VoiceSlot.LiveCallsSwitch />
            </div>
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-white/60" role="status">
                <Spinner size={12} />
                {phase === "saving" ? "Saving the case and starting the agent…" : "Started. Opening Case runs…"}
              </div>
            )}
            {working && !busy && <div className="text-[13px] text-white/50">Waiting for the recording to be transcribed…</div>}
            {error && <ErrorState title="Couldn't start the run" error={error} />}
          </div>
        </div>
      </div>
    </div>
  );
}
