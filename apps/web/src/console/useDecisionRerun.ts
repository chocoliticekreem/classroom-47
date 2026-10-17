"use client";
// React wrapper around decisionRerun.ts: one choice sends one request. The ref guard stops a second
// send even when two clicks land before React re-renders.
import { useCallback, useReducer, useRef } from "react";
import { postDecisionRerun, RERUN_IDLE, RerunRefused, rerunReducer, type DecisionRerunBody, type RerunOption } from "./decisionRerun";
import type { ExecutionRecord } from "./types";

export function useDecisionRerun(onDone?: (execution: ExecutionRecord) => void) {
  const [state, dispatch] = useReducer(rerunReducer, RERUN_IDLE);
  const inFlight = useRef(false);
  // Set once a request has gone out and may have reached the agent: no second send after that.
  const final = useRef(false);

  const run = useCallback(async (body: DecisionRerunBody, option?: RerunOption) => {
    if (inFlight.current || final.current) return;
    inFlight.current = true;
    dispatch({ type: "start", option });
    try {
      const execution = await postDecisionRerun(body);
      final.current = true;
      dispatch({ type: "succeed", execution });
      onDone?.(execution);
    } catch (e) {
      if (!(e instanceof RerunRefused)) final.current = true;
      dispatch({ type: "fail", message: e instanceof Error ? e.message : "Couldn't run it again.", canRetry: e instanceof RerunRefused });
    } finally {
      inFlight.current = false;
    }
  }, [onDone]);

  return {
    state,
    pick: (option: RerunOption) => dispatch({ type: "pick", option }),
    cancel: () => dispatch({ type: "cancel" }),
    run,
  };
}
