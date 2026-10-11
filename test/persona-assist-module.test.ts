// The persona's wizard and editor end to end in the main process: the two questions (what the model is asked, what is read back), the draft persona that cannot act, saving and
// opening the chat, adjusting a copy, discarding, clearing and deleting, and the origin of every change in the audit. No model is reached: `askBare` is a fake, and the data folder
// is the test's own. A paired browser calls through the rpc exactly as the window does, and gets the same.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIST_LIMITS, ASSIST_ROUND_SCHEMA } from '../src/shared/agentAssist';
import { neutralConfig } from '../src/shared/config';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent, personaDraftOf, personaOf, workingTeam } from '../src/shared/config/team';
import type { AgentDef } from '../src/shared/config/types';
import { agentThreadId } from '../src/shared/forum';
import { PERSONA_REVIEW_SCHEMA, personaAccess } from '../src/shared/persona';
import { MaxTurnsError, ProviderBudgetError } from '../src/main/engine/contract';

vi.setConfig({ testTimeout: 30_000 });

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

interface Call {
  role: string;
  prompt: string;
  schema: Record<string, unknown>;
  system: string;
}
const asked = vi.hoisted(() => ({ calls: [] as Call[], answer: null as unknown, fail: null as unknown }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  askBare: async (role: string, prompt: string, schema: Record<string, unknown>, opts: { system: string }) => {
    asked.calls.push({ role, prompt, schema, system: opts.system });
    if (asked.fail) throw asked.fail;
    return { data: asked.answer, sessionId: 's1', sources: [] };
  },
}));

