import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const personalE2ERunId = randomUUID();
process.env.PERSONAL_E2E_RUN_ID = personalE2ERunId;

export default defineConfig({
  testDir: './tests/personal-e2e',
  globalTeardown: './tests/personal-e2e/personal-api-server.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-personal' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs tests/personal-e2e/personal-api-server.ts',
      url: 'http://127.0.0.1:4102/api/health',
      env: {
        ...process.env,
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        PERSONAL_AUTO_LOGIN: 'true',
        NODE_ENV: 'test',
        PORT: '4102',
        WEB_ORIGIN: 'http://127.0.0.1:4174',
        PERSONAL_E2E_RUN_ID: personalE2ERunId,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @scli/web dev',
      url: 'http://127.0.0.1:4174',
      env: {
        ...process.env,
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        NODE_ENV: 'test',
        VITE_PORT: '4174',
        API_PROXY_TARGET: 'http://127.0.0.1:4102',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'personal-chromium', use: { ...devices['Desktop Chrome'] } }],
});
