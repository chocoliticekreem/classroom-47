"use client";
import { useSearchParams } from "next/navigation";
import HumanDesk from "./HumanDesk";

export default function ReviewRoute() {
  const params = useSearchParams();
  return <HumanDesk initialTaskId={params.get("case") ?? ""} initialSource={params.get("source") === "simulation" ? "simulation" : "agent"} />;
}
