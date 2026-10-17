"use client";
// Small picture of the steps every case goes through, lit from the most recent case. Hidden behind
// "How it works" (collapsed by default). Plain step names only (docs/plans/ui-simplify-brief.md).
import { memo, useMemo, useState } from "react";
import type { WorkflowEvent } from "../../store";
import { caseTitle, FLOW_EDGES, FLOW_NODES, gateBranch, nodeStatuses, stepName, type FlowNode, type NodeStatus } from "./flow";
import { STATUS_COLOR } from "./theme";

const BRANCH_WORD = { allow: "OK", ask: "Ask", block: "Stop" } as const;

const W = 100;
const H = 28;
const COL = 112;
const ROW = 50;
const PAD_X = 4;
const PAD_Y = 8;
const VB_W = PAD_X * 2 + COL * 3 + W;
const VB_H = PAD_Y * 2 + ROW * 3 + H;

const BY_ID = new Map(FLOW_NODES.map((n) => [n.id, n]));
const pos = (n: FlowNode) => ({ x: PAD_X + n.col * COL, y: PAD_Y + n.row * ROW });

function edgePath(a: FlowNode, b: FlowNode) {
  const pa = pos(a);
  const pb = pos(b);
  if (a.row === b.row) {
    const fwd = b.col > a.col;
    const sx = fwd ? pa.x + W : pa.x;
    const ex = fwd ? pb.x : pb.x + W;
    const y = pa.y + H / 2;
    return { d: `M${sx},${y} L${ex},${y}`, mx: (sx + ex) / 2, my: y };
  }
  const sx = pa.x + W / 2;
  const sy = pa.y + H;
  const ex = pb.x + W / 2;
  const ey = pb.y;
  const k = (ey - sy) * 0.6;
  return {
    d: `M${sx},${sy} C${sx},${sy + k} ${ex},${ey - k} ${ex},${ey}`,
    mx: (sx + ex) / 2,
    my: (sy + ey) / 2,
  };
}

const EDGES = FLOW_EDGES.map((e) => ({ ...e, ...edgePath(BY_ID.get(e.from)!, BY_ID.get(e.to)!) }));

function MiniFlowInner({ events }: { events: readonly WorkflowEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[11px] text-white/55 hover:text-white">
        How it works {open ? "▴" : "▾"}
      </button>
      {open && <Steps events={events} />}
    </div>
  );
}

function Steps({ events }: { events: readonly WorkflowEvent[] }) {
  const latest = events.length ? events[events.length - 1] : null;
  const caseId = latest?.caseId ?? null;
  const st = useMemo<Record<string, NodeStatus>>(() => (caseId ? nodeStatuses(events, caseId) : {}), [events, caseId]);

  return (
    <div className="mt-2">
      <div className="mb-1.5 truncate text-[11px] text-white/60">{caseId ? `Now: ${caseTitle(caseId)}` : "No case yet"}</div>
      <FlowPicture st={st} />
      {latest && <NowLine e={latest} />}
    </div>
  );
}

/**
 * The playbook drawn small: steps lit by status (green ok, amber a person, red stopped/failed).
 * `onPick` makes the steps clickable; `picked` outlines one.
 */
export function FlowPicture({ st, picked = null, onPick }: { st: Record<string, NodeStatus>; picked?: string | null; onPick?: (nodeId: string) => void }) {
  const branch = gateBranch(st);
  return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="block h-auto w-full" role="img" aria-label="The steps every case goes through">
        {EDGES.map((e) => {
          const target = st[e.to];
          const isBranch = !!e.when;
          const taken = isBranch ? branch === e.when && !!st.gate : !!target && !!st[e.from];
          const color = taken && target ? STATUS_COLOR[target] : taken ? STATUS_COLOR[st.gate ?? "ok"] : "rgba(255,255,255,0.14)";
          return (
            <g key={`${e.from}-${e.to}`}>
              <path
                d={e.d}
                fill="none"
                stroke={color}
                strokeWidth={taken ? 1.6 : 1}
                strokeOpacity={taken ? 0.9 : 1}
                strokeDasharray={isBranch && !taken ? "2 3" : undefined}
              >
              </path>
              {isBranch && (
                <text
                  x={e.mx + (e.when === "allow" ? 5 : 0)}
                  y={e.my + (e.when === "allow" ? 3 : -2)}
                  textAnchor={e.when === "allow" ? "start" : "middle"}
                  fontSize="7.5"
                  fill={taken ? color : "rgba(255,255,255,0.35)"}
                >
                  {BRANCH_WORD[e.when!]}
                </text>
              )}
            </g>
          );
        })}
        {FLOW_NODES.map((n) => {
          const p = pos(n);
          const s = st[n.id];
          const c = s ? STATUS_COLOR[s] : null;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              onClick={onPick ? () => onPick(n.id) : undefined}
              style={onPick ? { cursor: "pointer" } : undefined}
              role={onPick ? "button" : undefined}
              aria-label={onPick ? n.label : undefined}
            >
              <rect
                width={W}
                height={H}
                rx={7}
                fill={c ? `${c}22` : "rgba(16,18,24,0.85)"}
                stroke={picked === n.id ? "#fff" : (c ?? "rgba(255,255,255,0.16)")}
                strokeWidth={picked === n.id ? 1.8 : c ? 1.3 : 1}
              />
              <text x={7} y={H / 2 + 3} fontSize="8.5" fill={c ? "#fff" : "rgba(255,255,255,0.7)"} fontWeight={c ? 600 : 400}>
                {n.label}
              </text>
              {c && <circle cx={W - 8} cy={H / 2} r={2.6} fill={c} />}
            </g>
          );
        })}
      </svg>
  );
}

/** The current step in plain words (never the step's raw summary). */
function NowLine({ e }: { e: WorkflowEvent }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1.5 text-[11px]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[e.status] }} />
      <span className="truncate text-white/75">{stepName(e.nodeId)}</span>
    </div>
  );
}

export const MiniFlow = memo(MiniFlowInner);
