import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENTS_FILE, AGENTS_FILE_MAX } from '../src/shared/harness/agentsMd';
import { scanHarness } from '../src/main/harness/scan';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-agents-md-'));
  roots.push(dir);
  return dir;
}

describe('scanHarness', () => {
  it('reports no instructions when root AGENTS.md is absent', async () => {
    const state = await scanHarness(repo());
    expect(state).toMatchObject({ exists: false, document: null, ignored: [], signature: '' });
  });

  it('reads plain Markdown without requiring custom metadata or a special folder layout', async () => {
    const dir = repo();
    const text = '# Project instructions\n\nRun the tests before submitting.\n';
    writeFileSync(join(dir, AGENTS_FILE), text);
    const state = await scanHarness(dir);
    expect(state).toMatchObject({ exists: true, ignored: [], document: { path: AGENTS_FILE, text, size: Buffer.byteLength(text) } });
  });

  it('treats .coxia as private app state, not as project instructions', async () => {
    const dir = repo();
    mkdirSync(join(dir, '.coxia'), { recursive: true });
    writeFileSync(join(dir, '.coxia', 'README.md'), 'legacy documentation');
    const state = await scanHarness(dir);
    expect(state).toMatchObject({ exists: false, document: null });
  });

  it('does not follow symlinks, accept directories, or read oversized instructions', async () => {
    const dir = repo();
    const outside = join(dir, 'outside.md');
    writeFileSync(outside, '# External');
    symlinkSync(outside, join(dir, AGENTS_FILE));
    expect(await scanHarness(dir)).toMatchObject({ exists: true, document: null, ignored: [AGENTS_FILE] });

    rmSync(join(dir, AGENTS_FILE));
    mkdirSync(join(dir, AGENTS_FILE));
    expect(await scanHarness(dir)).toMatchObject({ exists: true, document: null, ignored: [AGENTS_FILE] });

    rmSync(join(dir, AGENTS_FILE), { recursive: true });
    writeFileSync(join(dir, AGENTS_FILE), 'x'.repeat(AGENTS_FILE_MAX + 1));
    expect(await scanHarness(dir)).toMatchObject({ exists: true, document: null, ignored: [AGENTS_FILE] });
  });

  it('changes its signature only when AGENTS.md changes', async () => {
    const dir = repo();
    writeFileSync(join(dir, AGENTS_FILE), '# First\n');
    const first = await scanHarness(dir);
    expect((await scanHarness(dir)).signature).toBe(first.signature);
    writeFileSync(join(dir, AGENTS_FILE), '# Second\n');
    const second = await scanHarness(dir);
    expect(second.signature).not.toBe(first.signature);
    utimesSync(join(dir, AGENTS_FILE), new Date(1_000_000), new Date(1_000_000));
    expect((await scanHarness(dir)).signature).not.toBe(second.signature);
  });
});
