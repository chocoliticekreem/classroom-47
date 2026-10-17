"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { record, sortTasks } from "./model";
import { REVIEW_CHANNEL, type ReviewMessage, type ReviewQueue, type ReviewTask } from "./types";

export function useReviewQueue() {
  const [queue, setQueue] = useState<ReviewQueue>({ tasks: [], warnings: [], updatedAt: "" });
  const [sessions, setSessions] = useState<Record<string, { at: number; tasks: ReviewTask[] }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const requests = useRef(new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch("/api/review/tasks", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The review queue is unavailable");
      setQueue(body);
      setError(null);
      setNow(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : "The review queue is unavailable"); }
    finally { setLoading(false); busy.current = false; }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => void refresh(), 0);
    const timer = setInterval(refresh, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const focus = () => { void refresh(); channel.current?.postMessage({ type: "queue:request" } satisfies ReviewMessage); };
    window.addEventListener("focus", focus);
    if (typeof BroadcastChannel !== "undefined") {
      const link = new BroadcastChannel(REVIEW_CHANNEL);
      channel.current = link;
      link.onmessage = (event: MessageEvent<unknown>) => {
        const message = record(event.data);
        if (message?.type === "queue:snapshot" && typeof message.sessionId === "string" && Array.isArray(message.tasks)) {
          const tasks = message.tasks.filter((value): value is ReviewTask => {
            const task = record(value);
            return task?.simulated === true && task.origin === "city" && typeof task.id === "string" && typeof task.caseId === "string" && Array.isArray(task.options);
          });
          setSessions((prior) => ({ ...prior, [String(message.sessionId)]: { at: Date.now(), tasks } }));
          setNow(Date.now());
        }
        if (message?.type === "decision:result" && typeof message.requestId === "string") {
          const pending = requests.current.get(message.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          requests.current.delete(message.requestId);
          if (message.ok === true) pending.resolve();
          else pending.reject(new Error(typeof message.error === "string" ? message.error : "The city didn't take that choice"));
        }
      };
      link.postMessage({ type: "queue:request" } satisfies ReviewMessage);
    }
    const pending = requests.current;
    return () => {
      clearTimeout(initialLoad); clearInterval(timer); clearInterval(clock); window.removeEventListener("focus", focus);
      channel.current?.close(); channel.current = null;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Closed")); }
      pending.clear();
    };
  }, [refresh]);

  /** Saves the choice. Returns the saved task (with its case run link) for live cards, null for city ones. */
  const decide = useCallback(async (task: ReviewTask, optionId: string, who: string, note: string): Promise<ReviewTask | null> => {
    if (task.origin === "city") {
      if (!channel.current) throw new Error("Open the city in this browser to decide this case");
      const requestId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          requests.current.delete(requestId);
          reject(new Error("The city didn't answer. Check the city is still open."));
        }, 5000);
        requests.current.set(requestId, { resolve, reject, timer });
        channel.current!.postMessage({ type: "decision:request", requestId, taskId: task.id, optionId, who, note } satisfies ReviewMessage);
      });
      return null;
    }
    const response = await fetch(`/api/review/tasks/${encodeURIComponent(task.id)}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionId, who, note }), signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) { void refresh(); throw new Error(body.error ?? "Your decision was not saved"); }
    const saved: ReviewTask = { ...body.task, executionId: body.task?.executionId ?? task.executionId ?? null };
    setQueue((prior) => ({ ...prior, tasks: prior.tasks.map((t) => t.id === task.id ? saved : t) }));
    return saved;
  }, [refresh]);

  const simulated = Object.values(sessions).filter((session) => now - session.at < 8000).flatMap((session) => session.tasks);
  return { tasks: sortTasks([...queue.tasks, ...simulated]), warnings: queue.warnings, loading, error, now, refresh, decide };
}
