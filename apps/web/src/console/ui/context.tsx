"use client";
// Console navigation + header slot. Provided by console/Shell.tsx; tabs read it via useConsole().
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TAB_IDS = ["overview", "intake", "executions", "workflows", "evidence", "reality", "how", "city", "settings"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** What a person reads. Ids stay internal (URLs, code). */
export const TAB_TITLES: Record<TabId, string> = {
  overview: "Home",
  intake: "New case",
  reality: "Reality Test",
  how: "How it works",
  settings: "Settings",
  workflows: "Playbooks",
  executions: "Case runs",
  evidence: "Results",
  city: "City",
};

export function isTabId(x: string | null | undefined): x is TabId {
  return !!x && (TAB_IDS as readonly string[]).includes(x);
}

export type ParamPatch = Record<string, string | null | undefined>;

export interface ConsoleContextValue {
  tab: TabId;
  /** Current URL search params (read-only snapshot). */
  params: URLSearchParams;
  /**
   * Switch tab. Tab-specific params (everything except `workflow`) are dropped unless passed
   * in `params`, e.g. navigate("executions", { id: exec.id }).
   */
  navigate: (tab: TabId, params?: ParamPatch) => void;
  /** Patch params on the current tab (null/undefined deletes). Uses history replace. */
  setParams: (patch: ParamPatch) => void;
  /** Workflow shown in the header: `?workflow=` or the first active workflow. */
  workflowId: string | null;
  workflowName: string | null;
  /** DOM node in the header where <HeaderActions> portals into. */
  headerSlot: HTMLElement | null;
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole(): ConsoleContextValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole() must be used inside the console Shell");
  return ctx;
}

/**
 * Render buttons into the header's right-hand action area.
 *   <HeaderActions><ExecuteButton /></HeaderActions>
 * Only the active tab is mounted, so each tab owns the slot while visible.
 * Rule: ONE primary button per page; anything else goes behind "Advanced" in the tab.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const ctx = useContext(ConsoleContext);
  if (!ctx?.headerSlot) return null;
  return createPortal(children, ctx.headerSlot);
}