const { getConfig, saveConfig, reloadConfig } = await import('../src/main/workspaceConfig');
const { forumStore } = await import('../src/main/forum');
const { attachmentStore } = await import('../src/main/attachments');
const { memoryStore } = await import('../src/main/memory/instance');
const { conversationsPath } = await import('../src/main/memory/store');
const { ATAS } = await import('../src/main/env');
const { callStops } = await import('../src/main/mentions/stop');
const { listAudit } = await import('../src/main/auditoria');
const { personaModule } = await import('../src/main/persona/module');
const { bindIpc, handle, invoke } = await import('../src/main/rpc');
const core = await import('../src/main/persona/assistCore');
const { agentAssist } = await import('../src/main/agentAssist');

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
beforeAll(() => {
  personaModule({ handle: (channel, fn) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined });
  agentAssist({ handle: (channel, fn) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined });
});
const window = async (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const paired = (channel: string, ...args: unknown[]) => invoke(channel, args, 'device-1');

const KEY = 'sk-ant-' + 'a1b2c3d4'.repeat(4);
const team = (): AgentDef[] => getConfig().agents.team;
const agent = (id: string): AgentDef | undefined => team().find((a) => a.id === id);
const threadOf = (id: string) => forumStore().summary(agentThreadId(id));
const messages = (id: string) => forumStore().read(agentThreadId(id), 0, 2000)?.messages ?? [];
const say = (id: string, text: string): void => void forumStore().append(agentThreadId(id), { kind: 'post', author: { type: 'person' }, text });

const choice = (text: string, options = ['fast', 'slow']) => ({ text, kind: 'single', options, why: 'It sets the pace.' });
const roundAnswer = (over: Record<string, unknown> = {}) => ({
  draft: { name: 'Ana', job: 'Represents Ana.', instructions: 'You represent Ana.' },
  questions: [choice('How do you decide?'), choice('What matters most?', ['quality', 'speed']), { text: 'What must never happen?', kind: 'open', options: [], why: 'A limit.' }],
  enough: false,
  ...over,
});
const reviewAnswer = (over: Record<string, unknown> = {}) => ({ draft: { name: 'Ana', job: 'Represents Ana, a tech lead.', instructions: 'You represent Ana.\n## Who the person is\nA tech lead.' }, ...over });

/** A neutral workspace in English, with an ordinary agent that has everything a persona must never inherit. */
function useConfig(over: (c: ReturnType<typeof neutralConfig>) => void = () => undefined): void {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team.push(newAgent({ id: 'writer', name: 'Writer', job: 'Writes the docs.', permission: 'worktree', tracker: 'read', shell: 'host', autonomous: true, model: { role: null, provider: 'openai', model: 'a-model' } }));
  c.llm.providers.push(newProvider({ id: 'openai', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }));
  over(c);
  saveConfig(c);
}
const withPersona = (): void =>
  useConfig((c) => {
    c.agents.team.push(newAgent({ id: 'me', name: 'Me', job: 'Represents the person.', instructions: 'About the person.', kind: 'persona', ...personaAccess(), model: { role: null, provider: 'openai', model: 'a-model' } }));
  });

const base = { mode: 'create', request: 'I lead a small team.', rounds: [], draft: { name: '', job: '', instructions: '' } };
const body = (over: Record<string, unknown> = {}) => ({ draft: { name: 'Ana', job: 'Represents Ana.', instructions: 'You represent Ana.' }, ...over });
const last = (): Call => asked.calls[asked.calls.length - 1];

beforeEach(() => {
  // Every case begins with no conversation of an agent and no audit: the data folder is the file's, not the case's.
  for (const s of forumStore().list()) if (s.kind === 'agent') forumStore().deleteThread(s.id);
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  asked.calls.length = 0;
  asked.answer = roundAnswer();
  asked.fail = null;
  useConfig();
});

describe('the round', () => {
  it('asks the deep role, with the persona system text, the schema of a round, and the four themes', async () => {
    const round = (await window('persona:round', base)) as { questions: unknown[] };
    expect(round.questions).toHaveLength(3);
    expect(asked.calls).toHaveLength(1);
    expect(last().role).toBe('deep');
    expect(last().system).toBe(core.personaSystem());
    expect(last().schema).toBe(ASSIST_ROUND_SCHEMA);
    expect(last().prompt).toContain('I lead a small team.');
    expect(last().prompt).toContain('Round 1 of 4');
    expect(last().prompt).toContain('who the person is');
    expect(last().prompt).not.toMatch(/Stages an agent can work|sandbox/i);
  });

  it('keeps the valid questions of an answer that is partly out of shape', async () => {
    asked.answer = roundAnswer({ questions: [choice('Good question?'), { text: 'No kind' }, { text: 'One option', kind: 'single', options: ['only'], why: '' }, choice('Another good one?')] });
    const round = (await window('persona:round', base)) as { questions: { id: string; text: string }[] };
    expect(round.questions.map((q) => [q.id, q.text])).toEqual([['q1', 'Good question?'], ['q2', 'Another good one?']]);
  });

  it('asks nothing of the model for a fifth round, an empty request, or a persona that already exists', async () => {
    const answered = { questions: [], answers: [] };
    await expect(window('persona:round', { ...base, rounds: [answered, answered, answered, answered] })).rejects.toThrow(/at most 4 rounds/);
    await expect(window('persona:round', { ...base, request: '  ' })).rejects.toThrow(/Tell the assistant who you are/);
    withPersona();
    await expect(window('persona:round', base)).rejects.toThrow(/already has a persona/);
    await expect(window('persona:round', { ...base, mode: 'adjust', from: 'writer' })).rejects.toThrow(/persona to adjust was not found/);
    expect(asked.calls).toHaveLength(0);
  });

  it('adjusts from the persona as it is, and keeps the settings out of what the model reads', async () => {
    withPersona();
    await window('persona:round', { ...base, mode: 'adjust', from: 'me', request: 'Make it blunter.' });
    expect(last().prompt).toContain('name: Me');
    expect(last().prompt).toContain('About the person.');
    expect(last().prompt).not.toMatch(/permission|tracker|shell/);
  });

  it('says a failure the way the creator does: the budget, the turns, and any other with its reason redacted', async () => {
    asked.fail = new ProviderBudgetError('openai', 'open', 'out of credit');
    await expect(window('persona:round', base)).rejects.toThrow(/budget of the openai key/);
    asked.fail = new MaxTurnsError('s1', []);
    await expect(window('persona:round', base)).rejects.toThrow(/ran out of steps/);
    asked.fail = new Error(`boom ${KEY}`);
    const e = (await window('persona:round', base).catch((x: unknown) => x)) as Error;
    expect(e.message).toContain('boom');
    expect(e.message).not.toContain(KEY);
  });
});

describe('the review', () => {
  it('asks for the draft only, and reads back nothing else, even from a model that proposed settings', async () => {
    asked.answer = reviewAnswer({ permission: { value: 'worktree', reason: 'x' }, tracker: { value: 'read', reason: 'x' }, shell: { value: 'host', reason: 'x' }, stages: { ids: ['plan'], reason: 'x' }, tools: { files: true } });
    const review = (await window('persona:review', base)) as Record<string, unknown>;
    expect(Object.keys(review)).toEqual(['draft']);
    expect(last().schema).toBe(PERSONA_REVIEW_SCHEMA);
    expect(last().prompt).toContain('## What they never want done');
    expect(last().prompt).not.toMatch(/"permission"|"shell"|"stages"/);
  });

  it('cuts the texts to the limits and masks a secret the model repeated', async () => {
    asked.answer = reviewAnswer({ draft: { name: 'N'.repeat(200), job: `Key ${KEY}`, instructions: 'I'.repeat(9000) } });
    const { draft } = (await window('persona:review', base)) as { draft: { name: string; job: string; instructions: string } };
    expect(draft.name).toHaveLength(ASSIST_LIMITS.name);
    expect(draft.instructions).toHaveLength(ASSIST_LIMITS.instructions);
    expect(draft.job).not.toContain(KEY);
  });

  it('says there was nothing to use when the answer is not an object or is empty', async () => {
    for (const answer of [null, 'text', [], { draft: {} }]) {
      asked.answer = answer;
      await expect(window('persona:review', base), JSON.stringify(answer)).rejects.toThrow(/nothing the assistant could use/);
    }
  });
});

describe('the draft persona, which cannot act', () => {
  it('is saved as a persona and a draft with no stage, no squad, not autonomous, turning to the person, and the starting access of the app', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    expect(id).toBe('persona');
    const made = agent(id) as AgentDef;
    expect(made).toMatchObject({ kind: 'persona', draft: true, system: false, name: 'Ana', job: 'Represents Ana.', instructions: 'You represent Ana.', stages: [], autonomous: false, turnsTo: null, permission: 'read', tracker: 'read', shell: 'none', model: { role: 'deep', provider: '', model: '' } });
    expect(made.squad ?? null).toBeNull();
    expect(made.tools).toBeUndefined();
    expect(made.allowedCommands).toBeUndefined();
    expect(made.screen).toBeUndefined();
    expect(made.allowedHosts).toBeUndefined();
    expect(made.browserProfile).toBeUndefined();
    expect(threadOf(id)).toMatchObject({ kind: 'agent', title: expect.stringContaining('Ana') });
    expect(messages(id)).toEqual([]);
    // It takes part in nothing: not in the working team, and `personaOf` does not find a draft.
    expect(workingTeam(team()).map((a) => a.id)).not.toContain(id);
    expect(personaOf(team())).toBeNull();
    expect(personaDraftOf(team())?.id).toBe(id);
  });

  it('takes nothing from the screen but the three texts: not the settings, the stages, the model, the host, the screen or the id of another agent', async () => {
    const hostile = {
      stages: ['plan'],
      squad: 'payments',
      autonomous: true,
      turnsTo: 'qa',
      system: true,
      kind: 'agent',
      draft: false,
      model: { role: null, provider: 'x', model: 'y' },
      allowedCommands: ['rm:*'],
      screen: true,
      allowedHosts: ['example.net'],
      browserProfile: true,
      settings: { permission: 'worktree', tracker: 'read', shell: 'host', stages: ['plan'], model: { role: null, provider: 'x', model: 'y' }, id: 'deep' },
    };
    const { id } = (await window('persona:saveDraft', body(hostile))) as { id: string };
    expect(agent(id)).toMatchObject({ kind: 'persona', draft: true, system: false, stages: [], autonomous: false, turnsTo: null, permission: 'read', tracker: 'read', shell: 'none', model: { role: 'deep', provider: '', model: '' } });
    expect(agent(id)?.allowedCommands).toBeUndefined();
    expect(agent(id)?.screen).toBeUndefined();
    // The agent of the person is untouched.
    expect(agent('writer')).toMatchObject({ autonomous: true, shell: 'host', permission: 'worktree' });
  });

  it('reuses the draft it has, and never makes a second', async () => {
    const first = (await window('persona:saveDraft', body())) as { id: string };
    say(first.id, 'a test with the old instructions');
    attachmentStore().put(agentThreadId(first.id), 'note.txt', new TextEncoder().encode('an attachment of the test'));
    const again = (await window('persona:saveDraft', body({ draft: { name: 'Ana v2', job: 'New job.', instructions: 'New instructions.' } }))) as { id: string };
    expect(again.id).toBe(first.id);
    expect(team().filter((a) => a.kind === 'persona')).toHaveLength(1);
    expect(agent(first.id)).toMatchObject({ name: 'Ana v2', job: 'New job.', instructions: 'New instructions.', draft: true });
    expect(messages(first.id)).toEqual([]);
    expect(existsSync(attachmentStore().dirOf(agentThreadId(first.id)))).toBe(false);
    // An id the screen holds that is not the draft is not followed either.
    const other = (await window('persona:saveDraft', body({ id: 'vanished' }))) as { id: string };
    expect(other.id).toBe(first.id);
  });

  it('refuses to overwrite an agent that is not the persona draft, and leaves it as it was', async () => {
    const writer = JSON.stringify(agent('writer'));
    for (const id of ['writer', 'turn', 'deep']) await expect(window('persona:saveDraft', body({ id })), id).rejects.toThrow(/is not a persona draft/);
    expect(JSON.stringify(agent('writer'))).toBe(writer);
  });

  it('cuts the texts to the limits, masks a secret, and gives a name when there is none', async () => {
    const long = (await window('persona:saveDraft', body({ draft: { name: 'N'.repeat(200), job: 'J'.repeat(3000), instructions: `I${KEY}`.padEnd(9000, 'I') } }))) as { id: string };
    expect(agent(long.id)).toMatchObject({ name: 'N'.repeat(ASSIST_LIMITS.name), job: 'J'.repeat(ASSIST_LIMITS.job) });
    expect(agent(long.id)?.instructions.length).toBeLessThanOrEqual(ASSIST_LIMITS.instructions);
    expect(agent(long.id)?.instructions).not.toContain(KEY);
    const unnamed = (await window('persona:saveDraft', body({ draft: { name: ' ', job: 'x', instructions: 'y' } }))) as { id: string };
    expect(agent(unnamed.id)?.name).toBe('My persona');
    expect(() => saveConfig(getConfig())).not.toThrow();
    for (const raw of [undefined, null, 'persona', 4, []]) expect(await window('persona:saveDraft', raw)).toEqual({ id: unnamed.id });
  });

  it('is refused when the workspace has a persona, and a copy of the persona is only made for the persona', async () => {
    withPersona();
    await expect(window('persona:saveDraft', body())).rejects.toThrow(/already has a persona/);
    await expect(window('persona:saveDraft', body({ from: 'writer' }))).rejects.toThrow(/persona to adjust was not found/);
    expect(personaDraftOf(team())).toBeNull();
  });

  it('is a copy when the persona is adjusted: it keeps the persona\'s model, the original does not change, and the test conversation is the copy\'s own', async () => {
    withPersona();
    const before = JSON.stringify(agent('me'));
    const { id } = (await window('persona:saveDraft', body({ from: 'me' }))) as { id: string };
    expect(id).toBe('me-draft');
    expect(agent(id)).toMatchObject({ kind: 'persona', draft: true, stages: [], autonomous: false, turnsTo: null, tracker: 'read', shell: 'none', model: { role: null, provider: 'openai', model: 'a-model' } });
    expect(JSON.stringify(agent('me'))).toBe(before);
    expect(threadOf(id)?.kind).toBe('agent');
  });
});

