// Road closures for city events: the rolling window around a moving event (motorcade, march, parade)
// and a ledger that only ever reopens the roads it closed itself. Pure (the store is injected).
import { edgeKey, neighbours } from "../../roads";

/** Junctions ahead of the head that are closed in advance (police hold them before the convoy arrives). */
export const AHEAD_EDGES = 3;

/**
 * Edges closed while an event occupies route edges [tailIdx, headIdx]: those route edges, `ahead` more
 * in front, and every side road at the junctions in that stretch (cross traffic is held). Edges behind
 * the tail are not included, so they reopen as the event passes.
 */
export function rollingWindow(route: readonly string[], tailIdx: number, headIdx: number, ahead = AHEAD_EDGES, sideRoads = true): Set<string> {
  const out = new Set<string>();
  const lastEdge = route.length - 2;
  if (lastEdge < 0) return out;
  const t = Math.max(0, Math.min(lastEdge, tailIdx));
  const h = Math.max(t, Math.min(lastEdge, headIdx + ahead));
  for (let k = t; k <= h; k++) out.add(edgeKey(route[k], route[k + 1]));
  if (sideRoads) {
    const on = new Set(out);
    for (let k = t + 1; k <= h + 1 && k < route.length; k++) {
      // don't hold side roads at the very last node (the destination gate) or the first
      if (k === route.length - 1) continue;
      for (const nb of neighbours(route[k])) {
        const key = edgeKey(route[k], nb);
        if (!on.has(key)) out.add(key);
      }
    }
  }
  return out;
}

/** Every edge of a route plus (optionally) side roads at its inner junctions: a full-course closure. */
export function fullClosure(route: readonly string[], sideRoads = true): Set<string> {
  return rollingWindow(route, 0, route.length - 2, 0, sideRoads);
}

/** What to close and reopen to go from `prev` to `next`. */
export function diffClosures(prev: ReadonlySet<string>, next: ReadonlySet<string>): { close: string[]; open: string[] } {
  const close: string[] = [];
  const open: string[] = [];
  for (const k of next) if (!prev.has(k)) close.push(k);
  for (const k of prev) if (!next.has(k)) open.push(k);
  return { close, open };
}

export interface ClosureStore {
  blocked(): Readonly<Record<string, string>>;
  block(key: string, reason: string): void;
  unblock(key: string): void;
}

/**
 * The roads one event has closed. It never overwrites someone else's closure (a crash on the route keeps
 * its own reason and is reopened by its owner) and only reopens keys still carrying its own reason.
 */
export class ClosureLedger {
  private owned = new Set<string>();
  private wanted = new Set<string>();

  constructor(private readonly store: ClosureStore, readonly reason: string) {}

  /** Keys this ledger has closed right now. */
  get keys(): ReadonlySet<string> {
    return this.owned;
  }

  /** Make the closed set equal `next` (as far as it's free to close). Returns true if anything changed. */
  set(next: ReadonlySet<string>): boolean {
    const blocked = this.store.blocked();
    const { close, open } = diffClosures(this.wanted, next);
    this.wanted = new Set(next);
    let changed = false;
    for (const k of open) {
      if (this.owned.delete(k) && blocked[k] === this.reason) {
        this.store.unblock(k);
        changed = true;
      }
    }
    for (const k of close) {
      if (blocked[k] !== undefined && blocked[k] !== this.reason) continue; // someone else's closure
      if (blocked[k] === undefined) this.store.block(k, this.reason);
      this.owned.add(k);
      changed = true;
    }
    return changed;
  }

  /** Re-close any wanted key another module reopened, and adopt ones that became free. */
  reassert(): boolean {
    const blocked = this.store.blocked();
    let changed = false;
    for (const k of this.wanted) {
      if (blocked[k] === undefined) {
        this.store.block(k, this.reason);
        this.owned.add(k);
        changed = true;
      } else if (blocked[k] !== this.reason) this.owned.delete(k);
    }
    return changed;
  }

  /** Reopen everything this ledger closed. */
  releaseAll() {
    const blocked = this.store.blocked();
    for (const k of this.owned) if (blocked[k] === this.reason) this.store.unblock(k);
    this.owned.clear();
    this.wanted.clear();
  }
}

/** Keys whose reason is one of `reasons` but no live ledger owns: leftovers to reopen (hot reload, crashes). */
export function orphanClosures(blocked: Readonly<Record<string, string>>, reasons: ReadonlySet<string>, owned: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [k, r] of Object.entries(blocked)) if (reasons.has(r) && !owned.has(k)) out.push(k);
  return out;
}
