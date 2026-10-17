import { Suspense } from "react";
import ReviewRoute from "@/review/ReviewRoute";

export default function ReviewPage() {
  return <Suspense fallback={<main className="p-8">Loading the human review desk…</main>}><ReviewRoute /></Suspense>;
}
