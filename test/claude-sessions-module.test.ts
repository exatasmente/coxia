// The doors of the machine's Claude Code sessions (#280): off by default and refusing every channel but the switch while off; window only, so a paired browser is refused on
// every channel (webPolicy.ts) and by the handler itself; its events reach the window emitter and never the one that broadcasts; the persona's door excludes every channel; the
// audit has one line per action naming the session; and only source.ts reads the disk.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../src/shared/types';
import { DESKTOP_ONLY, webAccess, webRefusal } from '../src/main/webPolicy';
import { neutralConfig } from '../src/shared/config/defaults';
import { t } from '../src/shared/i18n';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { moduleList } = await import('../src/main/modules');
const { auditClaudeSession, claudeSessionsModule, makeClaudeSessionsModule } = await import('../src/main/claudeSessions/module');
const { EXCLUDED } = await import('../src/main/persona/doorTable');
const { listAudit } = await import('../src/main/auditoria');
const { bindIpc, handle, invoke } = await import('../src/main/rpc');

const SRC = join(import.meta.dirname, '../src/main');
const DIR = join(SRC, 'claudeSessions');
const served = (): string[] => {
  const out: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
    for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(claudeSessions:[\w-]+)'/g)) out.push(m[1]);
  }
  return out.sort();
};

type Handler = (...args: unknown[]) => unknown;

function mount(o: { on?: boolean; via?: 'window' | 'paired' | 'persona' } = {}) {
  let on = o.on ?? false;
  const handlers = new Map<string, Handler>();
  const broadcast: AppEvent[] = [];
  const windowOnly: AppEvent[] = [];
  const service = {
    list: vi.fn(async () => {
      service.emit?.({ type: 'module', name: 'claudeSessions:state', payload: [] });
      return { cli: 'ok', reason: '', transcripts: [], running: [], background: [], owned: [] };
    }),
    read: vi.fn(),
    follow: vi.fn(),
    send: vi.fn(),
    answer: vi.fn(),
    pending: vi.fn(() => []),
    stop: vi.fn(),
    end: vi.fn(),
    start: vi.fn(),
    folders: vi.fn(() => []),
    shutdown: vi.fn(),
    emit: undefined as ((ev: AppEvent) => void) | undefined,
  };
  const changes: (() => void)[] = [];
  makeClaudeSessionsModule({
    enabled: () => on,
    setEnabled: (v) => (on = v),
    onConfigChange: (fn) => void changes.push(fn),
    via: () => o.via ?? 'window',
    build: (emit) => {
      service.emit = emit;
      return service as never;
    },
  })({ handle: (c, fn) => void handlers.set(c, fn as Handler), notify: () => undefined, emit: (e) => void broadcast.push(e), emitWindow: (e) => void windowOnly.push(e), job: () => undefined });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(...args);
  return { handlers, call, service, broadcast, windowOnly, changes, set: (v: boolean) => (on = v) };
}

describe('the switch', () => {
  it('is off in a new workspace', () => {
    expect(neutralConfig().claudeSessions).toEqual({ enabled: false });
  });

  it('off: every channel but the switch refuses, so there is nothing to call', () => {
    const { handlers, call, service } = mount();
    for (const channel of handlers.keys()) {
      if (channel === 'claudeSessions:enabled' || channel === 'claudeSessions:set-enabled') continue;
      expect(() => call(channel, 's-1', 'hi'), channel).toThrow(t('main.claudeSessions.off'));
    }
    expect(service.list).not.toHaveBeenCalled();
    expect(call('claudeSessions:enabled')).toBe(false);
  });

  it('turning it on opens the channels; turning it off ends what the app started', async () => {
    const m = mount();
    expect(m.call('claudeSessions:set-enabled', true)).toBe(true);
    await expect(m.call('claudeSessions:list')).resolves.toMatchObject({ cli: 'ok' });
    m.changes.forEach((f) => f());
    m.set(false);
    m.changes.forEach((f) => f());
    expect(m.service.shutdown).toHaveBeenCalledTimes(1);
    expect(() => m.call('claudeSessions:set-enabled', 'yes')).toThrow();
  });
});

