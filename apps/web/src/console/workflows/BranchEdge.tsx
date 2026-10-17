"use client";
// Orthogonal edge with rounded corners. The vertical trunk sits a fixed distance from the source
// (per-output slot from edgeRoutes), and the `when` label is a pill at the start of the last
// segment, just after the branch point, where no other line runs.
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { TRUNK } from "./layout";
import { plainWhen } from "./nodeTypes";

export type BranchEdgeData = {
  when?: string;
  /** Trunk distance from the source handle. */
  trunk?: number;
  /** Colour the gate exits; off while an overlay (run / diff) owns the colours. */
  plain?: boolean;
  /** Label colour override (run overlay, diff). */
  labelTone?: "taken" | "added" | "removed" | "faded";
};
export type BranchEdgeType = Edge<BranchEdgeData, "branch">;

export const EXIT_COLORS: Record<string, string> = {
  allow: "#22c55e", ok: "#22c55e", approve: "#22c55e",
  ask: "#f59e0b", retry: "#f59e0b",
  block: "#ef4444", failed: "#ef4444", reject: "#ef4444",
};

export function BranchEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps<BranchEdgeType>) {
  const trunk = data?.trunk ?? TRUNK;
  const forward = targetX > sourceX + trunk + 12;
  const [path, lx, ly] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10,
    ...(forward ? { centerX: sourceX + trunk } : {}),
  });
  const when = data?.when;
  const exit = when ? EXIT_COLORS[when.toLowerCase()] : undefined;
  const stroke = selected ? "#ff6a1a" : data?.plain && exit ? exit : undefined;
  const tone = data?.labelTone;
  const pillColor =
    tone === "taken" || tone === "added" ? "#4ade80" : tone === "removed" ? "#f87171" : tone === "faded" ? "#71717a" : exit ?? "#d4d4d8";
  const x = forward ? sourceX + trunk + 8 : lx;
  const y = forward ? targetY : ly;

  return (
    <>
      <BaseEdge id={id} path={path} style={stroke ? { stroke, strokeWidth: 2.25 } : undefined} />
      {when && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute max-w-[112px] truncate rounded-full border px-2 py-[1px] text-[10px] font-semibold leading-[14px]"
            style={{
              transform: `translate(${x}px, ${y}px) translate(${forward ? "0" : "-50%"}, -50%)`,
              color: pillColor,
              borderColor: `${pillColor}66`,
              background: "#1f1f23",
            }}
          >
            {plainWhen(when)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
