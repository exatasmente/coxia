// What the screen does with the machine's Claude Code sessions (#280), over a fake SDK and a fake machine: list, read masked, send (resume, or a copy when another process
// holds the session), answer a permission request, stop, end only what the app started, start in a project folder, refuse sending and starting in a test workspace, and
// write one audit line per action without the text. Nothing of a real ~/.claude or a real model is touched.
import { describe, expect, it } from 'vitest';
import { createClaudeAsks } from '../src/main/claudeSessions/asks-core';
import type { InputMessage } from '../src/main/claudeSessions/owned';
import { type DrivenQuery, type QueryOptions, createClaudeSessions } from '../src/main/claudeSessions/service';
import type { MachineSessions, RawMessage } from '../src/main/claudeSessions/source';
import { redact } from '../src/main/errorlog-core';
import { CLAUDE_SESSIONS_ASKS_EVENT, CLAUDE_SESSIONS_LINES_EVENT, type ClaudeLiveSession, type ClaudeSessionLines, type PendingClaudePermission } from '../src/shared/claudeSessions';
import type { AppEvent } from '../src/shared/types';

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
const settle = () => new Promise((r) => setTimeout(r, 0));

interface Call {
  options: QueryOptions;
  inputs: string[];
  interrupted: number;
  permission?: unknown;
}

function fakeQuery() {
  const calls: Call[] = [];
  const query = (params: { prompt: AsyncIterable<InputMessage>; options: QueryOptions }): DrivenQuery => {
    const call: Call = { options: params.options, inputs: [], interrupted: 0 };
    calls.push(call);
    const sid = params.options.forkSession ? 'copy-1' : (params.options.resume ?? 'new-1');
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<RawMessage> {
        for await (const m of params.prompt) {
          const text = m.message.content;
          call.inputs.push(text);
          yield { type: 'system', subtype: 'init', session_id: sid };
          if (text.includes('use a tool')) {
            call.permission = await params.options.canUseTool('Bash', { command: `echo ${SECRET}` }, { signal: params.options.abortController.signal });
          }
          yield { type: 'assistant', session_id: sid, message: { content: [{ type: 'text', text: `answer to ${text}` }] } };
          yield { type: 'result', subtype: 'success', session_id: sid };
        }
      },
      interrupt: async () => {
        call.interrupted += 1;
      },
    };
  };
  return { calls, query };
}

const transcript = { sessionId: 's-1', title: 'Fix the build', firstPrompt: `use ${SECRET}`, cwd: '/work/app', branch: 'main', lastModified: 1 };
const live = (over: Partial<ClaudeLiveSession> = {}): ClaudeLiveSession => ({ pid: 10, sessionId: 's-2', cwd: '/work/app', kind: 'interactive', status: 'idle', updatedAt: 2, ...over });

function setup(o: { test?: boolean; cli?: boolean; live?: ClaudeLiveSession[] } = {}) {
  const events: AppEvent[] = [];
  const audits: { action: string; sessionId: string; fields: Record<string, string> }[] = [];
  const ticks: (() => void)[] = [];
  const messages: RawMessage[] = [{ type: 'user', message: { content: `my key is ${SECRET}` } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Read', input: { file: 'a.ts' } }] } }];
  const source: MachineSessions = { transcripts: async () => [transcript], messages: async () => messages, live: () => o.live ?? [] };
  const sdk = fakeQuery();
  const emit = (ev: AppEvent) => void events.push(ev);
  const asks = createClaudeAsks({ changed: (list) => emit({ type: 'module', name: CLAUDE_SESSIONS_ASKS_EVENT, payload: list }), audit: (a, decision) => audits.push({ action: 'permission', sessionId: a.sessionId, fields: { decision } }) });
  const service = createClaudeSessions({
    source,
    query: sdk.query,
    cli: () => (o.cli === false ? { ok: false, reason: 'not installed' } : { ok: true, reason: '' }),
    isTest: () => o.test === true,
    folders: () => ['/work/app', '/work/site'],
    redact: (t) => redact(t, '/home/someone'),
    emit,
    audit: (action, sessionId, fields) => void audits.push({ action, sessionId, fields }),
    asks,
    every: (_ms, fn) => {
      ticks.push(fn);
      return () => undefined;
    },
  });
  const lines = () => events.filter((e) => e.type === 'module' && e.name === CLAUDE_SESSIONS_LINES_EVENT).map((e) => (e as { payload: ClaudeSessionLines }).payload);
  return { service, sdk, events, audits, ticks, messages, lines, asks };
}

describe('listing and reading', () => {
  it('lists transcripts, running and background sessions, masked', async () => {
    const { service } = setup({ live: [live(), live({ pid: 11, sessionId: 's-3', kind: 'background' })] });
    const list = await service.list();
    expect(list.cli).toBe('ok');
    expect(list.transcripts.map((s) => s.sessionId)).toEqual(['s-1']);
    expect(list.transcripts[0].firstPrompt).not.toContain(SECRET);
    expect(list.running.map((s) => s.sessionId)).toEqual(['s-2']);
    expect(list.background.map((s) => s.sessionId)).toEqual(['s-3']);
  });

  it('says the CLI is missing, with the reason, and offers no transcript', async () => {
    const list = await setup({ cli: false }).service.list();
    expect(list).toMatchObject({ cli: 'missing', reason: 'not installed', transcripts: [] });
  });

  it('reads a conversation into activity lines, with a secret masked', async () => {
    const { service } = setup();
    const r = await service.read('s-1');
    expect(r.of).toBe('s-1');
    expect(r.entries.map((e) => e.kind)).toEqual(['status', 'answer', 'tool']);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.entries[0].label).toContain('[key]');
  });

  it('follows an open session: a new message made elsewhere arrives without a reload', async () => {
    const { service, ticks, messages, lines } = setup();
    service.follow('s-1');
    ticks[0]();
    await settle();
    expect(lines().at(-1)).toMatchObject({ of: 's-1', mode: 'replace' });
    const before = lines().length;
    ticks[0]();
    await settle();
    expect(lines()).toHaveLength(before);
    messages.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'new one' }] } });
    ticks[0]();
    await settle();
    expect(lines().at(-1)?.entries.at(-1)?.label).toBe('new one');
  });
});

