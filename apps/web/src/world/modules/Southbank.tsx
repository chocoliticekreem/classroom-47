"use client";
// Module: Southbank. A dense, lively mixed-use district south-west of the ring with an organic street
// plan (roads live in districts/southbank.ts and are drawn/driven by Roads/Traffic): a curving high
// street, a tree-lined diagonal boulevard between two roundabouts, a Georgian crescent, mews, a
// pedestrianised market street, a park with a lake and bandstand, a culture quarter, glass towers
// and a football stadium with a Wembley-style arch. Seeded layout, instanced per archetype; walkers
// and the stadium crowd are animated on the GPU by one shared uTime uniform. Windows, lamps and
// floodlights follow timeOfDay (touched only when the quarter-hour bucket changes).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useWorld } from "../store";
import { buildCulture } from "./Southbank/culture";
import { buildGrounds } from "./Southbank/grounds";
import { Bag } from "./Southbank/kit";
import { generateSouthbank } from "./Southbank/layout";
import { uTime } from "./Southbank/materials";
import { hourBucket, nightLevel } from "./Southbank/night";
import { buildStadium } from "./Southbank/stadium";
import { buildStreets, makeFacades, type Glow } from "./Southbank/streets";

const SEED = 7041;
const _c = new THREE.Color();

function build() {
  const bag = new Bag();
  const glow: Glow = { std: [], basic: [] };
  const layout = generateSouthbank(SEED);
  buildGrounds(bag);
  const fac = makeFacades(bag, glow);
  buildStreets(layout, bag, glow, fac);
  buildCulture(bag, glow, fac);
  buildStadium(bag, glow);
  return { bag, glow };
}

function applyNight(glow: Glow, k: number) {
  for (const { mat, k: g } of glow.std) mat.emissiveIntensity = k * g;
  for (const { mat, day, night } of glow.basic) mat.color.copy(_c.copy(day).lerp(night, k));
}

export default function Southbank() {
  const built = useMemo(() => build(), []);
  useEffect(() => () => built.bag.dispose(), [built]);

  useEffect(() => {
    let last = Number.NaN;
    const apply = (hour: number) => {
      const b = hourBucket(hour);
      if (b === last) return;
      last = b;
      applyNight(built.glow, nightLevel(b));
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [built]);

  // One uniform write per frame drives every walker, the crowd wave and the lake.
  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    uTime.value += Math.min(delta, 0.1);
  });

  return (
    <group name="southbank">
      {built.bag.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
