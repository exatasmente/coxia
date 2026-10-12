// The direct actions of a schedule (#250), over a fake door: each action is one fixed operation of the persona's door with the arguments it names, a ceremony that is no longer on
// fails at the firing, and an answer that is a proposal waiting in Actions makes the schedule wait for it.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ForumMessage } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Schedule, ScheduleAction } from '../src/shared/schedules';
import { createDirectRunner, pendingActionOf } from '../src/main/schedules/direct';

const message = { thread: 'agent-me', seq: 4 } as ForumMessage;
const schedule = (action: ScheduleAction): Schedule => ({ id: 's-1', persona: 'me', action, prompt: '', missed: 'run', waiting: null }) as unknown as Schedule;

let calls: { tool: string; input: Record<string, unknown> }[];
let answer: string;
let on: string[];
const runner = () =>
  createDirectRunner({
    call: async (_s, m, tool, input) => {
      expect(m.seq).toBe(4);
      calls.push({ tool, input });
      return answer;
    },
    ceremonies: () => on,
  });

beforeEach(() => {
  setLanguage('en');
  calls = [];
  answer = 'Done: the run started.';
  on = ['retro'];
});

describe('a direct action', () => {
  it('starts a run through Runs.start with the ref and repo, and gives the reason of the schedule', async () => {
    expect(await runner().run(schedule({ kind: 'run', ref: '12', repo: 'web' }), message)).toEqual({ state: 'done', detail: '' });
    expect(calls).toEqual([{ tool: 'Runs', input: { op: 'start', ref: '12', repo: 'web', why: expect.stringContaining('s-1') } }]);
  });

  it('runs the retro through Ceremonies.retroPrepare, with its squad when it names one', async () => {
    await runner().run(schedule({ kind: 'ceremony', ceremony: 'retro', squad: 'platform' }), message);
    expect(calls[0]).toMatchObject({ tool: 'Ceremonies', input: { op: 'retroPrepare', squad: 'platform' } });
  });

  it('fails a ceremony that is no longer on, or one that cannot run from a schedule, without calling the door', async () => {
    on = [];
    await expect(runner().run(schedule({ kind: 'ceremony', ceremony: 'retro' }), message)).rejects.toThrow(/ceremony/i);
    on = ['retro', 'gate'];
    await expect(runner().run(schedule({ kind: 'ceremony', ceremony: 'gate' }), message)).rejects.toThrow(/ceremony/i);
    expect(calls).toEqual([]);
  });

  it('reaches no other operation: a persona or agent action is not its to take', async () => {
    await expect(runner().run(schedule({ kind: 'persona', prompt: 'x' }), message)).rejects.toThrow(/not a direct action/);
    await expect(runner().run(schedule({ kind: 'agent', agent: 'dev', prompt: 'x' }), message)).rejects.toThrow(/not a direct action/);
    expect(calls).toEqual([]);
  });

  it('waits when the door answers with a proposal pending in Actions', async () => {
    answer = JSON.stringify({ id: 'a-9', kind: 'comment', state: 'pending' });
    expect(await runner().run(schedule({ kind: 'run', ref: '12' }), message)).toEqual({ state: 'awaiting', actionId: 'a-9' });
    expect(pendingActionOf(JSON.stringify({ id: 'a-9', kind: 'comment', state: 'done' }))).toBeNull();
    expect(pendingActionOf('not json')).toBeNull();
  });

  it('passes the failure of the door on, for the firing to say', async () => {
    const failing = createDirectRunner({ call: () => Promise.reject(new Error('Runs.start refused: duplicate')), ceremonies: () => on });
    await expect(failing.run(schedule({ kind: 'run', ref: '12' }), message)).rejects.toThrow('duplicate');
  });
});
