// A read-only file browser over one ANSWERS/ folder (the real one, or a try run's). The tree is built
// only by listing directories; a requested path is matched against that listing, never joined onto
// the root, so nothing outside the listed files can be read.
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { answerFolders } from "./reality";

/** File names shown: plain names with a known text extension. */
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,120}\.(md|json|jsonl|txt|log)$/;
/** One path segment of a request: same alphabet, no dot-only names. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,120}$/;
export const FILE_CAP_BYTES = 1024 * 1024;
export const DOWNLOAD_CAP_BYTES = 50 * 1024 * 1024;

export interface TreeFile {
  kind: "file";
  name: string;
  /** Relative to the ANSWERS root, "/" separated. */
  path: string;
  size: number;
}
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeFile[];
}
export interface AnswersTree {
  /** Top-level files (INDEX.md, RUNLOG.md, case-history.jsonl ...). */
  files: TreeFile[];
  /** One folder per case. */
  cases: TreeFolder[];
}

async function filesIn(dir: string, rel: string): Promise<TreeFile[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: TreeFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !FILE_NAME.test(e.name)) continue;
    const s = await stat(path.join(dir, e.name)).catch(() => null);
    if (!s?.isFile()) continue;
    out.push({ kind: "file", name: e.name, path: rel ? `${rel}/${e.name}` : e.name, size: s.size });
  }
  return out.sort((a, b) => fileOrder(a.name) - fileOrder(b.name) || a.name.localeCompare(b.name));
}

const ORDER = ["INDEX.md", "RUNLOG.md", "ANSWER.md", "REASONING.md", "result.json", "trace.json"];
const fileOrder = (n: string) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);

/** The tree under `root`: its own files and one folder per case (as answerFolders() finds them). */
export async function answersTree(root: string): Promise<AnswersTree> {
  const files = await filesIn(root, "");
  const cases: TreeFolder[] = [];
  for (const dir of await answerFolders(root)) {
    const rel = path.relative(root, dir).split(path.sep).join("/");
    if (!rel || rel.startsWith("..") || !rel.split("/").every((s) => SEGMENT.test(s))) continue;
    cases.push({ kind: "folder", name: rel, path: rel, children: await filesIn(dir, rel) });
  }
  return { files, cases };
}

/** True when `p` is a plain relative path of allowed segments (no "..", no absolute, no backslashes). */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 400) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0") || path.isAbsolute(p)) return false;
  return p.split("/").every((s) => s !== "." && s !== ".." && SEGMENT.test(s));
}

/** The listed file at `rel`, or null. The absolute path comes from the listing, not from `rel`. */
export function findInTree(tree: AnswersTree, rel: string): TreeFile | null {
  if (!isSafeRelPath(rel)) return null;
  return tree.files.find((f) => f.path === rel) ?? tree.cases.flatMap((c) => c.children).find((f) => f.path === rel) ?? null;
}

export interface FileRead {
  path: string;
  size: number;
  text: string;
  truncated: boolean;
}

/** Text of the listed file `rel` under `root`, cut at `cap` bytes. Null when it is not in the listing. */
export async function readTreeFile(root: string, rel: unknown, cap = FILE_CAP_BYTES): Promise<FileRead | null> {
  if (!isSafeRelPath(rel)) return null;
  const tree = await answersTree(root);
  const hit = findInTree(tree, rel);
  if (!hit) return null;
  const abs = path.join(root, ...hit.path.split("/"));
  const fh = await open(abs, "r");
  try {
    const size = (await fh.stat()).size;
    const n = Math.min(size, cap);
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    return { path: hit.path, size, text: buf.toString("utf8"), truncated: size > cap };
  } finally {
    await fh.close();
  }
}
