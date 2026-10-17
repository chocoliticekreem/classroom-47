"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";

interface ChatDockProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  viewers: number;
  live: boolean;
  desktop: boolean;
  /** Leaves room for the copilot's collapsed bar on phones. */
  raised: boolean;
}

/** Chat as a floating drawer: collapsed to a bubble by default, the crowd engine keeps running behind it. */
export function ChatDock({ messages, onSend, viewers, live, desktop, raised }: ChatDockProps) {
  const [open, setOpen] = useState(false);
  const last = messages.at(-1);
  const panel = <ChatPanel messages={messages} onSend={onSend} viewers={viewers} live={live} />;

  if (desktop) {
    return (
      <div className="absolute bottom-3 left-3 z-30 flex flex-col items-start">
        {open ? (
          <div className="glass flex h-[min(520px,70vh)] w-[340px] flex-col overflow-hidden rounded-[28px]">
            <div className="relative min-h-0 flex-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse chat"
                className="pill pill-sm glass absolute right-2 top-2 z-10 !h-7 !w-7 !px-0"
              >
                <X className="size-3.5" />
              </button>
              {panel}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pill glass h-11 max-w-[360px] !justify-start !pl-1.5 !pr-4 text-left !font-medium"
          >
            <span className="pill-candy relative grid size-8 shrink-0 place-items-center rounded-full text-white">
              <MessageSquare className="size-3.5" />
              {live && <span className="animate-live absolute right-0.5 top-0.5 size-1.5 rounded-full bg-live" />}
            </span>
            <span className="min-w-0 truncate text-[12px] text-text/85">
              {last ? (
                <>
                  <span className="font-semibold" style={{ color: last.color }}>
                    {last.username}
                  </span>{" "}
                  {last.text}
                </>
              ) : (
                <span className="text-muted">Chat</span>
              )}
            </span>
            {live && <span className="shrink-0 font-mono text-[10px] text-dim">{viewers.toLocaleString("en-GB")}</span>}
          </button>
        )}
      </div>
    );
  }

  if (open) {
    return (
      <div className="absolute inset-x-0 bottom-0 top-[18%] z-30 flex flex-col">
        <button type="button" aria-label="Collapse chat" onClick={() => setOpen(false)} className="h-6 shrink-0" />
        <div className="glass animate-sheet-up relative flex min-h-0 flex-1 flex-col rounded-t-[28px]">
          <button
            type="button"
            aria-label="Collapse chat"
            onClick={() => setOpen(false)}
            className="absolute left-1/2 top-1.5 z-10 grid h-5 w-12 -translate-x-1/2 place-items-center text-dim"
          >
            <ChevronDown className="size-4" />
          </button>
          <div className="min-h-0 flex-1 pt-3">{panel}</div>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open chat"
      className={`pill glass absolute right-3 z-30 !h-11 !w-11 !px-0 ${
        raised ? "bottom-[100px]" : "bottom-16"
      }`}
    >
      <MessageSquare className="size-4" />
      {live && <span className="animate-live absolute right-2 top-2 size-1.5 rounded-full bg-live" />}
    </button>
  );
}
