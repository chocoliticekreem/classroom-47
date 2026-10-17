"use client";
// Toast notifications. <Toaster/> is mounted once in console/Shell.tsx; call useToast() (or the
// plain toast() function) from anywhere:
//   const toast = useToast();
//   toast.success("Case sent");  toast.error("Couldn't save", { description: "Try again." });
//   toast({ title: "Saved", action: { label: "Open", onClick: () => navigate("executions") } });
// Short plain words only (ui-simplify-brief). Toasts close by themselves after a few seconds
// (errors stay longer), pause while hovered or focused, and are read out by screen readers.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cx";
import { IconAlert, IconCheck, IconX } from "./icons";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before it closes. 0 = stays until closed. Default 4500 (errors 7000). */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Reuse an id to replace an existing toast instead of stacking a new one. */
  id?: string;
}

export interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
}

type Listener = () => void;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;
const MAX = 4;

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: string) {
  const next = items.filter((t) => t.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

function push(opts: ToastOptions): string {
  const id = opts.id ?? `t${++seq}`;
  const item: ToastItem = { ...opts, id, tone: opts.tone ?? "info" };
  const rest = items.filter((t) => t.id !== id);
  items = [...rest, item].slice(-MAX);
  emit();
  return id;
}

type Shortcut = (title: ReactNode, opts?: Omit<ToastOptions, "title" | "tone">) => string;

export interface ToastFn {
  (opts: ToastOptions | string): string;
  success: Shortcut;
  error: Shortcut;
  warning: Shortcut;
  info: Shortcut;
  dismiss: (id: string) => void;
}

/** Show a toast from anywhere (also outside React). Returns its id. */
export const toast: ToastFn = Object.assign(
  (opts: ToastOptions | string) => push(typeof opts === "string" ? { title: opts } : opts),
  {
    success: ((title, o) => push({ ...o, title, tone: "success" })) as Shortcut,
    error: ((title, o) => push({ ...o, title, tone: "error" })) as Shortcut,
    warning: ((title, o) => push({ ...o, title, tone: "warning" })) as Shortcut,
    info: ((title, o) => push({ ...o, title, tone: "info" })) as Shortcut,
    dismiss: dismissToast,
  },
);

/** Hook form of toast(); stable across renders. */
export function useToast(): ToastFn {
  return toast;
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const snapshot = () => items;
const EMPTY: ToastItem[] = [];

const TONE: Record<ToastTone, { icon: ReactNode; bar: string }> = {
  info: { icon: <span className="block h-2 w-2 rounded-full bg-white/50" />, bar: "bg-white/30" },
  success: { icon: <IconCheck size={16} className="text-rv-green" />, bar: "bg-rv-green" },
  warning: { icon: <IconAlert size={16} className="text-rv-amber" />, bar: "bg-rv-amber" },
  error: { icon: <IconAlert size={16} className="text-rv-red" />, bar: "bg-rv-red" },
};

/** Renders the toast stack (bottom-right). Mount once (Shell does). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return (
    <div
      className="rv-toaster pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
      style={{ fontFamily: "var(--font-ui), ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* Two live regions so errors interrupt and everything else waits its turn. */}
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {list.filter((t) => t.tone !== "error").map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
        {list.filter((t) => t.tone === "error").map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ t }: { t: ToastItem }) {
  const paused = useRef(false);
  const duration = t.duration ?? (t.tone === "error" ? 7000 : 4500);
  useEffect(() => {
    if (duration <= 0) return;
    let left = duration;
    let last = Date.now();
    const iv = window.setInterval(() => {
      const now = Date.now();
      if (!paused.current) left -= now - last;
      last = now;
      if (left <= 0) dismissToast(t.id);
    }, 200);
    return () => window.clearInterval(iv);
  }, [t.id, duration]);
  const tone = TONE[t.tone];
  return (
    <div
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") dismissToast(t.id);
      }}
      className={cx(
        "rv-toast pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border border-white/10 bg-[#2a2a30] py-3 pr-2 pl-4 text-white shadow-lg shadow-black/40",
      )}
    >
      <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-[3px]", tone.bar)} />
      <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-5 font-medium text-white">{t.title}</div>
        {t.description && <div className="mt-0.5 text-[13px] leading-5 text-white/60">{t.description}</div>}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action?.onClick();
              dismissToast(t.id);
            }}
            className="mt-2 rounded text-[13px] font-medium text-rv-orange hover:underline"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        aria-label="Close"
        title="Close"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/45 hover:bg-white/[0.07] hover:text-white"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
