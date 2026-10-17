"use client";
// Drop zone for "Try it now" with your own cases: a .zip of case folders, a whole folder, loose files
// (one case) or our JSON case files. Uploads at once to /api/console/reality/try/upload, which stages
// them and says how many cases it found; nothing runs until the user presses Run.
import { useRef, useState, type DragEvent } from "react";
import { Button, IconImport, cx } from "../ui";

export interface StagedUpload {
  id: string;
  cases: { name: string; source: string; files: number }[];
  bytes: number;
}

interface Picked {
  file: File;
  path: string;
}

const ACCEPT = ".zip,.md,.txt,.pdf,.png,.jpg,.jpeg,.csv,.json,.eml,.html,.mp3,.m4a,.wav";

// Dropped folders arrive as FileSystemEntry trees (webkitGetAsEntry), walked here with their paths.
async function walkEntry(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
    out.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 at a time; call until it returns nothing.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) break;
    for (const e of batch) await walkEntry(e, out);
  }
}

async function droppedFiles(e: DragEvent): Promise<Picked[]> {
  const items = Array.from(e.dataTransfer.items ?? []);
  // Entries must be taken synchronously, before the first await, or the browser clears them.
  const entries = items
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry() : null))
    .filter((x): x is FileSystemEntry => !!x);
  if (entries.length) {
    const out: Picked[] = [];
    for (const en of entries) await walkEntry(en, out);
    return out;
  }
  return Array.from(e.dataTransfer.files).map((file) => ({ file, path: file.name }));
}

const fromInput = (list: FileList | null): Picked[] =>
  Array.from(list ?? []).map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));

const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function UploadArea({
  maxBytes,
  staged,
  onStaged,
}: {
  maxBytes: number;
  staged: StagedUpload | null;
  onStaged: (u: StagedUpload | null) => void;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  const send = async (picked: Picked[]) => {
    setError(null);
    onStaged(null);
    const keep = picked.filter((p) => !p.path.split("/").some((s) => s.startsWith(".") || s === "__MACOSX"));
    if (!keep.length) return setError("No files to upload.");
    const total = keep.reduce((s, p) => s + p.file.size, 0);
    if (total > maxBytes) return setError(`That is ${mb(total)}; the limit is ${mb(maxBytes)}.`);
    const form = new FormData();
    for (const p of keep) {
      form.append("file", p.file, p.file.name);
      form.append("path", p.path);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/console/reality/try/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { upload?: StagedUpload; error?: string };
      if (!res.ok || !body.upload) throw new Error(body.error ?? `Upload failed (${res.status}).`);
      onStaged(body.upload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void droppedFiles(e).then(send, (err) => setError(String(err)));
        }}
        className={cx(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          over ? "border-rv-blue bg-rv-blue/[0.06]" : "border-white/15 bg-white/[0.02]",
        )}
      >
        <IconImport size={18} className="text-white/50" />
        <p className="text-[13px] text-white/75">
          Drop a <b className="font-medium text-white">.zip of case folders</b>, a folder, or a case&apos;s files here
        </p>
        <p className="text-[12px] text-white/45">
          Loose files (.md, .txt, .pdf, .png, .csv, .json) make one case. Our JSON case files become one case each. Up to {mb(maxBytes)}.
        </p>
        <div className="mt-1 flex gap-2">
          <Button size="sm" loading={busy} onClick={() => files.current?.click()}>Choose files or zip</Button>
          <Button size="sm" disabled={busy} onClick={() => folder.current?.click()}>Choose folder</Button>
        </div>
        <input
          ref={files}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void send(fromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={(el) => {
            folder.current = el;
            // React does not type webkitdirectory; set it on the element.
            if (el) el.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void send(fromInput(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      {busy && <p className="mt-2 text-[12px] text-white/50">Uploading and reading the cases…</p>}
      {error && <p className="mt-2 text-[12px] text-rv-red/80">{error}</p>}
      {staged && (
        <div className="mt-3 text-[12px] text-white/60">
          <p className="text-[13px] text-white/80">
            Found <b className="font-semibold text-white tabular">{staged.cases.length}</b> case{staged.cases.length === 1 ? "" : "s"} ({mb(staged.bytes)}).
          </p>
          <ul className="mt-1 max-h-32 overflow-y-auto">
            {staged.cases.map((c) => (
              <li key={c.name} className="truncate tabular">
                {c.name}. {c.source} <span className="text-white/35">· {c.files} file{c.files === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
