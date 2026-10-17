"use client";
// Module: Construction (Layer 2). A booming skyline: 5-7 construction sites in the open land around
// downtown and between the districts, each with a half-built concrete tower (slabs, columns, core,
// glazed lower floors, scaffold + netting), 1-2 tower cranes hoisting beams and concrete skips on
// loops, an excavator digging, a dump truck shuttling, hoardings with Hamyway ads, cabins, rebar piles,
// hammering workers (GPU-animated) and blinking aviation lights. Plus 7 concrete mixer trucks that
// drive the public roads between the sites (registered as "truck", crashable).
// Logic lives in ./Construction/ (sites.ts + crane.ts + machines.ts are pure and tested).
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { useWorld } from "../store";
import { MixerFleet } from "./Construction/mixers";
import { ConstructionScene, nightLevel } from "./Construction/scene";
import { getSites } from "./Construction/sites";
import { ViewCheck } from "./DeliveryFleet/lookahead";

// Camera frustum check so off-screen mixers only raycast every 4th frame.
const view = new ViewCheck();

export default function Construction() {
  const [rt] = useState(() => {
    const sites = getSites();
    const fleet = new MixerFleet(sites);
    fleet.sees = view.sees;
    return { scene: new ConstructionScene(sites), fleet };
  });

  useEffect(() => {
    rt.fleet.start();
    return () => rt.fleet.stop();
  }, [rt]);

  useEffect(
    () => () => {
      rt.scene.dispose();
      rt.fleet.dispose();
    },
    [rt],
  );

  // windows and floodlights follow the hour (only touched when it changes)
  useEffect(() => {
    let last = -1;
    const apply = (h: number) => {
      const n = Math.round(nightLevel(h) * 20) / 20;
      if (n === last) return;
      last = n;
      rt.scene.setNight(n);
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [rt]);

  useFrame(({ camera }, delta) => {
    const w = useWorld.getState();
    if (w.paused) return;
    view.update(camera);
    const dt = Math.min(delta, 0.1);
    rt.scene.tick(dt, nightLevel(w.timeOfDay));
    rt.fleet.step(dt, performance.now());
    rt.fleet.render();
  });

  const onMixerClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) return;
    const id = rt.fleet.idAt(e.instanceId);
    if (!id) return;
    e.stopPropagation();
    useWorld.getState().select(id);
  };

  return (
    <group name="construction">
      {rt.scene.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
      <primitive object={rt.fleet.body} onClick={onMixerClick} />
      <primitive object={rt.fleet.drum} />
      <primitive object={rt.fleet.shadow} />
    </group>
  );
}
