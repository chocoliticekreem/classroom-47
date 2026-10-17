// The city's "Practice cases" picker: every case set we have, paged, so the client never bundles ~3,000
// cases. Pure: the route passes the catalogue in (catalogue.listCases).
import type { CaseEntry } from "./catalogue";

/** Picker sets, in menu order. `datasets` are catalogue datasets (generated includes grounded). */
export const CITY_PICKER_SETS = [
  { id: "public", label: "Sample (public)", datasets: ["public"] },
  { id: "city", label: "City", datasets: ["city"] },
  { id: "generated", label: "Generated", datasets: ["generated", "grounded"] },
  { id: "adversarial", label: "Trick", datasets: ["adversarial"] },
  { id: "fixtures", label: "Hard (hand-written)", datasets: ["fixtures"] },
  { id: "haiku", label: "Haiku-made", datasets: ["haiku"] },
  { id: "bulk", label: "Bulk (rule-made)", datasets: ["bulk"] },
] as const;

export type PickerSetId = (typeof CITY_PICKER_SETS)[number]["id"];

export const PAGE_SIZE = 50;
const MAX_PAGE = 200;

export interface PickerPage {
  sets: { id: string; label: string; count: number }[];
  /** Cases in every set (the counter's denominator). */
  total: number;
  /** Cases matching this set + search. */
  matched: number;
  offset: number;
  cases: CaseEntry[];
}

const SET_OF = new Map<string, PickerSetId>(CITY_PICKER_SETS.flatMap((s) => s.datasets.map((d) => [d, s.id] as const)));

/** The picker set a catalogue dataset belongs to (null: not offered, e.g. one-off cases). */
export function pickerSetOf(dataset: string): PickerSetId | null {
  return SET_OF.get(dataset) ?? null;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** One page of the picker. `set` "all" (or empty/unknown) = every set; `q` matches id or title. */
export function pickerPage(all: CaseEntry[], input: { set?: string | null; q?: string | null; offset?: unknown; limit?: unknown }): PickerPage {
  const offered = all.filter((c) => pickerSetOf(c.dataset));
  const sets = CITY_PICKER_SETS.map((s) => ({ id: s.id, label: s.label, count: offered.filter((c) => pickerSetOf(c.dataset) === s.id).length }));
  const set = CITY_PICKER_SETS.some((s) => s.id === input.set) ? input.set : null;
  const needle = input.q?.trim().toLowerCase() ?? "";
  const matched = offered.filter(
    (c) => (!set || pickerSetOf(c.dataset) === set) && (!needle || c.id.toLowerCase().includes(needle) || (c.title ?? "").toLowerCase().includes(needle)),
  );
  const limit = int(input.limit, PAGE_SIZE, 1, MAX_PAGE);
  const offset = int(input.offset, 0, 0, Math.max(0, matched.length));
  return { sets, total: offered.length, matched: matched.length, offset, cases: matched.slice(offset, offset + limit) };
}
