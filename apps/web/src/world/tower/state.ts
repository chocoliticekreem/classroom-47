"use client";

import { create } from "zustand";
import {
  acceptFork,
  createLiveCity,
  discardFork,
  previewCrossingSurge,
  previewLocationLeak,
  stepSim,
} from "./sim";

type Sim = ReturnType<typeof createLiveCity>;

interface TowerState {
  sim: Sim;
  previewCrossing: () => void;
  previewLeak: () => void;
  accept: () => void;
  discard: () => void;
  tick: (dt: number) => void;
}

/** Live Tower Hill city (seed 47). Previews fork the sim; accept commits, discard drops, tick steps. */
export const useTower = create<TowerState>((set) => ({
  sim: createLiveCity(47),
  previewCrossing: () => set((s) => ({ sim: previewCrossingSurge(s.sim, 50) })),
  previewLeak: () => set((s) => ({ sim: previewLocationLeak(s.sim, 50) })),
  accept: () => set((s) => ({ sim: acceptFork(s.sim) })),
  discard: () => set((s) => ({ sim: discardFork(s.sim) })),
  tick: (dt) => set((s) => ({ sim: stepSim(s.sim, dt) })),
}));
