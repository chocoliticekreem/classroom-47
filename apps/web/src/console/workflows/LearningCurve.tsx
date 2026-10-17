"use client";
// Tiny "Getting better?" chart: share of cases right, per playbook version.
import type { CurvePoint } from "./testing";

const W = 300;
const H = 104;
const PAD = { l: 14, r: 14, t: 18, b: 20 };

export function LearningCurve({ points, current }: { points: CurvePoint[]; current: number | null }) {
  if (!points.length) {
    return <div className="text-[12px] text-white/40">Shows up after your first practice.</div>;
  }
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - v) * ih;
  const first = points[0].passRate;
  const last = points[points.length - 1].passRate;
  const verdict = points.length < 2 ? null : last > first ? "Yes" : last < first ? "Not yet" : "About the same";
  return (
    <div>
      {verdict && <div className={`mb-1 text-[15px] font-semibold ${verdict === "Yes" ? "text-[#4ade80]" : "text-white/60"}`}>{verdict}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Share of cases right for each version" className="block">
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.1)" />
        <polyline points={points.map((p, i) => `${x(i)},${y(p.passRate)}`).join(" ")} fill="none" stroke="#ff6a1a" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.version}>
            <circle cx={x(i)} cy={y(p.passRate)} r="4" fill="#ff6a1a">
              <title>{`Version ${p.version}: ${Math.round(p.passRate * 100)}% right`}</title>
            </circle>
            <text x={x(i)} y={y(p.passRate) - 7} textAnchor="middle" fontSize="12" fontWeight="600" fill="rgba(255,255,255,0.85)">{Math.round(p.passRate * 100)}%</text>
            <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="11" fill={p.version === current ? "#ffffff" : "rgba(255,255,255,0.4)"}>
              v{p.version}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
