// Execution overlay maths for the playbook canvas: which badge a step gets in one case run,
// how many of the last N runs passed through each step, and the "Last run" and "Settings"
// views of a step in plain words. Pure: no fetching, no React.
import type { FlowNode } from "../types";
import { cents, plainNode, plainStep, scrubLeaks } from "../../ui/plain";
import { fmtMs, inputsOf, type NodeRun, type RunOverlay } from "./status";

/** Badge on a card in a run: green check, amber (a person was needed / held back), red (went wrong). */
export type RunMark = "ok" | "warn" | "error";

export function runMark(run: NodeRun | null | undefined): RunMark | null {
  if (!run || run.status === "running") return null;
  if (run.status === "error") return "error";
  if (run.status === "skipped") return "warn";
  const out = (run.output ?? null) as Record<string, unknown> | null;
  if (out?.type === "safety_gate" && typeof out.decision === "string" && out.decision !== "allow") return "warn";
  if (out?.type === "human_decision") return "warn";
  if (out?.type === "verify" && out.ok === false) return "warn";
  return "ok";
}

export interface NodeTally { passed: number; ok: number; warn: number; error: number }
export interface RunTally {
  /** How many runs were counted. */
  runs: number;
  nodes: Record<string, NodeTally>;
  /** `from->to` -> how many runs took that hop. */
  edges: Record<string, number>;
}

/** Counts, per step and per hop, how many of the given runs passed through it. */
export function tallyRuns(overlays: RunOverlay[]): RunTally {
  const nodes: Record<string, NodeTally> = {};
  const edges: Record<string, number> = {};
  for (const o of overlays) {
    for (const [id, run] of Object.entries(o.nodes)) {
      const t = (nodes[id] ??= { passed: 0, ok: 0, warn: 0, error: 0 });
      t.passed += 1;
      const m = runMark(run);
      if (m) t[m] += 1;
    }
    for (const k of o.taken) edges[k] = (edges[k] ?? 0) + 1;
  }
  return { runs: overlays.length, nodes, edges };
}

/** "7 of 10 cases passed here" / "No case passed here". */
export function passedLabel(t: NodeTally | undefined, runs: number): string {
  const n = t?.passed ?? 0;
  if (!runs) return "";
  if (!n) return `None of the last ${runs} cases came here`;
  return `${n} of ${runs} case${runs === 1 ? "" : "s"} passed here`;
}

type RunRow = { id: string; workflowId: string; status: string; startedAt: string };

/** The last `n` finished runs of one playbook, newest first. */
export function playbookRuns<T extends RunRow>(rows: T[] | null | undefined, workflowId: string | null, n = 20): T[] {
  if (!rows || !workflowId) return [];
  return rows
    .filter((r) => r.workflowId === workflowId && r.status !== "running")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, n);
}

// ---------- Last run ----------

export interface LastRunView {
  /** What came in: one block per earlier step (or the case itself for the first step). */
  input: { from: string; lines: string[] }[];
  /** What the step did, in plain words. */
  output: string[];
  mark: RunMark | null;
  /** "1.2s · 0.4p" style footnote; empty when nothing was spent. */
  cost: string;
}

const clean = (lines: (string | null | undefined)[]) =>
  lines.map((l) => scrubLeaks(l)).filter((l) => l.length > 2);

/** The "Last run" tab for a step: input -> output in plain words. Null when it did not run. */
export function lastRunView(
  overlay: RunOverlay | null, nodeId: string, flow?: { nodes: Pick<FlowNode, "id" | "type">[] } | null,
): LastRunView | null {
  const run = overlay?.nodes[nodeId];
  if (!overlay || !run) return null;
  // Traces without node_start events leave nodeType empty; the flow knows it.
  const typeOf = (r: NodeRun) => r.nodeType || flow?.nodes.find((n) => n.id === r.nodeId)?.type || r.nodeId;
  const ups = inputsOf(overlay, nodeId);
  const input: LastRunView["input"] = [];
  if (!ups.length && overlay.start) {
    const files = overlay.start.inputs.map((i) => `${i.from}${i.channel ? ` (${i.channel})` : ""}`);
    input.push({
      from: "The case",
      lines: clean([overlay.start.title.replace(/^Case:\s*/i, ""), files.length ? `${files.length} item${files.length === 1 ? "" : "s"}: ${files.join(", ")}` : null]),
    });
  }
  for (const u of ups) {
    input.push({ from: plainNode(typeOf(u)), lines: clean([plainStep(typeOf(u), u.summary, u.output)]) });
  }
  const headline = plainStep(typeOf(run), run.summary, run.output);
  const output = clean([headline, ...run.detail]);
  // Drop a detail line that only repeats the headline.
  const dedup = output.filter((l, i) => output.indexOf(l) === i);
  const bits: string[] = [];
  if (run.latencyMs > 0) bits.push(fmtMs(run.latencyMs));
  if (run.costUsd > 0) bits.push(cents(run.costUsd));
  return { input, output: dedup, mark: runMark(run), cost: bits.join(" · ") };
}

// ---------- Settings ----------

export interface SettingRow {
  key: string;
  label: string;
  /** A 0-1 threshold, drawn as a slider. */
  threshold?: number;
  text?: string;
}

const LABELS: Record<string, string> = {
  allow_below: "Send on its own below",
  block_above: "Stop at or above",
};

function humanKey(k: string): string {
  const t = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function plainValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return scrubLeaks(v) || "—";
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? "" : "s"}` : "None";
  const n = Object.keys(v as object).length;
  return n ? `${n} setting${n === 1 ? "" : "s"}` : "None";
}

const isThreshold = (k: string, v: unknown) =>
  typeof v === "number" && v >= 0 && v <= 1 && /(below|above|threshold|min|max|_p$|^p_|risk|confidence)/i.test(k);

/** A step's config as plain rows; 0-1 thresholds become sliders. */
export function settingRows(node: Pick<FlowNode, "config">): SettingRow[] {
  const c = node.config ?? {};
  return Object.entries(c).map(([key, v]) =>
    isThreshold(key, v)
      ? { key, label: LABELS[key] ?? humanKey(key), threshold: v as number }
      : { key, label: LABELS[key] ?? humanKey(key), text: plainValue(v) },
  );
}

const RUNNER_WORD: Record<string, string> = {
  code: "Fixed rules", jev: "Quick yes/no check", claude: "Writes and plans", ortools: "Route maths",
};

/** How a step does its work, in words ("Fixed rules, Quick yes/no check"). */
export function runnerWords(runs_on: readonly string[]): string {
  return runs_on.map((r) => RUNNER_WORD[r] ?? humanKey(r)).join(", ");
}