describe('the window only', () => {
  it('sends its events through the window emitter, never through the one that broadcasts to a phone', async () => {
    const m = mount({ on: true });
    await m.call('claudeSessions:list');
    expect(m.windowOnly).toHaveLength(1);
    expect(m.broadcast).toEqual([]);
  });

  it.each(['paired', 'persona'] as const)('refuses every channel, the switch included, when the call comes from %s', (via) => {
    const m = mount({ on: true, via });
    for (const channel of m.handlers.keys()) expect(() => m.call(channel, 's-1', 'allow'), channel).toThrow(t('main.claudeSessions.windowOnly'));
    expect(m.service.answer).not.toHaveBeenCalled();
  });

  it.each([...served(), 'claudeSessions:made-up', 'claudeSessions:'])('a paired browser is denied %s by the policy, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
    expect(DESKTOP_ONLY.has(channel)).toBe(false);
  });

  it('does not mistake a channel that only has the word in its name for one of them', () => {
    expect(webAccess('runs:claudeSessions')).toBe('allow');
  });

  it('refuses a paired browser through the real call door', async () => {
    const ipc = new Map<string, Handler>();
    bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
    let on = true;
    makeClaudeSessionsModule({ enabled: () => on, setEnabled: (v) => (on = v), onConfigChange: () => undefined, via: (await import('../src/main/rpc')).viaOf, build: () => ({ list: async () => 'listed' }) as never })({
      handle: (channel, fn) => handle(channel, fn as never),
      notify: () => undefined,
      emit: () => undefined,
      emitWindow: () => undefined,
      job: () => undefined,
    });
    await expect(ipc.get('claudeSessions:list')?.()).resolves.toBe('listed');
    await expect(invoke('claudeSessions:list', [], 'device-1')).rejects.toThrow();
  });
});

describe('the persona and the module list', () => {
  it('registers the module in the list the app registers', () => {
    expect(moduleList()).toContain(claudeSessionsModule);
  });

  it('excludes every channel from the persona as the machine\'s', () => {
    const channels = served();
    expect(channels.length).toBe(12);
    for (const channel of channels) expect(EXCLUDED[channel], channel).toBe('machine');
  });
});

describe('the audit', () => {
  it('writes one line per message, permission answer, stop and start, naming the session, with no message text', () => {
    const before = listAudit().length;
    auditClaudeSession('message', 'sess-123', { length: '5', forked: 'false', of: 'sess-123' });
    auditClaudeSession('permission', 'sess-123', { tool: 'Bash', decision: 'deny' });
    auditClaudeSession('stop', 'sess-123', { ended: 'false' });
    auditClaudeSession('start', 'sess-456', { length: '2' });
    const rows = listAudit().slice(0, listAudit().length - before);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === 'claude-session' && r.via === 'window')).toBe(true);
    expect(rows.map((r) => [r.target, r.fields.action]).reverse()).toEqual([
      ['claude:sess-123', 'message'],
      ['claude:sess-123', 'permission'],
      ['claude:sess-123', 'stop'],
      ['claude:sess-456', 'start'],
    ]);
  });
});

describe('the disk', () => {
  it('is read only by source.ts: no other file of the feature imports fs', () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts') && f !== 'source.ts')) {
      expect(readFileSync(join(DIR, file), 'utf8'), file).not.toMatch(/from 'node:fs'|from 'fs'|require\('fs'\)/);
    }
  });

  it('never names a credential or key file to open', () => {
    for (const file of readdirSync(DIR)) expect(readFileSync(join(DIR, file), 'utf8'), file).not.toMatch(/['"`][^'"`]*(\.credentials\.json|control\.key)['"`]/);
  });
});
