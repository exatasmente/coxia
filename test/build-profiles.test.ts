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

  it('the public build excludes every @anthropic-ai package and unpacks nothing', () => {
    const pub = read('electron-builder.public.yml');
    expect(pub).toMatch(/^extends: \.\/electron-builder\.yml$/m);
    expect(pub).toContain('"!node_modules/@anthropic-ai/**"');
    expect(pub).toMatch(/^asarUnpack: \[\]$/m);
  });

  it('npm run dist stays personal and dist:public uses the public config', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts.dist).not.toContain('electron-builder.public.yml');
    expect(scripts['dist:public']).toContain('--config electron-builder.public.yml');
  });
});
