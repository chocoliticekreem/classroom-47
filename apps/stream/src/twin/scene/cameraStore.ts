import { create } from "zustand";

export type CameraPreset = "aerial" | "street" | "skyline" | "streamer";

export const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number]; label: string }> = {
  aerial: { pos: [470, 270, 640], target: [-140, 0, -140], label: "Aerial" },
  street: { pos: [60, 26, 150], target: [-60, 10, -120], label: "Street" },
  skyline: { pos: [240, 70, 320], target: [-420, 110, -500], label: "Skyline" },
  /** First person at the streamer; the rig follows the live position, so pos/target are placeholders. */
  streamer: { pos: [0, 1.7, 0], target: [0, 1.7, -10], label: "Streamer view" },
};

/** A real CCTV pose the rig reproduces: local metres + compass heading in radians (0 = north). */
export interface CctvPose {
  x: number;
  z: number;
  headingRad: number;
}

interface CameraState {
  preset: CameraPreset;
  /** Increments on every request so re-clicking the active preset still flies. */
  flight: number;
  /** When set, the camera sits at this real CCTV pose and the preset is ignored. */
  cctv: CctvPose | null;
  fly: (preset: CameraPreset) => void;
  setCctv: (pose: CctvPose | null) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  preset: "aerial",
  flight: 0,
  cctv: null,
  fly: (preset) => set((s) => ({ preset, flight: s.flight + 1, cctv: null })),
  setCctv: (cctv) => set((s) => ({ cctv, flight: s.flight + 1 })),
}));
