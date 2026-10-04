// The line a caller opened for an `@` call when the message was accepted (a run's thread) goes on in the answer: the engine runs under it, a call that waited
// its turn says it started when it really begins, and every agent named is released when its call is over, so the next call of the run may begin.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { RunActivity } from '../src/main/activity';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions } from '../src/main/mentions/answer';
import type { MentionPlace } from '../src/main/mentions/place';
import { fakeEngine } from './helpers/runner';

let root: string;
let forum: ForumStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-mention-line-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const config = () => {
  const c = neutralConfig();
  c.language = 'en';
  return c;
};

const place: MentionPlace = { thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' };

function line(id: string): RunActivity & { states: string[] } {
  const states: string[] = [];
  return { id, states, tool: () => undefined, text: () => undefined, blocked: () => undefined, status: (s) => void states.push(s) };
}

describe('the call line of a mention', () => {
  it('runs the engine under the line the caller opened, and a call that waited says it started', async () => {
    const engine = fakeEngine();
    const order: string[] = [];
    engine.script('turn', () => {
      order.push('engine');
      return { text: 'Here.' };
    });
    const made = line('line-1');
    const released: string[] = [];
    const [m] = forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn @nobody look', mentions: ['nobody', 'turn'] });
    await answerMentions(place, m, {
      forum,
      config,
      engine,
      env: () => ({ fallbackCwd: root }),
      callOf: (id) => (id === 'turn' ? { activity: made, queued: true } : null),
      release: (id) => {
        order.push(`release:${id}`);
        released.push(id);
      },
    });
    expect(engine.calls[0].activity).toBe(made);
    expect(made.states).toEqual(['started']);
    // The agent that is not of the team is let go at once; the one that answered, after its answer.
    expect(order).toEqual(['release:nobody', 'engine', 'release:turn']);
    expect(released).toEqual(['nobody', 'turn']);
  });

  it('releases the call when the engine fails, and leaves the end to the engine', async () => {
    const engine = fakeEngine();
    engine.script('turn', () => {
      throw new Error('model unavailable');
    });
    const made = line('line-2');
    const released: string[] = [];
    const [m] = forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn look', mentions: ['turn'] });
    await answerMentions(place, m, { forum, config, engine, env: () => ({ fallbackCwd: root }), callOf: () => ({ activity: made, queued: false }), release: (id) => released.push(id) });
    expect(made.states).toEqual([]);
    expect(released).toEqual(['turn']);
    expect(forum.read('squads', 0, 50)?.messages.some((x) => x.code === 'runner.mentionFailed')).toBe(true);
  });
});
