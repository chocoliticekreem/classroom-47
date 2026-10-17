"use client";
// A code-editor style explorer over one ANSWERS/ folder: the root expands to INDEX.md, RUNLOG.md and
// one folder per case (with its result badge); each case folder expands to its files. The right pane
// renders Markdown (safe renderer, no raw HTML), pretty-prints JSON, and has Raw and Copy.
import { useMemo, useState, type KeyboardEvent } from "react";
import Markdown from "../executions/MarkdownView";
import { Badge, Button, EmptyState, IconChevronDown, IconChevronRight, Panel, Skeleton, cx } from "../ui";
import { useApi } from "../useApi";
import { STATUS_LABEL, STATUS_TONE, caseStatus, type RealityCase } from "./logic";

interface TreeFile { kind: "file"; name: string; path: string; size: number }
interface TreeFolder { kind: "folder"; name: string; path: string; children: TreeFile[] }
interface TreeResponse { root: string; tree: { files: TreeFile[]; cases: TreeFolder[] } }
interface FileResponse { path: string; size: number; text: string; truncated: boolean }

const ROOT_KEY = "__root__";
const storeKey = (root: string) => `reality-files-open:${root}`;

function loadOpen(root: string): Set<string> {
  try {
    const raw = localStorage.getItem(storeKey(root));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set([ROOT_KEY]);
}

function saveOpen(root: string, open: Set<string>) {
  try {
    localStorage.setItem(storeKey(root), JSON.stringify([...open]));
  } catch {}
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Row =
  | { kind: "root"; key: string; depth: 0 }
  | { kind: "folder"; key: string; depth: 1; folder: TreeFolder }
  | { kind: "file"; key: string; depth: number; file: TreeFile };

export default function FilesView({ query, cases }: { query: string; cases: RealityCase[] }) {
  const tree = useApi<TreeResponse>(`/api/console/reality/files${query}`, { pollMs: 5000 });
  const rootLabel = tree.data?.root ?? "ANSWERS";
  const [open, setOpen] = useState<Set<string>>(() => new Set([ROOT_KEY]));
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>(ROOT_KEY);

  // Restore the remembered expanded folders once the folder is known, and again when it changes.
  const [seenRoot, setSeenRoot] = useState<string | null>(null);
  if (tree.data && seenRoot !== rootLabel) {
    setSeenRoot(rootLabel);
    setOpen(loadOpen(rootLabel));
    setSelected(null);
  }

  const byCase = useMemo(() => new Map(cases.map((c) => [c.caseId, c])), [cases]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [{ kind: "root", key: ROOT_KEY, depth: 0 }];
    const t = tree.data?.tree;
    if (!t || !open.has(ROOT_KEY)) return out;
    for (const f of t.files) out.push({ kind: "file", key: f.path, depth: 1, file: f });
    for (const c of t.cases) {
      out.push({ kind: "folder", key: c.path + "/", depth: 1, folder: c });
      if (open.has(c.path + "/")) for (const f of c.children) out.push({ kind: "file", key: f.path, depth: 2, file: f });
    }
    return out;
  }, [tree.data, open]);

  const toggle = (key: string, to?: boolean) => {
    setOpen((prev) => {
      const next = new Set(prev);
      const want = to ?? !next.has(key);
      if (want) next.add(key);
      else next.delete(key);
      saveOpen(rootLabel, next);
      return next;
    });
  };

  const activate = (r: Row) => {
    setFocus(r.key);
    if (r.kind === "file") setSelected(r.file.path);
    else toggle(r.key);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = rows.findIndex((r) => r.key === focus);
    const r = rows[i];
    const move = (j: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (next) {
        setFocus(next.key);
        document.getElementById(`ft-${next.key}`)?.focus();
      }
    };
    if (e.key === "ArrowDown") { e.preventDefault(); move(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(i - 1); }
    else if (e.key === "ArrowRight" && r && r.kind !== "file") { e.preventDefault(); toggle(r.key, true); }
    else if (e.key === "ArrowLeft" && r) {
      e.preventDefault();
      if (r.kind !== "file" && open.has(r.key)) toggle(r.key, false);
      else {
        for (let j = i - 1; j >= 0; j--) if (rows[j].depth < r.depth) { move(j); break; }
      }
    } else if ((e.key === "Enter" || e.key === " ") && r) { e.preventDefault(); activate(r); }
  };

  return (
    <div className="grid min-h-[60vh] grid-cols-1 gap-3 md:grid-cols-[18rem_1fr]">
      <Panel flush>
        <div role="tree" aria-label="ANSWERS files" className="max-h-[75vh] overflow-auto py-1 font-mono text-[12.5px]" onKeyDown={onKey}>
          {tree.loading && !tree.data ? (
            <Skeleton className="m-2 h-40" />
          ) : (
            rows.map((r) => {
              const isOpen = r.kind !== "file" && open.has(r.key);
              const active = r.kind === "file" && r.file.path === selected;
              const c = r.kind === "folder" ? byCase.get(r.folder.name) : undefined;
              const s = c ? caseStatus(c) : null;
              return (
                <div
                  key={r.key}
                  id={`ft-${r.key}`}
                  role="treeitem"
                  aria-expanded={r.kind === "file" ? undefined : isOpen}
                  aria-selected={active}
                  tabIndex={focus === r.key ? 0 : -1}
                  onClick={() => activate(r)}
                  onFocus={() => setFocus(r.key)}
                  style={{ paddingLeft: `${0.5 + r.depth * 0.9}rem` }}
                  className={cx(
                    "flex cursor-pointer select-none items-center gap-1.5 py-[3px] pr-2 outline-none",
                    active ? "bg-white/[0.09] text-white" : "text-white/70 hover:bg-white/[0.04]",
                    "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-rv-blue",
                  )}
                  title={r.kind === "file" ? `${r.file.path} (${kb(r.file.size)})` : undefined}
                >
                  {r.kind === "file" ? (
                    <span className="w-3.5" />
                  ) : isOpen ? (
                    <IconChevronDown size={13} className="text-white/45" />
                  ) : (
                    <IconChevronRight size={13} className="text-white/45" />
                  )}
                  {r.kind === "root" && <span className="truncate font-semibold text-white">{rootLabel.split("/").pop()}</span>}
                  {r.kind === "folder" && (
                    <>
                      <span className="text-white/85">{r.folder.name}</span>
                      {s && <Badge tone={STATUS_TONE[s]} dot className="ml-auto font-sans">{STATUS_LABEL[s]}</Badge>}
                    </>
                  )}
                  {r.kind === "file" && (
                    <>
                      <span className={cx("truncate", r.file.name.endsWith(".md") ? "text-white/85" : "text-white/60")}>{r.file.name}</span>
                      <span className="ml-auto text-[10.5px] text-white/30">{kb(r.file.size)}</span>
                    </>
                  )}
                </div>
              );
            })
          )}
          {tree.error && <p className="px-3 py-2 font-sans text-[12px] text-rv-red/80">{tree.error}</p>}
        </div>
      </Panel>
      <FilePane query={query} path={selected} rootLabel={rootLabel} />
    </div>
  );
}

function FilePane({ query, path, rootLabel }: { query: string; path: string | null; rootLabel: string }) {
  const sep = query ? "&" : "?";
  const url = path ? `/api/console/reality/files/raw${query}${sep}path=${encodeURIComponent(path)}` : null;
  const file = useApi<FileResponse>(url);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!path) {
    return (
      <Panel>
        <EmptyState compact title="Pick a file">Open a case folder on the left and click ANSWER.md, REASONING.md or a JSON file.</EmptyState>
      </Panel>
    );
  }
  const f = file.data && file.data.path === path ? file.data : null;
  const isMd = path.endsWith(".md");
  const isJson = path.endsWith(".json");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f?.text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <Panel
      title={<span className="font-mono text-[12.5px]">{`${rootLabel}/${path}`}</span>}
      actions={
        <div className="flex items-center gap-2">
          {(isMd || isJson) && (
            <Button size="sm" variant="ghost" onClick={() => setRaw((v) => !v)}>{raw ? (isMd ? "Rendered" : "Pretty") : "Raw"}</Button>
          )}
          <Button size="sm" variant="ghost" onClick={copy} disabled={!f}>{copied ? "Copied" : "Copy"}</Button>
          {url && <a href={`${url}&download=1`} className="text-[12px] text-white/55 hover:text-white/85">Download</a>}
        </div>
      }
    >
      {!f ? (
        file.error ? <p className="text-[12px] text-rv-red/80">{file.error}</p> : <Skeleton className="h-40 w-full" />
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          {f.truncated && (
            <p className="mb-2 text-[12px] text-rv-amber/80">Showing the first {kb(f.text.length)} of {kb(f.size)}. Use Download for the whole file.</p>
          )}
          {isMd && !raw ? (
            <div className="text-[13.5px] leading-relaxed text-white/80"><Markdown source={f.text} /></div>
          ) : isJson && !raw && !f.truncated ? (
            <JsonView text={f.text} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-white/75">{f.text}</pre>
          )}
        </div>
      )}
    </Panel>
  );
}

