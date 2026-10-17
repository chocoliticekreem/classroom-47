import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the already-running branch dev server (never started here).
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  outputDir: "./artifacts/test-results",
  timeout: 60_000,
  retries: 0,
  workers: 4,
  reporter: [["list"], ["json", { outputFile: "./artifacts/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { viewport: { width: 1280, height: 720 } } }],
});
