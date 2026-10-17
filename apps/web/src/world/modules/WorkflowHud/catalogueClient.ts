// Client for the Practice cases picker (GET /api/console/city/catalogue). Lists come from the server 50 at a
// time; picking a case outside the bundled 50 fetches its view and registers it as a generic city scenario.
import { useEffect, useState } from "react";
import { genericScenario, type PickedCase } from "../../genericScenario";
import { getScenario, registerScenario, SCENARIOS } from "../../scenarios";

export const CATALOGUE_URL = "/api/console/city/catalogue";

export interface PickerCase {
  id: string;
  dataset: string;
  title: string | null;
}

export interface PickerPage {
  sets: { id: string; label: string; count: number }[];
  total: number;
  matched: number;
  offset: number;
  cases: PickerCase[];
}

type Fetch = (url: string) => Promise<Response>;

export function pageUrl(set: string, q: string, offset: number): string {
  const p = new URLSearchParams();
  if (set && set !== "all") p.set("set", set);
  if (q.trim()) p.set("q", q.trim());
  if (offset) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `${CATALOGUE_URL}?${s}` : CATALOGUE_URL;
}

export async function fetchPage(set: string, q: string, offset: number, f: Fetch = fetch): Promise<PickerPage> {
  const r = await f(pageUrl(set, q, offset));
  if (!r.ok) throw new Error(`catalogue ${r.status}`);
  return (await r.json()) as PickerPage;
}

/**
 * The scenario id to stage for a picked case: a bundled public case as is (keeps its own scene), anything else
 * fetched from the server and registered as a generic scenario first.
 */
export async function prepareCase(c: PickerCase, f: Fetch = fetch): Promise<string> {
  const known = getScenario(c.id);
  if (known && (!known.dataset || known.dataset === c.dataset)) return c.id;
  const r = await f(`${CATALOGUE_URL}?id=${encodeURIComponent(c.id)}&dataset=${encodeURIComponent(c.dataset)}`);
  const body = (await r.json().catch(() => null)) as { case?: PickedCase; error?: string } | null;
  if (!r.ok || !body?.case) throw new Error(body?.error ?? `catalogue ${r.status}`);
  registerScenario(genericScenario(body.case));
  return c.id;
}

let totalP: Promise<number> | null = null;

/** Cases across every set (for the top-bar counter); the bundled 50 until the server answers. */
export function useCatalogueTotal(): number {
  const [n, setN] = useState<number>(SCENARIOS.length);
  useEffect(() => {
    let live = true;
    totalP ??= fetchPage("all", "", 0).then((p) => p.total).catch(() => {
      totalP = null;
      return SCENARIOS.length;
    });
    void totalP.then((t) => live && setN(t));
    return () => {
      live = false;
    };
  }, []);
  return n;
}
