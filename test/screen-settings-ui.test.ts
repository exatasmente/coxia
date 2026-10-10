// The agent editor's three settings for the app's browser and the sessions panel, as a static render shows them: drawn on the computer only, the host hint that changes for an
// agent that runs on the computer, the Chromium line from the sandbox status, and the list of sites with a Revoke each. The panel in motion (looking, revoking) is for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { SandboxStatus } from '../src/shared/sandbox';
import type { SitesRefusal } from '../src/shared/browser';
import { blankAgent } from '../src/renderer/src/screens/team/agentEdit';

const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  const invoke = vi.fn(async (..._args: unknown[]) => null);
  (globalThis as unknown as { window: unknown }).window = { api: { invoke }, addEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement };
  return { documentElement, invoke };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { ScreenFieldsView } = await import('../src/renderer/src/screens/team/ScreenFields');
const { SitesList } = await import('../src/renderer/src/screens/team/SessionsPanel');
const { SITES_REFUSAL_LABEL, CHROMIUM_LABEL } = await import('../src/renderer/src/screens/team/labels');
const { teamApi } = await import('../src/renderer/src/screens/team/teamApi');

afterEach(() => {
  setLanguage('pt-BR');
  dom.documentElement.dataset.platform = '';
});

const status = (gui: SandboxStatus['gui'], over: Partial<SandboxStatus> = {}): SandboxStatus => ({ available: true, backend: 'bwrap', version: '0.9', reason: undefined, detail: '', gui, ...over }) as SandboxStatus;
const fields = (over: Partial<ReturnType<typeof blankAgent>> = {}, st: SandboxStatus | null = null, agent?: { id: string; name: string }): string =>
  renderToStaticMarkup(createElement(ScreenFieldsView, { draft: { ...blankAgent(), ...over }, set: () => undefined, status: st, agent }));

describe('the settings of the app\'s browser in the agent editor', () => {
  it('offers the three settings on the computer, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = fields();
      for (const key of ['ui.team.f.screen', 'ui.team.f.allowedHosts', 'ui.team.f.browserProfile']) expect(html, key).toContain(CATALOGS[language][key]);
      expect(html.match(/role="switch"/g)).toHaveLength(2);
    }
  });

  it('draws nothing in a paired browser: it may lower the settings but never offers to raise them', () => {
    dom.documentElement.dataset.platform = 'web';
    expect(fields({ screen: true })).toBe('');
  });

  it('shows the switches as the agent has them, and the hosts it lists', () => {
    const html = fields({ screen: true, browserProfile: true, allowedHosts: ['example.com'] });
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toContain('example.com');
    expect(html).toContain(t('ui.runner.sandbox.hostRemove', { host: 'example.com' }));
  });

  it('says the hosts are not used by an agent that runs on the computer, and warns about the profile folder', () => {
    const host = fields({ shell: 'host', browserProfile: true });
    expect(host).toContain(t('ui.team.f.allowedHostsHost'));
    expect(host).not.toContain(t('ui.team.f.allowedHostsHint'));
    expect(host).toContain(t('ui.team.f.browserProfileHost'));
    const sandboxed = fields({ shell: 'sandbox', browserProfile: true });
    expect(sandboxed).toContain(t('ui.team.f.allowedHostsHint'));
    expect(sandboxed).not.toContain(t('ui.team.f.browserProfileHost'));
  });

  it('recommends no commands for work on sites, only to an agent that has commands', () => {
    expect(fields({ screen: true, shell: 'sandbox' })).toContain(t('ui.team.f.screenShell'));
    expect(fields({ screen: true, shell: 'none' })).not.toContain(t('ui.team.f.screenShell'));
    expect(fields({ screen: false, shell: 'sandbox' })).not.toContain(t('ui.team.f.screenShell'));
  });

  it('says plainly that the holds are not a bound against the commands of an agent that runs on the computer', () => {
    expect(fields({ screen: true, shell: 'host' })).toContain(t('ui.team.f.screenHost'));
    expect(fields({ screen: true, shell: 'sandbox' })).not.toContain(t('ui.team.f.screenHost'));
    expect(fields({ screen: false, shell: 'host' })).not.toContain(t('ui.team.f.screenHost'));
  });

  it('tells whether this computer can start the app\'s browser, once the switch is on', () => {
    expect(fields({ screen: true }, status({ browsers: 'ready', display: 'ready', chromium: 'ready' }))).toContain(t(CHROMIUM_LABEL.ready));
    expect(fields({ screen: true }, status({ browsers: 'unset', display: 'ready', chromium: 'unset' }))).toContain(t(CHROMIUM_LABEL.unset));
    expect(fields({ screen: true }, status({ browsers: 'empty', display: 'ready', chromium: 'none' }))).toContain(t(CHROMIUM_LABEL.none));
    expect(fields({ screen: true }, status({ browsers: 'ready', display: 'off', chromium: 'ready' }))).toContain(t('ui.team.screen.displayOff'));
    expect(fields({ screen: true }, status(undefined, { available: false }))).toContain(t('ui.team.screen.noSandbox'));
    // Nothing yet about the computer, or the switch off: no line.
    expect(fields({ screen: true }, null)).not.toContain(t(CHROMIUM_LABEL.ready));
    expect(fields({ screen: false }, status({ browsers: 'ready', display: 'ready', chromium: 'ready' }))).not.toContain(t(CHROMIUM_LABEL.ready));
  });

  it('lists the sessions of an agent that is saved, and not those of a new one', () => {
    expect(fields({}, null, { id: 'coder', name: 'Coder' })).toContain(t('ui.team.sessions.title'));
    expect(fields()).not.toContain(t('ui.team.sessions.title'));
  });
});

