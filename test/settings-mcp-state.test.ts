// The Settings panel of the state server, as a static render shows it (the panel in motion is for the manual plan): off shows no entry and
// offers no write; on shows the entry with the workspace id; the merge itself is the pure "mergeMcpEntry" behavior, tested in the entry test.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { McpStateView } from '../src/shared/mcpState';

const state = vi.hoisted(() => ({ web: false })) as { web: boolean; };

const fixture: McpStateView = {
  enabled: true,
  workspaceId: 'state-server-ws',
  available: true,
  entry: '{"mcpServers":{"coxia-state":{}}}',
  path: '/opt/app/out/main/mcp-state.js',
  targets: [{ path: '/data/projects', exists: false }],
};

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: async () => undefined } };
});

vi.mock('../src/renderer/src/platform', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/platform')>()), isWeb: () => state.web }));
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));

beforeEach(() => {
  Object.assign(fixture, { enabled: true, available: true, entry: '{"mcpServers":{"coxia-state":{}}}', path: '/opt/app/out/main/mcp-state.js' } as Partial<McpStateView>);
});

afterEach(() => {
  state.web = false;
  setLanguage('pt-BR');
});

const Section = async (): Promise<string> => {
  const mod = await import('../src/renderer/src/screens/McpStateSection');
  return renderToStaticMarkup(createElement(mod.McpStatePanel as never, { shown: fixture, onToggle: () => undefined, onWrite: () => undefined }));
};

describe('the panel', () => {
  it('is not drawn in a paired browser (the channels are desktop-only)', async () => {
    state.web = true;
    const mod = await import('../src/renderer/src/screens/McpStateSection');
    expect(renderToStaticMarkup(createElement(mod.McpStateSection as never))).toBe('');
  });

  it('with the opt-in off, no entry and no write offer are shown', async () => {
    fixture.enabled = false;
    fixture.entry = null;
    const html = await Section();
    expect(html).toContain(t('ui.settings.mcp.title'));
    expect(html).not.toContain(t('ui.settings.mcp.copy'));
    expect(html).not.toContain(t('ui.settings.mcp.write'));
  });

  it('with the opt-in on, the entry, the path hint and the folder write offer are shown, in both languages', async () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = await Section();
      expect(html).toContain('state-server-ws');
      expect(html).toContain(CATALOGS[language]['ui.settings.mcp.copy']);
      expect(html).toContain(CATALOGS[language]['ui.settings.mcp.write']);
    }
  });

  it('an install the state server cannot be spawned from answers the reason and offers nothing', async () => {
    fixture.available = false;
    fixture.entry = null;
    fixture.path = null;
    const html = await Section();
    expect(html).toContain(t('ui.settings.mcp.unavailable'));
    expect(html).not.toContain(t('ui.settings.mcp.copy'));
  });
});
