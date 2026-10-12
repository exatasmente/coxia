// The Remote Control switch in the agent editor (#282): off by default, the warning on screen as soon as a level is chosen and before Save, in both languages; never on a
// paired browser; held off with the reason in a test workspace. Static markup; the config the draft makes comes from agentEdit.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { setLanguage, t } from '../src/shared/i18n';

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/screens/cycle/Thread', () => ({ Thread: () => null }));
const { AgentPanel } = await import('../src/renderer/src/screens/team/TeamSection');
const { applyAgent, blankAgent, draftOf } = await import('../src/renderer/src/screens/team/agentEdit');

function page(dataset: Record<string, string>): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset } };
}
beforeEach(() => {
  setLanguage('en');
  page({});
});
afterEach(() => setLanguage('pt-BR'));

const world = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlow);
const first = (c: WorkspaceConfig) => c.agents.team[0];
const panel = (config: WorkspaceConfig, draft = draftOf(first(config))): string =>
  renderToStaticMarkup(createElement(AgentPanel, { config, initial: draft, isNew: false, save: async (c: WorkspaceConfig) => c, onClose: () => undefined } as never));

describe('the Remote Control switch', () => {
  it('is off for every agent of a new workspace, with no warning', () => {
    const c = world();
    expect(c.agents.team.every((a) => a.remoteControl === undefined)).toBe(true);
    expect(blankAgent().remoteControl).toBe('off');
    const out = panel(c);
    expect(out).toContain(t('ui.team.remoteControl'));
    expect(out).toContain(t('ui.team.remoteControl.applies.off'));
    expect(out).not.toContain('tm-assist-warn" role="note">This goes around');
  });

  it('shows the warning about the paired-phone rules as soon as view only is chosen, before Save', () => {
    const c = world();
    const out = panel(c, { ...draftOf(first(c)), remoteControl: 'mirror' });
    expect(out).toContain(t('ui.team.remoteControl.warning'));
    expect(out).toContain('paired-phone rules');
    expect(out).toContain(t('ui.team.remoteControl.applies.agent'));
  });

  it('says the warning in Portuguese too', () => {
    setLanguage('pt-BR');
    const c = world();
    expect(panel(c, { ...draftOf(first(c)), remoteControl: 'mirror' })).toContain('contorna as regras do celular pareado');
  });

  it('never appears on a paired browser', () => {
    page({ platform: 'web' });
    const c = world();
    expect(panel(c, { ...draftOf(first(c)), remoteControl: 'mirror' })).not.toContain(t('ui.team.remoteControl'));
  });

  it('is held off with the reason in a test workspace', () => {
    page({ workspaceTest: '1' });
    const c = world();
    const out = panel(c, { ...draftOf(first(c)), remoteControl: 'mirror' });
    expect(out).toContain(t('ui.team.remoteControl.testWorkspace'));
    expect(out).not.toContain(t('ui.team.remoteControl.warning'));
    expect(out).toMatch(/<select[^>]*disabled=""/);
  });

  it('saves mirror on the agent and drops the field when turned off', () => {
    const c = world();
    const id = first(c).id;
    const on = applyAgent(c, { ...draftOf(first(c)), remoteControl: 'mirror' }, false);
    expect(on.agents.team.find((a) => a.id === id)?.remoteControl).toBe('mirror');
    const off = applyAgent(on, { ...draftOf(on.agents.team.find((a) => a.id === id)!), remoteControl: 'off' }, false);
    expect('remoteControl' in off.agents.team.find((a) => a.id === id)!).toBe(false);
  });
});
