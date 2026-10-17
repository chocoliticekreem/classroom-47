"use client";
// Console tab: Executions (n8n's executions view). List + detail live in ../executions/.
import { Suspense } from "react";
import ExecutionsView from "../executions/ExecutionsView";

export default function ExecutionsTab() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-white/50">Loading executions…</div>}>
      <ExecutionsView />
    </Suspense>
  );
}
