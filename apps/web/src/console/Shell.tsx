"use client";
// The console app shell: left sidebar (Home, New case, Case runs, Decisions, Playbooks, Results,
// Reality Test, City; Settings at the bottom), a header with the page title, Live status and the
// page's one primary button, the ⌘K command palette (./palette), and `?tab=` routing. Must render
// inside <Suspense> (uses useSearchParams; Next 16 rule). Visible words follow ui-simplify-brief.md.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { useStatus, useWorkflows } from "./useApi";
import {
  Button,
  ConsoleContext,
  ExecuteButton,
  IconChevronLeft,
  IconChevronRight,
  IconCity,
  IconEvidence,
  IconInfo,
  IconSearch,
  IconWorkflow,
  RivetMark,
  StatusDot,
  TAB_TITLES,
  Toaster,
  cx,
  isTabId,
  useConsole,
  type ConsoleContextValue,
  type IconProps,
  type ParamPatch,
  type TabId,
} from "./ui";
import { TabErrorBoundary, AgentOfflineBanner } from "./reliability";
import CommandPalette, { usePaletteHotkey } from "./palette/CommandPalette";
import { IconDecisions, IconHome, IconNewCase, IconReality, IconRuns, IconSettings } from "./palette/icons";
import OverviewTab from "./tabs/Overview";
import WorkflowsTab from "./tabs/Workflows";
import ExecutionsTab from "./tabs/Executions";
import EvidenceTab from "./tabs/Evidence";
import CityTab from "./tabs/City";
import IntakeTab from "./tabs/Intake";
import RealityTab from "./tabs/Reality";
import HowItWorksTab from "./tabs/HowItWorks";
import SettingsTab from "./tabs/Settings";
import { useReviewQueue } from "../review/useReviewQueue";
import ReviewDrawer from "../review/ReviewDrawer";

const TAB_COMPONENT: Record<TabId, ComponentType> = {
  overview: OverviewTab,
  workflows: WorkflowsTab,
  executions: ExecutionsTab,
  evidence: EvidenceTab,
  city: CityTab,
  intake: IntakeTab,
  reality: RealityTab,
  how: HowItWorksTab,
  settings: SettingsTab,
};

/**
 * The sidebar leads with the three things the product is about: the playbook a case runs through,
 * the decisions waiting for a person, and the cases that have run. Every other page is still
 * there, under "More", so the first screen is not a menu of ten places to go.
 * "decisions" opens the Decisions drawer instead of a tab; Settings sits at the bottom.
 */
type NavItem = { id: TabId; title: string; Icon: ComponentType<IconProps> } | { id: "decisions"; title: string; Icon: ComponentType<IconProps> };
const NAV: NavItem[] = [
  { id: "workflows", title: TAB_TITLES.workflows, Icon: IconWorkflow },
  { id: "decisions", title: "Decisions", Icon: IconDecisions },
  { id: "executions", title: TAB_TITLES.executions, Icon: IconRuns },
];
const MORE: { id: TabId; title: string; Icon: ComponentType<IconProps> }[] = [
  { id: "overview", title: TAB_TITLES.overview, Icon: IconHome },
  { id: "intake", title: TAB_TITLES.intake, Icon: IconNewCase },
  { id: "evidence", title: TAB_TITLES.evidence, Icon: IconEvidence },
  { id: "reality", title: TAB_TITLES.reality, Icon: IconReality },
  { id: "how", title: TAB_TITLES.how, Icon: IconInfo },
  { id: "city", title: TAB_TITLES.city, Icon: IconCity },
];
/** The page the console opens on. */
const HOME_TAB: TabId = "workflows";

/** Params that survive a tab switch. */
const STICKY_PARAMS = ["workflow"];

// Sidebar collapsed state, persisted per browser (convenience only).
const COLLAPSE_KEY = "rivet.console.sidebarCollapsed";
const collapseListeners = new Set<() => void>();
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable: state still flips for this session via listeners */
  }
  memCollapsed = v;
  collapseListeners.forEach((l) => l());
}
let memCollapsed: boolean | null = null;
function useCollapsed(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      collapseListeners.add(cb);
      return () => collapseListeners.delete(cb);
    },
    () => memCollapsed ?? readCollapsed(),
    () => false,
  );
  return [v, writeCollapsed];
}

