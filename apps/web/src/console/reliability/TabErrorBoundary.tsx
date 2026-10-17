"use client";
// Keeps one broken tab from taking down the console. Shows one plain line and a Reload button;
// the technical reason is folded away under "Details". Resets by itself when `resetKey` changes
// (e.g. the user picks another tab). Reload remounts the tab; if it breaks again right away,
// the next Reload reloads the whole page.
import { Component, type ErrorInfo, type ReactNode } from "react";

export const TAB_ERROR_MESSAGE = "Something broke on this page.";

interface Props {
  children: ReactNode;
  /** Change it (e.g. the tab id) to clear the error automatically. */
  resetKey?: unknown;
  /** Called once per caught error, e.g. for logging. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/** A second Reload within this window reloads the whole page instead of just the tab. */
const RELOAD_PAGE_WITHIN_MS = 30_000;

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private lastRemountAt = 0;
  private prevKey: unknown = this.props.resetKey;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[console] tab crashed:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate() {
    if (this.props.resetKey !== this.prevKey) {
      this.prevKey = this.props.resetKey;
      this.lastRemountAt = 0;
      if (this.state.error) this.setState({ error: null });
    }
  }

  private reload = () => {
    const now = Date.now();
    if (now - this.lastRemountAt < RELOAD_PAGE_WITHIN_MS && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    this.lastRemountAt = now;
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="m-4 rounded-md border border-white/[0.08] bg-rv-card p-4 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-white/85">{TAB_ERROR_MESSAGE}</span>
          <button
            type="button"
            onClick={this.reload}
            className="shrink-0 rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/85 hover:bg-white/[0.1]"
          >
            Reload
          </button>
        </div>
        <details className="mt-3 text-white/45">
          <summary className="cursor-pointer select-none text-xs">Details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-white/45">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </details>
      </div>
    );
  }
}

export default TabErrorBoundary;