describe('concluding and discarding', () => {
  it('concluding empties the conversation of the test and leaves the draft in the team', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    say(id, 'trying it out');
    attachmentStore().put(agentThreadId(id), 'note.txt', new TextEncoder().encode('an attachment of the test'));
    const before = JSON.stringify(getConfig());
    expect(await window('persona:conclude', id)).toEqual({ id });
    expect(JSON.stringify(getConfig())).toBe(before);
    expect(messages(id)).toEqual([]);
    expect(threadOf(id)?.kind).toBe('agent');
    expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(false);
  });

  it('discarding takes the draft out of the team and deletes its conversation, its files and its memory folder', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    say(id, 'trying it out');
    memoryStore().save({ scope: { conversation: agentThreadId(id), agent: id }, kind: 'note', title: 'Tried it', text: 'Written during the test.' });
    expect(existsSync(join(conversationsPath(ATAS), agentThreadId(id)))).toBe(true);
    expect(await window('persona:discard', id)).toEqual({ id });
    expect(agent(id)).toBeUndefined();
    expect(threadOf(id)).toBeNull();
    expect(existsSync(join(conversationsPath(ATAS), agentThreadId(id)))).toBe(false);
    reloadConfig();
    expect(agent(id)).toBeUndefined();
  });

  it('refuses an ordinary agent, a system agent, the persona itself and no id at all, and deletes nothing; the creator refuses a persona draft the same way', async () => {
    withPersona();
    const { id } = (await window('persona:saveDraft', body({ from: 'me' }))) as { id: string };
    const before = JSON.stringify(getConfig());
    for (const target of ['writer', 'turn', 'me', 'nobody', '', null, undefined, 7]) {
      await expect(window('persona:discard', target), String(target)).rejects.toThrow(/is not a persona draft/);
      await expect(window('persona:conclude', target), String(target)).rejects.toThrow(/is not a persona draft/);
    }
    await expect(window('agentAssist:discard', id)).rejects.toThrow(/is not a draft/);
    expect(JSON.stringify(getConfig())).toBe(before);
  });
});

