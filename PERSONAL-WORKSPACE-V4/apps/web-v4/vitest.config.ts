import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Bound concurrent jsdom runtimes so UI deadlines do not depend on host CPU count.
    maxWorkers: 4,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
