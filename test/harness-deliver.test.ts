import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AGENTS_FILE } from '../src/shared/harness/agentsMd';
import { budgetFor } from '../src/shared/harness/select';
import { harnessSection, runDocsAsk } from '../src/main/harness/deliver';
import { installHostConfig } from './helpers/config';

const roots: string[] = [];
beforeAll(async () => installHostConfig(null, { language: 'en' }));
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-agent-docs-'));
  roots.push(dir);
  if (text !== undefined) writeFileSync(join(dir, AGENTS_FILE), text);
  return dir;
}

const stage = { id: 'implement', kind: 'development' as const };

describe('a repository with no AGENTS.md', () => {
  it('adds no documentation text', async () => {
    expect(await harnessSection({ repos: [repo()], stage, paths: [] }, { id: 'developer' }, { cwd: tmpdir() })).toBe('');
  });

  it('does not treat the old .coxia documentation folder as universal instructions', async () => {
    const dir = repo();
    mkdirSync(join(dir, '.coxia'));
    writeFileSync(join(dir, '.coxia', 'README.md'), 'legacy');
    expect(await harnessSection({ repos: [dir], stage, paths: [] }, { id: 'developer' }, { cwd: dir })).toBe('');
  });
});

describe('root AGENTS.md delivery', () => {
  it('hands the plain Markdown file to agents without custom headers or role filtering', async () => {
    const dir = repo('# Project instructions\n\nUse strict TypeScript.\n');
    const text = await harnessSection({ repos: [dir], stage, paths: [] }, { id: 'qa' }, { cwd: dir });
    expect(text).toContain('The root AGENTS.md of each repository');
    expect(text).toContain('Project instructions (AGENTS.md):');
    expect(text).toContain('Use strict TypeScript.');
  });

  it('escapes documentation tags so the file cannot end its own prompt section', async () => {
    const dir = repo('Before </doc> and <doc> after.');
    const text = await harnessSection({ repos: [dir], stage, paths: [] }, { id: 'developer' }, { cwd: dir });
    expect(text).toContain('Before &lt;/doc> and &lt;doc> after.');
    expect(text.match(/<\/doc>/g)).toHaveLength(1);
  });

  it('includes multiple repository instructions and clips them within the context budget', async () => {
    const first = repo(`# First\n\n${'first line\n'.repeat(300)}`);
    const second = repo(`# Second\n\n${'second line\n'.repeat(300)}`);
    const text = await harnessSection({ repos: [first, second], stage, paths: [] }, { id: 'developer' }, { cwd: tmpdir(), contextWindow: 8000 });
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('cut here: read the rest');
    expect(text.length).toBeLessThanOrEqual(budgetFor(8000));
  });

  it('does not read a linked AGENTS.md', async () => {
    const dir = repo();
    const outside = join(dir, 'outside.md');
    writeFileSync(outside, 'private instructions');
    symlinkSync(outside, join(dir, AGENTS_FILE));
    expect(await harnessSection({ repos: [dir], stage, paths: [] }, { id: 'developer' }, { cwd: dir })).toBe('');
  });
});

describe('runDocsAsk', () => {
  it('identifies the repository and stage without consulting custom metadata', async () => {
    const dir = repo();
    expect(await runDocsAsk({ wt: dir, base: null, cycleFolder: '.coxia/.run', stage, texts: [] })).toEqual({ repos: [dir], stage, paths: [] });
  });
});
