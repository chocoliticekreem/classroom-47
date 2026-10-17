"use client";
// Module: CityRemote. Renders nothing. Listens on the "rivet-city" BroadcastChannel for commands from the
// desk console (City tab), applies them to the world, and posts a telemetry snapshot every second.
import { useEffect } from "react";
import { CITY_CHANNEL, type CityMessage } from "../controlChannel";
import { emit } from "../bus";
import { useWorld } from "../store";
import { allVehicles } from "../registry";
import { cameraRigStatus } from "./CameraRig";
import { skyStatus } from "./Sky";
import { applyCommand, buildTelemetry, isCommand, type RemoteDeps, type RemoteState } from "./CityRemote/logic";

function* vehicleKinds() {
  for (const v of allVehicles()) yield v.kind;
}

const deps: RemoteDeps = {
  getState: () => useWorld.getState() as unknown as RemoteState,
  emit,
  chase: () => (window as unknown as { __cityChase?: () => void }).__cityChase?.(),
  tourOn: () => cameraRigStatus.tour,
  // CameraRig has no tour setter; its "c" hotkey toggles the tour.
  toggleTour: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" })),
};

export default function CityRemote() {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CITY_CHANNEL);
    const post = () => {
      try {
        const msg: CityMessage = buildTelemetry(deps.getState(), vehicleKinds(), skyStatus.weather, Date.now());
        ch.postMessage(msg);
      } catch {
        /* channel closed */
      }
    };
    ch.onmessage = (ev: MessageEvent) => {
      if (!isCommand(ev.data)) return;
      applyCommand(ev.data, deps);
      post(); // reflect the change straight away
    };
    post();
    const id = window.setInterval(post, 1000);
    return () => {
      window.clearInterval(id);
      ch.close();
    };
  }, []);
  return null;
}