describe('finishing', () => {
  it('making: the draft stops being one, takes the starting access, and the chat begins empty', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    say(id, 'a message of the test');
    attachmentStore().put(agentThreadId(id), 'note.txt', new TextEncoder().encode('an attachment of the test'));
    expect(await window('persona:finish', { id })).toEqual({ id });
    const made = agent(id) as AgentDef;
    expect(made.draft).toBeUndefined();
    expect(made).toMatchObject({ kind: 'persona', name: 'Ana', stages: [], autonomous: false, turnsTo: null, permission: 'read', tracker: 'read', shell: 'none' });
    expect(personaOf(team())?.id).toBe(id);
    expect(personaDraftOf(team())).toBeNull();
    expect(messages(id)).toEqual([]);
    expect(existsSync(attachmentStore().dirOf(agentThreadId(id)))).toBe(false);
    expect(threadOf(id)?.kind).toBe('agent');
    reloadConfig();
    expect(personaOf(team())?.id).toBe(id);
  });

  it('takes the draft there is when it is asked with no id, and refuses an ordinary agent and a second persona', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    await expect(window('persona:finish', { id: 'writer' })).rejects.toThrow(/is not a persona draft/);
    expect(await window('persona:finish', {})).toEqual({ id });
    // Another draft cannot be finished into a second persona: making one is refused now.
    await expect(window('persona:saveDraft', body())).rejects.toThrow(/already has a persona/);
    await expect(window('persona:finish', {})).rejects.toThrow(/is not a persona draft/);
  });

  it('adjusting: the three texts go onto the persona, which keeps its model, its access and its conversation, and the copy is gone', async () => {
    withPersona();
    say('me', 'the history of the persona');
    const { id } = (await window('persona:saveDraft', body({ from: 'me', draft: { name: 'Me again', job: 'Better.', instructions: 'Newer.' } }))) as { id: string };
    say(id, 'a message of the test');
    expect(await window('persona:finish', { id, from: 'me' })).toEqual({ id: 'me' });
    expect(agent('me')).toMatchObject({ name: 'Me again', job: 'Better.', instructions: 'Newer.', kind: 'persona', tracker: 'read', shell: 'none', model: { role: null, provider: 'openai', model: 'a-model' } });
    expect(agent('me')?.draft).toBeUndefined();
    expect(agent(id)).toBeUndefined();
    expect(threadOf(id)).toBeNull();
    expect(messages('me').map((m) => m.text)).toEqual(['the history of the persona']);
    // Finishing a copy without saying which persona it adjusts is making a second one: refused.
    const copy = (await window('persona:saveDraft', body({ from: 'me' }))) as { id: string };
    await expect(window('persona:finish', { id: copy.id })).rejects.toThrow(/already has a persona/);
    await expect(window('persona:finish', { id: copy.id, from: 'writer' })).rejects.toThrow(/persona to adjust was not found/);
  });
});

