import { defineConfig } from 'vitest/config';

// Nothing in the suite may touch the real data or specs directories: test/setup.ts gives every test file its own temporary ones.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
