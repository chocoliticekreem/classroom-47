"use client";
import Link from "next/link";
import { useReviewQueue } from "./useReviewQueue";

/** Drop this into the new workflow view; no dependency on the 3D world. */
export default function ReviewEntry({ onOpen }: { onOpen?: () => void }) {
  const { tasks } = useReviewQueue();
  const count = tasks.filter((t) => !t.simulated && t.status === "pending").length;
  const label = <>Decisions{count > 0 && <span className="ml-2 rounded-full bg-[#ff6a1a] px-1.5 text-[11px] font-semibold leading-[18px] text-white">{count}</span>}</>;
  const style = "inline-flex items-center rounded-md border border-white/15 bg-transparent px-3 py-2 text-xs font-medium text-white/90 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a1a]";
  return onOpen ? <button type="button" className={style} onClick={onOpen}>{label}</button> : <Link className={style} href="/review">{label}</Link>;
}