describe('sending', () => {
  it('resumes a session nobody holds and streams the answer', async () => {
    const { service, sdk, lines, audits } = setup();
    const r = await service.send('s-1', 'hello there');
    expect(r).toEqual({ ok: true, sessionId: 's-1', forked: false });
    expect(sdk.calls[0].options).toMatchObject({ resume: 's-1', cwd: '/work/app' });
    expect(sdk.calls[0].options.forkSession).toBeUndefined();
    await settle();
    expect(lines().flatMap((l) => l.entries.map((e) => e.label))).toContain('answer to hello there');
    expect(audits).toEqual([{ action: 'message', sessionId: 's-1', fields: { action: 'message', length: '11', forked: 'false', of: 's-1' } }]);
    expect(JSON.stringify(audits)).not.toContain('hello there');
  });

  it('sends to a copy when another process holds the session open, and the lines stay under the session opened', async () => {
    const { service, sdk, lines } = setup({ live: [live({ sessionId: 's-1' })] });
    const r = await service.send('s-1', 'hi');
    expect(r).toEqual({ ok: true, sessionId: 'copy-1', forked: true });
    expect(sdk.calls[0].options).toMatchObject({ resume: 's-1', forkSession: true });
    await settle();
    expect(lines().every((l) => l.of === 's-1')).toBe(true);
    expect((await service.list()).owned).toEqual([{ sessionId: 'copy-1', cwd: '/work/app', busy: false, forked: true, of: 's-1' }]);
  });

  it('sends the next message to the same process, and refuses while a turn runs', async () => {
    const { service, sdk } = setup();
    await service.send('s-1', 'first');
    await settle();
    expect((await service.send('s-1', 'second')).ok).toBe(true);
    await settle();
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.calls[0].inputs).toEqual(['first', 'second']);
    await service.send('s-1', 'use a tool');
    await settle();
    expect(await service.send('s-1', 'third')).toEqual({ ok: false, reason: 'busy' });
  });

  it('refuses an empty message and an unknown session', async () => {
    const { service } = setup();
    expect(await service.send('s-1', '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(await service.send('nope', 'hi')).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('permission requests', () => {
  const pending = (events: AppEvent[]) => (events.filter((e) => e.type === 'module' && e.name === CLAUDE_SESSIONS_ASKS_EVENT).at(-1) as { payload: PendingClaudePermission[] } | undefined)?.payload ?? [];

  it('shows a request as pending, masked; denying lets the session go on without the tool', async () => {
    const { service, sdk, events, audits } = setup();
    await service.send('s-1', 'use a tool');
    await settle();
    const [ask] = pending(events);
    expect(ask).toMatchObject({ sessionId: 's-1', tool: 'Bash' });
    expect(ask.input).not.toContain(SECRET);
    expect(service.answer(ask.id, 'deny', 'window')).toEqual({ ok: true });
    await settle();
    expect(sdk.calls[0].permission).toMatchObject({ behavior: 'deny' });
    expect(audits.at(-1)).toMatchObject({ action: 'permission', sessionId: 's-1', fields: { decision: 'deny' } });
  });

  it('allowing lets the tool run with its input', async () => {
    const { service, sdk, events } = setup();
    await service.send('s-1', 'use a tool');
    await settle();
    service.answer(pending(events)[0].id, 'allow', 'window');
    await settle();
    expect(sdk.calls[0].permission).toEqual({ behavior: 'allow', updatedInput: { command: `echo ${SECRET}` } });
  });

  it('is never answered by the persona or a paired browser', async () => {
    const { service, events } = setup();
    await service.send('s-1', 'use a tool');
    await settle();
    const id = pending(events)[0].id;
    expect(service.answer(id, 'allow', 'persona')).toEqual({ ok: false, reason: 'door' });
    expect(service.answer(id, 'allow', 'paired')).toEqual({ ok: false, reason: 'door' });
    expect(service.pending()).toHaveLength(1);
  });
});

describe('stop, end and start', () => {
  it('stop interrupts a running turn and is audited; with no turn there is nothing to stop', async () => {
    const { service, sdk, audits } = setup();
    expect(await service.stop('s-1')).toEqual({ ok: false, reason: 'not-running' });
    await service.send('s-1', 'use a tool');
    await settle();
    expect((await service.stop('s-1')).ok).toBe(true);
    expect(sdk.calls[0].interrupted).toBe(1);
    expect(audits.at(-1)).toMatchObject({ action: 'stop', sessionId: 's-1', fields: { ended: 'false' } });
  });

  it('ends only a process the app started: another process is never offered', async () => {
    const { service, sdk, audits } = setup({ live: [live()] });
    expect(service.end('s-2')).toEqual({ ok: false, reason: 'not-owned' });
    await service.send('s-1', 'hi');
    await settle();
    expect(service.end('s-1').ok).toBe(true);
    expect(sdk.calls[0].options.abortController.signal.aborted).toBe(true);
    expect(audits.at(-1)).toMatchObject({ action: 'stop', sessionId: 's-1', fields: { ended: 'true' } });
    await settle();
    expect((await service.list()).owned).toEqual([]);
  });

  it('starts a session in a project folder of the workspace only', async () => {
    const { service, sdk, audits } = setup();
    expect(await service.start('/elsewhere', 'hi')).toEqual({ ok: false, reason: 'folder' });
    expect(await service.start('/work/site', 'hi')).toEqual({ ok: true, sessionId: 'new-1', forked: false });
    expect(sdk.calls[0].options.cwd).toBe('/work/site');
    expect(sdk.calls[0].options.resume).toBeUndefined();
    expect(audits.at(-1)).toMatchObject({ action: 'start', sessionId: 'new-1', fields: { length: '2' } });
  });

  it('refuses sending and starting in a test workspace before the SDK is touched; listing and reading still work', async () => {
    const { service, sdk, audits } = setup({ test: true });
    expect(await service.send('s-1', 'hi')).toEqual({ ok: false, reason: 'test-workspace' });
    expect(await service.start('/work/app', 'hi')).toEqual({ ok: false, reason: 'test-workspace' });
    expect(sdk.calls).toEqual([]);
    expect(audits).toEqual([]);
    expect((await service.list()).transcripts).toHaveLength(1);
    expect((await service.read('s-1')).entries.length).toBeGreaterThan(0);
  });

  it('turning the feature off also ends a process whose session id has not arrived yet', async () => {
    let options: QueryOptions | null = null;
    const service = createClaudeSessions({
      source: { transcripts: async () => [], messages: async () => [], live: () => [] },
      query: (params) => {
        options = params.options;
        return {
          async *[Symbol.asyncIterator]() {
            for await (const _ of params.prompt) void _;
          },
          interrupt: async () => undefined,
        };
      },
      cli: () => ({ ok: true, reason: '' }),
      isTest: () => false,
      folders: () => ['/work/app'],
      redact: (t) => t,
      emit: () => undefined,
      audit: () => undefined,
      asks: createClaudeAsks({ changed: () => undefined }),
    });
    const starting = service.start('/work/app', 'hi');
    await settle();
    service.shutdown();
    expect(options!.abortController.signal.aborted).toBe(true);
    await expect(starting).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });

  it('masks an SDK error before it leaves the main process', async () => {
    const { service } = setup();
    const failing = createClaudeSessions({ source: { transcripts: async () => [], messages: async () => Promise.reject(new Error(`bad ${SECRET}`)), live: () => [] }, query: fakeQuery().query, cli: () => ({ ok: true, reason: '' }), isTest: () => false, folders: () => [], redact: (t) => redact(t, '/home/someone'), emit: () => undefined, audit: () => undefined, asks: createClaudeAsks({ changed: () => undefined }) });
    await expect(failing.read('s-1')).rejects.toThrow('[key]');
    expect((await service.list()).transcripts[0].cwd).toBe('/work/app');
  });

  it('turning the feature off ends every process the app started', async () => {
    const { service, sdk } = setup();
    await service.send('s-1', 'hi');
    await settle();
    service.shutdown();
    expect(sdk.calls[0].options.abortController.signal.aborted).toBe(true);
  });
});