describe('the editor', () => {
  it('saves the three texts and the model, and nothing else of the persona changes', async () => {
    withPersona();
    const before = agent('me') as AgentDef;
    await window('persona:save', { name: 'Me 2', job: 'Job 2.', instructions: 'Instructions 2.', model: { role: 'deep', provider: '', model: '' }, tracker: 'none', shell: 'host', stages: ['plan'] });
    expect(agent('me')).toMatchObject({ name: 'Me 2', job: 'Job 2.', instructions: 'Instructions 2.', model: { role: 'deep', provider: '', model: '' }, tracker: before.tracker, shell: before.shell, permission: before.permission, kind: 'persona' });
    expect(agent('me')?.stages).toEqual([]);
  });

  it('saves how its pool is used: saying nothing leaves it, null goes back to inheriting, and a word that is not a mode is not kept', async () => {
    withPersona();
    await window('persona:save', { name: 'Me', poolMode: 'delegate' });
    expect(agent('me')?.poolMode).toBe('delegate');
    await window('persona:save', { name: 'Me' });
    expect(agent('me')?.poolMode).toBe('delegate');
    await window('persona:save', { name: 'Me', poolMode: null });
    expect(agent('me')?.poolMode).toBeUndefined();
    await window('persona:save', { name: 'Me', poolMode: 'switch' });
    await window('persona:save', { name: 'Me', poolMode: 'nonsense' });
    expect(agent('me')?.poolMode).toBeUndefined();
  });

  it('cuts the texts, masks a secret, and refuses an empty name, no persona, and a model the configuration does not have', async () => {
    await expect(window('persona:save', { name: 'x' })).rejects.toThrow(/no persona yet/);
    withPersona();
    await expect(window('persona:save', { name: '  ', job: 'x' })).rejects.toThrow(/Give the persona a name/);
    await window('persona:save', { name: 'N'.repeat(200), job: 'x', instructions: `key ${KEY}` });
    expect(agent('me')?.name).toHaveLength(ASSIST_LIMITS.name);
    expect(agent('me')?.instructions).not.toContain(KEY);
    await expect(window('persona:save', { name: 'Me', model: { role: null, provider: 'nowhere', model: 'm' } })).rejects.toThrow(/could not be saved/);
    expect(agent('me')?.model).toEqual({ role: null, provider: 'openai', model: 'a-model' });
  });

  it('from a paired browser, takes the texts and a model, and refuses a reserve model added to the list', async () => {
    withPersona();
    await paired('persona:save', { name: 'Me 3', job: 'x', instructions: 'y' });
    expect(agent('me')?.name).toBe('Me 3');
    const model = { ...(agent('me') as AgentDef).model, fallbacks: [{ provider: 'openai', model: 'another' }] };
    await expect(paired('persona:save', { name: 'Me 3', model })).rejects.toThrow(/may not change this: agents\.team\[me\]\.model\.fallbacks/);
    expect(agent('me')?.model.fallbacks).toBeUndefined();
    // The computer may.
    await window('persona:save', { name: 'Me 3', model });
    expect(agent('me')?.model.fallbacks).toEqual([{ provider: 'openai', model: 'another' }]);
  });
});