function JsonView({ text }: { text: string }) {
  const value = useMemo(() => {
    try { return { ok: true as const, v: JSON.parse(text) as unknown }; } catch { return { ok: false as const }; }
  }, [text]);
  if (!value.ok) return <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-white/75">{text}</pre>;
  const big = text.length > 20_000;
  return <div className="font-mono text-[12px] text-white/75"><JsonNode v={value.v} depth={0} collapseFrom={big ? 2 : 6} /></div>;
}

function JsonNode({ v, depth, collapseFrom, name }: { v: unknown; depth: number; collapseFrom: number; name?: string }) {
  const label = name !== undefined ? <span className="text-rv-blue/90">{JSON.stringify(name)}: </span> : null;
  if (v === null || typeof v !== "object") {
    const cls = typeof v === "string" ? "text-[#ffb68a]" : typeof v === "number" ? "text-rv-green" : "text-violet-300";
    return <div className="whitespace-pre-wrap break-words">{label}<span className={cls}>{JSON.stringify(v)}</span></div>;
  }
  const entries: [string | undefined, unknown][] = Array.isArray(v) ? v.map((x) => [undefined, x]) : Object.entries(v);
  const [o, c] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return <div>{label}{o}{c}</div>;
  return (
    <details open={depth < collapseFrom}>
      <summary className="cursor-pointer select-none">
        {label}{o} <span className="text-white/35">{entries.length} {Array.isArray(v) ? "items" : "keys"}</span>
      </summary>
      <div className="ml-4 border-l border-white/[0.06] pl-2">
        {entries.map(([k, x], i) => <JsonNode key={i} v={x} depth={depth + 1} collapseFrom={collapseFrom} name={k} />)}
      </div>
      <div>{c}</div>
    </details>
  );
}
