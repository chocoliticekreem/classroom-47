import { create } from "zustand";

export type CameraPreset = "aerial" | "street" | "skyline";

export const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number]; label: string }> = {
  aerial: { pos: [470, 270, 640], target: [-140, 0, -140], label: "Aerial" },
  street: { pos: [60, 26, 150], target: [-60, 10, -120], label: "Street" },
  skyline: { pos: [240, 70, 320], target: [-420, 110, -500], label: "Skyline" },
};

interface CameraState {
  preset: CameraPreset;
  /** Increments on every request so re-clicking the active preset still flies. */
  flight: number;
  fly: (preset: CameraPreset) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  preset: "aerial",
  flight: 0,
  fly: (preset) => set((s) => ({ preset, flight: s.flight + 1 })),
}));
