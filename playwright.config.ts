import { defineConfig, devices } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/lib/chromium.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: chromiumLaunchOptions,
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
  // Normal use: root starts the app. Opt in only after a production build exists.
  ...(process.env.PLAYWRIGHT_START_SERVER === '1' ? {
    webServer: { command: 'npm run start', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  } : {}),
});
