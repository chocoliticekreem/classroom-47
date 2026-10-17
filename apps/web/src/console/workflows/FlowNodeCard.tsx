"use client";
// Canvas step card: a simple icon, a big plain title, the run status, and handles.
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "../types";
import { Icon } from "./icons";
import { metaFor, nodeTitle, plainWhen } from "./nodeTypes";
import type { NodeRun } from "./status";
import { runMark } from "./runStats";
import type { DiffMark, NodeChange } from "./testing";
import { CARD_H, CARD_W, GATE_H } from "./layout";

export type CardData = {
  node: FlowNode;
  run: NodeRun | null;
  /** A case run is shown and this step did not run in it. */
  dimmed: boolean;
  /** Safety-check problems that name this step (red outline, text in the tooltip). */
  problems?: string[];
  /** Just placed by "Make a playbook": play the appear animation. */
  appear?: boolean;
  /** The step "Make a playbook" placed last: highlighted while the draft builds. */
  fresh?: boolean;
  /** On the path from the start to the selected step. */
  onPath?: boolean;
  /** Shown as part of suggested changes. */
  diff?: { mark: DiffMark; change?: NodeChange };
  /** The step is drawn more than once in the tree (display-time unmerge). */
  shared?: { count: number; stub: boolean };
  /** Loops back (retry) leaving this step. */
  loops?: string[];
  /** How many of the last N case runs passed through this step. */
  tally?: { passed: number; runs: number; label: string };
};
export type CardNode = Node<CardData, "card">;

export { CARD_W };

const EXIT_COLORS: Record<string, string> = { allow: "#22c55e", ask: "#f59e0b", block: "#ef4444" };
const MARK_TEXT: Record<string, string> = { added: "New", removed: "Removed", changed: "Changed" };

function StatusMark({ run }: { run: NodeRun }) {
  if (run.status === "running") {
    return <span className="wf-spin block h-4 w-4 rounded-full border-2 border-[#ff6a1a] border-t-transparent" title="Working" />;
  }
  const mark = runMark(run);
  if (mark === "error") {
    return <span className="wf-mark grid h-5 w-5 place-items-center rounded-full bg-rv-red text-white" title="Went wrong"><Icon name="close" size={12} strokeWidth={3} /></span>;
  }
  if (mark === "warn") {
    return (
      <span className="wf-mark grid h-5 w-5 place-items-center rounded-full bg-rv-amber text-[13px] font-bold leading-none text-[#2a1a00]" title={run.status === "skipped" ? "Skipped" : "Held for a person"}>
        !
      </span>
    );
  }
  return (
    <span className="wf-mark grid h-5 w-5 place-items-center rounded-full bg-rv-green text-[#0b1f12]" title="Done">
      <Icon name="check" size={13} strokeWidth={3} />
    </span>
  );
}

/** A threshold change in plain words: lower allow / block numbers mean more careful. */
function carefulWord(change: NodeChange): string | null {
  const c = change.config.find((x) => (x.key === "allow_below" || x.key === "block_above") && typeof x.from === "number" && typeof x.to === "number");
  if (!c) return change.config.length || change.runners ? "Settings changed" : null;
  return (c.to as number) < (c.from as number) ? "More careful" : "Less careful";
}

function FlowNodeCardImpl({ data, selected }: NodeProps<CardNode>) {
  const { node, run, dimmed, problems, appear, fresh, onPath, diff, shared, loops, tally } = data;
  const mark = diff?.mark ?? null;
  const bad = !!problems?.length;
  const meta = metaFor(node.type);
  const outs = meta.outputs;
  const tall = !!outs && outs.length > 1;
  const border =
    mark === "added" ? "#22c55e"
      : mark === "removed" ? "#ef4444"
      : mark === "changed" ? "#f59e0b"
      : bad || run?.status === "error" ? "#ef4444"
      : selected || fresh ? "#ff6a1a" : onPath ? "#ff6a1a99" : run?.status === "ok" ? "#3ecf8e66" : "#3a3a42";
  const title = nodeTitle(node);
  const change = mark === "changed" && diff?.change ? carefulWord(diff.change) : null;

  return (
    <div
      className={`wf-card relative overflow-visible rounded-xl text-white transition-[opacity,box-shadow,background-color] ${selected ? "bg-[#33302e]" : "bg-[#2a2a30] hover:bg-[#303037]"} ${dimmed ? "opacity-35" : ""} ${appear ? "wf-appear" : ""} ${fresh ? "wf-fresh" : ""} ${diff && !mark ? "opacity-50" : ""}`}
      style={{
        width: CARD_W, height: tall ? GATE_H : CARD_H,
        border: `${selected || fresh ? 2 : 1.5}px ${mark === "removed" ? "dashed" : "solid"} ${border}`,
        boxShadow: selected ? "0 0 0 4px rgba(255,106,26,0.18)" : undefined,
      }}
      title={bad ? problems!.join("\n") : undefined}
    >
      <Handle type="target" position={Position.Left} id="in" className="wf-handle" />

      {/* Kind stripe: one colour per group of steps. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[4px] rounded-l-[10px]" style={{ background: meta.color, opacity: dimmed ? 0.5 : 0.9 }} />

      {tally && tally.runs > 0 && !mark && (
        <div
          className={`pointer-events-none absolute -top-[10px] left-3 inline-flex h-[19px] items-center gap-1 rounded-full border px-2 text-[11px] font-medium tabular-nums ${tally.passed ? "border-rv-green/35 bg-[#16241d] text-[#9be8c4]" : "border-white/10 bg-[#222227] text-white/40"}`}
          aria-label={tally.label}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tally.passed ? "bg-rv-green" : "bg-white/20"}`} />
          {tally.passed} of {tally.runs} cases
        </div>
      )}

      <div className="flex h-full items-center gap-2.5 pl-4 pr-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.07]" style={{ color: meta.color }}>
          <Icon name={meta.icon} size={20} />
        </div>
        <div className={`min-w-0 flex-1 ${tall ? "pr-[74px]" : "pr-2"}`}>
          <div className={`line-clamp-2 text-[17px] font-semibold leading-[1.22] tracking-[-0.005em] ${mark === "removed" ? "text-white/50 line-through" : "text-white"}`}>
            {title}
          </div>
          {mark && <div className="mt-0.5 text-[12px] font-medium" style={{ color: border }}>{MARK_TEXT[mark]}{change ? ` · ${change}` : ""}</div>}
          {!mark && shared?.stub && <div className="mt-0.5 text-[12px] text-white/50">Continues elsewhere ↗</div>}
          {!mark && loops && loops.length > 0 && <div className="mt-0.5 text-[12px] text-white/50">↺ Tries again once</div>}
        </div>
      </div>

      {run && (
        <div className="absolute -right-2 -top-2">
          <StatusMark run={run} />
        </div>
      )}

      {outs && outs.length > 1 ? (
        outs.map((o, i) => {
          const top = `${((i + 1) / (outs.length + 1)) * 100}%`;
          return (
            <div key={o}>
              <span
                className="pointer-events-none absolute right-3 -translate-y-1/2 text-[12px] font-semibold"
                style={{ top, color: EXIT_COLORS[o] ?? "#cbd5e1" }}
              >
                {plainWhen(o)}
              </span>
              <Handle type="source" position={Position.Right} id={o} className="wf-handle" style={{ top, background: EXIT_COLORS[o] ?? undefined }} />
            </div>
          );
        })
      ) : (
        <Handle type="source" position={Position.Right} id="out" className="wf-handle" />
      )}
    </div>
  );
}

export const FlowNodeCard = memo(FlowNodeCardImpl);
