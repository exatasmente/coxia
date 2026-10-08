// The card of an agent in Settings › Team lists the stages it works. A shipped template names its stages with catalog keys, so the card must word
// them in the app's language; a static render of the section shows what a person reads.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads, and the section asks document whether it runs in a paired browser; the node environment has neither.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { TeamSection } = await import('../src/renderer/src/screens/team/TeamSection');

afterEach(() => setLanguage('pt-BR'));

const render = (config: WorkspaceConfig): string => renderToStaticMarkup(createElement(TeamSection, { config, save: async (c: WorkspaceConfig) => c, reload: () => undefined }));

/** The stages line of one agent's card, as the card shows it. */
function stagesOf(html: string, id: string): string {
  const card = html.slice(html.indexOf(`@${id}<`));
  const head = `<dt>${t('ui.team.stages')}</dt><dd>`;
  const at = card.indexOf(head) + head.length;
  return card.slice(at, card.indexOf('</dd>', at));
}

describe('the stages on an agent card', () => {
  it.each(['en', 'pt-BR'] as const)('words the template stages in %s, never as their catalog keys', (language) => {
    setLanguage(language);
    const stage = (id: string): string => CATALOGS[language][`cycle.agentFlow.stage.${id}`];
    const html = render(applyTemplate(neutralConfig(), agentFlow));
    expect(stagesOf(html, 'customer-success')).toBe(stage('communicate'));
    expect(stagesOf(html, 'tech-lead')).toBe(`${stage('plan')}, ${stage('review')}`);
    expect(html).not.toContain('cycle.agentFlow.stage.');
  });

  it('keeps a typed name as it is, and falls back to the id when the stage has none', () => {
    setLanguage('en');
    const config = applyTemplate(neutralConfig(), agentFlow);
    config.devCycle.stages = config.devCycle.stages.map((s) => (s.id === 'communicate' ? { ...s, label: 'Tell the users' } : s.id === 'qa' ? { ...s, label: '' } : s));
    const html = render(config);
    expect(stagesOf(html, 'customer-success')).toBe('Tell the users');
    expect(stagesOf(html, 'qa')).toBe('qa');
  });
});
