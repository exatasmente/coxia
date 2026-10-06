// The suggestion card in a paired browser: the "edit" and "reject" paths act on the desktop machine (the editor that saves the agent, and the
// record's channel), so a browser is offered only "accept". The card needs no browser to be read; a static render of the same props shows which
// buttons a session gets, and the desktop case is rendered too so the restriction cannot hide the two paths there.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseAction } from '../src/shared/types';
import { setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { SuggestionCard } = await import('../src/renderer/src/screens/SuggestionCard');

/** Sets the marker the app writes on the document root when the build is the browser one. */
function asWeb(web: boolean): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset: web ? { platform: 'web' } : {} } };
}

const action = (): ReleaseAction =>
  ({
    id: 'a-1',
    kind: 'suggest-agent',
    state: 'pending',
    issue: 0,
    issueTitle: '',
    stage: 'review',
    unit: { suggestionId: 's-1', name: 'Reviewer', role: 'Reviews returns', stage: 'review', prompt: 'You look at returns.' },
  }) as never;

const render = (): string => renderToStaticMarkup(createElement(SuggestionCard, { a: action(), go: () => undefined } as never));

beforeEach(() => setLanguage('en'));
afterEach(() => setLanguage('pt-BR'));

describe('the suggestion card in a paired browser', () => {
  it('offers only accept, and neither the edit path nor the reject channel', () => {
    asWeb(true);
    const html = render();
    expect(html).toContain(t('ui.actions.suggest.accept'));
    expect(html).not.toContain(t('ui.actions.suggest.edit'));
    expect(html).not.toContain(t('ui.actions.suggest.reject'));
    expect(html).not.toContain(t('ui.actions.suggest.reasonPlaceholder'));
  });

  it('offers all three paths in the window, so the restriction is the browser only', () => {
    asWeb(false);
    const html = render();
    expect(html).toContain(t('ui.actions.suggest.accept'));
    expect(html).toContain(t('ui.actions.suggest.edit'));
    expect(html).toContain(t('ui.actions.suggest.reject'));
  });
});
