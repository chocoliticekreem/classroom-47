// The live engine instance, for overlays (the HUD) that want richer case data or to answer a decision card:
//   getWorkflowEngine()?.cases()  /  getWorkflowEngine()?.decide(caseId, option)
import type { WorkflowEngine } from "./engine";
import type { CityAgentLink } from "./link";

let current: WorkflowEngine | null = null;

export function setWorkflowEngine(e: WorkflowEngine | null) {
  current = e;
}

export function getWorkflowEngine(): WorkflowEngine | null {
  return current;
}

// The live city agent link (WorkflowDriver), and what a restored city (cityState.ts) left for it to pick up.

let link: CityAgentLink | null = null;
export interface PendingRestore {
  /** Incidents that were waiting in the queue before the refresh. */
  requeueIncidents: string[];
  /** City executions still running in the console: id + HUD label. */
  resume: { executionId: string; label: string }[];
}
let pending: PendingRestore | null = null;

export function setCityLink(l: CityAgentLink | null) {
  link = l;
  if (l && pending) applyRestore(l, pending);
}

export function getCityLink(): CityAgentLink | null {
  return link;
}

/** Hand the restored queue to the link now, or as soon as it exists. */
export function restoreQueue(p: PendingRestore) {
  if (link) applyRestore(link, p);
  else pending = p;
}

function applyRestore(l: CityAgentLink, p: PendingRestore) {
  pending = null;
  // Restored incident cases are not re-sent: city incidents are scenery, not agent cases.
  for (const r of p.resume) l.resume(r.executionId, r.label);
}