export default function Shell() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const rawTab = search.get("tab");
  const tab: TabId = isTabId(rawTab) ? rawTab : HOME_TAB;
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const openReview = useCallback(() => setReviewOpen(true), []);
  const [collapsed, setCollapsed] = useCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteHotkey(togglePalette);

  const workflows = useWorkflows({ pollMs: 30_000 });
  const wfParam = search.get("workflow");
  const wf = useMemo(() => {
    const list = workflows.data?.workflows ?? [];
    return list.find((w) => w.id === wfParam) ?? list.find((w) => w.active) ?? list[0] ?? null;
  }, [workflows.data, wfParam]);

  const hrefFor = useCallback(
    (next: TabId, params?: ParamPatch, keepCurrent = false) => {
      const sp = new URLSearchParams();
      if (keepCurrent) search.forEach((v, k) => sp.set(k, v));
      else for (const k of STICKY_PARAMS) {
        const v = search.get(k);
        if (v) sp.set(k, v);
      }
      if (next === "overview") sp.delete("tab");
      else sp.set("tab", next);
      for (const [k, v] of Object.entries(params ?? {})) {
        if (v === null || v === undefined || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, search],
  );

  const ctx = useMemo<ConsoleContextValue>(
    () => ({
      tab,
      params: new URLSearchParams(search.toString()),
      navigate: (next, params) => router.push(hrefFor(next, params), { scroll: false }),
      setParams: (patch) => router.replace(hrefFor(tab, patch, true), { scroll: false }),
      workflowId: wf?.id ?? null,
      workflowName: wf?.name ?? null,
      headerSlot,
    }),
    [tab, search, router, hrefFor, wf, headerSlot],
  );

  const Active = TAB_COMPONENT[tab];

  return (
    <ConsoleContext.Provider value={ctx}>
      <div className="console-root flex h-dvh min-h-0 w-full overflow-hidden">
        <Sidebar tab={tab} hrefFor={hrefFor} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} onOpenDecisions={openReview} decisionsOpen={reviewOpen} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="rv-shell-header flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-rv-canvas px-5">
            <div className="flex min-w-0 flex-1 items-baseline gap-3">
              <h1 className="shrink-0 text-[17px] font-semibold text-white">{TAB_TITLES[tab]}</h1>
              {tab !== "overview" && wf?.name && (
                <Link
                  href={hrefFor("workflows")}
                  title="Open playbook"
                  className="truncate text-[13px] text-white/45 hover:text-white/80"
                >
                  Playbook: {wf.name}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search and commands (⌘K)"
              title="Search and commands"
              className="hidden h-8 items-center gap-2 rounded-md border border-white/10 px-2.5 text-[13px] text-white/45 hover:border-white/20 hover:text-white/80 md:flex"
            >
              <IconSearch size={14} />
              <span>Search</span>
              <kbd className="rounded border border-white/15 px-1 text-[10px] text-white/45">⌘K</kbd>
            </button>
            <LiveStatus />
            {/* The page's one primary button. A tab's own <HeaderActions> wins; otherwise the
                shell's default for that tab shows (hidden by CSS once the tab slot has content). */}
            <div ref={setHeaderSlot} className="rv-tab-actions flex shrink-0 items-center gap-2 empty:hidden" />
            <div className="rv-default-action flex shrink-0 items-center">
              <DefaultPrimary tab={tab} />
            </div>
          </header>
          <AgentOfflineBanner />
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-rv-canvas">
            <TabErrorBoundary resetKey={tab}>
              <Active key={tab} />
            </TabErrorBoundary>
          </main>
        </div>
      </div>
      <style>{`.rv-shell-header:has(.rv-tab-actions > *) .rv-default-action { display: none; }`}</style>
      <CommandPalette open={paletteOpen} onClose={closePalette} onOpenDecisions={openReview} />
      {reviewOpen && <ReviewDrawer onClose={closeReview} source="agent" />}
      <Toaster />
    </ConsoleContext.Provider>
  );
}


/** Live = the agent answers. Anything else (checking, console down, agent down) is not Live. */
function LiveStatus() {
  const status = useStatus({ pollMs: 5000 });
  const live = status.data?.agentApi === true;
  const checking = status.loading;
  const text = checking ? "Checking" : live ? "Live" : "Offline";
  const title = checking ? "Checking the agent" : live ? "The agent is on and answering." : "The agent is off. Cases can't run right now.";
  return (
    <div
      role="status"
      aria-label={text}
      title={title}
      className={cx(
        "flex h-8 shrink-0 items-center gap-2 px-1 text-[13px] font-medium",
        live ? "text-rv-green" : checking ? "text-white/45" : "text-rv-red",
      )}
    >
      <span>{text}</span>
      <StatusDot tone={checking ? "neutral" : live ? "green" : "red"} pulse={checking} />
    </div>
  );
}

/** The shell's primary button per tab, used when the tab doesn't put its own in the header. */
function DefaultPrimary({ tab }: { tab: TabId }): ReactNode {
  const { navigate } = useConsole();
  switch (tab) {
    case "overview":
      return (
        <Button variant="primary" icon={<IconNewCase size={15} />} onClick={() => navigate("intake")}>
          New case
        </Button>
      );
    case "executions":
    case "evidence":
      return <ExecuteButton />;
    case "city":
      return (
        <a
          href="/city"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-rv-orange px-4 text-sm font-medium text-white hover:bg-rv-orange-hi"
        >
          <IconCity size={15} />
          Open the city
        </a>
      );
    default:
      return null; // New case, Playbooks, Reality Test, How it works, Settings bring their own
  }
}

function Sidebar({
  tab,
  hrefFor,
  collapsed,
  onToggle,
  onOpenDecisions,
  decisionsOpen,
}: {
  tab: TabId;
  hrefFor: (t: TabId) => string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenDecisions: () => void;
  decisionsOpen: boolean;
}) {
  const { tasks } = useReviewQueue();
  const waiting = tasks.filter((t) => !t.simulated && t.status === "pending").length;
  // "More" starts open only when the page being shown lives under it.
  const [moreOpen, setMoreOpen] = useState(() => MORE.some((m) => m.id === tab));

  const row = (on: boolean) =>
    cx(
      "relative flex h-10 w-full items-center gap-3 rounded-md text-sm transition-colors",
      collapsed ? "justify-center" : "px-2.5",
      on ? "bg-rv-orange/[0.12] font-medium text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
    );
  const marker = <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r bg-rv-orange" />;

  const tabLink = (id: TabId, title: string, Icon: ComponentType<IconProps>) => {
    const on = id === tab;
    return (
      <Link
        href={hrefFor(id)}
        scroll={false}
        aria-current={on ? "page" : undefined}
        title={collapsed ? title : undefined}
        className={row(on)}
      >
        {on && marker}
        <Icon size={18} className={on ? "text-rv-orange" : undefined} />
        {!collapsed && <span className="truncate">{title}</span>}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Console"
      className={cx(
        "flex shrink-0 flex-col border-r border-white/[0.07] bg-rv-sidebar transition-[width] duration-150",
        collapsed ? "w-[60px]" : "w-[196px]",
      )}
    >
      <div className={cx("flex h-14 shrink-0 items-center gap-2.5", collapsed ? "justify-center" : "px-3.5")}>
        <RivetMark size={26} />
        {!collapsed && <div className="text-[15px] font-semibold text-white">Hamyway City</div>}
      </div>

      <ul className="flex flex-col gap-0.5 px-2 pt-2">
        {NAV.map((item) => (
          <li key={item.id}>
            {item.id === "decisions" ? (
              <button
                type="button"
                onClick={onOpenDecisions}
                aria-haspopup="dialog"
                aria-expanded={decisionsOpen}
                title={collapsed ? `Decisions${waiting ? ` (${waiting} waiting)` : ""}` : undefined}
                className={row(decisionsOpen)}
              >
                {decisionsOpen && marker}
                <span className="relative">
                  <item.Icon size={18} className={decisionsOpen ? "text-rv-orange" : undefined} />
                  {collapsed && waiting > 0 && (
                    <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-rv-orange" aria-hidden />
                  )}
                </span>
                {!collapsed && <span className="truncate">Decisions</span>}
                {!collapsed && waiting > 0 && (
                  <span
                    className="ml-auto rounded-full bg-rv-orange px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular"
                    aria-label={`${waiting} waiting`}
                  >
                    {waiting}
                  </span>
                )}
              </button>
            ) : (
              tabLink(item.id, item.title, item.Icon)
            )}
          </li>
        ))}
        <li className="mt-2">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            title={collapsed ? "More pages" : undefined}
            className={cx("flex h-8 w-full items-center gap-3 rounded-md text-[12px] uppercase tracking-wide text-white/35 hover:text-white/70", collapsed ? "justify-center" : "px-2.5")}
          >
            <IconChevronRight size={14} className={cx("transition-transform", moreOpen && "rotate-90")} />
            {!collapsed && <span>More</span>}
          </button>
        </li>
        {moreOpen && MORE.map((item) => <li key={item.id}>{tabLink(item.id, item.title, item.Icon)}</li>)}
      </ul>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/[0.06] px-2 py-2">
        {tabLink("settings", TAB_TITLES.settings, IconSettings)}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Show menu" : "Hide menu"}
          title={collapsed ? "Show menu" : "Hide menu"}
          className={cx(
            "flex h-8 items-center gap-3 rounded-md text-[12px] text-white/40 hover:bg-white/[0.05] hover:text-white/80",
            collapsed ? "justify-center" : "px-2.5",
          )}
        >
          {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          {!collapsed && <span>Hide menu</span>}
        </button>
      </div>
    </nav>
  );
}
