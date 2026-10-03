import { describe, expect, it } from 'vitest';
import { cleanLabels, effectiveCardScope, parseLabelsField, scopesOffered } from '../src/shared/cardScope';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { migrateConfig } from '../src/shared/config/migrations';
import type { VcsKind } from '../src/shared/config/types';
import { VCS_CAPS } from '../src/shared/vcsCaps';

const input = (over: Partial<Parameters<typeof effectiveCardScope>[0]> = {}) => ({ scope: 'assigned' as const, labels: [], project: 'acme/app', kind: 'github' as VcsKind | null, ...over });

describe('what a stored card scope really does', () => {
  it('assigned is always itself, whatever else is set', () => {
    expect(effectiveCardScope(input())).toEqual({ scope: 'assigned', labels: [], fallback: null });
    expect(effectiveCardScope(input({ project: null, labels: ['bug'], kind: 'bitbucket' }))).toEqual({ scope: 'assigned', labels: [], fallback: null });
  });

  it('all and labels need the issue project: without one they are assigned, and the note says why', () => {
    for (const project of [null, '', '   ']) {
      expect(effectiveCardScope(input({ scope: 'all', project }))).toEqual({ scope: 'assigned', labels: [], fallback: 'noProject' });
      expect(effectiveCardScope(input({ scope: 'labels', labels: ['bug'], project }))).toMatchObject({ scope: 'assigned', fallback: 'noProject' });
    }
  });

  it('all keeps the project scope and drops any labels', () => {
    expect(effectiveCardScope(input({ scope: 'all', labels: ['bug'] }))).toEqual({ scope: 'all', labels: [], fallback: null });
  });

  it('labels with no usable label is assigned, never all', () => {
    for (const labels of [[], [' '], ['', '  ']]) expect(effectiveCardScope(input({ scope: 'labels', labels }))).toEqual({ scope: 'assigned', labels: [], fallback: 'noLabels' });
  });

  it('labels on a host without issue labels is assigned, and that wins over the missing labels', () => {
    expect(VCS_CAPS.bitbucket.issueLabels).toBe(false);
    expect(effectiveCardScope(input({ scope: 'labels', labels: ['bug'], kind: 'bitbucket' }))).toEqual({ scope: 'assigned', labels: [], fallback: 'noLabelSupport' });
    expect(effectiveCardScope(input({ scope: 'labels', labels: [], kind: 'bitbucket' })).fallback).toBe('noLabelSupport');
    expect(effectiveCardScope(input({ scope: 'all', kind: 'bitbucket' })).scope).toBe('all');
  });

  it('the project is checked before the host, so the note names the first thing to fix', () => {
    expect(effectiveCardScope(input({ scope: 'labels', labels: ['bug'], kind: 'bitbucket', project: null })).fallback).toBe('noProject');
  });

  it('labels are trimmed and a name that differs only in case is dropped', () => {
    expect(effectiveCardScope(input({ scope: 'labels', labels: [' Bug ', 'bug', 'ready to test', 'BUG'] }))).toEqual({ scope: 'labels', labels: ['Bug', 'ready to test'], fallback: null });
    expect(cleanLabels(['a', 'A', ' b'])).toEqual(['a', 'b']);
  });

  it('every host but Bitbucket filters by label', () => {
    expect((['gitlab', 'github', 'bitbucket'] as const).map((k) => VCS_CAPS[k].issueLabels)).toEqual([true, true, false]);
  });
});

