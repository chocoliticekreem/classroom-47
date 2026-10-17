"use client";
// URL-driven navigation between console tabs: "/?tab=executions&id=<executionId>".
// Callers must sit inside <Suspense> (useSearchParams in the App Router).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function useConsoleNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = useCallback(
    (tab: string, extra: Record<string, string | null> = {}, replace = false) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      next.set("tab", tab);
      for (const [k, v] of Object.entries(extra)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const url = `${pathname}?${next.toString()}`;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, go };
}
