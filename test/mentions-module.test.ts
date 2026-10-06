// A person's `@agent` outside a run's thread reaches an agent only because the mentions module is registered and its subscription is made: the list of modules
// the app registers is what decides whether that happens at all. A module that is written and imported but missing from that list never runs.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module list pulls in every feature module, and the app's build info reads Electron at load. This file gives Electron what it needs before the list is
// read (the suite's own stub carries no version); the modules themselves read only what they are handed.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { MODULES, moduleList } = await import('../src/main/modules');
const { callsOf, mentionsIdle, mentionsModule } = await import('../src/main/mentions/module');
const { forumStore } = await import('../src/main/forum');
const { activityLog } = await import('../src/main/activity');
const { mentionJob } = await import('../src/shared/activity');
type ModuleContext = import('../src/main/module').ModuleContext;

const realData = process.env.CERIMONIAS_DATA_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-mentions-module-'));
  // The module resolves the workspace's own stores at import; a test points them at a throwaway folder before that happens.
  process.env.CERIMONIAS_DATA_DIR = dir;
});

afterEach(() => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  rmSync(dir, { recursive: true, force: true });
});

/** The context the app hands a module; the module under test registers nothing, it answers from the forum subscription. */
const appContext = (): { ctx: ModuleContext; handles: string[] } => {
  const handles: string[] = [];
  return {
    handles,
    ctx: {
      handle: (channel) => void handles.push(channel),
      notify: () => undefined,
      emit: () => undefined,
      job: () => undefined,
    },
  };
};

describe('the list of modules the app registers', () => {
  it('holds the mentions module: a module written but missing here is never registered and never answers', () => {
    expect(moduleList()).toContain(mentionsModule);
    expect(MODULES).toContain(mentionsModule);
  });
});

describe('the names a message calls', () => {
  it('are the mentions of a person post', () => {
    expect(callsOf({ thread: 'squads', kind: 'post', author: { type: 'person' }, mentions: ['turn'] } as never)).toEqual(['turn']);
  });

  it('are none for what an agent wrote, so an answer never calls another agent', () => {
    expect(callsOf({ thread: 'squads', kind: 'post', author: { type: 'agent', id: 'turn' }, mentions: ['reply'] } as never)).toEqual([]);
  });
});

describe('the registration', () => {
  it('is what makes the subscription: a channel post reaches the answer of the named agent', async () => {
    const { ctx, handles } = appContext();
    mentionsModule(ctx);
    expect(handles).toEqual([]);
    // The registration subscribes to the forum: what the app writes to a channel reaches the module only if this ran.
    forumStore().ensureThread({ id: 'squads', kind: 'channel', squad: null, title: 'Squads' });
    forumStore().append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn hi', mentions: ['turn'] });
    await mentionsIdle();
  });

  it('opens the line of each call under the conversation as soon as the message is accepted, as a run\'s thread does', async () => {
    const { ctx } = appContext();
    mentionsModule(ctx);
    forumStore().ensureThread({ id: 'squads', kind: 'channel', squad: null, title: 'Squads' });
    const [m] = forumStore().append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn @reply hi', mentions: ['turn', 'reply'] });
    // The conversation reads its calls from its own job: one line per agent named, tied to the message, the second waiting its turn.
    const lines = activityLog.get(mentionJob('squads')).filter((e) => e.call?.message === m.seq);
    expect([...new Set(lines.map((e) => e.call?.agent))]).toEqual(['turn', 'reply']);
    expect(lines.find((e) => e.call?.agent === 'reply' && e.kind === 'status')?.state).toBe('queued');
    await mentionsIdle();
  });

  it('opens no channel of its own, and the module folder is the workspace one', () => {
    expect(existsSync(join(dir, 'sandbox'))).toBe(false);
    mkdirSync(join(dir, 'forum'), { recursive: true });
    expect(existsSync(join(dir, 'forum'))).toBe(true);
  });
});
