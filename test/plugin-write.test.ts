// What a plugin asks for, and the write it is allowed, go through the single door of Actions: a request is answered (never "approved"), an allowed write
// goes out to the plugin's outbox through the audit log, an irreversible one is announced until its deadline and may be blocked, and a test workspace
// neither asks nor writes. A plugin gets no write of its own.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const unit = (over: Partial<import('../src/main/actions').PluginAskUnit> = {}) => ({ plugin: 'web-search', name: 'Web search', need: 'write' as const, reversible: true, runId: 'r1', thread: null, asked: '', event: 'stage-finished', stage: 'implement', hosts: [], to: 'results', text: 'the result of the search', ...over });
const ask = (key: string, over = {}) => actions.proposePluginAsk({ key, issue: 123, issueTitle: 'Plugin platform', summary: 'The plugin Web search asks to write', unit: unit(over) });
const write = { plugin: 'web-search', to: 'results', text: 'the result of the search' };
const outbox = () => actions.pluginOutboxFile('web-search', 'results');

beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  rmSync(join(ATAS, 'plugins-out'), { recursive: true, force: true });
  asReal(false);
});

afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe("a plugin's request", () => {
  it('waits in Actions with what it asks for, and nothing runs', () => {
    const a = ask('plugin-ask:1');
    expect(a).toMatchObject({ kind: 'plugin-ask', state: 'pending', issue: 123, unit: { plugin: 'web-search', need: 'write', to: 'results' } });
    expect(actions.pendingPluginAsks()).toHaveLength(1);
    expect(existsSync(outbox())).toBe(false);
  });

  it('is not opened twice while the same one waits', () => {
    ask('plugin-ask:2');
    expect(ask('plugin-ask:2')).toBeNull();
  });

  it('is answered, never approved: the approval of a write refuses it', async () => {
    const a = ask('plugin-ask:3') as { id: string };
    await expect(actions.approveAction(a.id)).rejects.toThrow();
    expect(actions.pendingPluginAsks()).toHaveLength(1);
  });

  it('is closed with the answer: allowed is done, refused is set aside, and a closed one cannot be answered again', () => {
    const a = ask('plugin-ask:4') as { id: string };
    expect(actions.settlePluginAsk(a.id, false, 'refused').state).toBe('skipped');
    expect(() => actions.settlePluginAsk(a.id, true, 'allowed')).toThrow();
  });

  it('is not opened in a test workspace, which widens nothing', () => {
    asReal(true);
    expect(() => ask('plugin-ask:5')).toThrow(/Workspace de testes/);
    expect(actions.listActions()).toEqual([]);
  });

  it('cannot be set aside once answered: the conversation of the run never gets a refusal that did not happen', async () => {
    const a = ask('plugin-ask:7') as { id: string };
    actions.settlePluginAsk(a.id, true, 'allowed');
    await expect(actions.skipAction(a.id)).rejects.toThrow();
  });

  it('released by going on without answering, stays to be answered and says it no longer holds the run', () => {
    const a = ask('plugin-ask:8') as { id: string };
    ask('plugin-ask:9', { runId: 'r2' });
    actions.releasePluginAsks('r1');
    const pending = actions.pendingPluginAsks();
    expect(pending.find((x) => x.id === a.id)?.unit).toMatchObject({ holdsRun: false });
    expect(pending.find((x) => x.id !== a.id)?.unit?.holdsRun).toBeUndefined();
  });

  it('tells who listens when it is set aside from the list (a paired browser may refuse)', async () => {
    const seen: string[] = [];
    const stop = actions.onActionSkipped((x) => seen.push(`${x.kind}:${x.state}`));
    const a = ask('plugin-ask:6') as { id: string };
    await actions.skipAction(a.id);
    stop();
    expect(seen).toEqual(['plugin-ask:skipped']);
  });
});

