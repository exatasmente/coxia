// Settings › "Configurações e workspaces" draws the terminal state server's section on the computer and not in a paired browser. The section itself is tested in
// settings-mcp-state.test.ts; this pins that the screen draws it at all (it was imported and never drawn, so its switches could not be reached).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/shared/i18n';

const state = vi.hoisted(() => ({ web: false }));

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: async () => undefined } };
});

vi.mock('../src/renderer/src/platform', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/platform')>()), isWeb: () => state.web }));
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/workspaceApi', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/workspaceApi')>()), useWorkspaces: () => ({ running: 'ws', list: [] }) }));
vi.mock('../src/renderer/src/screens/WorkspacesSection', () => ({ WorkspacesSection: () => null, RestartOverlay: () => null }));
vi.mock('../src/renderer/src/wizard/ConfigTransfer', () => ({ ConfigExport: () => null, ConfigImport: () => null }));
vi.mock('../src/renderer/src/screens/McpStateSection', () => ({ McpStateSection: () => createElement('div', { id: 'state-server-section' }) }));

afterEach(() => {
  state.web = false;
});

const render = async (): Promise<string> => {
  const mod = await import('../src/renderer/src/screens/ConfigWorkspacesSection');
  return renderToStaticMarkup(createElement(mod.ConfigWorkspacesSection, { go: () => undefined }));
};

describe('the configuration and workspaces screen', () => {
  it('draws the terminal state server section on the computer', async () => {
    expect(await render()).toContain('state-server-section');
  });

  it('does not draw it in a paired browser', async () => {
    state.web = true;
    expect(await render()).not.toContain('state-server-section');
  });
});
