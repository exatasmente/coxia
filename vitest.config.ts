import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Nothing in the suite may touch the real data or specs directories.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      CERIMONIAS_DATA_DIR: join(tmpdir(), 'cerimonias-test-data-ws'),
      CERIMONIAS_SPECS_DIR: join(tmpdir(), 'cerimonias-test-specs'),
    },
  },
});
