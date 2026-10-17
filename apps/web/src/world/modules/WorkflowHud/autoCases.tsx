"use client";
// Top-bar "Auto" toggle: while on, plays a real practice case in the city about every 3 minutes (sample cases
// first, then the other sets), only when the agent is idle and the shared budget has a slot. Each case goes
// through the same staging as a picked one (prepareCase -> request:scenario). Replaces the Scenarios autoplay.
import { useEffect, useRef, useState } from "react";
import { emit } from "../../bus";
import { AUTO_FIRST_MS, AUTO_INTERVAL_MS, AUTO_STORAGE_KEY, autoCasesStatus, planPick, shouldFire, type SetCount } from "../../autoCases";
import { agentIdle, useWorld } from "../../store";
import { budgetLeft } from "../WorkflowDriver/budget";
import { fetchPage, prepareCase } from "./catalogueClient";

const RETRY_MS = 30_000;

function load(): { on: boolean; step: number } {
  let on = !/[?&]autoplay=0\b/.test(window.location.search);
  let step = 0;
  try {
    const v = JSON.parse(localStorage.getItem(AUTO_STORAGE_KEY) ?? "null") as { on?: unknown; step?: unknown } | null;
    if (typeof v?.on === "boolean") on = v.on;
    if (typeof v?.step === "number" && v.step >= 0) step = Math.floor(v.step);
  } catch {
    /* storage blocked: defaults */
  }
  return { on, step };
}

function save(on: boolean, step: number) {
  try {
    localStorage.setItem(AUTO_STORAGE_KEY, JSON.stringify({ on, step }));
  } catch {
    /* storage blocked */
  }
}

export function AutoCasesToggle() {
  const [on, setOn] = useState(false);
  const st = useRef({ on: false, step: 0, nextAt: 0, busy: false, sets: null as SetCount[] | null });

  useEffect(() => {
    autoCasesStatus.driving = true;
    const s = st.current;
    const saved = load();
    Object.assign(s, saved, { nextAt: Date.now() + AUTO_FIRST_MS });
    queueMicrotask(() => setOn(saved.on));

    const fire = async () => {
      s.busy = true;
      try {
        if (!s.sets) s.sets = (await fetchPage("all", "", 0)).sets;
        const pick = planPick(s.step, s.sets, Math.random);
        if (!pick) throw new Error("no cases");
        const c = (await fetchPage(pick.set, "", pick.offset)).cases[0];
        if (!c) throw new Error("no case");
        const scenarioId = await prepareCase(c);
        emit({ type: "request:scenario", scenarioId, modifiers: [] });
        s.step++;
        s.nextAt = Date.now() + AUTO_INTERVAL_MS;
      } catch {
        s.sets = null;
        s.nextAt = Date.now() + RETRY_MS;
      } finally {
        s.busy = false;
        save(s.on, s.step);
      }
    };

    const id = setInterval(() => {
      const w = useWorld.getState();
      const now = Date.now();
      if (shouldFire({ on: s.on, now, nextAt: s.nextAt, idle: agentIdle(w) && !w.paused, budgetLeft: budgetLeft(w.agentBudget, now), busy: s.busy })) void fire();
    }, 2000);
    return () => {
      clearInterval(id);
      autoCasesStatus.driving = false;
    };
  }, []);

  const toggle = () => {
    const s = st.current;
    s.on = !s.on;
    if (s.on) s.nextAt = Math.min(s.nextAt, Date.now() + AUTO_FIRST_MS);
    setOn(s.on);
    save(s.on, s.step);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={
        on
          ? `Auto: plays a real practice case about every 3 min (sample cases first), when the agent is free and the budget allows. Click to stop.`
          : "Auto is off. Click to play a real practice case about every 3 min."
      }
      className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition ${
        on
          ? "border-teal-300/50 bg-teal-400/10 text-teal-100 hover:bg-teal-400/20"
          : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-teal-300" : "bg-white/30"}`} />
      Auto cases
    </button>
  );
}
