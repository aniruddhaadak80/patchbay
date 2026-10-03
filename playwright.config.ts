import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PATCHBAY_PORT ?? 3100);
const baseURL = process.env.PATCHBAY_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  // The journey walks eight routes and several mutating round trips. Local runs
  // use an embedded database; a hosted deployment completes this far faster.
  timeout: 420_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // The full mutating journey runs on desktop, where every control is reachable
    // without a viewport-sized scroll.
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Mobile covers layout, navigation, live-data honesty, validation, and
    // keyboard focus. The tests below are non-mutating by design.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grep: /repository link|catalog labels|vault rejects|skip link/,
    },
  ],
  // Readiness is a static asset: it answers without touching the database, so it
  // does not race the embedded adapter's slow first query. globalSetup then
  // waits for a real persistence round trip before any test runs. Set
  // PATCHBAY_BASE_URL to test an already-running deployment instead.
  webServer: process.env.PATCHBAY_BASE_URL
    ? undefined
    : {
        command: `node node_modules/next/dist/bin/next start --port ${port}`,
        url: `${baseURL}/icon.svg`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        // Playwright replaces the child environment with this object, so
        // process.env must be spread or PATH is lost and the command cannot run.
        env: {
          ...process.env,
          ALLOW_EMBEDDED_DB: "true",
          AUTH_SECRET: process.env.AUTH_SECRET ?? "patchbay-local-browser-test-secret-32chars",
          BETTER_AUTH_URL: baseURL,
          PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? ".patchbay/pglite-test",
        },
      },
});