import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { redact, redactCode, redactDoc } from '../src/main/errorlog-core';
import { finalizeHarness } from '../src/main/harness/finalize';
import { checkText, rewriteLocal } from '../src/shared/runs/comment';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-finalize-agents-'));
  roots.push(dir);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}

const put = (dir: string, path: string, text: string): void => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const options = (dir: string) => ({
  redact: (text: string) => redactDoc(text, '/home/nobody'),
  redactCode: (text: string) => redactCode(text, '/home/nobody'),
  worktree: dir,
});

describe('rewriteLocal', () => {
  it('replaces local paths, masks credentials, and agrees with checkText', () => {
    const worktree = '/tmp/work/wt';
    const redactText = (text: string) => redact(text, '/home/nobody');
    const raw = 'Read /tmp/work/wt/src/a.ts and ~/notes/x.md; key sk-abcdefgh12345678.';
    const result = rewriteLocal(raw, { worktree, redact: redactText });
    expect(result).toMatchObject({ body: 'Read src/a.ts and x.md; key [key].', paths: 2, secret: true });
    expect(checkText(raw, { worktree, redact: redactText, agentIds: [] }).body).toBe(result.body);
  });
});

describe('finalizeHarness', () => {
  it('rewrites paths and credentials in the changed root AGENTS.md without adding metadata', async () => {
    const dir = repo();
    const source = `Project sources live in ${dir}/src/a.ts. Key: sk-abcdefgh12345678.`;
    put(dir, 'AGENTS.md', source);
    const result = await finalizeHarness(dir, options(dir));
    expect(result).toMatchObject({ paths: 1, secrets: 1, rewritten: [{ file: 'AGENTS.md', paths: 1, secrets: 1 }], skipped: [] });
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('Project sources live in src/a.ts. Key: [key].');
  });

  it('keeps code examples intact except for credentials and worktree paths', async () => {
    const dir = repo();
    const content = [
      'Use `apiKey: string;` in the example.',
      '',
      '```ts',
      'const apiKey = \"hunter2hunter2\";',
      `const source = \"${dir}/src/a.ts\";`,
      '```',
      '',
    ].join('\n');
    put(dir, 'AGENTS.md', content);
    await finalizeHarness(dir, options(dir));
    const result = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(result).toContain('Use `apiKey: string;` in the example.');
    expect(result).toContain('const apiKey = [redacted];');
    expect(result).toContain('const source = \"src/a.ts\";');
  });

  it('does not process private run state or unrelated files', async () => {
    const dir = repo();
    put(dir, '.coxia/.run/0_ISSUE.md', `Local path ${dir}/src/a.ts and key sk-abcdefgh12345678.`);
    put(dir, 'docs/notes.md', `Local path ${dir}/src/a.ts.`);
    expect(await finalizeHarness(dir, options(dir))).toEqual({ rewritten: [], paths: 0, secrets: 0, skipped: [] });
    expect(readFileSync(join(dir, '.coxia/.run/0_ISSUE.md'), 'utf8')).toContain(dir);
    expect(readFileSync(join(dir, 'docs/notes.md'), 'utf8')).toContain(dir);
  });

  it('does not follow a symbolic link named AGENTS.md', async () => {
    const dir = repo();
    const outside = join(dir, 'outside.md');
    writeFileSync(outside, 'untouched');
    symlinkSync(outside, join(dir, 'AGENTS.md'));
    const result = await finalizeHarness(dir, options(dir));
    expect(result.skipped).toEqual(['AGENTS.md']);
    expect(readFileSync(outside, 'utf8')).toBe('untouched');
  });
});
