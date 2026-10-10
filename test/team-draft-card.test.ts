// A draft agent in the team list: it carries the mark and can only be discarded, with a question first. Static markup of the section, as the other screen tests here
// do (there is no DOM library in this repository); the discarding itself is the channel's, covered by agent-assist-draft.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The assistant's conversation reads the activity of the app from the window while it loads; the list does not show it.
vi.mock('../src/renderer/src/screens/cycle/Thread', () => ({ Thread: () => null }));
const { DiscardDraft, TeamSection } = await import('../src/renderer/src/screens/team/TeamSection');

function asWeb(web: boolean): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset: web ? { platform: 'web' } : {} } };
}

beforeEach(() => {
  setLanguage('en');
  asWeb(false);
});
afterEach(() => setLanguage('pt-BR'));

const withTrial = (): WorkspaceConfig => {
  const c = applyTemplate(neutralConfig(), agentFlow);
  c.agents.team.push(newAgent({ id: 'trial', name: 'Trial agent', job: 'Tries things out', draft: true, tracker: 'read' }));
  return c;
};

const list = (config: WorkspaceConfig, web = false): string => {
  asWeb(web);
  return renderToStaticMarkup(createElement(TeamSection, { config, save: async (c: WorkspaceConfig) => c, reload: () => undefined } as never));
};

/** The card of one agent: from its opening tag to the next card. */
const cardOf = (html: string, id: string): string => {
  const cards = html.split('<li class="tm-card').slice(1);
  const card = cards.find((c) => c.includes(`@${id}</span>`));
  if (!card) throw new Error(`no card for ${id}`);
  return card;
};

describe('the card of a draft agent', () => {
  it('carries the mark, has no Edit and no switch to let it run, and can be discarded', () => {
    const card = cardOf(list(withTrial()), 'trial');
    expect(card).toContain('Trial agent');
    expect(card).toContain('>Draft</span>');
    expect(card).toContain('Discard</button>');
    expect(card).toContain('aria-label="Discard the draft Trial agent"');
    expect(card).not.toContain('>Edit</button>');
    expect(card).not.toContain('role="switch"');
    expect(card).not.toContain('Runs by itself');
    expect(card).toContain('works no stage');
  });

  it('says it works no stage even when a file lists some on it', () => {
    const c = withTrial();
    c.agents.team.find((a) => a.id === 'trial')!.stages = ['implement'];
    expect(cardOf(list(c), 'trial')).toContain('<dt>Stages</dt><dd>none</dd>');
    expect(cardOf(list(c), 'developer')).toContain('<dt>Stages</dt><dd>');
    expect(cardOf(list(c), 'developer')).not.toContain('<dt>Stages</dt><dd>none</dd>');
  });

  it('leaves the card of every other agent as it was, mark and switch included', () => {
    const html = list(withTrial());
    const dev = cardOf(html, 'developer');
    expect(dev).toContain('>Edit</button>');
    expect(dev).toContain('role="switch"');
    expect(dev).not.toContain('>Draft</span>');
    expect(dev).not.toContain('Discard');
    // one switch per agent that is not a draft
    expect(html.match(/role="switch"/g)).toHaveLength(withTrial().agents.team.length - 1);
  });

  it('shows the mark in a paired browser too, but not the way to discard, which is the computer\'s', () => {
    const card = cardOf(list(withTrial(), true), 'trial');
    expect(card).toContain('>Draft</span>');
    expect(card).not.toContain('Discard</button>');
    expect(card).not.toContain('>Edit</button>');
  });

  it('shows a team with no draft exactly as before', () => {
    const html = list(applyTemplate(neutralConfig(), agentFlow));
    expect(html).not.toContain('>Draft</span>');
    expect(html).not.toContain('Discard');
  });

  it('is said in Portuguese too', () => {
    setLanguage('pt-BR');
    const card = cardOf(list(withTrial()), 'trial');
    expect(card).toContain('>Rascunho</span>');
    expect(card).toContain('Descartar</button>');
  });
});

describe('discarding a draft agent', () => {
  it('asks first, says it deletes the agent and its conversation, and offers to keep it', () => {
    const html = renderToStaticMarkup(createElement(DiscardDraft, { name: 'Trial agent', onConfirm: () => undefined, onCancel: () => undefined }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Discard Trial agent?');
    expect(html).toContain('deletes the test agent and its conversation');
    expect(html).toContain('cannot be undone');
    expect(html).toContain('Discard the draft</button>');
    expect(html).toContain('Cancel</button>');
    // the question is the red one: a deletion
    expect(html).toContain('ws-danger');
  });
});
