"use client";

import { Bell, Search } from "lucide-react";

export function TopBar({ live }: { live: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-surface px-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-ember text-[13px] font-black text-bg">
          47
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Classroom 47</span>
      </div>

      <div className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 md:flex">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          type="search"
          placeholder="Search streams, places, people"
          className="w-full bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
            live ? "border-live/40 bg-live/10 text-live" : "border-line text-muted"
          }`}
        >
          <span className={`size-1.5 rounded-full ${live ? "animate-live bg-live" : "bg-muted"}`} />
          {live ? "You're live" : "Offline"}
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Bell className="size-4" />
        </button>
        <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-line">
          C4
        </span>
      </div>
    </header>
  );
}
