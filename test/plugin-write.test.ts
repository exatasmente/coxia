// The external write a plugin asks for goes through the single door of Actions: it waits for the person's "sim", is refused in a test
// workspace, and what is approved lands in the audit log. A plugin gets no write of its own.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-plugin-write-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { listAudit } = await import('../src/main/auditoria');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
const input = (key: string) => ({ key, issue: 84, issueTitle: 'Plugin platform', summary: 'External write asked for by the plugin Web search', plugin: 'web-search', destination: 'plugin://web-search/results', detail: 'the result of the search' });

beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  asReal(false);
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe('the external write a plugin asks for', () => {
  it('waits as a pending proposal, with the plugin and the neutral destination, and nothing runs', () => {
    const a = actions.proposePluginWrite(input('plugin-write:1'));
    expect(a).toMatchObject({ kind: 'plugin-write', state: 'pending', issue: 84, unit: { plugin: 'web-search', destination: 'plugin://web-search/results' } });
    expect(a?.output).toContain('plugin://web-search/results');
    expect(actions.listActions()).toHaveLength(1);
  });

  it('is not proposed twice for the same key while one waits', () => {
    actions.proposePluginWrite(input('plugin-write:2'));
    expect(actions.proposePluginWrite(input('plugin-write:2'))).toBeNull();
  });

  it('goes to the audit log when approved, and the log names the plugin and the destination', async () => {
    const a = actions.proposePluginWrite(input('plugin-write:3')) as { id: string };
    const done = await actions.approveAction(a.id);
    expect(done.state).toBe('done');
    const entry = listAudit()[0];
    expect(entry).toMatchObject({ kind: 'plugin-write', issue: 84, via: 'plugin', ok: true });
    expect(entry.target).toBe('plugin://web-search/results');
    expect(entry.fields).toMatchObject({ plugin: 'web-search', destination: 'plugin://web-search/results' });
  });

  it('is refused in a test workspace, with nothing logged', async () => {
    asReal(true);
    expect(() => actions.proposePluginWrite(input('plugin-write:4'))).toThrow(/Workspace de testes/);
    expect(actions.listActions()).toEqual([]);
    expect(listAudit()).toEqual([]);
  });
});
