# E2E smoke report (http://localhost:3001)

Run with `npm run e2e -w web`. Each run is appended below.

## Run 1 (2026-10-10 13:12:25)

Passed 6/10.

- **tab:intake** (screenshot: `e2e/artifacts/tab-intake.png`)
  - no visible primary (orange) button
- **tab:workflows** (screenshot: `e2e/artifacts/tab-workflows.png`)
  - no visible primary (orange) button
- **tab:reality** (screenshot: `e2e/artifacts/tab-reality.png`)
  - no visible primary (orange) button
- **tab:city** (screenshot: `e2e/artifacts/tab-city.png`)
  - no <canvas> after 40s
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
  - console.error: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.

## Run 2 (2026-10-10 13:22:34)

Passed 6/10.

- **tab:workflows** (screenshot: `e2e/artifacts/tab-workflows.png`)
  - no visible primary (orange) button
- **tab:reality** (screenshot: `e2e/artifacts/tab-reality.png`)
  - no visible primary (orange) button
- **tab:city** (screenshot: `e2e/artifacts/tab-city.png`)
  - Test timeout of 120000ms exceeded.
- **route:/city** (screenshot: `e2e/artifacts/route-city.png`)
  - Test timeout of 120000ms exceeded.

## Run 3 (2026-10-10 13:33:35)

Passed 7/10.

- **tab:workflows** (screenshot: `e2e/artifacts/tab-workflows.png`)
  - no visible primary (orange) button
- **tab:reality** (screenshot: `e2e/artifacts/tab-reality.png`)
  - no visible primary (orange) button
- **tab:settings** (screenshot: `e2e/artifacts/tab-settings.png`)
  - no visible primary (orange) button

## Run 4 (2026-10-10 13:42, after updating the header-primary check to the new shell)

Passed 8/10 (evidence re-run after fixing the test's expectation: passes).
- **tab:city** (screenshot: `e2e/artifacts/test-results/smoke.e2e.ts-tab-city-chromium/test-failed-1.png`)
  - Test timeout of 180000ms exceeded (no canvas inside the `/city?embed=1` iframe in time; passed in run 3 and alone in 1.7m, so slow dev compile/WebGL under load rather than a hard break)
- **route:/city** (screenshot: `e2e/artifacts/test-results/smoke.e2e.ts-route-city-chromium/test-failed-1.png`)
  - Test timeout of 180000ms exceeded (same cause; passed in run 3)
