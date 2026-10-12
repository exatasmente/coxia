// The bridge of claude.ai/code behind its one module (#282), with a fake of the SDK's alpha API: a mirror is attached outbound only and says it is read-only first, what
// the engine hands it is filtered, every refusal of the bridge leaves the stage without it, and each session opened is one audit line.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { newAgent } from '../src/shared/config/team';
import type { RemoteControlMode } from '../src/shared/config/types';
import { createRemoteControlPort, openMirror, readClaudeToken, SESSION_TAG, type BridgeApi } from '../src/main/remoteBridge';

interface Fake {
  api: BridgeApi;
  written: unknown[];
  results: number;
  closed: number;
  attached: Record<string, unknown>[];
  created: { title: string; tags?: string[] }[];
}

function fakeBridge(o: { create?: () => unknown; creds?: () => unknown } = {}): Fake {
  let n = 0;
  const f: Fake = {
    written: [],
    results: 0,
    closed: 0,
    attached: [],
    created: [],
    api: {
      createCodeSession: async (_base, _token, title, _timeout, tags) => {
        f.created.push({ title, tags });
        return (o.create ? o.create() : `cse_${++n}`) as never;
      },
      fetchRemoteCredentials: async () => (o.creds ? o.creds() : { worker_jwt: 'jwt', api_base_url: 'https://example.com', worker_epoch: 1 }) as never,
      attachBridgeSession: async (opts) => {
        f.attached.push(opts as unknown as Record<string, unknown>);
        return { write: (m) => f.written.push(m), sendResult: () => void f.results++, close: () => void f.closed++ };
      },
    },
  };
  return f;
}

const typeOf = (m: unknown): unknown => (m as { type?: unknown }).type;
const textOf = (m: unknown): string => ((m as { message: { content: { text: string }[] } }).message.content[0]?.text ?? '');

