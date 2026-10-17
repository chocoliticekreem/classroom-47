// Minimal undo/redo stack.
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new state (undoable). No-op when the state is the same object. */
export function push<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

/** Replace the present without recording (e.g. intermediate drag frames after a checkpoint). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next };
}

/** Save the present as an undo point without changing it (e.g. at drag start). */
export function checkpoint<T>(h: History<T>): History<T> {
  return { past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
