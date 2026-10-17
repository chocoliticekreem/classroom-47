// Server only: stores one-off cases from the "New case" page (dataset "adhoc") next to the console
// database, as runs/adhoc/<id>.json in the same shape as a generated case, so the catalogue can
// build its view and the console execute path can run it like any other case.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dbPath } from "../server/db";
import type { IntakeRequest } from "./request";

export const ADHOC_DATASET = "adhoc";
const ID = /^adhoc-\d{8}-\d{6}-[0-9a-f]{4}$/;

export function adhocDir(): string {
  return path.join(path.dirname(dbPath()), "adhoc");
}

export function newAdhocId(now = new Date()): string {
  const s = now.toISOString().replace(/[-:]/g, "");
  return `adhoc-${s.slice(0, 8)}-${s.slice(9, 15)}-${randomBytes(2).toString("hex")}`;
}

export function isAdhocId(id: string): boolean {
  return ID.test(id);
}

export interface AdhocCase {
  id: string;
  track: "delivery";
  title: string;
  events: IntakeRequest["events"];
  attachments: IntakeRequest["attachments"];
  created_at: string;
}

export async function saveAdhoc(req: IntakeRequest, now = new Date()): Promise<AdhocCase> {
  const c: AdhocCase = {
    id: newAdhocId(now),
    track: "delivery",
    title: req.title,
    events: req.events,
    attachments: req.attachments,
    created_at: now.toISOString(),
  };
  await mkdir(adhocDir(), { recursive: true });
  await writeFile(path.join(adhocDir(), `${c.id}.json`), JSON.stringify(c, null, 2));
  return c;
}

export async function readAdhoc(id: string): Promise<AdhocCase | null> {
  if (!isAdhocId(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(adhocDir(), `${id}.json`), "utf8")) as AdhocCase;
  } catch {
    return null;
  }
}

export async function listAdhoc(): Promise<{ id: string; title: string | null }[]> {
  const names = await readdir(adhocDir()).catch(() => [] as string[]);
  const out: { id: string; title: string | null }[] = [];
  for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
    const c = await readAdhoc(n.replace(/\.json$/, ""));
    if (c) out.push({ id: c.id, title: c.title ?? null });
  }
  return out;
}
