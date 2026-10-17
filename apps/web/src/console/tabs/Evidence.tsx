"use client";
// Console tab: Results (PRD J0, the coverage shot). The page lives in ../evidence/.
import { Suspense } from "react";
import EvidenceGrid from "../evidence/EvidenceGrid";

export default function EvidenceTab() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-white/50">Loading results…</div>}>
      <EvidenceGrid />
    </Suspense>
  );
}
