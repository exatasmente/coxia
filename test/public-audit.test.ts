import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, no declaration file
import { RULES, auditFiles, auditRoot, globToRegex, loadAllowlist } from '../scripts/public-audit.mjs';

type Hit = { file: string; line: number; rule: string };
const audit = (files: Record<string, string>, allow: unknown[] = []): Hit[] => auditFiles(Object.keys(files), (f: string) => Buffer.from(files[f]), allow);

describe('public audit rules', () => {
  it.each(RULES.map((r: { id: string; sample: string }) => [r.id, r.sample]) as [string, string][])('rule %s catches its own sample', (id, sample) => {
    const hits = audit({ 'src/a.ts': `// ${sample}\n` });
    expect(hits.map((h) => h.rule)).toContain(id);
  });

  it('passes ordinary text, documentation addresses and the author credit', () => {
    const hits = audit({
      'src/a.ts': "const host = 'git.acme.test'; // acme/web#101, 198.51.100.7, 203.0.113.0/24\n",
      'LICENSE': 'Copyright 2026 Luiz Neto\n',
      'package.json': '{ "author": "Luiz Neto <22161417+exatasmente@users.noreply.github.com>" }\n',
      'src/b.ts': "remote: 'git@github.com:acme/api.git', mail: 'ana@example.test'\n",
    });
    expect(hits).toEqual([]);
  });

  it('flags private network addresses, emails outside the reserved domains and keys', () => {
    const ip = ['10', '1', '2', '3'].join('.');
    const mail = ['ana', 'corp.com'].join('@');
    const key = `-----BEGIN ${'RSA '}PRIVATE KEY-----`;
    const hits = audit({ 'a.ts': `x ${ip}\ny ${mail}\n${key}\n` });
    expect(hits.map((h) => `${h.line}:${h.rule}`)).toEqual(['1:private-ip', '2:email', '3:secret']);
  });

  it('flags files that must never be tracked, by path', () => {
    const hits = audit({ 'scratch/notes.txt': 'x', '.claude/worktrees/a/b.ts': 'x', 'legacy-profile.json': '{}', 'docs/examples/legacy-profile.example.json': '{}', '.env.local': 'x' });
    expect(hits.map((h) => h.file).sort()).toEqual(['.claude/worktrees/a/b.ts', '.env.local', 'legacy-profile.json', 'scratch/notes.txt']);
  });

  it('skips the content of binary files but still checks their names', () => {
    const word = RULES[0].sample as string;
    const hits = auditFiles(['icon.png', `${word}.png`], () => Buffer.from([0, 1, 2, ...Buffer.from(word)]), []);
    expect(hits.map((h: Hit) => h.file)).toEqual([`${word}.png`]);
  });
});

describe('allowlist', () => {
  it('silences one rule in the files its glob names, only where the text matches', () => {
    const sample = RULES.find((r: { id: string }) => r.id === 'secret').sample as string;
    const files = { 'test/a.ts': sample, 'src/a.ts': sample, 'test/b.ts': `other ${sample}` };
    const allow = [{ rule: 'secret', file: globToRegex('test/**'), match: null, reason: 'fixtures' }];
    expect(audit(files, allow).map((h) => h.file)).toEqual(['src/a.ts']);
    const narrow = [{ rule: 'secret', file: globToRegex('test/*.ts'), match: 'other', reason: 'fixtures' }];
    expect(audit(files, narrow).map((h) => h.file)).toEqual(['test/a.ts', 'src/a.ts']);
  });

  it('globs: * stays in a folder, ** crosses folders', () => {
    expect(globToRegex('test/*.ts').test('test/a.ts')).toBe(true);
    expect(globToRegex('test/*.ts').test('test/x/a.ts')).toBe(false);
    expect(globToRegex('test/**').test('test/x/a.ts')).toBe(true);
  });

  it('the committed allowlist is valid and every entry carries a reason', () => {
    expect(loadAllowlist().length).toBeGreaterThan(0);
  });

  it('refuses an entry without a reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-allow-'));
    const file = join(dir, 'allow.json');
    writeFileSync(file, JSON.stringify({ entries: [{ rule: 'secret', file: 'a' }] }));
    expect(() => loadAllowlist(file)).toThrow(/needs/);
  });
});

describe('the repository', () => {
  it('has nothing that belongs to a company or a person', () => {
    const { hits, files } = auditRoot(join(import.meta.dirname, '..'), loadAllowlist());
    expect(files).toBeGreaterThan(100);
    expect(hits.map((h: Hit) => `${h.file}:${h.line} ${h.rule}`)).toEqual([]);
  });

  it('works on a folder that is not a git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-root-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), `x ${RULES[0].sample}\n`);
    writeFileSync(join(dir, 'src', 'b.ts'), 'clean\n');
    const { files, hits } = auditRoot(dir, []);
    expect(files).toBe(2);
    expect(hits.map((h: Hit) => h.file)).toEqual(['src/a.ts']);
  });
});
