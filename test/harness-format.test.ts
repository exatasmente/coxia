import { describe, expect, it } from 'vitest';
import { coversPath, evidencePaths, parseEvidence } from '../src/shared/harness/evidence';
import { HARNESS_DIR, classifyHarnessPath, parseHarnessFile } from '../src/shared/harness/format';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const head = (...lines: string[]): string => ['---', ...lines, '---', '', '# Title', '', 'The body.', ''].join('\n');
const base = [`checked-commit: ${COMMIT}`, 'checked-date: 2026-10-06'];

function ok(path: string, text: string) {
  const r = parseHarnessFile(path, text);
  if (!r || !r.ok) throw new Error(`expected a valid file, got ${JSON.stringify(r)}`);
  return r.file;
}
const reason = (path: string, text: string) => {
  const r = parseHarnessFile(path, text);
  return r && !r.ok ? r.reason : r;
};

describe('the layout of .coxia', () => {
  it('names the folder and tells the kind and the id of a file by where it sits, never by what it says', () => {
    expect(HARNESS_DIR).toBe('.coxia');
    expect(classifyHarnessPath('README.md')).toEqual({ kind: 'overview', id: null });
    expect(classifyHarnessPath('rules/billing.md')).toEqual({ kind: 'rule', id: 'billing' });
    expect(classifyHarnessPath('skills/release-it.md')).toEqual({ kind: 'skill', id: 'release-it' });
    expect(classifyHarnessPath('roles/dev_2.md')).toEqual({ kind: 'role', id: 'dev_2' });
    expect(ok('rules/x.md', head(...base, 'evidence: [a.ts]', 'kind: skill')).kind).toBe('rule');
  });

  it('does not read what is outside the layout: one level only, the id pattern, .md only, the readme by its exact name', () => {
    for (const path of ['rules/a/b.md', 'rules/x.txt', 'rules/Upper.md', 'rules/.md', 'readme.md', 'docs/README.md', 'README.md/x.md', 'other/x.md', '.run/x.md', '.gitignore', 'notes.md']) {
      expect(classifyHarnessPath(path), path).toBeNull();
      expect(parseHarnessFile(path, head(...base)), path).toBeNull();
    }
    expect(classifyHarnessPath(`rules/${'a'.repeat(49)}.md`)).toBeNull();
    expect(classifyHarnessPath(`rules/${'a'.repeat(48)}.md`)).not.toBeNull();
  });
});

describe('the header', () => {
  it('reads the required fields and the lists written inline', () => {
    const f = ok('rules/billing.md', head(...base, 'evidence: [src/billing.ts:10-20, src/shared/, test/billing.test.ts]', 'stages: [development, review]', 'roles: [dev]', 'summary: How an invoice is priced'));
    expect(f).toMatchObject({ path: 'rules/billing.md', kind: 'rule', id: 'billing' });
    expect(f.header).toEqual({
      checkedCommit: COMMIT,
      checkedDate: '2026-10-06',
      evidence: ['src/billing.ts:10-20', 'src/shared/', 'test/billing.test.ts'],
      stages: ['development', 'review'],
      roles: ['dev'],
      summary: 'How an invoice is priced',
      extra: {},
    });
    expect(f.body).toBe('# Title\n\nThe body.\n');
  });

  it('reads the lists written as a block, with or without indentation, and quoted values', () => {
    const f = ok('rules/x.md', head(`checked-commit: "${COMMIT}"`, "checked-date: '2026-10-06'", 'evidence:', '  - src/a.ts:1', '  - "src/b.ts:2-3"', 'stages:', '- qa', 'roles:', '  - reviewer'));
    expect(f.header.evidence).toEqual(['src/a.ts:1', 'src/b.ts:2-3']);
    expect(f.header.stages).toEqual(['qa']);
    expect(f.header.roles).toEqual(['reviewer']);
    expect(f.header.checkedCommit).toBe(COMMIT);
  });

  it('accepts a short commit, lowercases it, and reads CRLF files, a byte order mark, comments and blank lines in the header', () => {
    const text = `\uFEFF${head('# a note', '', 'checked-commit: ABCDEF1', 'checked-date: 2024-02-29', 'evidence: [a.ts]')}`.replace(/\n/g, '\r\n');
    const f = ok('rules/x.md', text);
    expect(f.header.checkedCommit).toBe('abcdef1');
    expect(f.header.checkedDate).toBe('2024-02-29');
    expect(f.body).toBe('# Title\n\nThe body.\n');
  });

  it('keeps a key it does not know and ignores it, so a newer app can add fields', () => {
    const f = ok('skills/x.md', head(...base, 'owner: team-a', 'tags: [a, b]'));
    expect(f.header.extra).toEqual({ owner: 'team-a', tags: ['a', 'b'] });
    expect(f.header).not.toHaveProperty('owner');
  });

  it('needs no evidence outside rules, and takes an empty list or a missing key there', () => {
    expect(ok('README.md', head(...base)).header.evidence).toEqual([]);
    expect(ok('skills/x.md', head(...base, 'evidence: []')).header.evidence).toEqual([]);
    expect(ok('roles/dev.md', head(...base, 'evidence: [src/a.ts]')).header.evidence).toEqual(['src/a.ts']);
  });

  it('cuts a summary at 160 characters and treats a lone stage or role as a list of one', () => {
    const f = ok('README.md', head(...base, `summary: ${'x'.repeat(200)}`, 'stages: review', 'roles: dev'));
    expect(f.header.summary).toHaveLength(160);
    expect(f.header.stages).toEqual(['review']);
    expect(f.header.roles).toEqual(['dev']);
  });
});

