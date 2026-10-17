"use client";

import { Bell, Search } from "lucide-react";

export function TopBar({ live }: { live: boolean }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-5 border-b border-line bg-surface px-4 lg:px-5">
      <div className="flex items-center gap-3">
        <span className="relative grid size-7 place-items-center rounded-[6px] bg-ember font-mono text-[11px] font-bold leading-none text-bg">
          47
          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-text" />
        </span>
        <span className="font-display text-[17px] font-semibold leading-none tracking-[-0.02em]">
          Classroom <span className="text-muted">47</span>
        </span>
        <span className="hidden items-center gap-1.5 border-l border-line pl-3 font-mono text-[10px] tracking-normal text-dim lg:flex">
          London
          <span className="size-0.5 rounded-full bg-dim" />
          IRL
        </span>
      </div>

      <div className="mx-auto hidden w-full max-w-sm items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 transition-colors focus-within:border-line-strong md:flex">
        <Search className="size-3.5 text-dim" aria-hidden />
        <input
          type="search"
          placeholder="Search streams, places, people"
          className="w-full bg-transparent text-[13px] text-text placeholder:text-dim focus:outline-none"
        />
        <kbd className="rounded border border-line px-1 font-mono text-[10px] text-dim">/</kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={`flex h-7 items-center gap-2 rounded-md border px-2.5 font-mono text-[10px] tracking-normal ${
            live ? "border-live/40 bg-live/10 text-live" : "border-line text-muted"
          }`}
        >
          <span className={`size-1.5 rounded-full ${live ? "animate-live bg-live" : "bg-dim"}`} />
          {live ? "On air" : "Standby"}
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Bell className="size-4" />
        </button>
        <span className="grid size-8 place-items-center rounded-md bg-surface-2 font-mono text-[11px] font-semibold ring-1 ring-line">
          SN
        </span>
      </div>
    </header>
  );
}
