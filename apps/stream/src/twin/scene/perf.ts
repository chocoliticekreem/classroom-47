/**
 * Shared adaptive-quality state. Plain mutable object, read it inside useFrame / useMemo; never put it in React state.
 * Written only by `stepTier` (World.tsx drives it from drei's PerformanceMonitor) and `readRenderer` (Canvas onCreated).
 *
 * - `tier`:    "high" | "medium" | "low". Heavy modules can scale their own cost with it, e.g. Pedestrians/Traffic
 *              instance caps (high 100 % / medium 60 % / low 30 %), rain DROPS, building draw distance.
 *              Decisions made in useMemo should re-run on a tier change, so also read `perf.tier` inside useFrame
 *              and rebuild only when it actually changes.
 * - `dprCap`:  the device pixel ratio the Canvas currently renders at (1 .. min(devicePixelRatio, 1.75)).
 * - `renderer`: UNMASKED_RENDERER_WEBGL, e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)".
 * - `software`: true when the renderer string is SwiftShader / llvmpipe / a software rasteriser.
 */
export type PerfTier = "high" | "medium" | "low";

const TIERS: PerfTier[] = ["low", "medium", "high"];
const MAX_DPR = 1.75;
const OSCILLATION_MS = 45_000;

function deviceCap() {
  return typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

function dprFor(tier: PerfTier) {
  const cap = deviceCap();
  if (tier === "low") return 1;
  return tier === "medium" ? Math.min(cap, 1.25) : cap;
}

export const perf = {
  tier: "high" as PerfTier,
  dprCap: deviceCap(),
  renderer: "",
  software: false,
};

let ceiling = TIERS.length - 1;
let lastIncline = 0;

/**
 * Moves one tier up or down and returns the pixel ratio to render at. A decline that comes within 45 s of an
 * incline means the higher tier is not sustainable, so it becomes the ceiling and the quality settles instead of oscillating.
 */
export function stepTier(direction: 1 | -1, now = performance.now()) {
  const index = TIERS.indexOf(perf.tier);
  if (direction < 0 && index > 0) {
    if (now - lastIncline < OSCILLATION_MS) ceiling = index - 1;
    perf.tier = TIERS[index - 1];
  } else if (direction > 0 && index < ceiling) {
    lastIncline = now;
    perf.tier = TIERS[index + 1];
  }
  perf.dprCap = dprFor(perf.tier);
  return perf.dprCap;
}

const SOFTWARE = /swiftshader|llvmpipe|software|softpipe/i;

/** Reads the real GPU name once, stores it on `perf` and warns only when WebGL fell back to software rendering. */
export function readRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  perf.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  perf.software = SOFTWARE.test(perf.renderer);
  if (perf.software) {
    console.warn(
      `[twin] WebGL is running on a software renderer (${perf.renderer}). Enable hardware acceleration and check chrome://gpu.`,
    );
  }
  return perf.renderer;
}
