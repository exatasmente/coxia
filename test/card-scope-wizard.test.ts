import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { VcsKind, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { IntegrationsStep } = await import('../src/renderer/src/wizard/steps/IntegrationsStep');

afterEach(() => setLanguage('pt-BR'));

// The wizard's integrations step, rendered once for a config: what the person sees under "Where the issues live".
function step(kind: VcsKind, issues: Partial<WorkspaceConfig['projects']['issues']>, cardSourceOn = false): string {
  const cfg = neutralConfig();
  cfg.vcs = [{ id: 'host', kind, host: 'example.test', apiUrl: '', user: '', secretRef: null, cliPreference: 'auto', cliCommand: null }];
  cfg.projects.issues = { ...cfg.projects.issues, vcsId: 'host', project: 'group/app', ...issues };
  cfg.externalTools.cardSource.enabled = cardSourceOn;
  const props = { cfg, setCfg: () => undefined, view: { secrets: [], storage: {} }, refreshView: async () => ({}), reload: async () => undefined, avail: null, goTo: () => undefined };
  return renderToStaticMarkup(createElement(IntegrationsStep, props as never));
}
const options = (html: string): string[] => [...(/<select id="wz-issues-scope"[^>]*>(.*?)<\/select>/s.exec(html)?.[1] ?? '').matchAll(/<option value="(\w+)"/g)].map((m) => m[1]);

describe('the card scope in the integrations step', () => {
  it('offers the three choices on a host whose issues have labels, with the saved one selected and no note', () => {
    setLanguage('en');
    const html = step('github', {});
    expect(options(html)).toEqual(['assigned', 'all', 'labels']);
    expect(html).toContain('Which issues become cards');
    expect(html).toMatch(/<option value="assigned" selected/);
    expect(html).not.toContain('wz-issues-labels');
    expect(html.slice(html.indexOf('aria-labelledby="wz-issues"'))).not.toContain('wz-note');
  });

  it('does not offer labels on Bitbucket, and shows the field only for the labels scope', () => {
    expect(options(step('bitbucket', {}))).toEqual(['assigned', 'all']);
    const html = step('gitlab', { cardScope: 'labels', cardLabels: ['bug', 'ready to test'] });
    expect(html).toContain('id="wz-issues-labels"');
    expect(html).toContain('value="bug, ready to test"');
  });

  it('says what a choice that cannot apply will do instead', () => {
    setLanguage('en');
    expect(step('github', { cardScope: 'all', project: null })).toContain('only the issues assigned to you become cards');
    expect(step('github', { cardScope: 'all', project: null })).toContain('Without the issue project');
    expect(step('github', { cardScope: 'labels', cardLabels: [] })).toContain('No label is listed');
    expect(step('bitbucket', { cardScope: 'labels', cardLabels: ['bug'] })).toContain('has no labels');
    expect(options(step('bitbucket', { cardScope: 'labels', cardLabels: ['bug'] }))).toContain('labels');
  });

  it('says that a card source command decides the cards', () => {
    setLanguage('en');
    expect(step('github', {}, true)).toContain('A card source command is on');
    expect(step('github', {}, false)).not.toContain('A card source command is on');
  });

  it('is in Portuguese too', () => {
    const html = step('github', { cardScope: 'all', project: null });
    expect(html).toContain('Quais issues viram cartões');
    expect(html).toContain('só as issues atribuídas a você viram cartões');
  });
});
