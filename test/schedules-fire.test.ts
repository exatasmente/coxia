// A schedule firing (#275), with a fake clock and a fake engine: the persona's turn starts from the schedule's line by the `schedule` door with no session kept from before, its
// answer lands in the conversation, a failure is said there and leaves the schedule as it was, one schedule never runs twice at once, the scheduler fires nothing while it is
// off, a paused schedule waits, and the firings missed while the app was closed become one late firing when it is turned on.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { type ForumStore, createForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { answerMentions } from '../src/main/mentions/answer';
import { placeOfThread } from '../src/main/mentions/place';
import { createFirer } from '../src/main/schedules/fire';
import { createScheduleService } from '../src/main/schedules/service';
import { type ScheduleStore, createScheduleStore } from '../src/main/schedules/store';
import { fakeEngine } from './helpers/runner';

const WORKDAYS = [0, 1, 2, 3, 4, 5, 6];
const THREAD = agentThreadId('me');
const at = (day: number, h: number, m = 0) => new Date(2026, 2, day, h, m);

let root: string;
let forum: ForumStore;
let store: ScheduleStore;
let now: Date;
let config: WorkspaceConfig;
let engine: ReturnType<typeof fakeEngine>;
let doors: string[];

/** The persona's answer to a schedule's line, as the mentions module gives it: the real answer, over the fake engine, with no session but the one the answer opens. */
const wake = async (message: ForumMessage, persona: string, door: string): Promise<void> => {
  doors.push(door);
  const place = placeOfThread(forum.summary(message.thread), () => null, config);
  if (!place) throw new Error('no place');
  await answerMentions(place, message, { forum, config: () => config, engine, env: () => ({ fallbackCwd: root }), calls: [persona], door });
};

function world(over: { wake?: typeof wake } = {}) {
  const firer = createFirer({ store, forum, wake: over.wake ?? wake, now: () => now, workdays: () => WORKDAYS });
  return { firer, service: createScheduleService({ store, firer, now: () => now }) };
}

const make = (over: Partial<Parameters<ScheduleStore['create']>[0]> = {}) =>
  store.create({ prompt: 'Summarise the board.', recurrence: { kind: 'every', minutes: 5 }, thread: THREAD, ...over }, 'user', { persona: 'me', hasThread: (id) => forum.summary(id) !== null, now }, WORKDAYS);
const messages = () => forum.read(THREAD, 0, 2000)?.messages ?? [];
const fired = () => messages().filter((m) => m.code === 'schedule.fired' || m.code === 'schedule.firedLate');

