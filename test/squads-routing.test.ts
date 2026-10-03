// Which squad an issue belongs to, by scope: the repository first, then the labels, then the folders of the files the issue mentions. One squad left is the
// answer; several, or none, is a triage. Pure.
import { describe, expect, it } from 'vitest';
import { newSquad } from '../src/shared/config/squads';
import type { SquadDef } from '../src/shared/config/types';
import { mentionedPaths, routeIssue } from '../src/shared/runs';

const squad = (id: string, scope: Partial<SquadDef['scope']>): SquadDef => newSquad({ id, scope });
const issue = (over: Partial<Parameters<typeof routeIssue>[1]> = {}) => ({ repo: 'app', labels: [], text: '', ...over });

describe('the files an issue mentions', () => {
  it('finds paths with a folder in them, in prose, in quotes and in a diff, and leaves addresses and sentences alone', () => {
    const text = 'It breaks in `services/billing/invoice.ts` and (src/app/main.ts), see https://example.com/a/b and b/web/page.tsx. Not "a/b" alone? Yes: docs/readme.md.';
    expect(mentionedPaths(text)).toEqual(expect.arrayContaining(['services/billing/invoice.ts', 'src/app/main.ts', 'b/web/page.tsx', 'docs/readme.md']));
    expect(mentionedPaths(text).some((p) => p.startsWith('http') || p.startsWith('example.com'))).toBe(false);
    expect(mentionedPaths('nothing to see, only words')).toEqual([]);
  });
});

describe('routing an issue to a squad', () => {
  it('one squad owns the repository: it is the answer, by the repository', () => {
    const squads = [squad('a', { repos: ['app'] }), squad('b', { repos: ['web'] })];
    expect(routeIssue(squads, issue())).toEqual({ kind: 'matched', squad: 'a', rule: 'repo' });
    expect(routeIssue(squads, issue({ repo: 'web' }))).toEqual({ kind: 'matched', squad: 'b', rule: 'repo' });
  });

  it('several own the repository: the labels narrow them, then the paths', () => {
    const squads = [squad('a', { repos: ['app'], labels: ['Billing'] }), squad('b', { repos: ['app'], labels: ['search'] }), squad('c', { repos: ['app'] })];
    expect(routeIssue(squads, issue({ labels: ['billing'] }))).toEqual({ kind: 'matched', squad: 'a', rule: 'label' });
    expect(routeIssue(squads, issue({ labels: ['search', 'bug'] }))).toEqual({ kind: 'matched', squad: 'b', rule: 'label' });
    const mono = [squad('a', { repos: ['app'], paths: [{ repo: 'app', prefix: 'services/billing' }] }), squad('b', { repos: ['app'], paths: [{ repo: 'app', prefix: 'services/search/' }] })];
    expect(routeIssue(mono, issue({ text: 'The bug is in services/search/index.ts.' }))).toEqual({ kind: 'matched', squad: 'b', rule: 'path' });
    expect(routeIssue(mono, issue({ text: 'See a/services/billing/x.ts in the diff' }))).toEqual({ kind: 'matched', squad: 'a', rule: 'path' });
  });

  it('a rule that says nothing about the issue does not narrow: the label decides when no repository is owned', () => {
    const squads = [squad('a', { repos: ['app'] }), squad('b', { labels: ['mobile'] })];
    expect(routeIssue(squads, issue({ repo: 'other', labels: ['mobile'] }))).toEqual({ kind: 'matched', squad: 'b', rule: 'label' });
    // the path of a folder of another repository does not count
    const paths = [squad('a', { paths: [{ repo: 'mono', prefix: 'x' }] })];
    expect(routeIssue(paths, issue({ text: 'x/file.ts' })).kind).toBe('ambiguous');
    expect(routeIssue(paths, issue({ repo: 'mono', text: 'x/file.ts' }))).toEqual({ kind: 'matched', squad: 'a', rule: 'path' });
  });

  it('with the repository not known yet (the scheduler has not chosen one), only the labels and the paths speak', () => {
    const squads = [squad('a', { repos: ['app'], labels: ['x'] }), squad('b', { repos: ['web'], labels: ['y'] })];
    expect(routeIssue(squads, issue({ repo: null, labels: ['y'] }))).toEqual({ kind: 'matched', squad: 'b', rule: 'label' });
    expect(routeIssue(squads, issue({ repo: null })).kind).toBe('ambiguous');
  });

  it('an issue two squads claim, or nobody does, is a triage', () => {
    const both = [squad('a', { repos: ['app'] }), squad('b', { repos: ['app'] })];
    expect(routeIssue(both, issue())).toEqual({ kind: 'ambiguous', why: 'several', candidates: ['a', 'b'] });
    const none = [squad('a', { repos: ['web'] }), squad('b', { repos: ['api'] })];
    expect(routeIssue(none, issue())).toEqual({ kind: 'ambiguous', why: 'none', candidates: ['a', 'b'] });
  });

  it('what nobody claims goes to the squad that takes it, and to a triage when several do', () => {
    const squads = [squad('a', { repos: ['web'] }), squad('rest', { unclaimed: true })];
    expect(routeIssue(squads, issue())).toEqual({ kind: 'matched', squad: 'rest', rule: 'unclaimed' });
    // a claim wins over the squad that takes the leftovers
    expect(routeIssue(squads, issue({ repo: 'web' }))).toEqual({ kind: 'matched', squad: 'a', rule: 'repo' });
    const two = [squad('r1', { unclaimed: true }), squad('r2', { unclaimed: true }), squad('a', { repos: ['web'] })];
    expect(routeIssue(two, issue())).toEqual({ kind: 'ambiguous', why: 'several', candidates: ['r1', 'r2'] });
  });
});
