// Two messages written to the persona while it answers: the second waits its turn (its line says so), is answered after the first with a bubble and a message of its own,
// and each answer names the message it answers. Through the mentions module, as the app runs it, with the real engine against a fake OpenAI server.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

import { type ActivityEntry, mentionJob } from '../src/shared/activity';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { agentThreadId } from '../src/shared/forum';
import type { LiveEvent } from '../src/shared/persona';
import { type Fake, fakeOpenAI, textStep } from './helpers/fakeOpenAI';

let home: string;
let fake: Fake;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-queue-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  let n = 0;
  fake = await fakeOpenAI(() => textStep(`Answer number ${++n} comes in a few pieces.`, { pieces: 4 }));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

describe('messages written while the persona answers', () => {
  it('are answered one after the other, each with its own line, bubble and message', async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const base = neutralConfig();
    saveConfig({ ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } });
    const { forumStore } = await import('../src/main/forum');
    const { ensureAgentThread } = await import('../src/main/forum-channels');
    const { activityLog } = await import('../src/main/activity');
    const { mentionsIdle, mentionsModule } = await import('../src/main/mentions/module');
    const { setLiveEmitter } = await import('../src/main/persona/runtime');
    const events: LiveEvent[] = [];
    const pushed: ActivityEntry[] = [];
    activityLog.setSink((e) => pushed.push(e));
    setLiveEmitter((e) => events.push(e));
    mentionsModule({ handle: () => undefined, notify: () => undefined, emit: () => undefined, job: () => undefined });

    const forum = forumStore();
    ensureAgentThread(forum, { id: 'me', name: 'Me' }, 'en');
    const thread = agentThreadId('me');
    const [first] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'first question' });
    const [second] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'second question' });
    await mentionsIdle();

    const messages = forum.read(thread, 0, 100)?.messages ?? [];
    const answers = messages.filter((m) => m.author.type === 'agent');
    expect(answers.map((m) => m.answersTo)).toEqual([first.seq, second.seq]);
    expect(answers.map((m) => m.text)).toEqual(['Answer number 1 comes in a few pieces.', 'Answer number 2 comes in a few pieces.']);
    // the second one was written before the first answer: it was the module's to hold back, in order
    expect(messages.map((m) => m.kind + ':' + (m.author.type === 'agent' ? 'agent' : m.author.type))).toEqual(['post:person', 'post:person', 'post:agent', 'post:agent']);

    // each answer had a line of its own, the second one first queued and then working
    const lines = pushed.filter((e) => e.jobId === mentionJob(thread) && e.call && e.kind === 'status');
    expect(lines.filter((e) => e.call?.message === second.seq).map((e) => e.state).slice(0, 2)).toEqual(['queued', 'started']);
    expect(lines.filter((e) => e.call?.message === first.seq).map((e) => e.state)[0]).toBe('started');

    // and a bubble of its own: the events of the first answer all come before those of the second, and each ends
    const forFirst = events.filter((e) => e.to === first.seq);
    const forSecond = events.filter((e) => e.to === second.seq);
    expect(forFirst.at(-1)?.end).toBe(true);
    expect(forSecond.at(-1)?.end).toBe(true);
    expect(events.indexOf(forFirst.at(-1) as LiveEvent)).toBeLessThan(events.indexOf(forSecond[0]));
  });
});