beforeEach(() => {
  setLanguage('en');
  root = mkdtempSync(join(tmpdir(), 'coxia-schedules-fire-'));
  forum = createForumStore(join(root, 'forum'));
  ensureAgentThread(forum, { id: 'me', name: 'Me' }, 'en');
  store = createScheduleStore(join(root, 'schedules.json'));
  const base = neutralConfig();
  config = { ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } };
  engine = fakeEngine();
  doors = [];
  now = at(2, 10);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a schedule firing', () => {
  it('wakes the persona at its time, with no session open, and its answer appears in the conversation', async () => {
    engine.script('me', () => 'Three cards moved today.');
    const s = make();
    const { service } = world();
    await service.setEnabled(true);
    expect(fired()).toHaveLength(0);

    now = at(2, 10, 5);
    await service.tick();
    const [line] = fired();
    expect(line).toMatchObject({ code: 'schedule.fired', text: 'Summarise the board.', author: { type: 'app' }, params: { schedule: s.id } });
    expect(doors).toEqual(['schedule']);
    // The turn is a fresh one: the prompt is the message, and nothing is resumed.
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0].resume).toBeUndefined();
    expect(JSON.stringify(engine.calls[0])).toContain('Summarise the board.');
    const answer = messages().find((m) => m.author.type === 'agent');
    expect(answer).toMatchObject({ author: { type: 'agent', id: 'me' }, text: 'Three cards moved today.', answersTo: line.seq });
    expect(store.get(s.id)).toMatchObject({ lastRun: at(2, 10, 5).toISOString(), nextRun: at(2, 10, 10).toISOString(), paused: false });
  });

  it('says a failed turn in the conversation and keeps the schedule active', async () => {
    engine.script('me', () => {
      throw new Error('the model is down');
    });
    const s = make();
    const { service } = world();
    await service.setEnabled(true);
    now = at(2, 10, 5);
    await service.tick();
    expect(messages().find((m) => m.code === 'runner.mentionFailed')?.params).toMatchObject({ agent: 'me' });
    expect(store.get(s.id)).toMatchObject({ paused: false, nextRun: at(2, 10, 10).toISOString() });
  });

  it('says it when the answer cannot even begin', async () => {
    const s = make();
    const { service } = world({ wake: () => Promise.reject(new Error('no persona here')) });
    await service.setEnabled(true);
    now = at(2, 10, 5);
    await service.tick();
    expect(messages().find((m) => m.code === 'runner.mentionFailed')?.params).toMatchObject({ agent: 'me', reason: 'no persona here' });
    expect(store.get(s.id)?.paused).toBe(false);
  });

  it('never runs the same schedule twice at once', async () => {
    let finish: () => void = () => undefined;
    const slow = (): Promise<void> => new Promise((resolve) => (finish = resolve));
    const s = make({ recurrence: { kind: 'every', minutes: 1 } });
    const { firer } = world({ wake: slow });
    now = at(2, 10, 1);
    const first = firer.fire(store.get(s.id)!, { late: false });
    expect(firer.running(s.id)).toBe(true);
    expect(await firer.fire(store.get(s.id)!, { late: false })).toBe('busy');
    finish();
    expect(await first).toBe('fired');
    expect(fired()).toHaveLength(1);
  });

  it('skips a schedule whose conversation is gone and marks it, without pausing or removing it', async () => {
    const s = make();
    const { firer } = world();
    expect(await firer.fire({ ...store.get(s.id)!, thread: 'general-gone' }, { late: false })).toBe('skipped');
    expect(store.get(s.id)).toMatchObject({ lastError: 'thread', paused: false });
  });
});

describe('the scheduler of the app', () => {
  it('fires nothing while it is off, even past the time', async () => {
    engine.script('me', () => 'ok');
    make();
    const { service } = world();
    now = at(2, 12);
    await service.tick();
    expect(fired()).toHaveLength(0);
    expect(service.enabled()).toBe(false);
    expect(service.hasActive()).toBe(true);
  });

  it('leaves a paused schedule alone and fires it again once it is resumed', async () => {
    engine.script('me', () => 'ok');
    const s = make();
    store.update(s.id, { paused: true }, 'user', { persona: 'me', hasThread: () => true, now }, WORKDAYS);
    const { service } = world();
    await service.setEnabled(true);
    now = at(2, 10, 30);
    await service.tick();
    expect(fired()).toHaveLength(0);
    expect(service.hasActive()).toBe(false);

    store.update(s.id, { paused: false }, 'user', { persona: 'me', hasThread: () => true, now }, WORKDAYS);
    now = at(2, 10, 35);
    await service.tick();
    expect(fired()).toHaveLength(1);
  });

  it('turned on after the app was closed, fires each missed schedule once, marked late, and counts the next from now', async () => {
    engine.script('me', () => 'ok');
    const s = make();
    // The app was closed from 10:00 to 13:00: thirty-six firings were missed.
    now = at(2, 13);
    const { service } = world();
    expect(service.view()).toMatchObject({ enabled: false, asked: false });
    await service.setEnabled(true);
    expect(service.view()).toMatchObject({ enabled: true, asked: true });
    expect(fired().map((m) => m.code)).toEqual(['schedule.firedLate']);
    expect(store.get(s.id)?.nextRun).toBe(at(2, 13, 5).toISOString());
    await service.tick();
    expect(fired()).toHaveLength(1);
  });

  it('answered no, stays off', async () => {
    make();
    const { service } = world();
    now = at(2, 13);
    await service.setEnabled(false);
    expect(service.view()).toMatchObject({ enabled: false, asked: true });
    expect(fired()).toHaveLength(0);
  });
});
