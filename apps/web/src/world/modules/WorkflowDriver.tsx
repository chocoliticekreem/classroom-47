"use client";
// Module: WorkflowDriver. Links the city to the REAL agent API; renders nothing. There is no mock agent:
// incidents, grouped delivery delays and staged scenarios go through the console (POST /api/console/city/cases,
// recorded in SQLite, run on apps/api) via WorkflowDriver/link.ts (FIFO queue, 2 at a time, within the budget guard), and new console runs are
// polled and replayed. While the agent API is offline, cases wait in the queue and nothing is invented.
import { useEffect } from "react";
import { emit, on } from "../bus";
import { useWorld } from "../store";
import { checkAgent, followExecution, runCityCase, traceCost } from "../agentBridge";
import { browserFetchJson, ExecutionPoller, POLL_MS } from "../backendLink";
import { allVehicles } from "../registry";
import { budgetLeft } from "./WorkflowDriver/budget";
import { CityAgentLink } from "./WorkflowDriver/link";
import { setCityLink } from "./WorkflowDriver/handle";
import type { Trace } from "../../../../api/src/lib/trace";

function push(e: Omit<import("../store").WorkflowEvent, "id" | "t">) {
  useWorld.getState().pushWorkflow({ ...e, id: `agt-${Math.random().toString(36).slice(2, 10)}`, t: performance.now() });
}

/** The shared budget as SQLite last reported it (state load, every case start, every 429). */
function syncBudget(b: { starts: number[]; spentUsd: number; maxPerWindow: number }) {
  useWorld.getState().syncAgentBudget(b.starts, b.spentUsd, b.maxPerWindow);
}

/**
 * Local pre-check against the last known shared budget; the server (POST /api/console/city/cases) is the
 * authority and answers 429 when the window is full, which puts the case back in the queue.
 */
function claimBudget(): boolean {
  return budgetLeft(useWorld.getState().agentBudget, Date.now()) > 0;
}

function recordSpend(trace: Trace) {
  const usd = traceCost(trace);
  if (usd !== null) useWorld.getState().addAgentSpend(usd); // display only: SQLite adds it server side
}

function createCityLink(): CityAgentLink {
  return new CityAgentLink({
    runAgent: (view, label) => runCityCase(view, label, { onBudget: syncBudget }),
    follow: (id) => followExecution(id),
    push,
    emit,
    schedule: (fn, ms) => void setTimeout(fn, ms),
    online: () => useWorld.getState().agentOnline === true,
    claim: claimBudget,
    onSpend: recordSpend,
    onQueue: (queue, running) => useWorld.getState().setAgentQueue(queue, running),
    incident: (id) => useWorld.getState().incidents.find((i) => i.id === id),
    deliveries: () => useWorld.getState().deliveries,
    positions: () => {
      const p: Record<string, { x: number; z: number }> = {};
      for (const v of allVehicles()) p[v.id] = { x: v.object.position.x, z: v.object.position.z };
      return p;
    },
    now: () => Date.now(),
    clock: () => performance.now(),
  });
}

export default function WorkflowDriver() {
  useEffect(() => {
    const link = createCityLink();
    setCityLink(link);

    const off = on((ev) => {
      switch (ev.type) {
        // City-made incidents (crashes, roadworks, late vans) are scenery now: they no longer become
        // agent cases. Only real cases (practice set, scenarios, console runs) go to the agent.
        case "scenario:staged":
          link.staged(ev);
          return;
      }
    });

    // Delay groups close after 20 s; the queue also re-pumps as the budget window rolls.
    const tick = setInterval(() => {
      link.flushDelays();
      link.pump();
    }, 2000);

    // Agent API health: every 10 s while offline (cases paused), every 30 s once online.
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const ping = async () => {
      const ok = await checkAgent();
      if (!alive) return;
      useWorld.getState().setAgentOnline(ok);
      if (ok) link.pump();
      pingTimer = setTimeout(ping, ok ? 30_000 : 10_000);
    };
    void ping();

    // New console runs (Execute, test runs) are replayed as they finish.
    const poller = new ExecutionPoller(browserFetchJson, link.replayedRuns);
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const ex of await poller.poll()) link.consoleExecution(ex);
      } catch {
        /* console API down: try again next tick */
      } finally {
        busy = false;
      }
    };
    void poll();
    const pollTimer = setInterval(poll, POLL_MS);

    return () => {
      alive = false;
      if (pingTimer) clearTimeout(pingTimer);
      clearInterval(tick);
      clearInterval(pollTimer);
      off();
      setCityLink(null);
    };
  }, []);

  return null;
}