describe('the labels field', () => {
  it('splits on commas, trims, drops empties and repeats, and strips what the configuration refuses', () => {
    expect(parseLabelsField('bug, ready to test ,, "sprint 12",Bug')).toEqual(['bug', 'ready to test', 'sprint 12']);
    expect(parseLabelsField('a\\b')).toEqual(['ab']);
    expect(parseLabelsField('')).toEqual([]);
  });

  it('whatever it produces passes the schema', () => {
    const c = neutralConfig();
    c.projects.issues.cardScope = 'labels';
    c.projects.issues.cardLabels = parseLabelsField('bug, "ready" ,sprint:12, in progress, STAGE:: Doing');
    expect(validateConfig(c).errors).toEqual([]);
  });

  it('keeps at most 10 labels of 100 characters', () => {
    expect(parseLabelsField(Array.from({ length: 12 }, (_, i) => `l${i}`).join(','))).toHaveLength(10);
    expect(parseLabelsField('x'.repeat(150))[0]).toHaveLength(100);
  });

  it('a stored label that starts or ends with a comma, a quote or a backslash is refused', () => {
    for (const bad of [',bug', 'bug,', '"x', 'x"', '"', ',', '\\', 'a\\', 'a,b']) {
      const c = neutralConfig();
      c.projects.issues.cardScope = 'labels';
      c.projects.issues.cardLabels = [bad];
      expect(validateConfig(c).errors.length, bad).toBeGreaterThan(0);
    }
  });
});

