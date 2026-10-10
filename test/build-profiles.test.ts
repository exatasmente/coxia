import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');

// The public package must not carry the Claude Agent SDK (Anthropic's terms); the personal build from source still does.
describe('build profiles', () => {
  it('the personal build unpacks the SDK binary and keeps it in the package', () => {
    const base = read('electron-builder.yml');
    expect(base).toContain('node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**');
    expect(base).not.toContain('!node_modules/@anthropic-ai');
  });

  // The app's browser runs the Playwright MCP server from a real file (src/main/paths.ts reads app.asar.unpacked), in both builds: the public list replaces the base's.
  it('both builds unpack the Playwright MCP server and the core nested under it', () => {
    for (const name of ['electron-builder.yml', 'electron-builder.public.yml']) {
      const yml = read(name);
      expect(yml, name).toContain('- node_modules/@playwright/**');
      expect(yml, name).toContain('- node_modules/@playwright/mcp/node_modules/playwright-core/**');
      // electron-builder hoists the server's Playwright to the top of node_modules in the package; unpacked cli.js cannot reach into app.asar.
      expect(yml, name).toContain('- node_modules/playwright/**');
      expect(yml, name).toContain('- node_modules/playwright-core/**');
    }
  });

  it('the public build excludes every @anthropic-ai package and unpacks only the Playwright MCP server', () => {
    const pub = read('electron-builder.public.yml');
    expect(pub).toMatch(/^extends: \.\/electron-builder\.yml$/m);
    expect(pub).toContain('"!node_modules/@anthropic-ai/**"');
    const unpack = pub.slice(pub.search(/^asarUnpack:/m)).split('\n').filter((l) => /^\s+- /.test(l)).map((l) => l.trim().slice(2));
    expect(unpack.length).toBeGreaterThan(0);
    expect(unpack.every((p) => /^node_modules\/(@playwright\/|playwright\/|playwright-core\/)/.test(p))).toBe(true);
    expect(unpack.some((p) => p.includes('anthropic'))).toBe(false);
  });

  // The same guarantee as the build lists above: the app still reads the server from the unpacked folder when packaged. The paths module now
  // computes that path from the host's resources folder instead of naming the runtime's own path, so the test watches the folder in the string.
  it('the app reads the server from the unpacked folder when packaged', () => {
    expect(read('src/main/paths.ts')).toContain('app.asar.unpacked/node_modules/@playwright/mcp/cli.js');
  });

  it('npm run dist stays personal and dist:public uses the public config', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts.dist).not.toContain('electron-builder.public.yml');
    expect(scripts['dist:public']).toContain('--config electron-builder.public.yml');
  });
});
