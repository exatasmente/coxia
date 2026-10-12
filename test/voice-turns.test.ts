// Which sentences of the persona's answers are spoken: only the turns this device sent by voice, the first sentence before the answer is complete, each sentence once,
// and an answer stopped, failed or never given closes its turn.
import { describe, expect, it } from 'vitest';
import type { ForumMessage } from '../src/shared/forum';
import type { LiveAnswer } from '../src/shared/persona';
import { createTurnTracker } from '../src/renderer/src/voice/voiceTurns';

const live = (to: number, text: string): LiveAnswer => ({ thread: 'agent-persona', to, agent: 'persona', rev: 1, text });
const answer = (to: number, text: string, params?: Record<string, unknown>): ForumMessage =>
  ({ v: 1, type: 'message', seq: to + 1, thread: 'agent-persona', author: { type: 'agent', id: 'persona' }, text, answersTo: to, params, published: null }) as unknown as ForumMessage;

describe('createTurnTracker', () => {
  it('speaks the first sentence before the answer is complete', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    const [u] = tr.feed([live(5, 'First one. Second')], [], 1);
    expect(u).toMatchObject({ to: 5, speak: ['First one.'], started: true, done: false });
    const [end] = tr.feed([], [answer(5, 'First one. Second one.')], 2);
    expect(end).toMatchObject({ speak: ['Second one.'], done: true, interrupted: false });
    expect(tr.open()).toEqual([]);
  });

  it('ignores the turns it was not told about (another device sent them, or they were typed)', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    expect(tr.feed([live(9, 'Not mine. At all')], [answer(9, 'Not mine.')], 1)).toEqual([]);
  });

  it('speaks a stored answer whole when no live text came first', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    const [u] = tr.feed([], [answer(5, 'One. Two')], 1);
    expect(u).toMatchObject({ speak: ['One.', 'Two'], started: true, done: true });
  });

  it('never speaks a sentence twice across live updates and the stored answer', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    const said: string[] = [];
    for (const text of ['Hi. ', 'Hi. There ', 'Hi. There is more. ']) for (const u of tr.feed([live(5, text)], [], 1)) said.push(...u.speak);
    for (const u of tr.feed([], [answer(5, 'Hi. There is more. Bye.')], 2)) said.push(...u.speak);
    expect(said).toEqual(['Hi.', 'There is more.', 'Bye.']);
  });

  it('reads a rewritten live text again, skipping what was already said', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    tr.feed([live(5, 'Alpha. Beta. ')], [], 1);
    const [u] = tr.feed([live(5, 'Alpha. Gamma. ')], [], 2);
    expect(u.speak).toEqual(['Gamma.']);
  });

  it('closes an interrupted answer without speaking it', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    const [u] = tr.feed([], [answer(5, 'Cut short. Here', { interrupted: 'stop' })], 1);
    expect(u).toMatchObject({ speak: [], done: true, interrupted: true });
  });

  it('closes a turn whose live answer vanished without a stored one, and one never answered', () => {
    const tr = createTurnTracker({ vanishedMs: 100, silentMs: 1000 });
    tr.mark(5, 0);
    tr.mark(7, 0);
    tr.feed([live(5, 'Starting')], [], 10);
    expect(tr.feed([], [], 20)).toEqual([]);
    expect(tr.feed([], [], 130)).toEqual([expect.objectContaining({ to: 5, done: true })]);
    expect(tr.open()).toEqual([7]);
    expect(tr.feed([], [], 1000)).toEqual([expect.objectContaining({ to: 7, done: true, started: false })]);
  });

  it('forgets every turn on clear', () => {
    const tr = createTurnTracker();
    tr.mark(5, 0);
    tr.clear();
    expect(tr.feed([live(5, 'Hello. World')], [], 1)).toEqual([]);
  });
});
