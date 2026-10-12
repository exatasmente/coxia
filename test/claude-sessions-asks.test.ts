// The permission requests of a Claude Code session the app drives (#280): each waits for the person, allow or deny, from the window only; stopping the turn denies it.
import { describe, expect, it } from 'vitest';
import { createClaudeAsks } from '../src/main/claudeSessions/asks-core';
import type { PendingClaudePermission } from '../src/shared/claudeSessions';

const setup = () => {
  const lists: PendingClaudePermission[][] = [];
  const audits: [string, string, string][] = [];
  let n = 0;
  const asks = createClaudeAsks({ changed: (l) => void lists.push(l), audit: (a, d, through) => void audits.push([a.id, d, through]), newId: () => `p${++n}` });
  return { asks, lists, audits };
};
const input = { sessionId: 's-1', tool: 'Bash', input: '{"command":"ls"}' };

describe('the permission requests of a session', () => {
  it('waits as a pending item; allowing resolves allow and audits once', async () => {
    const { asks, lists, audits } = setup();
    const waiting = asks.ask(input);
    expect(asks.list()).toMatchObject([{ id: 'p1', tool: 'Bash', sessionId: 's-1' }]);
    expect(asks.answer('p1', 'allow', 'window')).toEqual({ ok: true });
    await expect(waiting).resolves.toEqual({ decision: 'allow', by: 'person' });
    expect(asks.list()).toEqual([]);
    expect(lists.at(-1)).toEqual([]);
    expect(audits).toEqual([['p1', 'allow', 'window']]);
    expect(asks.answer('p1', 'allow', 'window')).toEqual({ ok: false, reason: 'gone' });
  });

  it('denying resolves deny, so the session goes on without the tool', async () => {
    const { asks } = setup();
    const waiting = asks.ask(input);
    asks.answer('p1', 'deny', 'window');
    await expect(waiting).resolves.toEqual({ decision: 'deny', by: 'person' });
  });

  it.each(['paired', 'persona'] as const)('refuses an answer from %s and keeps waiting', async (through) => {
    const { asks, audits } = setup();
    void asks.ask(input);
    expect(asks.answer('p1', 'allow', through)).toEqual({ ok: false, reason: 'door' });
    expect(asks.list()).toHaveLength(1);
    expect(audits).toEqual([]);
  });

  it('refuses a decision that is not allow or deny', () => {
    const { asks } = setup();
    void asks.ask(input);
    expect(asks.answer('p1', 'always', 'window')).toEqual({ ok: false, reason: 'decision' });
  });

  it('denies, unaudited, when the turn is stopped or the process ends', async () => {
    const { asks, audits } = setup();
    const abort = new AbortController();
    const one = asks.ask(input, abort.signal);
    const two = asks.ask({ ...input, sessionId: 's-2' });
    abort.abort();
    await expect(one).resolves.toEqual({ decision: 'deny', by: 'abort' });
    asks.dropSession('s-2');
    await expect(two).resolves.toEqual({ decision: 'deny', by: 'abort' });
    expect(audits).toEqual([]);
  });
});
