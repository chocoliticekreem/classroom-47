"use client";
import { useEffect } from "react";
import { getWorkflowEngine } from "../world/modules/WorkflowDriver/handle";
import { simulationTasks } from "./simulation";
import { record } from "./model";
import { REVIEW_CHANNEL, type ReviewDecision, type ReviewMessage } from "./types";

export default function CityReviewBridge() {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(REVIEW_CHANNEL);
    const sessionId = crypto.randomUUID();
    const decisions = new Map<string, ReviewDecision>();
    function publish() {
      const engine = getWorkflowEngine();
      if (!engine) return;
      const tasks = simulationTasks(engine, sessionId, Date.now()).map((task) => ({
        ...task, decision: decisions.get(task.id) ?? task.decision,
        status: decisions.has(task.id) ? "resolved" as const : task.status,
      }));
      channel.postMessage({ type: "queue:snapshot", sessionId, tasks } satisfies ReviewMessage);
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = record(event.data);
      if (message?.type === "queue:request") { publish(); return; }
      if (message?.type !== "decision:request" || typeof message.requestId !== "string" || typeof message.taskId !== "string" || typeof message.optionId !== "string") return;
      const engine = getWorkflowEngine();
      if (!engine || !message.taskId.startsWith(`simulation:${sessionId}:`)) return;
      const task = simulationTasks(engine, sessionId, Date.now()).find((t) => t.id === message.taskId);
      const option = task?.options.find((o) => o.id === message.optionId);
      const ok = Boolean(task && option && engine.decide(task.caseId, option.label));
      if (ok && task && option) decisions.set(task.id, {
        optionId: option.id, optionLabel: option.label, who: typeof message.who === "string" ? message.who : "Someone",
        note: typeof message.note === "string" ? message.note : "", at: new Date().toISOString(), execution: "simulation",
      });
      channel.postMessage({ type: "decision:result", requestId: message.requestId, ok, ...(!ok && { error: "This case has moved on. Refresh." }) } satisfies ReviewMessage);
      publish();
    };
    publish();
    const timer = setInterval(publish, 1000);
    return () => {
      clearInterval(timer);
      channel.postMessage({ type: "queue:snapshot", sessionId, tasks: [] } satisfies ReviewMessage);
      channel.close();
    };
  }, []);
  return null;
}
