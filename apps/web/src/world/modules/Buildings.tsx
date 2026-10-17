"use client";
// Module: Buildings. The downtown skyline: glass towers in the middle, offices around them,
// Victorian terraces and high-street shops at the edges, plus a Shard and a Gherkin.
// Layout is seeded (same city every reload). One InstancedMesh per archetype (Buildings/build.ts).
// Windows are procedural canvas textures; their emissive glow follows useWorld timeOfDay.
// Damage zones (store.damage) collapse buildings into rubble and rebuild them under scaffolding
// (Buildings/destruction.ts); this module marks a zone "restored" and removes it when done.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useWorld } from "../store";
import { build, type Built } from "./Buildings/build";
import { Destruction } from "./Buildings/destruction";
import { generateCity } from "./Buildings/layout";
import { hourBucket, nightLevel } from "./Buildings/night";

const SEED = 20261010;

/** Scales every window material's emissive glow (0 = day, 1 = night). */
function setGlow(b: Built, k: number) {
  for (const { mat, glow } of b.facadeMats) mat.emissiveIntensity = k * glow;
}

/** Blinks the aviation lights: a short red flash every 1.6 s, all in sync like a real skyline. */
function blink(b: Built, now: number) {
  const on = now % 1600 < 260;
  const v = on ? 3 : 0.35;
  const c = b.lightMat.color;
  if (c.r !== v) c.setRGB(v, on ? 0.15 : 0.03, on ? 0.1 : 0.02);
}

function restoreZone(id: string) {
  const s = useWorld.getState();
  s.updateDamage(id, { state: "restored" });
  s.removeDamage(id);
}

export default function Buildings() {
  const { built, fx } = useMemo(() => {
    const city = generateCity(SEED);
    const b = build(city);
    return { built: b, fx: new Destruction(b, city, restoreZone) };
  }, []);

  useEffect(
    () => () => {
      fx.dispose();
      built.dispose();
    },
    [built, fx],
  );

  // Window glow: touch materials only when the quarter-hour bucket changes, never per frame.
  useEffect(() => {
    let last = Number.NaN;
    const apply = (hour: number) => {
      const b = hourBucket(hour);
      if (b === last) return;
      last = b;
      setGlow(built, nightLevel(b));
    };
    apply(useWorld.getState().timeOfDay);
    return useWorld.subscribe((s) => apply(s.timeOfDay));
  }, [built]);

  // Damage zones: react only when the damage array changes.
  useEffect(() => {
    fx.sync(useWorld.getState().damage);
    return useWorld.subscribe((s, prev) => {
      if (s.damage !== prev.damage) fx.sync(s.damage);
    });
  }, [fx]);

  useFrame((_, delta) => {
    if (useWorld.getState().paused) return;
    blink(built, performance.now());
    fx.update(Math.min(delta, 0.1));
  });

  return (
    <group name="buildings">
      {built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
      {fx.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
