// Command registry for the ⌘K palette. Pure: buildCommands() turns live data + side-effect
// callbacks into a flat list; the palette ranks it with fuzzyRank(). Words follow
// ui-simplify-brief.md (plain, no ids people don't know, no jargon).
import { TAB_IDS, TAB_TITLES, type ParamPatch, type TabId } from "../ui/context";
import { fuzzyRank, type FuzzyMatch } from "./fuzzy";

export type CommandGroup = "Go to" | "Actions" | "Run a case" | "Case runs" | "Practice" | "City";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Extra words that should find this command (not shown). */
  keywords?: readonly string[];
  /** Small grey text on the right. */
  hint?: string;
  /** Only listed once the person types (long lists: cases, runs). */
  searchOnly?: boolean;
  run: () => void | Promise<void>;
}

/** Things a city trigger can start. Sent on the "rivet-city" channel as { type: "inject", event }. */
export const CITY_TRIGGERS = [
  { event: "truck_crash", title: "Trigger: truck crash", keywords: ["accident", "lorry", "incident"] },
  { event: "motorcade", title: "Trigger: motorcade", keywords: ["president", "closure", "event", "convoy"] },
] as const;
export type CityTrigger = (typeof CITY_TRIGGERS)[number]["event"];

export interface CaseLite { id: string; dataset: string; title: string | null }
export interface RunLite { id: string; caseId: string; startedAt: string; status: string; simulated: boolean }
export interface SetLite { id: string; label: string; count: number }

export interface PaletteActions {
  navigate: (tab: TabId, params?: ParamPatch) => void;
  openDecisions: () => void;
  runCase: (c: CaseLite) => void | Promise<void>;
  practice: (set: SetLite) => void | Promise<void>;
  openCity: () => void;
  trigger: (event: CityTrigger) => void;
}

export interface PaletteData {
  cases?: readonly CaseLite[];
  runs?: readonly RunLite[];
  sets?: readonly SetLite[];
  /** Practice needs a playbook to practise; without one the Practice commands are hidden. */
  canPractice?: boolean;
}

const TAB_KEYWORDS: Record<TabId, string[]> = {
  overview: ["home", "dashboard", "start"],
  intake: ["new case", "add", "create", "report"],
  executions: ["runs", "history", "executions"],
  workflows: ["playbooks", "flow", "workflow", "editor"],
  evidence: ["results", "scores", "evidence", "grid"],
  reality: ["reality test", "real world", "compare"],
  how: ["how it works", "explain", "framework", "about"],
  city: ["city", "simulation", "map"],
  settings: ["settings", "preferences", "config"],
};

/** "Quick: 5 public cases, one per scene" -> "Quick". */
export function shortSetLabel(label: string): string {
  const head = label.split(":")[0]?.trim();
  return head || label;
}

const RUN_STATUS: Record<string, string> = { running: "Working on it", success: "Finished", error: "Didn't finish" };

export function buildCommands(a: PaletteActions, d: PaletteData = {}): Command[] {
  const out: Command[] = [];

  for (const tab of TAB_IDS) {
    if (tab === "intake") continue; // the "New case" action below covers it
    out.push({
      id: `tab:${tab}`,
      title: `Go to ${TAB_TITLES[tab]}`,
      group: "Go to",
      keywords: TAB_KEYWORDS[tab],
      run: () => a.navigate(tab),
    });
  }
  out.push({ id: "decisions", title: "Open Decisions", group: "Go to", keywords: ["review", "approve", "waiting", "inbox"], run: a.openDecisions });

  out.unshift({ id: "new-case", title: "New case", group: "Actions", keywords: ["add case", "create", "intake"], run: () => a.navigate("intake") });
  out.push({ id: "open-city", title: "Open the city", group: "City", keywords: ["3d", "world", "map"], hint: "New tab", run: a.openCity });
  for (const t of CITY_TRIGGERS) {
    out.push({ id: `trigger:${t.event}`, title: t.title, group: "City", keywords: t.keywords, hint: "In the city", run: () => a.trigger(t.event) });
  }

  if (d.canPractice) {
    for (const s of d.sets ?? []) {
      if (s.id === "custom" || s.count === 0) continue;
      out.push({
        id: `practice:${s.id}`,
        title: `Practice on ${shortSetLabel(s.label)}`,
        group: "Practice",
        keywords: [s.label, "test", "practice"],
        hint: `${Math.min(s.count, 5)} case${Math.min(s.count, 5) === 1 ? "" : "s"}`,
        run: () => a.practice(s),
      });
    }
  }

  for (const c of d.cases ?? []) {
    out.push({
      id: `run:${c.dataset}:${c.id}`,
      title: `Run case ${c.id}`,
      group: "Run a case",
      keywords: c.title ? [c.title] : undefined,
      hint: c.title ?? undefined,
      searchOnly: true,
      run: () => a.runCase(c),
    });
  }

  for (const r of d.runs ?? []) {
    out.push({
      id: `exec:${r.id}`,
      title: `Open case run ${r.caseId}`,
      group: "Case runs",
      keywords: [r.id],
      hint: `${r.simulated ? "Practice case · " : ""}${RUN_STATUS[r.status] ?? r.status}`,
      searchOnly: true,
      run: () => a.navigate("executions", { id: r.id }),
    });
  }

  return out;
}

/** What the palette lists for a query: everything short when empty, fuzzy-ranked otherwise. */
export function searchCommands(query: string, commands: readonly Command[], limit = 40): { item: Command; match: FuzzyMatch }[] {
  const pool = query.trim() ? commands : commands.filter((c) => !c.searchOnly);
  return fuzzyRank(query, pool, limit);
}
