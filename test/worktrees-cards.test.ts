import { describe, expect, it } from 'vitest';
import { compareCards } from '../src/main/cards';
import { checkConvention, issueOf, parseWorktrees } from '../src/main/worktrees';
import type { Card } from '../src/shared/types';

describe('branch convention', () => {
  it.each([
    'main',
    'master',
    'develop',
    'release/bugfix/14327',
    'release/feature/14500',
    'release/hotfix/14735',
    'release/bugfix/14327-extra',
    'release/49.0.2',
    'release/v49.0.2',
    'docs/release-branch-prefix',
    'cov-15499',
    'cov/15499',
    'exp-x',
    'local/qualquer',
    'backup-main',
    'test/x',
  ])('accepts %s', (branch) => {
    expect(checkConvention(branch)).toBeNull();
  });

  it.each([
    ['bugfix/14327', 'release/bugfix/14327'],
    ['bug/14327', 'release/bugfix/14327'],
    ['fix/14327', 'release/bugfix/14327'],
    ['feat/15999', 'release/feature/15999'],
    ['feature/15999', 'release/feature/15999'],
    ['hotfix/14735', 'release/hotfix/14735'],
    ['Bugfix/14327', 'release/bugfix/14327'],
    ['bugfix/14327-algo.x', 'release/bugfix/14327-algo.x'],
    ['release/feat/15999', 'release/feature/15999'],
  ])('suggests the new name for %s', (branch, name) => {
    expect(checkConvention(branch)).toEqual({ suggestedName: name, note: `renomear para ${name} (skill branch-rename)` });
  });

  it('only points at the convention when the name has an issue number but the type is unknown', () => {
    expect(checkConvention('luiz-15499-ajuste')).toEqual({ suggestedName: null, note: 'usar release/<bugfix|feature|hotfix>/15499' });
    expect(checkConvention('chore/15499')).toEqual({ suggestedName: null, note: 'usar release/<bugfix|feature|hotfix>/15499' });
  });

  it('flags a branch with no issue number', () => {
    expect(checkConvention('luiz/teste')).toEqual({ suggestedName: null, note: 'fora de release/<tipo>/<n> e docs/<slug>' });
    expect(checkConvention('bugfix/123')).toEqual({ suggestedName: null, note: 'fora de release/<tipo>/<n> e docs/<slug>' });
  });

  it('flags a docs branch with an invalid slug and a release type that does not exist', () => {
    expect(checkConvention('docs/Release_Branch')?.suggestedName).toBeNull();
    expect(checkConvention('release/chore/14327')).not.toBeNull();
  });
});

describe('issueOf', () => {
  it('reads the issue from the branch', () => {
    expect(issueOf('release/bugfix/15499', '')).toBe('15499');
    expect(issueOf('feat/15965-builder', '/x')).toBe('15965');
    expect(issueOf('release/hotfix/14735', '/home/u/projects/wt-1')).toBe('14735');
  });

  it('falls back to the worktree path', () => {
    expect(issueOf('main', '/home/u/projects/wt-15965')).toBe('15965');
    expect(issueOf(null, '/home/u/projects/wt-cov14816')).toBe('14816');
    expect(issueOf('main', '/home/u/projects/wt-16086-playbook')).toBe('16086');
  });

  it('does not read a version or a number of the wrong size as an issue', () => {
    expect(issueOf('release/49.0.2', '/home/u/projects/sz4')).toBeNull();
    expect(issueOf('release/bugfix/1234', '')).toBeNull();
    expect(issueOf('release/bugfix/1234567', '')).toBeNull();
    expect(issueOf('main', '/home/u/projects/sz4')).toBeNull();
    expect(issueOf(null, '/home/u/projects/wt-1234')).toBeNull();
  });
});

describe('parseWorktrees', () => {
  const porcelain = [
    'worktree /home/u/projects/sz4\nHEAD aaaaaaa\nbranch refs/heads/main',
    'worktree /home/u/projects/wt-15499\nHEAD bbbbbbb\nbranch refs/heads/release/bugfix/15499',
    'worktree /home/u/projects/wt-gone\nHEAD ccccccc\ndetached\nprunable gitdir file points to non-existent location',
    '',
  ].join('\n\n');

  it('reads path, head, branch and prunable', () => {
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/home/u/projects/sz4', head: 'aaaaaaa', branch: 'main', prunable: false },
      { path: '/home/u/projects/wt-15499', head: 'bbbbbbb', branch: 'release/bugfix/15499', prunable: false },
      { path: '/home/u/projects/wt-gone', head: 'ccccccc', branch: null, prunable: true },
    ]);
  });

  it('returns nothing for an empty output', () => {
    expect(parseWorktrees('')).toEqual([]);
  });
});

const card = (ref: string, over: Partial<Card> = {}): Card => ({
  ref,
  iid: ref,
  title: ref,
  stage: null,
  spec: null,
  mrs: [],
  mrPaths: [],
  blockers: [],
  pending: [],
  changes: [],
  note: null,
  url: '',
  ...over,
});

describe('card ordering', () => {
  it('puts blocked first, then with pending items, then the rest, each group by ref', () => {
    const cards = [
      card('sz4#5'),
      card('sz4#3', { pending: ['revisar'] }),
      card('sz4#4', { blockers: ['x'] }),
      card('sz4#1'),
      card('sz4#2', { pending: ['y'], blockers: ['z'] }),
      card('sz4#0', { pending: ['w'] }),
    ];
    cards.sort(compareCards);
    expect(cards.map((c) => c.ref)).toEqual(['sz4#2', 'sz4#4', 'sz4#0', 'sz4#3', 'sz4#1', 'sz4#5']);
  });

  it('is stable for equal cards and does not mutate them', () => {
    const a = card('a#1', { blockers: ['x'] });
    expect(compareCards(a, { ...a })).toBe(0);
  });
});
