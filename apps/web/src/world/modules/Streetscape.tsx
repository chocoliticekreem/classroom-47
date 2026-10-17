"use client";
// Module: Streetscape (Layer 2). Street-level realism outside downtown, built at runtime from the merged
// road graph: London plane trees, lamp columns, bins, bollards, parked cars, road signs and bus stop flags
// on every non-downtown street; grass verges and shrubs along highways and the motorway; billboards with
// procedural ads at ring/motorway junctions; neon shop signs; and a Piccadilly-style animated LED wall on
// the downtown corner facing junction g_1_-1. Reads useWorld.timeOfDay (glow) and paused. Writes nothing.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { useWorld } from "../store";
import { build } from "./Streetscape/scene";
import { nightness } from "./Streetscape/night";

const LED_FRAME_MS = 250; // ~4 fps, like a real LED billboard cycling

export default function Streetscape() {
  const built = useMemo(() => build(), []);
  useEffect(() => () => built.dispose(), [built]);

  // Night glow: touch materials only when the 5-minute bucket of timeOfDay changes.
  useEffect(() => {
    let last = Number.NaN;
    const apply = (hour: number) => {
      const bucket = Math.round(hour * 12);
      if (bucket === last) return;
      last = bucket;
      built.setNight(nightness(hour));
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [built]);

  const lastPaint = useRef(0);
  useFrame(() => {
    if (useWorld.getState().paused) return;
    const now = performance.now();
    if (now - lastPaint.current < LED_FRAME_MS) return;
    lastPaint.current = now;
    built.led.paint(now / 1000);
  });

  return (
    <group name="streetscape">
      {built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
