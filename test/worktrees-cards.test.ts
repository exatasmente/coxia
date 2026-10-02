import { describe, expect, it } from 'vitest';
import { compareCards } from '../src/main/cards';
import { checkConvention, issueOf, parseWorktrees } from '../src/main/worktrees';
import type { Card } from '../src/shared/types';

describe('branch convention', () => {
  it.each([
    'main',
    'master',
    'develop',
    'release/bugfix/10110',
    'release/feature/10104',
    'release/hotfix/14735',
    'release/bugfix/10110-extra',
    'release/49.0.2',
    'release/v49.0.2',
    'docs/release-branch-prefix',
    'cov-10101',
    'cov/10101',
    'exp-x',
    'local/qualquer',
    'backup-main',
    'test/x',
  ])('accepts %s', (branch) => {
    expect(checkConvention(branch)).toBeNull();
  });

  it.each([
    ['bugfix/10110', 'release/bugfix/10110'],
    ['bug/10110', 'release/bugfix/10110'],
    ['fix/10110', 'release/bugfix/10110'],
    ['feat/15999', 'release/feature/15999'],
    ['feature/15999', 'release/feature/15999'],
    ['hotfix/14735', 'release/hotfix/14735'],
    ['Bugfix/10110', 'release/bugfix/10110'],
    ['bugfix/10110-algo.x', 'release/bugfix/10110-algo.x'],
    ['release/feat/15999', 'release/feature/15999'],
  ])('suggests the new name for %s', (branch, name) => {
    expect(checkConvention(branch)).toEqual({ suggestedName: name, note: `renomear para ${name} (skill branch-rename)` });
  });

  it('only points at the convention when the name has an issue number but the type is unknown', () => {
    expect(checkConvention('bruno-10101-ajuste')).toEqual({ suggestedName: null, note: 'usar release/<bugfix|feature|hotfix>/10101' });
    expect(checkConvention('chore/10101')).toEqual({ suggestedName: null, note: 'usar release/<bugfix|feature|hotfix>/10101' });
  });

  it('flags a branch with no issue number', () => {
    expect(checkConvention('bruno/teste')).toEqual({ suggestedName: null, note: 'fora de release/<tipo>/<n> e docs/<slug>' });
    expect(checkConvention('bugfix/123')).toEqual({ suggestedName: null, note: 'fora de release/<tipo>/<n> e docs/<slug>' });
  });

  it('flags a docs branch with an invalid slug and a release type that does not exist', () => {
    expect(checkConvention('docs/Release_Branch')?.suggestedName).toBeNull();
    expect(checkConvention('release/chore/10110')).not.toBeNull();
  });
});

describe('issueOf', () => {
  it('reads the issue from the branch', () => {
    expect(issueOf('release/bugfix/10101', '')).toBe('10101');
    expect(issueOf('feat/10103-builder', '/x')).toBe('10103');
    expect(issueOf('release/hotfix/14735', '/home/u/projects/wt-1')).toBe('14735');
  });

  it('falls back to the worktree path', () => {
    expect(issueOf('main', '/home/u/projects/wt-10103')).toBe('10103');
    expect(issueOf(null, '/home/u/projects/wt-cov10111')).toBe('10111');
    expect(issueOf('main', '/home/u/projects/wt-10112-playbook')).toBe('10112');
  });

  it('does not read a version or a number of the wrong size as an issue', () => {
    expect(issueOf('release/49.0.2', '/home/u/projects/web')).toBeNull();
    expect(issueOf('release/bugfix/1234', '')).toBeNull();
    expect(issueOf('release/bugfix/1234567', '')).toBeNull();
    expect(issueOf('main', '/home/u/projects/web')).toBeNull();
    expect(issueOf(null, '/home/u/projects/wt-1234')).toBeNull();
  });
});

describe('parseWorktrees', () => {
  const porcelain = [
    'worktree /home/u/projects/web\nHEAD aaaaaaa\nbranch refs/heads/main',
    'worktree /home/u/projects/wt-10101\nHEAD bbbbbbb\nbranch refs/heads/release/bugfix/10101',
    'worktree /home/u/projects/wt-gone\nHEAD ccccccc\ndetached\nprunable gitdir file points to non-existent location',
    '',
  ].join('\n\n');

  it('reads path, head, branch and prunable', () => {
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/home/u/projects/web', head: 'aaaaaaa', branch: 'main', prunable: false },
      { path: '/home/u/projects/wt-10101', head: 'bbbbbbb', branch: 'release/bugfix/10101', prunable: false },
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
      card('web#5'),
      card('web#3', { pending: ['revisar'] }),
      card('web#4', { blockers: ['x'] }),
      card('web#1'),
      card('web#2', { pending: ['y'], blockers: ['z'] }),
      card('web#0', { pending: ['w'] }),
    ];
    cards.sort(compareCards);
    expect(cards.map((c) => c.ref)).toEqual(['web#2', 'web#4', 'web#0', 'web#3', 'web#1', 'web#5']);
  });

  it('is stable for equal cards and does not mutate them', () => {
    const a = card('a#1', { blockers: ['x'] });
    expect(compareCards(a, { ...a })).toBe(0);
  });
});
