"use client";
// Console side of the console <-> city BroadcastChannel: send commands, receive telemetry.
import { useCallback, useEffect, useRef, useState } from "react";
import { CITY_CHANNEL, type CityCommand, type CityTelemetry } from "../../world/controlChannel";
import { isTelemetry, linkState, type LinkState } from "./logic";

export function useCityLink() {
  const ch = useRef<BroadcastChannel | null>(null);
  const [telemetry, setTelemetry] = useState<CityTelemetry | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(CITY_CHANNEL);
    ch.current = c;
    c.onmessage = (ev: MessageEvent) => {
      if (isTelemetry(ev.data)) setTelemetry(ev.data);
    };
    c.postMessage({ type: "ping" } satisfies CityCommand);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(tick);
      c.close();
      ch.current = null;
    };
  }, []);

  const send = useCallback((cmd: CityCommand) => {
    try {
      ch.current?.postMessage(cmd);
    } catch {
      /* closed */
    }
  }, []);

  // Before the first tick `now` is 0; treat any snapshot as live until the clock starts.
  const state: LinkState = telemetry && now === 0 ? "live" : linkState(telemetry, now);
  return { telemetry, state, send };
}