describe('the sites of a logged-in browser', () => {
  const list = (sites: { site: string; cookies: number; storage: number }[]): string => renderToStaticMarkup(createElement(SitesList, { sites, busy: false, onRevoke: () => undefined }));

  it('shows each site with its counts and a Revoke, and never a value', () => {
    const html = list([{ site: 'example.com', cookies: 3, storage: 2 }, { site: 'docs.example.com', cookies: 1, storage: 0 }]);
    expect(html).toContain('example.com');
    expect(html).toContain(t('ui.team.sessions.counts', { cookies: 3, storage: 2 }));
    expect(html.match(new RegExp(`>${t('ui.team.sessions.revoke')}</button>`, 'g'))).toHaveLength(2);
    expect(html).toContain(`aria-label="${t('ui.team.sessions.revokeAria', { site: 'docs.example.com' })}"`);
  });

  it('says when no site holds a session', () => {
    expect(list([])).toContain(t('ui.team.sessions.none'));
  });

  it('words every reason a listing or a revoke is refused, in both languages', () => {
    const whys: SitesRefusal[] = ['agent', 'site', 'open', 'busy', 'browser', 'failed'];
    expect(Object.keys(SITES_REFUSAL_LABEL).sort()).toEqual([...whys].sort());
    for (const why of whys) for (const language of ['en', 'pt-BR'] as const) expect(CATALOGS[language][SITES_REFUSAL_LABEL[why]], `${language} ${why}`).toBeTruthy();
    // The one the person meets while the agent works says what to do.
    expect(CATALOGS.en[SITES_REFUSAL_LABEL.open]).toMatch(/Close the agent's screen first/);
  });
});

describe('the channels of the panel', () => {
  it('list and revoke by the agent\'s id, and revoke one site or all', async () => {
    dom.invoke.mockClear();
    await teamApi.sites('coder');
    await teamApi.revoke('coder', 'example.com');
    await teamApi.revoke('coder');
    expect(dom.invoke.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['screen:sites', 'coder'],
      ['screen:revoke', 'coder', 'example.com'],
      ['screen:revoke', 'coder', undefined],
    ]);
  });
});

describe('the words of the settings', () => {
  it('exist in both languages with the same placeholders', () => {
    const keys = Object.keys(CATALOGS['pt-BR']).filter((k) => /^ui\.team\.(screen\.|sessions\.|f\.(screen|allowedHosts|browserProfile))/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const k of keys) {
      expect(CATALOGS.en[k], k).toBeTruthy();
      expect([...CATALOGS.en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k).toEqual([...CATALOGS['pt-BR'][k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});
