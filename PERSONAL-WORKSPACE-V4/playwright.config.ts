import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @scli/api exec tsx src/server.ts',
      url: 'http://127.0.0.1:4101/api/health',
      env: {
        ...process.env,
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'team',
        NODE_ENV: 'test',
        PORT: '4101',
        WEB_ORIGIN: 'http://127.0.0.1:4173',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @scli/web dev',
      url: 'http://127.0.0.1:4173',
      env: {
        ...process.env,
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'team',
        NODE_ENV: 'test',
        VITE_PORT: '4173',
        API_PROXY_TARGET: 'http://127.0.0.1:4101',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
