"use client";
// Top-bar links back into the desk console: "Desk" (home) and "Playbooks" (the editor). Same tab, so the
// city and the desk feel like one app. `?playbook=<id>` on the city URL is carried over to the editor.
import Link from "next/link";
import { useSyncExternalStore, type SyntheticEvent } from "react";

const noSubscribe = () => () => {};

/** The editor link, keeping `?playbook=<id>` when the city was opened for one playbook. */
export function playbooksHref(search: string): string {
  const id = new URLSearchParams(search).get("playbook");
  return id ? `/?tab=workflows&playbook=${encodeURIComponent(id)}` : "/?tab=workflows";
}

function usePlaybooksHref(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => playbooksHref(window.location.search),
    () => "/?tab=workflows",
  );
}

// Keep clicks and wheel on the links away from the camera controls.
const stop = (e: SyntheticEvent) => e.stopPropagation();
const GUARD = { onPointerDown: stop, onPointerUp: stop, onWheel: stop, onClick: stop } as const;

const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition";

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <g stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round">
        <circle cx="3" cy="2.5" r="1.4" />
        <circle cx="3" cy="9.5" r="1.4" />
        <circle cx="9" cy="5" r="1.4" />
        <path d="M3 3.9 V8.1 M3 6.2 C3 5 5.5 5 7.6 5" />
      </g>
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <path d="M1.8 5.6 L6 2 L10.2 5.6 M3 4.8 V10 H9 V4.8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DeskLinks() {
  const href = usePlaybooksHref();
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-1.5">
      <Link
        href="/"
        title="Back to the desk"
        {...GUARD}
        className={`${PILL} border-white/10 bg-white/[0.04] text-white/85 hover:border-white/30 hover:bg-white/[0.08] hover:text-white`}
      >
        <HomeIcon />
        Desk
      </Link>
      <Link
        href={href}
        title="Open the Playbooks editor"
        {...GUARD}
        className={`${PILL} border-[#ff6a1a]/60 bg-[#ff6a1a]/15 text-white hover:bg-[#ff6a1a]/25`}
      >
        <BranchIcon />
        Playbooks
      </Link>
    </div>
  );
}
