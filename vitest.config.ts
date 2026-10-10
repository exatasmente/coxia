import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Nothing in the suite may touch the real data or specs directories: test/setup.ts gives every test file its own temporary ones.
export default defineConfig({
  resolve: {
    // A missing Electron binary is downloaded on the first require of the package: the tests get a stub instead (test/helpers/electron.ts).
    alias: [{ find: /^electron$/, replacement: fileURLToPath(new URL('./test/helpers/electron.ts', import.meta.url)) }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
