"use client";
// Module: Rail (Layer 2). A mainline railway on its own track: the King's Hamyway terminus (St Pancras style:
// red-brick gothic hotel and clock tower, a glazed barrel-vault trainshed over 8 platforms on a brick
// undercroft), lines west to Airport Parkway and Old Town, north over the river on a steel truss to
// Hampstead Heath, east onto the Shoreditch viaduct, and a freight line round the ring to the container
// terminal / industrial freight yard. Intercity sets, an EMU and long freight trains run a smooth timetable;
// signals, overhead line gantries, and two level crossings whose barriers close the road (traffic queues).
// Everything is instanced or merged; logic lives in ./Rail/.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { createRail } from "./Rail/engine";

export default function Rail() {
  const engine = useMemo(() => createRail(), []);

  useEffect(() => () => engine.dispose(), [engine]);

  useFrame((_, delta) => engine.tick(delta));

  return (
    <group name="Rail">
      {engine.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
