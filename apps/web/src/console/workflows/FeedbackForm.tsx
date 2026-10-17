"use client";

import { useEffect, useState } from "react";
import type { ImproveProposal } from "../types";
import { getExecution, improveFlow } from "./api";

/** Feedback produces a draft. The existing proposal review controls decide whether to use it. */
export function FeedbackForm({ executionId, workflowId, disabled, onProposal, onBusy }: {
  executionId: string | null;
  workflowId: string | null;
  disabled: boolean;
  onProposal: (proposal: ImproveProposal) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [author, setAuthor] = useState("");
  const [correction, setCorrection] = useState("");
  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (executionId) void getExecution(executionId).then((r) => {
      if (live && r.ok) setCaseTitle(r.data.execution.caseId);
    });
    return () => { live = false; };
  }, [executionId]);

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    if (!executionId || !workflowId || busy || disabled) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const r = await improveFlow({ workflowId, executionId, author, correction });
      if (r.ok) onProposal(r.data.proposal);
      else setError(r.error);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form onSubmit={propose} className="space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="text-[14px] font-semibold text-white/90">Learn from a human correction</div>
      <p className="text-[12px] text-white/55">
        {executionId ? `Selected run: ${caseTitle ?? "Loading…"}` : "Open a completed run on this workflow first."}
      </p>
      <label className="block text-[12px] text-white/60">
        Your name
        <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} required
          disabled={busy || disabled || !executionId}
          className="mt-1 w-full rounded border border-white/15 bg-black/20 px-2 py-2 text-white outline-none focus:border-[#ff6a1a]" />
      </label>
      <label className="block text-[12px] text-white/60">
        What should it do differently next time, and when does that rule apply?
        <textarea value={correction} onChange={(e) => setCorrection(e.target.value)} minLength={12} maxLength={4000} required rows={4}
          disabled={busy || disabled || !executionId}
          placeholder="For deliveries to a clinic, check the site owner's receiving hours before requesting a booking."
          className="mt-1 w-full rounded border border-white/15 bg-black/20 px-2 py-2 text-white outline-none focus:border-[#ff6a1a]" />
      </label>
      <p className="text-[12px] text-white/45">Creates a draft for review and testing. It does not approve a delivery change or send a message.</p>
      {error && <p role="alert" className="text-[12px] text-[#f87171]">{error}</p>}
      <button type="submit" disabled={busy || disabled || !executionId || !author.trim() || correction.trim().length < 12}
        className="rounded-md bg-[#ff6a1a] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#ff7d38] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Preparing changes…" : "Suggest workflow changes"}
      </button>
    </form>
  );
}
