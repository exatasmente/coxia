// The schedules as the persona and the person manage them (#275), through the persona's real door and the channels of the module: the persona makes one in its conversation, the
// person sees it and removes it and the persona no longer finds it; a turn a schedule started cannot make or change one, and the refusal is audited with the `schedule` door;
// the switch of the scheduler is the person's alone.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { agentThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Schedule, SchedulesView } from '../src/shared/schedules';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { EXCLUDED, findOp } = await import('../src/main/persona/doorTable');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { saveConfig } = await import('../src/main/workspaceConfig');
const { ToolError } = await import('../src/main/engine/open/tools/types');
const { ATAS } = await import('../src/main/env');

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const jobs: { name: string; everyMin: number; enabled?: () => boolean }[] = [];
const ctx = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: (j: (typeof jobs)[number]) => void jobs.push(j) };

const THREAD = agentThreadId('me');
const why = 'The person asked for a daily summary.';
const session = (door = 'window') => createSession({ persona: 'me', thread: THREAD, seq: 3, door });
const asPerson = async <T>(channel: string, ...args: unknown[]) => (await ipc.get(channel)?.(...args)) as T;
const listed = async (door = 'window'): Promise<Schedule[]> => {
  const text = await personaDoor.run(session(door), 'Conversations', { op: 'schedules' });
  return (JSON.parse(text) as SchedulesView).schedules;
};

beforeAll(async () => {
  setLanguage('en');
  const base = neutralConfig();
  saveConfig({ ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } });
  mkdirSync(join(ATAS, 'forum'), { recursive: true });
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  const { schedulesModule } = await import('../src/main/schedules/module');
  schedulesModule(ctx as never);
});

describe('the schedules of the persona and the person', () => {
  it('registers one job on the app clock, every minute, off until the person says yes', () => {
    expect(jobs.map((j) => [j.name, j.everyMin])).toEqual([['schedules', 1]]);
    expect(jobs[0].enabled?.()).toBe(false);
  });

  it('lets the persona make a schedule that answers in its own conversation, and the person sees it', async () => {
    const done = await personaDoor.run(session(), 'Conversations', { op: 'scheduleCreate', prompt: 'Summarise the day.', recurrence: { kind: 'daily', time: '18:00', days: [1, 2, 3, 4, 5] }, why });
    expect(done).toMatch(/^Done/);
    const [mine] = await listed();
    expect(mine).toMatchObject({ persona: 'me', prompt: 'Summarise the day.', thread: THREAD, createdBy: 'me', paused: false });
    const view = await asPerson<SchedulesView>('schedules:list');
    expect(view.schedules.map((s) => s.id)).toEqual([mine.id]);
    expect(view).toMatchObject({ enabled: false, asked: false });
    // The act is audited with the door the answer came by, and said in the conversation.
    expect(listAudit().find((e) => e.target === 'Conversations.scheduleCreate')).toMatchObject({ door: 'window', said: why });
  });

  it('removed by the person, the persona no longer finds it', async () => {
    const [mine] = await listed();
    expect(await asPerson('schedules:remove', mine.id)).toBe(true);
    expect(await listed()).toEqual([]);
  });

  it('marks a schedule the person makes as theirs, and the persona can change and remove it', async () => {
    const made = await asPerson<Schedule>('schedules:create', { prompt: 'Look at the board.', recurrence: { kind: 'every', minutes: 30 }, thread: THREAD });
    expect(made).toMatchObject({ createdBy: 'user' });
    await personaDoor.run(session(), 'Conversations', { op: 'scheduleUpdate', schedule: made.id, patch: { paused: true }, why });
    expect((await listed())[0]).toMatchObject({ paused: true, createdBy: 'user', updatedBy: 'me' });
    await personaDoor.run(session(), 'Conversations', { op: 'scheduleRemove', schedule: made.id, why });
    expect(await listed()).toEqual([]);
  });

  it('refuses a schedule from a turn a schedule started, and audits the refusal with the schedule door', async () => {
    const e = await personaDoor
      .run(session('schedule'), 'Conversations', { op: 'scheduleCreate', prompt: 'Wake me again.', recurrence: { kind: 'every', minutes: 1 }, why })
      .catch((x: Error) => x);
    expect(e).toBeInstanceOf(ToolError);
    expect((e as Error).message).toMatch(/cannot create or change schedules/);
    expect(await listed('schedule')).toEqual([]);
    const refused = listAudit().filter((x) => x.target === 'Conversations.scheduleCreate' && x.ok === false);
    expect(refused[0]).toMatchObject({ door: 'schedule' });
  });

  it('words what is wrong with a schedule for the persona', async () => {
    const e = await personaDoor.run(session(), 'Conversations', { op: 'scheduleCreate', prompt: 'x', recurrence: { kind: 'every', minutes: 0 }, why }).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/at least 1/);
  });

  it('keeps the switch of the scheduler out of the persona\'s reach; the person turns it on', async () => {
    expect(EXCLUDED['schedules:setEnabled']).toBe('scheduler');
    expect(findOp('Conversations', 'schedules')?.write).toBe(false);
    const view = await asPerson<SchedulesView>('schedules:setEnabled', true);
    expect(view).toMatchObject({ enabled: true, asked: true });
    expect(jobs[0].enabled?.()).toBe(true);
    await asPerson('schedules:setEnabled', false);
    expect(jobs[0].enabled?.()).toBe(false);
  });
});
