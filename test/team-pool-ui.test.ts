// The pool of an agent in the editor, as static markup: the editor on the computer, the sentence for a role's model, and a paired browser that sees the reserves and
// cannot change them. What moves (a click) is the pure edits of agentEdit.ts and poolEdit.ts, tested on their own.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The conversation reads the activity of the app from the window while it loads; the editor does not open it here.
vi.mock('../src/renderer/src/screens/cycle/Thread', () => ({ Thread: () => null }));
const { AgentPanel } = await import('../src/renderer/src/screens/team/TeamSection');
const { draftOf } = await import('../src/renderer/src/screens/team/agentEdit');

function asWeb(web: boolean): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset: web ? { platform: 'web' } : {} } };
}
beforeEach(() => {
  setLanguage('en');
  asWeb(false);
});
afterEach(() => setLanguage('pt-BR'));

const ref = (model: string) => ({ provider: 'local', model });
function world(): WorkspaceConfig {
  const c = applyTemplate(neutralConfig(), agentFlow);
  c.llm.providers.push({ ...c.llm.providers[0], id: 'local', kind: 'openai-compatible', engine: 'open', baseUrl: 'http://localhost:11434/v1', models: ['model-a'] });
  c.llm.roles.fix = { provider: 'local', model: 'model-a', fallbacks: [ref('model-b')], activities: { shell: [ref('model-c')] } };
  const dev = c.agents.team.find((a) => a.id === 'developer')!;
  dev.model = { role: null, provider: 'local', model: 'own', fallbacks: [ref('model-b'), ref('model-c')] };
  const qa = c.agents.team.find((a) => a.id === 'qa')!;
  qa.model = { role: 'fix', provider: '', model: '' };
  return c;
}
const panel = (config: WorkspaceConfig, id: string): string =>
  renderToStaticMarkup(createElement(AgentPanel, { config, initial: draftOf(config.agents.team.find((a) => a.id === id)!), isNew: false, save: async (c: WorkspaceConfig) => c, onClose: () => undefined } as never));

describe('the pool of an agent in the editor', () => {
  it('shows the editor of the reserves under the model of its own, with the agent\'s model first and the reserves in order', () => {
    const html = panel(world(), 'developer');
    expect(html).toContain('Reserve models');
    expect(html.indexOf('local · own')).toBeLessThan(html.indexOf('local · model-b'));
    expect(html.indexOf('local · model-b')).toBeLessThan(html.indexOf('local · model-c'));
    expect(html).toContain('Lists by kind of work (0)');
    expect(html).toContain('Model to add to');
    expect(html).not.toContain('Test this model');
  });

  it('shows the marks of the agent\'s own model and of its reserves where the provider has the features, and the obsolete warning', () => {
    const c = world();
    c.llm.providers.find((p) => p.id === 'local')!.features = { serviceTier: true, reasoningEffort: true };
    const dev = c.agents.team.find((a) => a.id === 'developer')!;
    dev.model = { role: null, provider: 'local', model: 'own', offer: { effort: true }, fallbacks: [{ ...ref('model-b'), offer: { flex: true, deprecated: 1790000000, replacedBy: 'model-c' } }] };
    const html = panel(c, 'developer');
    expect(html).toContain('local · own: takes the reasoning effort');
    expect(html).toContain('local · model-b: served in the flex tier');
    expect(html).toMatch(/obsolete since [^;]+; substitute: model-c/);
    // without the features on the provider there is nothing to mark
    c.llm.providers.find((p) => p.id === 'local')!.features = undefined;
    expect(panel(c, 'developer')).not.toContain('served in the flex tier');
  });

  it('says that an agent on a role\'s model uses the role\'s pool, with how many reserves it has, and offers no editor', () => {
    const html = panel(world(), 'qa');
    expect(html).toContain('Uses the pool of the role');
    expect(html).toContain('(reserve models: 2)');
    expect(html).not.toContain('Lists by kind of work');
    expect(html).not.toContain('Model to add to');
  });

  it('shows a paired browser the reserves and no way to change them', () => {
    asWeb(true);
    const html = panel(world(), 'developer');
    expect(html).toContain('Reserve models are changed on the computer');
    expect(html).toContain('local · model-b');
    expect(html).not.toContain('Model to add to');
    expect(html).not.toContain('Lists by kind of work');
    expect(html).not.toContain('Move local');
  });

  it('is in Portuguese too', () => {
    setLanguage('pt-BR');
    expect(panel(world(), 'qa')).toContain('Usa o conjunto do papel');
    expect(panel(world(), 'developer')).toContain('Modelos de reserva');
  });
});