describe('the stored fields', () => {
  it('default to the behavior every workspace had', () => {
    expect(neutralConfig().projects.issues).toMatchObject({ cardScope: 'assigned', cardLabels: [] });
  });

  it('a schema 3 file gets the default written out, keeps the rest of its issue project, and a current file is left alone', () => {
    const stored = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    delete stored.projects.issues.cardScope;
    delete stored.projects.issues.cardLabels;
    stored.projects.issues = { ...stored.projects.issues, vcsId: null, project: 'acme/app', refPrefix: 'app#' };
    const v3 = { ...stored, schemaVersion: 3 };
    const r = migrateConfig(v3, { legacyInstall: false });
    expect(r.fromVersion).toBe(3);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(10);
    expect(r.config.projects.issues).toMatchObject({ project: 'acme/app', refPrefix: 'app#', cardScope: 'assigned', cardLabels: [] });
    expect(validateConfig(r.config).ok).toBe(true);
    const v4 = migrateConfig(stored, { legacyInstall: false });
    expect(v4.changed).toBe(false);
    expect(v4.config.projects.issues).toMatchObject({ project: 'acme/app', cardScope: 'assigned', cardLabels: [] });
  });

  it('the v3 to v4 step is idempotent, keeps a scope already there, and tolerates a file with no projects', () => {
    const v3 = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    v3.schemaVersion = 3;
    v3.projects.issues = { ...v3.projects.issues, cardScope: 'labels', cardLabels: ['ready'] };
    expect(migrateConfig(v3, { legacyInstall: false }).config.projects.issues).toMatchObject({ cardScope: 'labels', cardLabels: ['ready'] });
    const bare = migrateConfig({ schemaVersion: 3, language: 'en' }, { legacyInstall: false });
    expect(bare.config.language).toBe('en');
    expect(bare.config.projects.issues).toMatchObject({ cardScope: 'assigned', cardLabels: [] });
  });

  it('a file from before the card fields (schema 2) ends at the current schema with the scope and the priority section', () => {
    const v2 = { ...neutralConfig(), schemaVersion: 2 } as Record<string, any>;
    delete v2.devCycle.priority;
    delete v2.projects.issues.cardScope;
    delete v2.projects.issues.cardLabels;
    const r = migrateConfig(v2, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(10);
    expect(r.config.projects.issues).toMatchObject({ cardScope: 'assigned', cardLabels: [] });
    expect(r.config.devCycle.priority).toEqual({ labels: [] });
  });

  it('an invalid scope or label is reset by itself, keeping the rest of the block', () => {
    const stored = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    stored.projects.issues = { vcsId: null, project: 'acme/app', projectId: null, refPrefix: 'app#', cardScope: 'everything', cardLabels: ['ok'] };
    const r = migrateConfig(stored, { legacyInstall: false });
    expect(r.config.projects.issues).toMatchObject({ project: 'acme/app', refPrefix: 'app#', cardScope: 'assigned', cardLabels: ['ok'] });
    expect(r.notes.some((n) => n.startsWith('reset projects.issues.cardScope'))).toBe(true);
    const bad = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
    bad.projects.issues.cardLabels = ['fine', 'a,b'];
    const fixed = migrateConfig(bad, { legacyInstall: false });
    expect(fixed.config.projects.issues.cardLabels).toEqual([]);
    expect(fixed.changed).toBe(true);
  });

  it.each([['a,b'], ['say "hi"'], ['back\\slash'], [' lead'], ['trail '], [''], ['new\nline'], ['x'.repeat(101)]])('refuses the label %j', (label) => {
    const c = neutralConfig();
    c.projects.issues.cardLabels = [label];
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(['projects.issues.cardLabels[0]']);
  });

  it('accepts what trackers really use: spaces inside, scoped names, colons, accents', () => {
    const c = neutralConfig();
    c.projects.issues.cardLabels = ['ready to test', 'STAGE:: Doing', 'priority/high', 'em análise', 'x'.repeat(100)];
    expect(validateConfig(c).errors).toEqual([]);
  });

  it('allows at most ten labels', () => {
    const c = neutralConfig();
    c.projects.issues.cardLabels = Array.from({ length: 11 }, (_, i) => `l${i}`);
    expect(validateConfig(c).errors[0].path).toBe('projects.issues.cardLabels');
    c.projects.issues.cardLabels = c.projects.issues.cardLabels.slice(0, 10);
    expect(validateConfig(c).errors).toEqual([]);
  });

  it('warns, without failing, when the choice cannot be applied', () => {
    const gh = { id: 'gh', kind: 'github' as const, host: 'github.com', apiUrl: '', user: '', secretRef: null, cliPreference: 'auto' as const, cliCommand: null };
    const bb = { ...gh, id: 'bb', kind: 'bitbucket' as const, host: 'bitbucket.org' };
    const warn = (patch: (c: ReturnType<typeof neutralConfig>) => void) => {
      const c = neutralConfig();
      patch(c);
      const r = validateConfig(c);
      expect(r.ok).toBe(true);
      return r.warnings.filter((w) => w.path === 'projects.issues.cardScope').map((w) => w.message);
    };
    expect(warn(() => undefined)).toEqual([]);
    expect(warn((c) => { c.projects.issues.cardScope = 'all'; })).toEqual([expect.stringContaining('issue project')]);
    expect(warn((c) => { c.vcs = [gh]; c.projects.issues = { ...c.projects.issues, vcsId: 'gh', project: 'acme/app', cardScope: 'all' }; })).toEqual([]);
    expect(warn((c) => { c.vcs = [gh]; c.projects.issues = { ...c.projects.issues, vcsId: 'gh', project: 'acme/app', cardScope: 'labels' }; })).toEqual([expect.stringContaining('no labels')]);
    expect(warn((c) => { c.vcs = [bb]; c.projects.issues = { ...c.projects.issues, vcsId: 'bb', project: 'acme/app', cardScope: 'labels', cardLabels: ['bug'] }; })).toEqual([expect.stringContaining('no labels')]);
    const c = neutralConfig();
    c.projects.issues.cardLabels = ['bug', 'Bug'];
    expect(validateConfig(c).warnings.some((w) => w.path === 'projects.issues.cardLabels')).toBe(true);
  });
});

describe('the scopes a tracker offers', () => {
  it('offers labels only where issues have them, unless one is already stored', () => {
    expect(scopesOffered('github', 'assigned')).toEqual(['assigned', 'all', 'labels']);
    expect(scopesOffered('gitlab', 'all')).toEqual(['assigned', 'all', 'labels']);
    expect(scopesOffered(null, 'assigned')).toEqual(['assigned', 'all', 'labels']);
    expect(scopesOffered('bitbucket', 'assigned')).toEqual(['assigned', 'all']);
    expect(scopesOffered('bitbucket', 'labels')).toEqual(['assigned', 'all', 'labels']);
  });
});
