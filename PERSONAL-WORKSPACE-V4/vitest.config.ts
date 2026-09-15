import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Evidence archives contain preserved copies of tests, not executable test suites.
    exclude: [...configDefaults.exclude, 'output/**'],
    globals: true,
    environment: 'node',
    setupFiles: ['./apps/web/src/test-setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.d.ts', '**/dist/**', 'tests/e2e/**'],
    },
  },
});
