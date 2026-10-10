import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import { agentThreadId, type ThreadSummary } from '../src/shared/forum';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const CHANNELS = ['forum:list', 'forum:read', 'forum:post', 'forum:create', 'forum:attachment-put', 'forum:attachment-post', 'forum:attachment-drop', 'forum:attachment-get', 'forum:attachment-delete'];

describe('web policy for the forum', () => {
  it('lets a paired browser list, read, post, open a general thread and send the files of a message: they only touch the workspace\'s own files', () => {
    for (const channel of CHANNELS) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
    }
  });

  it('puts none of them behind the desktop window or the external-effects switch: nothing in them reaches the code host', () => {
    for (const channel of CHANNELS) {
      expect(DESKTOP_ONLY.has(channel)).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
    }
  });

  it('are exactly the channels the module serves', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/main/forum.ts'), 'utf8');
    const served = [...src.matchAll(/ctx\.handle\('(forum:[\w-]+)'/g)].map((m) => m[1]);
    expect(served.sort()).toEqual([...CHANNELS].sort());
  });

  it('the module imports nothing that writes to a code host or runs an agent', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/main/forum.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/(actions|agents|vcs)/);
  });
});

describe('the conversation of a draft agent', () => {
  type Channels = Record<string, (...args: unknown[]) => unknown>;
  /** The module's channels, driven as the app drives them, on the throwaway data folder of this file. */
  async function serve(): Promise<Channels> {
    const { forumModule } = await import('../src/main/forum');
    const out: Channels = {};
    forumModule({ handle: (channel: string, fn: (...args: never[]) => unknown) => (out[channel] = fn as unknown as (...args: unknown[]) => unknown), notify: () => undefined, emit: () => undefined, job: () => undefined } as unknown as import('../src/main/module').ModuleContext);
    return out;
  }
  const team = async (): Promise<void> => {
    const { updateConfig } = await import('../src/main/workspaceConfig');
    updateConfig((c) => ({ ...c, agents: { ...c.agents, team: [...c.agents.team.filter((a) => a.id !== 'helper' && a.id !== 'trial'), newAgent({ id: 'helper' }), newAgent({ id: 'trial', draft: true })] } }));
  };

  it('is neither made nor listed by forum:list, while every agent of the team keeps its own', async () => {
    await team();
    const channels = await serve();
    const ids = (channels['forum:list']() as ThreadSummary[]).map((t) => t.id);
    expect(ids).toContain(agentThreadId('helper'));
    expect(ids).toContain(agentThreadId('turn'));
    expect(ids).not.toContain(agentThreadId('trial'));
    // The assistant makes the conversation of the test: it stays out of the list, and is read by its id as any other.
    const { forumStore } = await import('../src/main/forum');
    const { ensureAgentThread } = await import('../src/main/forum-channels');
    ensureAgentThread(forumStore(), { id: 'trial', name: 'Trial' }, 'en');
    expect((channels['forum:list']() as ThreadSummary[]).map((t) => t.id)).not.toContain(agentThreadId('trial'));
    expect(channels['forum:read'](agentThreadId('trial'))).toMatchObject({ thread: { kind: 'agent', agent: 'trial' } });
  });

  it('is an unknown @name anywhere but in its own conversation', async () => {
    await team();
    const channels = await serve();
    const { forumStore } = await import('../src/main/forum');
    const { ensureAgentThread } = await import('../src/main/forum-channels');
    ensureAgentThread(forumStore(), { id: 'trial', name: 'Trial' }, 'en');
    channels['forum:list']();
    const elsewhere = channels['forum:post'](agentThreadId('helper'), '@trial are you there?') as { mentions: string[] };
    expect(elsewhere.mentions).toEqual([]);
    const lines = (thread: string) => (forumStore().read(thread, 0, 100)?.messages ?? []).filter((m) => m.code === 'main.forum.mentions.unknown');
    expect(lines(agentThreadId('helper'))).toHaveLength(1);
    const inside = channels['forum:post'](agentThreadId('trial'), '@trial are you there?') as { mentions: string[] };
    expect(inside.mentions).toEqual(['trial']);
    expect(lines(agentThreadId('trial'))).toHaveLength(0);
    // an agent of the team is addressed as ever
    expect((channels['forum:post'](agentThreadId('helper'), '@turn hello') as { mentions: string[] }).mentions).toEqual(['turn']);
  });

  it('leaves the channels open to a paired browser: the draft changes what they answer, not who may ask', () => {
    for (const channel of CHANNELS) expect(webAccess(channel), channel).toBe('allow');
  });
});