describe('a file with no valid header is not dropped and not trusted: it comes back with the reason', () => {
  it('no-header: no block, an unclosed one, not at the top, or a line that is not a pair', () => {
    expect(reason('README.md', '# Only a title\n')).toBe('no-header');
    expect(reason('README.md', `---\nchecked-commit: ${COMMIT}\n`)).toBe('no-header');
    expect(reason('README.md', `# Title\n\n${head(...base)}`)).toBe('no-header');
    expect(reason('README.md', head(...base, 'not a pair'))).toBe('no-header');
    expect(reason('README.md', head(...base, 'evidence: [a.ts'))).toBe('no-header');
    expect(reason('README.md', head('- orphan item', ...base))).toBe('no-header');
    expect(reason('README.md', '')).toBe('no-header');
  });

  it('bad-commit: missing, too short, too long or not hexadecimal', () => {
    expect(reason('README.md', head('checked-date: 2026-10-06'))).toBe('bad-commit');
    for (const commit of ['abc12', 'g'.repeat(40), `${COMMIT}0`, 'HEAD', '']) expect(reason('README.md', head(`checked-commit: ${commit}`, 'checked-date: 2026-10-06')), commit).toBe('bad-commit');
  });

  it('bad-date: missing, in another shape, or a day that does not exist', () => {
    expect(reason('README.md', head(`checked-commit: ${COMMIT}`))).toBe('bad-date');
    for (const date of ['06/10/2026', '2026-1-6', '2026-02-30', '2023-02-29', '2026-13-01', 'today']) expect(reason('README.md', head(`checked-commit: ${COMMIT}`, `checked-date: ${date}`)), date).toBe('bad-date');
  });

  it('no-evidence: a rule with no evidence key or an empty list', () => {
    expect(reason('rules/x.md', head(...base))).toBe('no-evidence');
    expect(reason('rules/x.md', head(...base, 'evidence: []'))).toBe('no-evidence');
    expect(reason('rules/x.md', head(...base, 'evidence:'))).toBe('no-evidence');
  });

  it('bad-evidence: an entry that is not a path of the repository, in a rule or anywhere else', () => {
    for (const entry of ['/etc/passwd', '../outside.ts', 'a/../b.ts', '~/notes.md', 'C:/x.ts', 'src//a.ts', 'src/a.ts:0', 'src/a.ts:9-3', 'src/:3', 'a\\b.ts']) {
      expect(reason('rules/x.md', head(...base, `evidence: [src/ok.ts, ${entry}]`)), entry).toBe('bad-evidence');
    }
    expect(reason('skills/x.md', head(...base, 'evidence: [/abs/path.ts]'))).toBe('bad-evidence');
  });

  it('keeps the kind and the id of the file with the reason', () => {
    expect(parseHarnessFile('rules/billing.md', '# nothing')).toEqual({ ok: false, path: 'rules/billing.md', kind: 'rule', id: 'billing', reason: 'no-header' });
    expect(parseHarnessFile('README.md', '# nothing')).toEqual({ ok: false, path: 'README.md', kind: 'overview', id: null, reason: 'no-header' });
  });
});

describe('evidence', () => {
  it('reads a path, a line, a range and a folder', () => {
    expect(parseEvidence('src/a.ts')).toEqual({ path: 'src/a.ts', dir: false, from: null, to: null });
    expect(parseEvidence('src/a.ts:12')).toEqual({ path: 'src/a.ts', dir: false, from: 12, to: 12 });
    expect(parseEvidence(' src/a.ts:12-20 ')).toEqual({ path: 'src/a.ts', dir: false, from: 12, to: 20 });
    expect(parseEvidence('src/shared/')).toEqual({ path: 'src/shared', dir: true, from: null, to: null });
    expect(parseEvidence('.github/workflows/ci.yml:3')).toMatchObject({ path: '.github/workflows/ci.yml' });
    expect(parseEvidence('')).toBeNull();
    expect(parseEvidence('/')).toBeNull();
  });

  it('covers the same file, or any file under a folder entry, and never a sibling with the same prefix', () => {
    expect(coversPath('src/a.ts:3-9', 'src/a.ts')).toBe(true);
    expect(coversPath('src/a.ts', 'src/a.tsx')).toBe(false);
    expect(coversPath('src/shared/', 'src/shared/x/y.ts')).toBe(true);
    expect(coversPath('src/shared/', 'src/shared')).toBe(true);
    expect(coversPath('src/shared/', 'src/shared-two/y.ts')).toBe(false);
    expect(coversPath('src/shared', 'src/shared/y.ts')).toBe(false);
    expect(coversPath('src/a.ts', './src/a.ts')).toBe(true);
    expect(coversPath('../a.ts', 'a.ts')).toBe(false);
  });

  it('lists the distinct paths of the entries that parse', () => {
    expect(evidencePaths(['src/a.ts:1', 'src/a.ts:5-9', 'src/shared/', '/abs.ts'])).toEqual(['src/a.ts', 'src/shared']);
  });
});
