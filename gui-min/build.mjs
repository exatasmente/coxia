import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
await build({
  configFile: false,
  plugins: [react()],
  root,
  logLevel: 'warn',
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: root + '/index.html' } },
});
console.log('built ok');
