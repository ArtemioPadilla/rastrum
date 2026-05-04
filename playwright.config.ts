import { defineConfig, devices } from '@playwright/test';

// Use a non-default port to avoid colliding with an `astro dev` someone left
// running locally. CI is clean either way.
const PORT = Number(process.env.E2E_PORT ?? 4329);
const LOCAL_BASE_URL = `http://127.0.0.1:${PORT}`;

// When PLAYWRIGHT_BASE_URL is set we hit a real deployment instead of
// spinning up `astro preview` locally. The nightly smoke workflow uses
// this against https://rastrum.org/.
const REMOTE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '');
const BASE_URL = REMOTE_BASE_URL || LOCAL_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  expect: {
    timeout: 7_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  timeout: 30_000,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /(mobile|smoke)\.spec\.ts/,
    },
    {
      name: 'journey-chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /journey-(?!mobile).*\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'journey-mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /journey-mobile.*\.spec\.ts/,
      timeout: 60_000,
    },
  ],
  // Skip the local preview server when targeting a remote base URL — the
  // nightly smoke workflow runs against production and shouldn't waste
  // a minute booting Astro on the runner.
  webServer: REMOTE_BASE_URL
    ? undefined
    : {
        command: `npm run preview -- --port ${PORT} --host 127.0.0.1`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
