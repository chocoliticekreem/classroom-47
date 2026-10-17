"use client";
// Small download links for the export routes. Plain <a download> (no fetch, no state), styled like
// the kit's secondary small button. Mount wherever a download makes sense.
import type { ReactNode } from "react";
import { cx } from "../ui/cx";
import { IconImport } from "../ui/icons";

const BASE = "/api/console/export";

export const exportUrls = {
  results: `${BASE}/results.csv`,
  run: (id: string) => `${BASE}/run/${encodeURIComponent(id)}.zip`,
  evidencePack: `${BASE}/evidence-pack`,
};

function DownloadLink({ href, title, children, className }: { href: string; title: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      download
      title={title}
      className={cx(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-rv-line bg-rv-card px-3 text-[13px] font-medium whitespace-nowrap text-white/85 transition-colors select-none hover:bg-rv-raised hover:text-white",
        className,
      )}
    >
      <IconImport size={14} aria-hidden />
      {children}
    </a>
  );
}

/** Every case with its result, cost and time, as a spreadsheet. */
export function DownloadResultsButton({ className }: { className?: string }) {
  return (
    <DownloadLink href={exportUrls.results} title="Every case with its result, cost and time" className={className}>
      Download results
    </DownloadLink>
  );
}

/** One case run: the answer, the steps, the full record and the messages. */
export function DownloadRunButton({ id, className }: { id: string; className?: string }) {
  return (
    <DownloadLink href={exportUrls.run(id)} title="The answer, the steps and the messages for this run" className={className}>
      Download this run
    </DownloadLink>
  );
}

/** The results report for each case set, ready to commit as eval/results.md. */
export function EvidencePackButton({ className }: { className?: string }) {
  return (
    <DownloadLink href={exportUrls.evidencePack} title="Results for each set of cases, as a report" className={className}>
      Download report
    </DownloadLink>
  );
}