describe('clearing and deleting', () => {
  it('clearing empties the conversation, its files and its memory folder, and keeps the persona', async () => {
    withPersona();
    say('me', 'the history');
    attachmentStore().put(agentThreadId('me'), 'note.txt', new TextEncoder().encode('an attachment'));
    memoryStore().save({ scope: { conversation: agentThreadId('me'), agent: 'me' }, kind: 'note', title: 'Kept', text: 'Written in the chat.' });
    const before = JSON.stringify(agent('me'));
    expect(await window('persona:clear')).toEqual({ id: 'me' });
    expect(messages('me')).toEqual([]);
    expect(threadOf('me')?.kind).toBe('agent');
    expect(existsSync(attachmentStore().dirOf(agentThreadId('me')))).toBe(false);
    expect(existsSync(join(conversationsPath(ATAS), agentThreadId('me')))).toBe(false);
    expect(JSON.stringify(agent('me'))).toBe(before);
  });

  it('deleting removes the persona and its test copy with their conversations, and the home returns to the invitation', async () => {
    withPersona();
    const { id } = (await window('persona:saveDraft', body({ from: 'me' }))) as { id: string };
    say('me', 'the history');
    expect(await window('persona:delete')).toEqual({ id: 'me' });
    expect(agent('me')).toBeUndefined();
    expect(agent(id)).toBeUndefined();
    expect(threadOf('me')).toBeNull();
    expect(threadOf(id)).toBeNull();
    expect(personaOf(team())).toBeNull();
    expect(agent('writer')).toBeDefined();
    reloadConfig();
    expect(team().some((a) => a.kind === 'persona')).toBe(false);
  });

  it('both refuse while an answer is going, and say so, and change nothing', async () => {
    withPersona();
    say('me', 'the history');
    const release = callStops.register(agentThreadId('me'), 'me', new AbortController());
    await expect(window('persona:clear')).rejects.toThrow(/is answering/);
    await expect(window('persona:delete')).rejects.toThrow(/is answering/);
    expect(messages('me')).toHaveLength(1);
    expect(agent('me')).toBeDefined();
    release();
    await window('persona:clear');
    expect(messages('me')).toEqual([]);
  });

  it('say there is no persona when there is none', async () => {
    await expect(window('persona:clear')).rejects.toThrow(/no persona yet/);
    await expect(window('persona:delete')).rejects.toThrow(/no persona yet/);
  });
});

