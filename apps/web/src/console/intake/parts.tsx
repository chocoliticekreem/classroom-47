"use client";
// Pieces of the "New case" page: the add-a-message form, the file list and the plain preview.
import { useRef, useState, type DragEvent } from "react";
import { Badge, Button, cx, formatTimestamp, IconX } from "../ui";
import { CHANNELS, DESK, type AttachmentKind, type DraftMessage, type IntakeEvent } from "./request";
import { parseDate } from "./split";

export const FIELD =
  "w-full rounded-md border border-white/10 bg-rv-canvas px-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-rv-orange/60 focus:outline-none";

export function Label({ children }: { children: string }) {
  return <span className="mb-1 block text-[12px] text-white/50">{children}</span>;
}

export function ChannelSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cx(FIELD, "h-9")}>
      {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/** One message typed in by hand. */
export function AddMessage({ onAdd }: { onAdd: (m: DraftMessage) => void }) {
  const [channel, setChannel] = useState<string>("Customer portal");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [when, setWhen] = useState("");
  const [body, setBody] = useState("");
  const date = when.trim() ? parseDate(when) : null;
  const badDate = Boolean(when.trim()) && !date;

  function add() {
    if (!body.trim() || badDate) return;
    onAdd({ channel, from: from.trim() || null, to: to.trim() || null, subject: null, date, body: body.trim() });
    setBody("");
    setWhen("");
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block">
        <Label>Came by</Label>
        <ChannelSelect value={channel} onChange={setChannel} />
      </label>
      <label className="block">
        <Label>When (optional)</Label>
        <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="2026-02-25 09:10" className={cx(FIELD, "h-9", badDate && "border-rv-red/60")} />
      </label>
      <label className="block">
        <Label>From</Label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Sorin Vaal, recipient" className={cx(FIELD, "h-9")} />
      </label>
      <label className="block">
        <Label>To</Label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={DESK} className={cx(FIELD, "h-9")} />
      </label>
      <label className="block sm:col-span-2">
        <Label>Message</Label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What did they say?" className={cx(FIELD, "py-2 leading-relaxed")} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button size="sm" onClick={add} disabled={!body.trim() || badDate}>Add message</Button>
        {badDate && <span className="text-[12px] text-rv-red">Can&apos;t read that date. Try 2026-02-25 09:10.</span>}
      </div>
    </div>
  );
}

export interface FileRow {
  key: string;
  name: string;
  kind: AttachmentKind;
  size: number;
  state: "read" | "working" | "transcribed" | "not-read";
  note: string;
}

const KIND_WORD: Record<AttachmentKind, string> = { text: "Text", pdf: "PDF", image: "Photo", audio: "Recording", other: "File" };

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Drop zone plus the list of files with what happened to each. */
export function Files({ rows, onFiles, onRemove }: { rows: FileRow[]; onFiles: (files: File[]) => void; onRemove: (key: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  };
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cx(
          "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center text-[13px]",
          over ? "border-rv-orange/70 bg-rv-orange/[0.06] text-white/80" : "border-white/15 text-white/50",
        )}
      >
        <span>Drop files here: text, CSV, PDF, photos or a call recording</span>
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>Choose files</Button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept=".txt,.csv,.tsv,.md,.json,.eml,.log,.pdf,image/*,audio/*"
          onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = ""; }}
        />
      </div>
      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-white/[0.06] rounded-md border border-white/[0.07]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <Badge tone={r.state === "read" || r.state === "transcribed" ? "green" : r.state === "working" ? "blue" : "amber"}>
                {r.state === "read" ? "Read" : r.state === "transcribed" ? "Transcribed" : r.state === "working" ? "Working…" : "Not read"}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-white/85">{r.name}</div>
                <div className="truncate text-[12px] text-white/40">{KIND_WORD[r.kind]} · {size(r.size)} · {r.note}</div>
              </div>
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => onRemove(r.key)} className="rounded p-1 text-white/40 hover:bg-white/[0.06] hover:text-white">
                <IconX size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The case as the agent will read it: a plain timeline, then the files. */
export function Preview({ events, files, notRead }: { events: IntakeEvent[]; files: string[]; notRead: string[] }) {
  if (!events.length) {
    return <p className="text-[13px] text-white/45">Paste a message or add one. It shows up here as the agent will read it.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.n} className="rounded-md border border-white/[0.07] bg-rv-canvas/60 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/45">
              <span className="tabular text-white/30">{e.n}</span>
              <Badge>{e.channel ?? "Email"}</Badge>
              {e.source === "audio_attachment" && <Badge tone="blue">From a recording</Badge>}
              <span className="tabular">{formatTimestamp(e.timestamp)}</span>
            </div>
            <div className="mb-1 text-[13px] text-white/70">
              <span className="text-white/90">{e.from ?? "Unknown sender"}</span>
              <span className="text-white/35"> to </span>
              {e.to ?? "the desk"}
            </div>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/80">{e.body}</p>
          </li>
        ))}
      </ol>
      {(files.length > 0 || notRead.length > 0) && (
        <div className="text-[13px]">
          {files.length > 0 && <div className="text-white/70">Files it reads: {files.join(", ")}</div>}
          {notRead.length > 0 && <div className="mt-1 text-rv-amber/90">Not read: {notRead.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}
