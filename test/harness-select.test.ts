import { describe, expect, it } from 'vitest';
import { type HarnessEntry, classifyHarnessPath, parseHarnessFile } from '../src/shared/harness/format';
import { BUDGET_MAX, BUDGET_MIN, CLIP_MIN, type Mark, type SelectInput, budgetFor, clipText, selectDocs, wantsInvalid } from '../src/shared/harness/select';

const HEAD = ['checked-commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'checked-date: 2026-10-06'];

/** An entry as the scan makes it: the path says the kind, the text is parsed. */
function entry(path: string, header: string[] | null, body = `# ${path}\n`): HarnessEntry {
  const text = header ? ['---', ...HEAD, ...header, '---', '', body].join('\n') : body;
  const parse = parseHarnessFile(path, text);
  const at = classifyHarnessPath(path);
  if (!parse || !at) throw new Error(`not a file of the layout: ${path}`);
  return { path, kind: at.kind, id: at.id, parse, size: text.length, mtimeMs: 0 };
}

const ask = (over: Partial<SelectInput> = {}): SelectInput => ({ entries: [], marks: {}, texts: {}, stage: null, paths: [], agent: 'developer', budget: BUDGET_MAX, ...over });
const names = (items: { path: string }[]): string[] => items.map((i) => i.path);

describe('the budget of a call', () => {
  it('is 24000 characters without a declared window, and follows the window when there is one, with a floor', () => {
    expect(budgetFor(null)).toBe(BUDGET_MAX);
    expect(budgetFor(undefined)).toBe(BUDGET_MAX);
    expect(budgetFor(200_000)).toBe(BUDGET_MAX);
    // a model of 8 thousand tokens: 3 characters a token, 15% of it
    expect(budgetFor(8000)).toBe(3600);
    expect(budgetFor(2000)).toBe(BUDGET_MIN);
  });

  it('cuts at a line end when there is one near the limit', () => {
    expect(clipText('one\ntwo\nthree', 100)).toBe('one\ntwo\nthree');
    expect(clipText('aaaa\nbbbb\ncccccccc', 12)).toBe('aaaa\nbbbb');
    expect(clipText('abcdefghij', 4)).toBe('abcd');
  });
});

describe('what an agent is given', () => {
  it('always gives the overview, and indexes the rules nothing chose, with their summaries', () => {
    const sel = selectDocs(
      ask({ entries: [entry('README.md', [], 'About the project.'), entry('rules/a.md', ['evidence: [src/a.ts]', 'summary: how a works']), entry('rules/b.md', ['evidence: [src/b.ts]'])] }),
    );
    expect(sel.overview?.text).toBe('About the project.');
    expect(sel.picked).toEqual([]);
    expect(sel.indexed.map((l) => [l.path, l.summary])).toEqual([
      ['rules/a.md', 'how a works'],
      ['rules/b.md', null],
    ]);
    expect(sel.notIncluded).toEqual([]);
  });

  it('chooses by the id of the stage and by its kind', () => {
    const entries = [entry('rules/by-id.md', ['evidence: [x]', 'stages: [dev-stage]']), entry('rules/by-kind.md', ['evidence: [x]', 'stages: [review]']), entry('rules/other.md', ['evidence: [x]', 'stages: [qa]'])];
    expect(names(selectDocs(ask({ entries, stage: { id: 'dev-stage', kind: 'development' } })).picked)).toEqual(['rules/by-id.md']);
    const review = selectDocs(ask({ entries, stage: { id: 'peer', kind: 'review' } }));
    expect(names(review.picked)).toEqual(['rules/by-kind.md']);
    expect(names(review.indexed)).toEqual(['rules/by-id.md', 'rules/other.md']);
  });

  it('chooses by the agent: its id in roles, or its own notes by name', () => {
    const entries = [entry('rules/for-dev.md', ['evidence: [x]', 'roles: [developer]']), entry('rules/for-qa.md', ['evidence: [x]', 'roles: [qa]']), entry('roles/developer.md', []), entry('roles/qa.md', [])];
    const sel = selectDocs(ask({ entries, agent: 'developer' }));
    // the notes of the agent's own role come first
    expect(names(sel.picked)).toEqual(['roles/developer.md', 'rules/for-dev.md']);
    expect(sel.picked[0].why).toBe('role');
    expect(names(sel.indexed)).toEqual(['rules/for-qa.md', 'roles/qa.md']);
  });

  it('chooses by evidence over a path of the work, a folder included, and puts the rule that covers more paths first', () => {
    const entries = [entry('rules/one.md', ['evidence: [src/a.ts:1-9]']), entry('rules/folder.md', ['evidence: [src/main/]']), entry('rules/none.md', ['evidence: [docs/x.md]'])];
    const sel = selectDocs(ask({ entries, paths: ['src/a.ts', 'src/main/x.ts', 'src/main/y.ts'] }));
    expect(names(sel.picked)).toEqual(['rules/folder.md', 'rules/one.md']);
    expect(sel.picked.every((p) => p.why === 'evidence')).toBe(true);
    expect(names(sel.indexed)).toEqual(['rules/none.md']);
  });

  it('puts the skills after the rules that were chosen', () => {
    const entries = [entry('skills/how.md', ['stages: [development]']), entry('rules/r.md', ['evidence: [x]', 'stages: [development]'])];
    expect(names(selectDocs(ask({ entries, stage: { id: 'dev', kind: 'development' } })).picked)).toEqual(['rules/r.md', 'skills/how.md']);
  });
});

describe('marks', () => {
  const stale: Mark = { state: 'stale', ref: 'abc1234def', changed: ['src/a.ts'], total: 1 };

  it('goes with the file that was chosen, and not with one that is checked', () => {
    const entries = [entry('rules/old.md', ['evidence: [src/a.ts]']), entry('rules/fine.md', ['evidence: [src/a.ts]'])];
    const sel = selectDocs(ask({ entries, paths: ['src/a.ts'], marks: { 'rules/old.md': stale, 'rules/fine.md': { state: 'checked' } } }));
    expect(sel.picked.map((p) => [p.path, p.mark?.state ?? null])).toEqual([
      ['rules/fine.md', null],
      ['rules/old.md', 'stale'],
    ]);
  });

  it('goes with a file that was only indexed, and a file the check said nothing about is not trusted', () => {
    const entries = [entry('rules/old.md', ['evidence: [src/a.ts]']), entry('rules/unknown.md', ['evidence: [src/b.ts]'])];
    const sel = selectDocs(ask({ entries, marks: { 'rules/old.md': stale } }));
    expect(sel.indexed.map((l) => [l.path, l.mark?.state])).toEqual([
      ['rules/old.md', 'stale'],
      ['rules/unknown.md', 'unverified'],
    ]);
  });

  it('gives the overview and the notes of the agent\'s role even with no valid header, marked, and only names the others', () => {
    const entries = [entry('README.md', null, 'Plain overview.'), entry('roles/developer.md', null, 'My notes.'), entry('roles/qa.md', null, 'Not mine.'), entry('rules/bad.md', null, 'No header.')];
    expect(entries.every((e) => !e.parse.ok)).toBe(true);
    const texts = { 'README.md': 'Plain overview.', 'roles/developer.md': 'My notes.' };
    const sel = selectDocs(ask({ entries, texts }));
    expect(sel.overview).toMatchObject({ text: 'Plain overview.', mark: { state: 'invalid', reason: 'no-header' } });
    expect(sel.picked).toMatchObject([{ path: 'roles/developer.md', text: 'My notes.', mark: { state: 'invalid' } }]);
    expect(sel.indexed.map((l) => [l.path, l.mark?.state, l.summary])).toEqual([
      ['roles/qa.md', 'invalid', null],
      ['rules/bad.md', 'invalid', null],
    ]);
    expect(wantsInvalid(entries[0], 'developer')).toBe(true);
    expect(wantsInvalid(entries[2], 'developer')).toBe(false);
  });
});

describe('the budget', () => {
  const big = (n: number): string => `${'line of a rule\n'.repeat(Math.ceil(n / 15))}`.slice(0, n);

  it('cuts the overview at 40% of it, and says it was cut', () => {
    const sel = selectDocs(ask({ budget: 5000, entries: [entry('README.md', [], big(9000))] }));
    expect(sel.overview?.clipped).toBe(true);
    expect(sel.overview?.text.length).toBeLessThanOrEqual(2000);
    expect(sel.overview?.text.length).toBeGreaterThan(1500);
  });

  it('gives a file whole when it fits, cut with the note when 600 characters of it fit, and only names the rest', () => {
    const entries = [entry('rules/a.md', ['evidence: [x]', 'stages: [development]'], big(1500)), entry('rules/b.md', ['evidence: [x]', 'stages: [development]'], big(1500)), entry('rules/c.md', ['evidence: [x]', 'stages: [development]'], big(1500))];
    const sel = selectDocs(ask({ entries, budget: 2800, stage: { id: 'dev', kind: 'development' } }));
    expect(sel.picked.map((p) => [p.path, p.clipped])).toEqual([
      ['rules/a.md', false],
      ['rules/b.md', true],
    ]);
    expect(sel.picked[1].text.length).toBeGreaterThanOrEqual(CLIP_MIN);
    expect(sel.notIncluded).toEqual(['rules/c.md']);
  });

  it('keeps nothing silent: a file chosen that did not fit and an index line that did not fit are both named', () => {
    const entries = [entry('README.md', [], big(1400)), entry('rules/a.md', ['evidence: [x]', 'stages: [development]'], big(900)), entry('rules/idx.md', ['evidence: [y]', `summary: ${'s'.repeat(150)}`])];
    const sel = selectDocs(ask({ entries, budget: BUDGET_MIN, stage: { id: 'dev', kind: 'development' } }));
    const given = [...names(sel.picked), ...names(sel.indexed), ...sel.notIncluded, sel.overview?.path];
    expect(given.sort()).toEqual(['README.md', 'rules/a.md', 'rules/idx.md']);
  });

  it('shrinks with a small context window: the same files give less of themselves', () => {
    const entries = [entry('rules/a.md', ['evidence: [x]', 'stages: [development]'], big(2500)), entry('rules/b.md', ['evidence: [x]', 'stages: [development]'], big(2500))];
    const stage = { id: 'dev', kind: 'development' };
    expect(selectDocs(ask({ entries, stage, budget: budgetFor(null) })).notIncluded).toEqual([]);
    const small = selectDocs(ask({ entries, stage, budget: budgetFor(8000) }));
    expect(small.picked.some((p) => p.clipped) || small.notIncluded.length > 0).toBe(true);
    const total = small.picked.reduce((n, p) => n + p.text.length, 0);
    expect(total).toBeLessThan(3600);
  });
});
