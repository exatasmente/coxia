import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HARNESS_FILE_MAX, scanHarness } from '../src/main/harness/scan';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const header = (...extra: string[]): string => ['---', `checked-commit: ${COMMIT}`, 'checked-date: 2026-10-06', ...extra, '---', '', '# Body', ''].join('\n');

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-harness-'));
  roots.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe('scanHarness', () => {
  it('says a repository without .coxia/ has none, and does not mistake a file of that name for the folder', async () => {
    const none = await scanHarness(repo({ 'src/a.ts': '' }));
    expect(none).toMatchObject({ exists: false, entries: [], ignored: [], signature: '' });
    expect((await scanHarness(repo({ '.coxia': 'a file' }))).exists).toBe(false);
    expect((await scanHarness(join(tmpdir(), 'cerimonias-harness-missing-folder'))).exists).toBe(false);
  });

  it('reads the overview, the rules, the skills and the roles, by where they sit', async () => {
    const dir = repo({
      '.coxia/README.md': header('summary: What this is'),
      '.coxia/rules/billing.md': header('evidence: [src/billing.ts:1-9]'),
      '.coxia/rules/auth.md': header('evidence: [src/auth/]'),
      '.coxia/skills/release.md': header(),
      '.coxia/roles/reviewer.md': header('stages: [review]'),
    });
    const s = await scanHarness(dir);
    expect(s).toMatchObject({ repo: dir, exists: true, ignored: [] });
    expect(s.entries.map((e) => [e.path, e.kind, e.id, e.parse.ok])).toEqual([
      ['README.md', 'overview', null, true],
      ['roles/reviewer.md', 'role', 'reviewer', true],
      ['rules/auth.md', 'rule', 'auth', true],
      ['rules/billing.md', 'rule', 'billing', true],
      ['skills/release.md', 'skill', 'release', true],
    ]);
    const readme = s.entries[0].parse;
    expect(readme.ok && readme.file.header.summary).toBe('What this is');
  });

  it('keeps a file with a bad header as an entry with the reason, and a rule without evidence as such', async () => {
    const s = await scanHarness(repo({ '.coxia/README.md': '# no header', '.coxia/rules/x.md': header(), '.coxia/skills/y.md': header('evidence: [/etc/passwd]') }));
    expect(s.entries.map((e) => [e.path, e.parse.ok ? 'ok' : e.parse.reason])).toEqual([
      ['README.md', 'no-header'],
      ['rules/x.md', 'no-evidence'],
      ['skills/y.md', 'bad-evidence'],
    ]);
  });

  it('lists what is outside the layout as ignored and reads none of it', async () => {
    const s = await scanHarness(
      repo({
        '.coxia/README.md': header(),
        '.coxia/rules/a/deep.md': header('evidence: [x]'),
        '.coxia/rules/notes.txt': 'x',
        '.coxia/rules/Upper.md': header('evidence: [x]'),
        '.coxia/other/z.md': header(),
        '.coxia/readme.md': header(),
      }),
    );
    expect(s.entries.map((e) => e.path)).toEqual(['README.md']);
    expect(s.ignored).toEqual(['other/z.md', 'readme.md', 'rules/Upper.md', 'rules/a/deep.md', 'rules/notes.txt']);
  });

  it('leaves what the app writes itself (.run/ and .gitignore) out of the count and the list', async () => {
    const s = await scanHarness(repo({ '.coxia/README.md': header(), '.coxia/.gitignore': '.run/\n', '.coxia/.run/log.md': 'x', '.coxia/.run/deep/x.md': 'x' }));
    expect(s.entries.map((e) => e.path)).toEqual(['README.md']);
    expect(s.ignored).toEqual([]);
  });

  it('does not read a file that is too big, and does not follow a link', async () => {
    const dir = repo({ '.coxia/README.md': header(), '.coxia/rules/big.md': header('evidence: [a]') + 'x'.repeat(HARNESS_FILE_MAX), '.coxia/rules/real.md': header('evidence: [a]') });
    symlinkSync(join(dir, '.coxia/rules/real.md'), join(dir, '.coxia/rules/link.md'));
    const s = await scanHarness(dir);
    expect(s.entries.map((e) => e.path)).toEqual(['README.md', 'rules/real.md']);
    expect(s.ignored).toEqual(['rules/big.md', 'rules/link.md']);
  });

  it('changes the signature when a file of the folder changes, and only then', async () => {
    const dir = repo({ '.coxia/README.md': header() });
    const a = await scanHarness(dir);
    expect((await scanHarness(dir)).signature).toBe(a.signature);
    writeFileSync(join(dir, '.coxia/README.md'), `${header()}more\n`);
    const b = await scanHarness(dir);
    expect(b.signature).not.toBe(a.signature);
    utimesSync(join(dir, '.coxia/README.md'), new Date(1_000_000), new Date(1_000_000));
    expect((await scanHarness(dir)).signature).not.toBe(b.signature);
    writeFileSync(join(dir, '.coxia/notes.txt'), 'ignored files are not part of it');
    const c = await scanHarness(dir);
    writeFileSync(join(dir, '.coxia/notes.txt'), 'changed');
    expect((await scanHarness(dir)).signature).toBe(c.signature);
  });
});
