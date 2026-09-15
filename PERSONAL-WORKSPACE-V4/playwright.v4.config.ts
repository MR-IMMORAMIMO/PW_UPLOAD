import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const runId = randomUUID();
process.env.PERSONAL_E2E_RUN_ID = runId;
process.env.PERSONAL_E2E_REQUIRE_FULL_BACKUPS = 'false';

export default defineConfig({
  testDir: './tests/v4-e2e',
  globalTeardown: './tests/personal-e2e/personal-api-server.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'on',
    video: 'on',
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
        WEB_ORIGIN: 'http://127.0.0.1:4175',
        PERSONAL_E2E_RUN_ID: runId,
        PERSONAL_E2E_REQUIRE_FULL_BACKUPS: 'false',
        P5B_OWNER_UAT_FIXTURE: 'true',
        P5C_DATASHEET_UAT_FIXTURE: 'true',
        P5D_INTELLIGENCE_UAT_FIXTURE: 'true',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --dir apps/web-v4 dev',
      url: 'http://127.0.0.1:4175/v4/',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VITE_PORT: '4175',
        API_PROXY_TARGET: 'http://127.0.0.1:4102',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'v4-chromium', use: { ...devices['Desktop Chrome'] } }],
});
