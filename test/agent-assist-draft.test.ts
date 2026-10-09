// The draft agent the assistant saves so a person can try it in a conversation: made by the main process, inert by construction whatever the screen sends, with the
// permissions held to what exists, its direct conversation made fresh, and cleaned up by "conclude" and "discard", which touch nothing that is not a draft.
import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIST_LIMITS } from '../src/shared/agentAssist';
import { neutralConfig } from '../src/shared/config';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { settingsOf } from '../src/main/agentAssist-core';
import { LLM_ROLES, type AgentDef, type WorkspaceConfig } from '../src/shared/config/types';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { agentThreadId } from '../src/shared/forum';

vi.setConfig({ testTimeout: 30_000 });

const { getConfig, reloadConfig, saveConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { sandbox } = await import('../src/main/sandbox/workspace');
const { forumStore, forumModule } = await import('../src/main/forum');
const { attachmentStore } = await import('../src/main/attachments');
const { ATAS } = await import('../src/main/env');
const assist = await import('../src/main/agentAssist');
const actions = await import('../src/main/actions');

let sandboxWorks = true;
vi.spyOn(sandbox, 'status').mockImplementation(async () => ({ available: sandboxWorks }) as never);

const team = (): AgentDef[] => getConfig().agents.team;
const agent = (id: string): AgentDef | undefined => team().find((a) => a.id === id);
const threadOf = (id: string) => forumStore().summary(agentThreadId(id));
const messages = (id: string) => forumStore().read(agentThreadId(id), 0, 2000)?.messages ?? [];

/** The engineering cycle, and an agent of the person that has everything a copy must take from it and a model must never hand out: a model of its own, commands allowed, a host. */
function useConfig(over: (c: WorkspaceConfig) => void = () => undefined): void {
  const c = applyTemplate(neutralConfig(), agentFlowEngineering);
  c.language = 'en';
  c.agents.team.push(
    newAgent({
      id: 'writer',
      name: 'Writer',
      job: 'Writes the docs.',
      instructions: 'You write the docs.',
      model: { role: null, provider: 'openai', model: 'a-model' },
      permission: 'worktree',
      tracker: 'read',
      shell: 'host',
      allowedCommands: ['git status:*'],
      autonomous: true,
    }),
  );
  c.llm.providers.push(newProvider({ id: 'openai', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }));
  over(c);
  saveConfig(c);
}

/** What the screen sends to be saved: the texts and the settings it holds. */
const body = (over: Record<string, unknown> = {}) => ({
  draft: { name: 'Release notes', job: 'Writes release notes.', instructions: 'You write release notes from merged changes.' },
  settings: { permission: 'read', tracker: 'none', shell: 'none', tools: null, stages: [], squad: null, turnsTo: null },
  ...over,
});

beforeEach(() => {
  sandboxWorks = true;
  // Each test begins with no draft, and no conversation either: an old one would take an id away from the next test, which is what the app does on purpose.
  for (const s of forumStore().list()) {
    attachmentStore().dropThread(s.id);
    forumStore().deleteThread(s.id);
  }
  useConfig();
});

describe('saving the draft', () => {
  it('makes an agent that takes no part in the cycle, whatever the screen sends', async () => {
    const hostile = body({
      id: 'writer',
      stages: ['implement'],
      autonomous: true,
      turnsTo: 'qa',
      squad: 'payments',
      system: true,
      isDraft: false,
      model: { role: null, provider: 'x', model: 'y' },
      allowedCommands: ['rm:*'],
      settings: { permission: 'read', tracker: 'none', shell: 'none', tools: null, stages: ['implement', 'review'], squad: 'payments', turnsTo: 'qa', autonomous: true, allowedCommands: ['rm:*'], model: { role: null, provider: 'x', model: 'y' }, id: 'deep' },
    });
    delete (hostile as { id?: string }).id;
    const { id } = await assist.saveAssistDraft(hostile);
    const made = agent(id) as AgentDef;
    expect(made).toMatchObject({ stages: [], autonomous: false, turnsTo: null, draft: true, system: false, name: 'Release notes', job: 'Writes release notes.' });
    expect(made.squad ?? null).toBeNull();
    expect(made.allowedCommands).toBeUndefined();
    expect(made.model).toEqual({ role: 'deep', provider: '', model: '' });
    // The one agent of the team that is not the draft, or a system agent, is untouched.
    expect(agent('writer')).toMatchObject({ autonomous: true, allowedCommands: ['git status:*'], model: { role: null, provider: 'openai', model: 'a-model' } });
  });

  it('holds the permissions to what exists: no host, no sandbox where there is none, no allowlist for a reader', async () => {
    sandboxWorks = false;
    const wild = await assist.saveAssistDraft(body({ settings: { permission: 'read', tracker: 'read', shell: 'host' } }));
    expect(agent(wild.id)).toMatchObject({ permission: 'read', tracker: 'read', shell: 'none' });
    const noSandbox = await assist.saveAssistDraft(body({ draft: { name: 'Second', job: '', instructions: '' }, settings: { shell: 'sandbox' } }));
    expect(agent(noSandbox.id)?.shell).toBe('none');
    const reader = await assist.saveAssistDraft(body({ draft: { name: 'Third', job: '', instructions: '' }, settings: { permission: 'read', shell: 'allowlist' } }));
    expect(agent(reader.id)?.shell).toBe('none');
    sandboxWorks = true;
    const fine = await assist.saveAssistDraft(body({ draft: { name: 'Fourth', job: '', instructions: '' }, settings: { permission: 'worktree', tracker: 'read', shell: 'sandbox' } }));
    expect(agent(fine.id)).toMatchObject({ permission: 'worktree', tracker: 'read', shell: 'sandbox' });
    const writer = await assist.saveAssistDraft(body({ draft: { name: 'Fifth', job: '', instructions: '' }, settings: { permission: 'worktree', shell: 'allowlist' } }));
    expect(agent(writer.id)).toMatchObject({ permission: 'worktree', shell: 'allowlist' });
  });

  it('keeps the tools the screen holds for the draft, and takes the tracker tools from the workspace', async () => {
    const own = { ...getConfig().agents.tools, files: false, subagents: true, trackerMcp: true, trackerMcpServer: 'evil' };
    const { id } = await assist.saveAssistDraft(body({ settings: { tools: own } }));
    expect(agent(id)?.tools).toEqual({ ...getConfig().agents.tools, files: false, subagents: true });
  });

  it('cuts the texts to the limits of the editor and gives a name when the model brought none', async () => {
    const long = await assist.saveAssistDraft(body({ draft: { name: 'N'.repeat(200), job: 'J'.repeat(3000), instructions: 'I'.repeat(9000) } }));
    expect(agent(long.id)).toMatchObject({ name: 'N'.repeat(ASSIST_LIMITS.name), job: 'J'.repeat(ASSIST_LIMITS.job), instructions: 'I'.repeat(ASSIST_LIMITS.instructions) });
    const unnamed = await assist.saveAssistDraft(body({ draft: { name: '  ', job: 'Does something.', instructions: 'Do it.' } }));
    expect(agent(unnamed.id)?.name).toBe('Agent draft');
    // The config is valid with all of them in it: a name that was generated never makes the save fail.
    expect(() => saveConfig(getConfig())).not.toThrow();
  });

  it('reads anything that is not an object as an empty draft with the minimum permissions', async () => {
    for (const raw of [undefined, null, 'agent', 4, []]) {
      const { id } = await assist.saveAssistDraft(raw);
      expect(agent(id)).toMatchObject({ draft: true, name: 'Agent draft', permission: 'read', tracker: 'none', shell: 'none', stages: [], autonomous: false });
    }
  });

  it('takes the id from the name, free of the team, of the ids the app keeps and of every direct conversation there is', async () => {
    const first = await assist.saveAssistDraft(body({ draft: { name: 'Release Notes', job: '', instructions: '' } }));
    expect(first.id).toBe('release-notes');
    const second = await assist.saveAssistDraft(body({ draft: { name: 'Release Notes', job: '', instructions: '' } }));
    expect(second.id).toBe('release-notes-2');
    // An id the app keeps for a system agent, and the id of an agent of the team.
    expect((await assist.saveAssistDraft(body({ draft: { name: 'Deep', job: '', instructions: '' } }))).id).toBe('deep-2');
    expect((await assist.saveAssistDraft(body({ draft: { name: 'Writer', job: '', instructions: '' } }))).id).toBe('writer-2');
    for (const role of LLM_ROLES) expect(team().filter((a) => a.id === role)).toHaveLength(1);
  });

  it('takes an id no old conversation uses: the conversation of a draft always begins empty', async () => {
    // What removing an agent leaves behind: its conversation, with the history of the person.
    forumStore().ensureThread({ id: agentThreadId('ghost'), kind: 'agent', squad: 'ghost', title: 'Chat with Ghost' });
    forumStore().append(agentThreadId('ghost'), { kind: 'post', author: { type: 'person' }, text: 'an old talk' });
    const { id } = await assist.saveAssistDraft(body({ draft: { name: 'Ghost', job: '', instructions: '' } }));
    expect(id).toBe('ghost-2');
    expect(messages('ghost-2')).toEqual([]);
    expect(messages('ghost').map((m) => m.text)).toEqual(['an old talk']);
  });

  it('makes the direct conversation of the draft, empty, and keeps it out of the list of the forum', async () => {
    const { id } = await assist.saveAssistDraft(body());
    expect(threadOf(id)).toMatchObject({ kind: 'agent', title: expect.stringContaining('Release notes') });
    expect(messages(id)).toEqual([]);

    const handlers = new Map<string, (...args: never[]) => unknown>();
    forumModule({ handle: (channel, fn) => void handlers.set(channel, fn), notify: () => undefined, emit: () => undefined, job: () => undefined });
    const listed = (handlers.get('forum:list') as () => { id: string }[])().map((s) => s.id);
    expect(listed).toContain(agentThreadId('writer'));
    expect(listed).not.toContain(agentThreadId(id));
    // The conversation is still there for the assistant to open.
    expect(threadOf(id)).not.toBeNull();
  });

  it('refuses to overwrite an agent that is not a draft, and leaves it as it was', async () => {
    const writer = JSON.stringify(agent('writer'));
    for (const id of ['writer', 'turn', 'deep']) {
      await expect(assist.saveAssistDraft(body({ id })), id).rejects.toThrow(/is not a draft/);
    }
    expect(JSON.stringify(agent('writer'))).toBe(writer);
    expect(team().filter((a) => a.id === 'turn')).toHaveLength(1);
  });

  it('makes a new draft, with an id of its own, for an id nobody has', async () => {
    const { id } = await assist.saveAssistDraft(body({ id: 'vanished' }));
    expect(id).toBe('release-notes');
    expect(agent('vanished')).toBeUndefined();
  });

  describe('updating a draft', () => {
    it('changes it in place and begins its conversation over, files included', async () => {
      const { id } = await assist.saveAssistDraft(body());
      const position = team().findIndex((a) => a.id === id);
      forumStore().append(agentThreadId(id), { kind: 'post', author: { type: 'person' }, text: 'a test with the old instructions' });
      attachmentStore().put(agentThreadId(id), 'note.txt', new TextEncoder().encode('an attachment of the test'));
      expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(true);

      const again = await assist.saveAssistDraft(body({ id, draft: { name: 'Release notes v2', job: 'New job.', instructions: 'New instructions.' }, settings: { tracker: 'read' } }));
      expect(again.id).toBe(id);
      expect(team().filter((a) => a.id === id)).toHaveLength(1);
      expect(team().findIndex((a) => a.id === id)).toBe(position);
      expect(agent(id)).toMatchObject({ name: 'Release notes v2', job: 'New job.', instructions: 'New instructions.', tracker: 'read', draft: true, stages: [], autonomous: false });
      expect(messages(id)).toEqual([]);
      expect(threadOf(id)?.kind).toBe('agent');
      expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(false);
    });
  });

  describe('when adjusting an agent', () => {
    it('saves a copy named after the original, with its model and always-allowed commands from the stored config, and leaves the original alone', async () => {
      const before = JSON.stringify(agent('writer'));
      const { id } = await assist.saveAssistDraft(
        body({
          from: 'writer',
          model: { role: null, provider: 'x', model: 'y' },
          allowedCommands: ['rm:*'],
          settings: { permission: 'worktree', tracker: 'read', shell: 'host', stages: ['implement'], squad: 'payments', turnsTo: 'qa' },
        }),
      );
      expect(id).toBe('writer-draft');
      expect(agent(id)).toMatchObject({ draft: true, stages: [], autonomous: false, turnsTo: null, name: 'Release notes', permission: 'worktree', tracker: 'read', model: { role: null, provider: 'openai', model: 'a-model' }, allowedCommands: ['git status:*'] });
      expect(agent(id)?.squad ?? null).toBeNull();
      expect(JSON.stringify(agent('writer'))).toBe(before);
      expect(threadOf(id)?.kind).toBe('agent');
    });

    it('never carries the screen, the hosts or the logged-in browser: not from the original, not from what the screen sends', async () => {
      useConfig((c) => {
        Object.assign(c.agents.team.find((a) => a.id === 'writer')!, { screen: true, allowedHosts: ['example.com'], browserProfile: true });
      });
      expect(settingsOf(agent('writer')!)).not.toHaveProperty('screen');
      const hostile = { screen: true, allowedHosts: ['example.net'], browserProfile: true };
      const { id } = await assist.saveAssistDraft(body({ from: 'writer', ...hostile, draft: { name: 'Copy', job: '', instructions: '' }, settings: { permission: 'worktree', tracker: 'read', shell: 'none', ...hostile } }));
      const copy = agent(id)!;
      expect(copy.screen).toBeUndefined();
      expect(copy.allowedHosts).toBeUndefined();
      expect(copy.browserProfile).toBeUndefined();
      const fresh = await assist.saveAssistDraft(body({ ...hostile, settings: { ...body().settings, ...hostile } }));
      expect(agent(fresh.id)).not.toHaveProperty('screen');
      // Saving over the same draft does not bring them either, and the original keeps what the person gave it.
      const again = await assist.saveAssistDraft(body({ id, ...hostile }));
      expect(agent(again.id)?.screen).toBeUndefined();
      expect(agent('writer')).toMatchObject({ screen: true, allowedHosts: ['example.com'], browserProfile: true });
    });

    it('keeps the host the original has when the copy still says it, and never gives it otherwise', async () => {
      const same = await assist.saveAssistDraft(body({ from: 'writer', settings: { permission: 'worktree', tracker: 'read', shell: 'host' } }));
      expect(agent(same.id)?.shell).toBe('host');
      const lowered = await assist.saveAssistDraft(body({ from: 'writer', settings: { permission: 'worktree', tracker: 'read', shell: 'none' } }));
      expect(agent(lowered.id)?.shell).toBe('none');
      // An agent that never had it cannot be given it by a copy.
      useConfig((c) => {
        c.agents.team.find((a) => a.id === 'writer')!.shell = 'none';
      });
      const claimed = await assist.saveAssistDraft(body({ from: 'writer', settings: { permission: 'worktree', tracker: 'read', shell: 'host' } }));
      expect(agent(claimed.id)?.shell).toBe('none');
    });

    it('takes a second id when the first copy is still there', async () => {
      expect((await assist.saveAssistDraft(body({ from: 'writer' }))).id).toBe('writer-draft');
      expect((await assist.saveAssistDraft(body({ from: 'writer' }))).id).toBe('writer-draft-2');
    });

    it.each([
      ['an id nobody has', 'nobody'],
      ['a system agent', 'turn'],
    ])('refuses to copy %s', async (_what, from) => {
      await expect(assist.saveAssistDraft(body({ from }))).rejects.toThrow(/agent to adjust was not found/);
    });

    it('refuses to copy a draft', async () => {
      const { id } = await assist.saveAssistDraft(body());
      await expect(assist.saveAssistDraft(body({ from: id }))).rejects.toThrow(/agent to adjust was not found/);
    });
  });
});

describe('concluding', () => {
  it('empties the conversation of the test and leaves the draft in the team, untouched', async () => {
    const { id } = await assist.saveAssistDraft(body({ settings: { permission: 'worktree', tracker: 'read', shell: 'allowlist' } }));
    forumStore().append(agentThreadId(id), { kind: 'post', author: { type: 'person' }, text: 'trying it out' });
    attachmentStore().put(agentThreadId(id), 'note.txt', new TextEncoder().encode('an attachment of the test'));
    const before = JSON.stringify(getConfig());

    expect(assist.concludeAssistDraft(id)).toEqual({ id });
    expect(JSON.stringify(getConfig())).toBe(before);
    expect(agent(id)).toMatchObject({ draft: true, shell: 'allowlist' });
    expect(messages(id)).toEqual([]);
    expect(threadOf(id)?.kind).toBe('agent');
    expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(false);
  });

  it('refuses what is not a draft and touches neither the agent nor its conversation', () => {
    forumStore().ensureThread({ id: agentThreadId('writer'), kind: 'agent', squad: 'writer', title: 'Chat with Writer' });
    forumStore().append(agentThreadId('writer'), { kind: 'post', author: { type: 'person' }, text: 'the history of a real agent' });
    forumStore().ensureThread({ id: agentThreadId('turn'), kind: 'agent', squad: 'turn', title: 'Chat with Turn' });
    const before = JSON.stringify(getConfig());
    for (const id of ['writer', 'turn', 'nobody', '', null, 3, { id: 'x' }]) expect(() => assist.concludeAssistDraft(id), String(id)).toThrow(/is not a draft/);
    expect(messages('writer').map((m) => m.text)).toEqual(['the history of a real agent']);
    expect(JSON.stringify(getConfig())).toBe(before);
  });
});

describe('discarding', () => {
  it('takes the draft out of the team and deletes its conversation and files', async () => {
    const { id } = await assist.saveAssistDraft(body());
    forumStore().append(agentThreadId(id), { kind: 'post', author: { type: 'person' }, text: 'trying it out' });
    attachmentStore().put(agentThreadId(id), 'note.txt', new TextEncoder().encode('an attachment of the test'));

    expect(assist.discardAssistDraft(id)).toEqual({ id });
    expect(agent(id)).toBeUndefined();
    expect(threadOf(id)).toBeNull();
    expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(false);
    expect(existsSync(ATAS)).toBe(true);
    // The stored file agrees: a reload does not bring it back.
    reloadConfig();
    expect(agent(id)).toBeUndefined();
  });

  it('refuses an agent of the person, a system agent and an id nobody has, and deletes nothing', () => {
    forumStore().ensureThread({ id: agentThreadId('writer'), kind: 'agent', squad: 'writer', title: 'Chat with Writer' });
    forumStore().append(agentThreadId('writer'), { kind: 'post', author: { type: 'person' }, text: 'the history of a real agent' });
    const before = JSON.stringify(getConfig());
    for (const id of ['writer', 'turn', 'reply', 'nobody', undefined, null, 7]) expect(() => assist.discardAssistDraft(id), String(id)).toThrow(/is not a draft/);
    expect(JSON.stringify(getConfig())).toBe(before);
    expect(messages('writer')).toHaveLength(1);
  });

  it('takes the agent out of the config first: a conversation that could not be deleted does not bring the draft back', async () => {
    const { id } = await assist.saveAssistDraft(body());
    const forum = forumStore();
    const spy = vi.spyOn(forum, 'deleteThread').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => assist.discardAssistDraft(id)).toThrow(/disk full/);
    expect(agent(id)).toBeUndefined();
    spy.mockRestore();
    // The conversation that is left is an orphan the next listing no longer hides; nothing else of the draft remains.
    expect(threadOf(id)?.kind).toBe('agent');
  });

  it('leaves the proposals the draft raised in Actions where they are', async () => {
    const { id } = await assist.saveAssistDraft(body());
    const before = actions.listActions().length;
    assist.discardAssistDraft(id);
    expect(actions.listActions()).toHaveLength(before);
  });
});

describe('with an old problem in the flow', () => {
  it('still saves, updates, concludes and discards a draft, which is no change to the flow', async () => {
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    // A flow the app opened with a stage that lost its agent: saving a change to it is refused, a stored one is kept as it was.
    const stored = applyTemplate(neutralConfig(), agentFlowEngineering);
    stored.language = 'en';
    stored.agents.team = stored.agents.team.filter((a) => a.id !== 'developer');
    delete stored.devCycle.stages.find((s) => s.id === 'implement')!.agentId;
    writeConfigFile(ATAS, stored);
    reloadConfig();
    expect(() => updateConfig((c) => ({ ...c, agents: { ...c.agents, team: [...c.agents.team, newAgent({ id: 'worker' })] } }))).toThrow();

    const { id } = await assist.saveAssistDraft(body());
    expect(agent(id)?.draft).toBe(true);
    await assist.saveAssistDraft(body({ id, settings: { tracker: 'read' } }));
    expect(agent(id)?.tracker).toBe('read');
    assist.concludeAssistDraft(id);
    assist.discardAssistDraft(id);
    expect(agent(id)).toBeUndefined();
  });
});
