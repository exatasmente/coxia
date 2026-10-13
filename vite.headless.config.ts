import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain', '--', 'src']) !== '';

// The core without the desktop, as one file: the app's own sources are bundled and every npm dependency stays external, resolved from the node_modules
// installed next to the bundle. The sources are Vite's (`import.meta.glob`, JSON catalogs), which is why it is built with Vite and not copied.
// `electron` is not a dependency of the core, and `electron-updater` is only required lazily (updates.ts), so neither is bundled nor loaded.
export default defineConfig({
  publicDir: false,
  define: {
    __BUILD_COMMIT__: JSON.stringify(dirty ? `${commit}+dirty` : commit),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    ssr: fileURLToPath(new URL('./src/headless/run.ts', import.meta.url)),
    outDir: 'out/headless',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', 'electron-updater'],
      output: { format: 'es', entryFileNames: 'coxia.mjs', inlineDynamicImports: true },
    },
  },
  ssr: { target: 'node' },
});
