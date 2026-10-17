// Warms every expensive endpoint for Tower Hill once so the first visitor (and the first 3D tab)
// gets cached replies. `--wait` polls until the dev server answers, for use alongside `dev:stream`.
const port = process.env.PORT ?? "3047";
const base = process.env.WARM_URL ?? `http://127.0.0.1:${port}`;
const ORIGIN = { lat: 51.5098, lon: -0.0766 };
const q = `lat=${ORIGIN.lat}&lon=${ORIGIN.lon}`;

const wait = process.argv.includes("--wait");
for (let tries = 0; wait; tries++) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) });
    break;
  } catch {
    if (tries > 120) {
      console.error(`[warm] ${base} never answered`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function hit(path, timeoutMs = 120_000) {
  const t = performance.now();
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json();
    console.log(`[warm] ${res.status} ${String(Math.round(performance.now() - t)).padStart(6)} ms ${path}`);
    return body;
  } catch (e) {
    console.log(`[warm] FAIL ${path}: ${e.message}`);
    return null;
  }
}

await hit("/api/twin/osm");
const [cams] = await Promise.all([
  hit(`/api/around/cams?${q}&radius=700`),
  hit(`/api/around/buses?${q}`),
  hit(`/api/around/disruptions?${q}&radius=900`),
  hit(`/api/around/weather?${q}`),
]);
const ids = (cams?.cams ?? []).map((c) => c.id).join(",");
if (ids) {
  // YOLO decodes each ~10 s TfL clip on first sight (10–30 s a camera); counts and tracks share the pass.
  await Promise.all([hit(`/api/around/counts?ids=${ids}`), hit(`/api/around/tracks?ids=${ids}`)]);
}
await hit("/api/twin/field");
await hit(`/api/route?from=${ORIGIN.lat},${ORIGIN.lon}&to=Tower%20Bridge`);