describe("a plugin's write", () => {
  it('goes out to the outbox of the plugin, and the audit log says what was written', async () => {
    await actions.writePluginNow({ issue: 123, key: 'plugin-write:1', summary: 'Write of Web search', plugin: 'web-search' }, write);
    expect(readFileSync(outbox(), 'utf8')).toContain('the result of the search');
    const entry = listAudit()[0];
    expect(entry).toMatchObject({ kind: 'plugin-write', issue: 123, via: 'plugin', ok: true, target: 'web-search/results', by: 'web-search' });
    expect(entry.fields).toMatchObject({ plugin: 'web-search', to: 'results', bytes: String(Buffer.byteLength(write.text)) });
  });

  it('appends: a second write keeps the first', async () => {
    await actions.writePluginNow({ issue: 123, key: 'k1', summary: 's', plugin: 'web-search' }, { ...write, text: 'first' });
    await actions.writePluginNow({ issue: 123, key: 'k2', summary: 's', plugin: 'web-search' }, { ...write, text: 'second' });
    const text = readFileSync(outbox(), 'utf8');
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
  });

  it('refuses a destination that is not a plain name', async () => {
    await expect(actions.writePluginNow({ issue: 123, key: 'k', summary: 's', plugin: 'web-search' }, { ...write, to: '../escape' })).rejects.toThrow();
    expect(listAudit()).toEqual([]);
  });

  it('is refused in a test workspace before anything is written', async () => {
    asReal(true);
    await expect(actions.writePluginNow({ issue: 123, key: 'k', summary: 's', plugin: 'web-search' }, write)).rejects.toThrow(/Workspace de testes/);
    expect(existsSync(outbox())).toBe(false);
  });
});

describe('an announced irreversible write', () => {
  const announce = (seconds = 30) => actions.announcePluginWrite({ key: `plugin-write:a:${seconds}`, issue: 123, issueTitle: 'Plugin platform', summary: 'Write of Web search', runId: 'r1', seconds, write });

  it('waits with its deadline, and goes out when the deadline passes', async () => {
    const a = announce(30) as { id: string; unit: Record<string, unknown> };
    const due = Date.parse(String(a.unit.due));
    expect(due - Date.now()).toBeGreaterThan(25_000);
    expect(existsSync(outbox())).toBe(false);
    const sent = await actions.sendDuePluginWrite(a.id);
    expect(sent?.state).toBe('done');
    expect(readFileSync(outbox(), 'utf8')).toContain('the result of the search');
    expect(listAudit()[0]).toMatchObject({ kind: 'plugin-write', ok: true });
  });

  it('blocked before the deadline, never goes out', async () => {
    const a = announce(31) as { id: string };
    const blocked = await actions.skipAction(a.id);
    expect(blocked.state).toBe('skipped');
    expect(blocked.output).toBeTruthy();
    expect(await actions.sendDuePluginWrite(a.id)).toBeNull();
    expect(existsSync(outbox())).toBe(false);
  });

  it('cannot be sent before its deadline through the approval of a write', async () => {
    const a = announce(34) as { id: string };
    await expect(actions.approveAction(a.id)).rejects.toThrow();
    expect(existsSync(outbox())).toBe(false);
  });

  it('withdrawn (plugin switched off, permission taken back) never goes out, and a sent one cannot be blocked afterwards', async () => {
    const a = announce(35) as { id: string };
    expect(actions.withdrawPluginWrite(a.id, 'taken back')?.output).toBe('taken back');
    expect(await actions.sendDuePluginWrite(a.id)).toBeNull();
    const b = announce(36) as { id: string };
    await actions.sendDuePluginWrite(b.id);
    await expect(actions.skipAction(b.id)).rejects.toThrow();
  });

  it('gets its whole deadline again when the app opens', () => {
    const a = announce(32) as { id: string };
    const rearmed = actions.rearmPluginWrite(a.id, 600);
    expect(Date.parse(String(rearmed.unit?.due)) - Date.now()).toBeGreaterThan(590_000);
  });

  it('is not announced in a test workspace', () => {
    asReal(true);
    expect(() => announce(33)).toThrow(/Workspace de testes/);
  });
});
