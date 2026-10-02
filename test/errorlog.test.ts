import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorHint, errorReport } from '../src/shared/errorlog';
import { appendEntry, buildEntry, clearLog, createLimiter, groupEntries, readEntries, redact, rpcContext, safeContext } from '../src/main/errorlog-core';
import { webAccess } from '../src/main/webPolicy';

const dir = () => mkdtempSync(join(tmpdir(), 'cerimonias-errors-'));
const entry = (message: string, time: string, source = 'rpc:x') => ({ time, workspace: 'default', source, name: 'Error', message, stack: '', context: {} });

describe('redact', () => {
  it.each([
    ['glpat-abcdefghij1234567890', 'glpat'],
    ['sk-or-v1-0123456789abcdef0123456789abcdef', 'sk-or-v1'],
    ['Authorization: Bearer abc.def-ghi_jkl', 'abc.def'],
    ['request failed with Bearer abcdef123456', 'abcdef123456'],
    ['PRIVATE-TOKEN: hunter2hunter2', 'hunter2'],
    ['Cookie: cer_session=zzz111; other=1', 'zzz111'],
    ['cer_session=zzz111', 'zzz111'],
    ['{"token":"supersecretvalue"}', 'supersecretvalue'],
    ['api_key=abc123def456', 'abc123def456'],
    ['password: "p4ss w0rd"', 'p4ss'],
    ['mail luiz@example.com failed', 'luiz@example.com'],
    ['GET https://x.test/api?private_token=abc&x=1', 'private_token'],
    ['https://user:pw123@host.test/repo.git', 'pw123'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123', 'eyJhbGci'],
    ['id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081'],
  ])('hides %s', (text, secret) => {
    expect(redact(text, '/home/x')).not.toContain(secret);
  });

  it('keeps what helps diagnosis', () => {
    const text = 'connect ECONNREFUSED 10.0.0.1:443 at dark.smartzap.com.br, code: ENOENT, exit code=1';
    expect(redact(text, '/home/x')).toBe(text);
  });

  it('replaces the home directory', () => {
    expect(redact('at /home/luiz/projects/app/x.ts:1:2', '/home/luiz')).toBe('at ~/projects/app/x.ts:1:2');
  });
});

describe('entries', () => {
  it('trims the stack, drops the message line and redacts', () => {
    const err = new Error('boom sk-or-v1-0123456789abcdef');
    err.stack = `Error: boom\n${Array.from({ length: 30 }, (_, i) => `    at fn${i} (/home/u/app/a.js:${i}:1)`).join('\n')}`;
    const e = buildEntry('rpc:x', err, undefined, 'default', new Date('2026-10-02T10:00:00Z'), '/home/u');
    expect(e.message).toBe('boom [key]');
    expect(e.stack.split('\n')).toHaveLength(10);
    expect(e.stack).toContain('~/app/a.js');
    expect(e.stack).not.toContain('Error: boom');
    expect(e.time).toBe('2026-10-02T10:00:00.000Z');
  });

  it('accepts strings and plain objects', () => {
    expect(buildEntry('x', 'plain', undefined, 'w').message).toBe('plain');
    expect(buildEntry('x', { name: 'TypeError', message: 'm', stack: 'a\nb' }, undefined, 'w').name).toBe('TypeError');
  });

  it('keeps only short whitelisted context values', () => {
    const ctx = safeContext({ channel: 'qa:ask', via: 'ipc', exitCode: 1, question: 'what is my password', ref: 'sz4/sz4#15965', id: 'two words', cmd: 'x'.repeat(200), status: true });
    expect(ctx).toEqual({ channel: 'qa:ask', via: 'ipc', exitCode: 1, ref: 'sz4/sz4#15965', status: true });
  });

  it('never takes text arguments as context', () => {
    expect(rpcContext('qa:ask', ['15965', 'my secret question'], 'ipc')).toEqual({ channel: 'qa:ask', via: 'ipc', id: '15965' });
    expect(rpcContext('clipboard:copy', ['some private text'], 'ipc')).toEqual({ channel: 'clipboard:copy', via: 'ipc' });
    expect(rpcContext('voice:plan', ['olá'], 'web')).toEqual({ channel: 'voice:plan', via: 'web' });
    expect(rpcContext('agent:reply', [{ ref: 'sz4/sz4#15965', title: 'private title' }, {}, 'text'], 'ipc')).toEqual({ channel: 'agent:reply', via: 'ipc', ref: 'sz4/sz4#15965' });
    expect(rpcContext('conflict:fromMr', [{ ref: 'sz4/sz4#1' }, 'sz4/sz4!925'], 'web')).toMatchObject({ mr: 'sz4/sz4!925' });
    expect(rpcContext('agent:reply', [{ ref: 'free text with spaces' }], 'ipc')).toEqual({ channel: 'agent:reply', via: 'ipc' });
  });
});

describe('files', () => {
  it('rotates at the limit and keeps three files', () => {
    const d = dir();
    const e = entry('x'.repeat(100), '2026-10-02T10:00:00.000Z');
    for (let i = 0; i < 40; i++) appendEntry(d, { ...e, message: `m${i}` }, 1000);
    expect(existsSync(join(d, 'errors.jsonl'))).toBe(true);
    expect(existsSync(join(d, 'errors.1.jsonl'))).toBe(true);
    expect(existsSync(join(d, 'errors.2.jsonl'))).toBe(true);
    expect(existsSync(join(d, 'errors.3.jsonl'))).toBe(false);
    for (const f of ['errors.jsonl', 'errors.1.jsonl', 'errors.2.jsonl']) expect(statSync(join(d, f)).size).toBeLessThanOrEqual(1000);
    const all = readEntries(d, 1000);
    expect(all.at(-1)?.message).toBe('m39');
    expect(all.map((x) => x.message)).toEqual([...all.map((x) => x.message)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it('writes json lines and clears', () => {
    const d = dir();
    appendEntry(d, entry('one', '2026-10-02T10:00:00.000Z'));
    appendEntry(d, entry('two', '2026-10-02T10:01:00.000Z'));
    expect(readFileSync(join(d, 'errors.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).message)).toEqual(['one', 'two']);
    clearLog(d);
    expect(readEntries(d)).toEqual([]);
  });

  it('skips broken lines', () => {
    const d = dir();
    appendEntry(d, entry('ok', '2026-10-02T10:00:00.000Z'));
    expect(readEntries(d)).toHaveLength(1);
  });
});

describe('groups', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');

  it('groups by message, newest first, with count, first and last', () => {
    const { groups } = groupEntries(
      [entry('a', '2026-10-02T09:00:00Z', 'rpc:a'), entry('b', '2026-10-02T10:00:00Z'), entry('a', '2026-10-02T11:00:00Z', 'job:a'), entry('a', '2026-10-02T10:30:00Z', 'rpc:a')],
      0,
      now,
    );
    expect(groups.map((g) => g.message)).toEqual(['a', 'b']);
    expect(groups[0]).toMatchObject({ count: 3, firstAt: '2026-10-02T09:00:00Z', lastAt: '2026-10-02T11:00:00Z', sources: ['rpc:a', 'job:a'] });
  });

  it('counts unseen messages from the last 24 h only', () => {
    const entries = [entry('old', '2026-09-30T10:00:00Z'), entry('seen', '2026-10-02T08:00:00Z'), entry('new', '2026-10-02T11:00:00Z')];
    const { unseen, groups } = groupEntries(entries, Date.parse('2026-10-02T09:00:00Z'), now);
    expect(unseen).toBe(1);
    expect(groups.find((g) => g.message === 'new')?.unseen).toBe(true);
    expect(groups.find((g) => g.message === 'seen')?.unseen).toBe(false);
    expect(groupEntries(entries, 0, now).unseen).toBe(2);
  });

  it('caps the number of groups', () => {
    const entries = Array.from({ length: 80 }, (_, i) => entry(`m${i}`, new Date(now - i * 1000).toISOString()));
    expect(groupEntries(entries, 0, now).groups).toHaveLength(50);
  });
});

describe('limiter', () => {
  it('drops the excess inside the window and recovers after it', () => {
    let t = 0;
    const allow = createLimiter(3, 1000, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    t = 1500;
    expect(allow()).toBe(true);
  });
});

describe('hints', () => {
  it.each([
    ['agent ended with error_max_turns', 'rpc:conflict:propose', 'agente parou antes de terminar'],
    ['connect ECONNREFUSED 10.1.1.1:443', 'job:radar', 'Sem rede ou VPN'],
    ['getaddrinfo ENOTFOUND git.example.test', 'rpc:cards:load', 'Sem rede ou VPN'],
    ['Sem conexão com git.example.test: ENOTFOUND', 'job:feedback', 'Sem rede ou VPN'],
    ['Request failed with status code 401: user not found (OpenRouter)', 'rpc:agent:reply', 'chave ou saldo da OpenRouter'],
    ['API Error: 402 Payment Required', 'rpc:deep:ask', 'chave ou saldo da OpenRouter'],
    ['glab: You are not logged in to git.example.test', 'job:status', 'acesso ao host de código foi recusado'],
    ['git.example.test recusou a credencial (HTTP 401). Confira o token ou refaça o login do CLI.', 'job:feedback', 'acesso ao host de código foi recusado'],
    ['spawn gh ENOENT', 'rpc:cards:load', 'CLI do host de código'],
    ['voice sidecar exited (code 1, signal none)', 'sidecar:voice', 'sidecar de voz caiu'],
  ])('%s', (message, source, hint) => {
    expect(errorHint(message, source)?.toLowerCase()).toContain(hint.toLowerCase());
  });

  it('is silent for unknown errors', () => {
    expect(errorHint('Cannot read properties of undefined', 'rpc:x')).toBeNull();
  });
});

describe('report', () => {
  it('lists the groups with count, source, hint and the top of the stack', () => {
    const { groups } = groupEntries([{ ...entry('agent ended with error_max_turns', '2026-10-02T10:00:00Z', 'rpc:conflict:propose'), stack: 'at a (x.ts:1:1)\nat b (y.ts:2:2)' }], 0, Date.parse('2026-10-02T12:00:00Z'));
    const text = errorReport({ groups, file: '/data/logs/errors.jsonl' });
    expect(text).toContain('1. agent ended with error_max_turns');
    expect(text).toContain('rpc:conflict:propose');
    expect(text).toContain('dica: O agente parou');
    expect(text).toContain('| at a (x.ts:1:1)');
    expect(text).toContain('/data/logs/errors.jsonl');
  });

  it('stays compact', () => {
    const { groups } = groupEntries(Array.from({ length: 30 }, (_, i) => ({ ...entry(`m${i}`, '2026-10-02T10:00:00Z'), stack: 'at a (x.ts:1:1)\n'.repeat(40) })), 0);
    expect(errorReport({ groups, file: 'f' }).length).toBeLessThanOrEqual(7100);
  });
});

describe('web policy', () => {
  it('lets the browser report renderer errors and nothing more', () => {
    expect(webAccess('log:renderer')).toBe('allow');
    expect(webAccess('errors:get')).toBe('allow');
  });
});
