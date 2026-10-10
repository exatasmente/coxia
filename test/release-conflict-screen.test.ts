// The card of a failed release step in Actions, as a static render shows it: the offer to free the branch from the worktree that holds it (with the text
// naming the branch and the path), only when the step stopped on that conflict, and nothing of it on any other card.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { ReleaseAction } from '../src/shared/types';

// src/renderer/src/api.ts reads window.api when it loads, and the node environment has none of it.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: async () => null, onEvent: () => () => undefined, copy: () => undefined }, addEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/useJobs', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/useJobs')>()), useJobs: () => [], busyText: () => null, jobs: { launch: () => undefined } }));
// The pieces of the card that draw other screens are not in this render, and their modules pull more than a node render can hold.
vi.mock('../src/renderer/src/screens/cycle/RunProposal', () => ({ isRunProposal: () => false, RunProposal: () => null }));
vi.mock('../src/renderer/src/screens/SuggestionCard', () => ({ isSuggestion: () => false, SuggestionCard: () => null }));
vi.mock('../src/renderer/src/screens/PluginActionCard', () => ({ isPluginAction: () => false, PluginActionCard: () => null }));

const { ActionCard } = await import('../src/renderer/src/screens/Actions');

afterEach(() => {
  setLanguage('pt-BR');
});

const action = (over: Partial<ReleaseAction> = {}): ReleaseAction =>
  ({
    id: 'a1',
    key: 'k',
    kind: 'release-git',
    issue: 0,
    issueTitle: 'Release 0.5.0',
    stage: 'implementation',
    release: '0.5.0',
    mrs: [],
    files: [],
    retest: false,
    state: 'failed',
    createdAt: '2026-10-09T00:00:00.000Z',
    finishedAt: '2026-10-09T00:00:00.000Z',
    output: 'the refusal of the script',
    noteId: null,
    currentBody: null,
    proposedBody: null,
    sessionId: null,
    msgs: [],
    unit: null,
    summary: 'Release step cut',
    command: null,
    ...over,
  }) as ReleaseAction;

const card = (a: ReleaseAction): string => renderToStaticMarkup(createElement(ActionCard, { a, go: () => undefined }));

describe('the offer to free the branch on a failed step', () => {
  it('is on the card of a step that stopped on the worktree conflict, naming the branch and the path, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = card(action({ conflict: { branch: 'release/0.5.0', path: '/tmp/other-worktree' } }));
      expect(html).toContain(CATALOGS[language]['ui.actions.freeBranch'].replace('{path}', '/tmp/other-worktree'));
      expect(html).toContain(CATALOGS[language]['ui.actions.freeBranch.what'].replace('{path}', '/tmp/other-worktree').replace('{branch}', 'release/0.5.0'));
      // the confirmation the freeing asks for is not given before the button is pressed
      expect(html).not.toContain(CATALOGS[language]['ui.actions.confirm.freeBranch']);
    }
  });

  it('is not on the card of a step that failed for anything else, nor of a done one', () => {
    expect(card(action())).not.toContain(t('ui.actions.freeBranch'));
    expect(card(action({ state: 'done', conflict: { branch: 'release/0.5.0', path: '/tmp/other-worktree' } }))).not.toContain(t('ui.actions.freeBranch'));
  });
});
