import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173/kairo/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    /*
      `npm`, not `npm.cmd`. Playwright runs this through a shell, which resolves the .cmd
      shim on Windows by itself; spelling it out pinned the suite to Windows, which went
      unnoticed for as long as a Windows laptop was the only thing that ever ran it.

      `npm run dev` deliberately starts the Express half too, not just Vite. With no
      VITE_API_URL in the environment, src/lib/apiBase.js resolves a localhost page to
      http://localhost:3001 — so the app under test talks to that local server rather than
      to the production backend, and no metered provider call is made from a test run.
    */
    command: 'npm run dev',
    url: 'http://localhost:5173/kairo/',
    // Reuse whatever is already running locally; never reuse in CI, where a leftover
    // server would mean the suite silently tested something other than this commit.
    reuseExistingServer: !process.env.CI,
    // A warm dev machine answers in a second or two. A cold runner has to boot Vite,
    // optimise dependencies for the first time, and start Express alongside it — 15s was
    // a local-only number.
    timeout: 120 * 1000,
  },
});
