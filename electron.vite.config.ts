import { execFileSync } from 'node:child_process';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The installed app reports which commit it was built from; a build over uncommitted src/ changes says so.
const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain', '--', 'src']) !== '';

export default defineConfig({
  main: {
    define: {
      __BUILD_COMMIT__: JSON.stringify(dirty ? `${commit}+dirty` : commit),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
  },
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: { plugins: [react()] },
});