describe('openMirror', () => {
  it('attaches outbound only, tags the session, and says it is read-only before anything else', async () => {
    const f = fakeBridge();
    const r = await openMirror({ api: f.api, token: 'token', title: 'plan · #123 Example' });
    expect(r.ok).toBe(true);
    expect(f.attached[0]).toMatchObject({ sessionId: 'cse_1', ingressToken: 'jwt', apiBaseUrl: 'https://example.com', epoch: 1, outboundOnly: true });
    expect(f.created[0]).toEqual({ title: 'plan · #123 Example', tags: [SESSION_TAG] });
    expect(typeOf(f.written[0])).toBe('assistant');
    expect(textOf(f.written[0]).length).toBeGreaterThan(0);
    expect(f.results).toBe(1);
  });

  it('drops what is typed in claude.ai/code: the inbound handler delivers nothing anywhere', async () => {
    const f = fakeBridge();
    await openMirror({ api: f.api, token: 'token', title: 't' });
    const inbound = f.attached[0].onInboundMessage as (m: unknown) => unknown;
    expect(inbound({ type: 'user', message: { role: 'user', content: 'rm -rf' } })).toBeUndefined();
    expect(f.written).toHaveLength(1);
  });

  it('shows the turns and their end, never the partial pieces or the system notices, and nothing once closed', async () => {
    const f = fakeBridge();
    const r = await openMirror({ api: f.api, token: 'token', title: 't' });
    if (!r.ok) throw new Error('not opened');
    for (const type of ['stream_event', 'system', 'rate_limit_event', 'assistant', 'user', 'result']) r.mirror.write({ type });
    expect(f.written.slice(1).map(typeOf)).toEqual(['assistant', 'user', 'result']);
    r.mirror.close();
    r.mirror.close();
    r.mirror.write({ type: 'assistant' });
    r.mirror.turnEnd();
    expect(f.closed).toBe(1);
    expect(f.written).toHaveLength(4);
  });

  it('never throws when the bridge does', async () => {
    const f = fakeBridge();
    const r = await openMirror({ api: { ...f.api, attachBridgeSession: async () => ({ write: () => { throw new Error('gone'); }, sendResult: () => { throw new Error('gone'); }, close: () => { throw new Error('gone'); } }) }, token: 'token', title: 't' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => r.mirror.write({ type: 'assistant' })).not.toThrow();
    expect(() => r.mirror.close()).not.toThrow();
  });

  it('opens nothing without a credential', async () => {
    const f = fakeBridge();
    expect(await openMirror({ api: f.api, token: null, title: 't' })).toEqual({ ok: false, reason: 'no_credential' });
    expect(f.created).toHaveLength(0);
  });

  it.each([
    ['untrusted_device', { creds: () => ({ terminal: true, reason: 'untrusted_device' }) }],
    ['session_stale_relogin', { creds: () => ({ terminal: true, reason: 'session_stale_relogin' }) }],
    ['oauth_rejected', { create: () => ({ terminal: false, reason: 'oauth_rejected' }) }],
    ['request_rejected', { create: () => ({ terminal: true, reason: 'request_rejected', status: 403 }) }],
    ['unreachable', { create: () => null }],
    ['unreachable', { creds: () => null }],
  ])('gives the reason %s and attaches nothing when the bridge refuses', async (reason, how) => {
    const f = fakeBridge(how);
    expect(await openMirror({ api: f.api, token: 'token', title: 't' })).toEqual({ ok: false, reason });
    expect(f.attached).toHaveLength(0);
  });
});

describe('the port a stage uses', () => {
  const run = { id: 'r-1', issue: 123, ref: '#123' };
  const agentWith = (mode?: RemoteControlMode) => newAgent({ id: 'dev', ...(mode ? { remoteControl: mode } : {}) });
  const port = (o: { test?: boolean; token?: string | null; bridge?: Fake; failLoad?: boolean } = {}) => {
    const lines: Omit<AuditEntry, 'at'>[] = [];
    const said: { code: string; params: Record<string, string> }[] = [];
    let loads = 0;
    const bridge = o.bridge ?? fakeBridge();
    const p = createRemoteControlPort({
      test: () => o.test ?? false,
      token: () => (o.token === undefined ? 'token' : o.token),
      api: async () => {
        loads++;
        if (o.failLoad) throw new Error('missing');
        return bridge.api;
      },
      audit: (e) => lines.push(e),
    });
    const open = (mode?: RemoteControlMode) => p.open({ agent: agentWith(mode), run, title: 't', say: (code, params) => said.push({ code, params }) });
    return { open, lines, said, loads: () => loads, bridge };
  };

  it('does nothing at all for an agent with it off: no bridge loaded, no line, nothing said', async () => {
    const p = port();
    expect(await p.open()).toBeNull();
    expect(await p.open('off')).toBeNull();
    expect(p.loads()).toBe(0);
    expect(p.lines).toHaveLength(0);
    expect(p.said).toHaveLength(0);
  });

  it('refuses a test workspace before loading the bridge, and says so in the thread', async () => {
    const p = port({ test: true });
    expect(await p.open('mirror')).toBeNull();
    expect(p.loads()).toBe(0);
    expect(p.lines).toHaveLength(0);
    expect(p.said).toEqual([{ code: 'runner.remoteControl.skipped', params: { agent: 'dev', reason: 'test_workspace' } }]);
  });

  it('writes exactly one audit line per session opened, naming the session id, and none for one that did not open', async () => {
    const p = port();
    for (let i = 0; i < 3; i++) expect(await p.open('mirror')).not.toBeNull();
    expect(p.lines).toHaveLength(3);
    expect(p.lines.map((l) => l.fields.session)).toEqual(['cse_1', 'cse_2', 'cse_3']);
    expect(p.lines[0]).toMatchObject({ kind: 'remote-control', issue: 123, ok: true, by: 'dev', fields: { agent: 'dev', mode: 'mirror', run: 'r-1', ref: '#123' }, origin: { kind: 'remote-control', key: 'cse_1' } });
    expect(p.said.filter((s) => s.code === 'runner.remoteControl.opened')).toHaveLength(3);
    await p.open();
    expect(p.lines).toHaveLength(3);
  });

  it('never audits the same session id twice', async () => {
    const p = port({ bridge: fakeBridge({ create: () => 'cse_same' }) });
    await p.open('mirror');
    await p.open('mirror');
    expect(p.lines).toHaveLength(1);
  });

  it('runs the stage without it, with the reason, when the credential is missing or the bridge cannot load', async () => {
    const none = port({ token: null });
    expect(await none.open('mirror')).toBeNull();
    expect(none.said).toEqual([{ code: 'runner.remoteControl.skipped', params: { agent: 'dev', reason: 'no_credential' } }]);
    expect(none.lines).toHaveLength(0);
    const missing = port({ failLoad: true });
    expect(await missing.open('mirror')).toBeNull();
    expect(missing.said[0]?.params.reason).toBe('unavailable');
  });
});

describe('readClaudeToken', () => {
  const home = (body: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-home-'));
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', '.credentials.json'), typeof body === 'string' ? body : JSON.stringify(body));
    return dir;
  };

  it('reads the access token the signed-in Claude Code keeps', () => {
    expect(readClaudeToken(home({ claudeAiOauth: { accessToken: 'abc', expiresAt: 2_000 } }), 1_000)).toBe('abc');
  });

  it('is null when expired, absent, malformed or missing', () => {
    expect(readClaudeToken(home({ claudeAiOauth: { accessToken: 'abc', expiresAt: 500 } }), 1_000)).toBeNull();
    expect(readClaudeToken(home({}), 1_000)).toBeNull();
    expect(readClaudeToken(home('{not json'), 1_000)).toBeNull();
    expect(readClaudeToken(mkdtempSync(join(tmpdir(), 'rc-empty-')), 1_000)).toBeNull();
  });
});