describe('what a paired browser can do, and what is recorded', () => {
  it('makes the persona end to end with no setting of its own, which the configuration route would have refused', async () => {
    const { id } = (await paired('persona:saveDraft', body({ settings: { tracker: 'read', shell: 'host' } }))) as { id: string };
    await paired('persona:finish', { id });
    expect(agent(id)).toMatchObject({ kind: 'persona', tracker: 'read', shell: 'none', permission: 'read' });
    await paired('persona:clear');
    await paired('persona:delete');
    expect(agent(id)).toBeUndefined();
  });

  it('records each change with the door it came by and the id of the agent, never a text', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    await window('persona:finish', { id });
    await paired('persona:save', { name: 'Ana 2', job: 'Secret job text.', instructions: 'Secret instructions.' });
    await window('persona:clear');
    await paired('persona:delete');
    const entries = listAudit().filter((e) => e.kind === 'persona').reverse();
    expect(entries.map((e) => [e.target, e.via, e.fields])).toEqual([
      ['persona:finish', 'window', { agent: id }],
      ['persona:save', 'paired', { agent: id }],
      ['persona:clear', 'window', { agent: id }],
      ['persona:delete', 'paired', { agent: id }],
    ]);
    expect(entries.every((e) => e.ok)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('Secret');
  });

  it('records nothing for the steps of the wizard that change no persona', async () => {
    const { id } = (await window('persona:saveDraft', body())) as { id: string };
    await window('persona:conclude', id);
    await window('persona:discard', id);
    expect(listAudit().filter((e) => e.kind === 'persona')).toEqual([]);
  });
});
