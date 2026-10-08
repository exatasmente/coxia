// The two questions the agent assistant asks of a model, end to end in the main process: what the model is told (only what exists), what is read back (held to what the
// editor offers), what is refused before any model is asked, and how a failure reaches the person. No model is reached: `askBare` is a fake, the sandbox probe is a
// spy, and the data folder is the test's own.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIST_LIMITS, ASSIST_ROUND_SCHEMA } from '../src/shared/agentAssist';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { agentThreadId } from '../src/shared/forum';
import { MaxTurnsError, ProviderBudgetError } from '../src/main/engine/contract';

vi.setConfig({ testTimeout: 30_000 });

interface Call {
  role: string;
  prompt: string;
  schema: Record<string, unknown>;
  system: string;
  maxTurns: number | undefined;
}
const asked = vi.hoisted(() => ({ calls: [] as Call[], answer: null as unknown, fail: null as unknown }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  askBare: async (role: string, prompt: string, schema: Record<string, unknown>, opts: { system: string; maxTurns?: number }) => {
    asked.calls.push({ role, prompt, schema, system: opts.system, maxTurns: opts.maxTurns });
    if (asked.fail) throw asked.fail;
    return { data: asked.answer, sessionId: 's1', sources: [] };
  },
}));

const { saveConfig } = await import('../src/main/workspaceConfig');
const { sandbox } = await import('../src/main/sandbox/workspace');
const { forumStore } = await import('../src/main/forum');
const actions = await import('../src/main/actions');
const assist = await import('../src/main/agentAssist');
const core = await import('../src/main/agentAssist-core');

let sandboxWorks = true;
vi.spyOn(sandbox, 'status').mockImplementation(async () => ({ available: sandboxWorks }) as never);

const KEY = 'sk-ant-' + 'a1b2c3d4'.repeat(4);
const choice = (text: string, options = ['api', 'web']) => ({ text, kind: 'single', options, why: 'It sets the scope.' });
const roundAnswer = (over: Record<string, unknown> = {}) => ({ draft: { name: 'Release notes', job: 'Writes release notes.', instructions: 'You write release notes.' }, questions: [choice('Which repository?'), choice('Which tone?', ['formal', 'friendly']), { text: 'What must it avoid?', kind: 'open', options: [], why: 'A limit.' }], enough: false, ...over });
const reasoned = (value: unknown, reason = 'The work needs it.') => ({ value, reason });
const reviewAnswer = (over: Record<string, unknown> = {}) => ({
  draft: { name: 'Release notes', job: 'Writes release notes.', instructions: 'You write release notes from merged changes.' },
  permission: reasoned('read', ''),
  tracker: reasoned('none', ''),
  shell: reasoned('none', ''),
  tools: { files: null, skills: null, vcsCli: null, subagents: null, reason: '' },
  stages: { ids: [], reason: '' },
  squad: { id: null, reason: '' },
  turnsTo: { id: null, reason: '' },
  ...over,
});

/** The engineering cycle in English, a draft that must never be offered, and an agent of the person to adjust (it has a host shell that only it may keep). */
function useConfig(over: (c: WorkspaceConfig) => void = () => undefined): WorkspaceConfig {
  const c = applyTemplate(neutralConfig(), agentFlowEngineering);
  c.language = 'en';
  c.agents.team.push(newAgent({ id: 'sketch', name: 'Sketch', job: 'A draft that must never be offered.', draft: true }));
  c.agents.team.push(newAgent({ id: 'writer', name: 'Writer', job: 'Writes the docs.', instructions: 'You write the docs.', permission: 'worktree', tracker: 'read', shell: 'host' }));
  // The template names the agent of every work stage, and a named stage is not offered: free them, so there are stages to offer (the agents still list them).
  for (const s of c.devCycle.stages) delete s.agentId;
  over(c);
  return saveConfig(c);
}

const base = { mode: 'create', request: 'An agent that writes release notes.', rounds: [], draft: { name: '', job: '', instructions: '' } };
const last = (): Call => asked.calls[asked.calls.length - 1];

beforeEach(() => {
  asked.calls.length = 0;
  asked.answer = roundAnswer();
  asked.fail = null;
  sandboxWorks = true;
  useConfig();
});

describe('the round', () => {
  it('asks the deep role, with the system text of the assistant, the schema of a round, and no other tool than the answer', async () => {
    await assist.assistRound(base);
    expect(asked.calls).toHaveLength(1);
    expect(last().role).toBe('deep');
    expect(last().system).toBe(core.assistSystem());
    expect(last().schema).toBe(ASSIST_ROUND_SCHEMA);
    expect(last().prompt).toContain('An agent that writes release notes.');
    expect(last().prompt).toContain('Round 1 of 4');
  });

  it('tells the model only what exists: the work stages and the agents of the team, never a draft or a gate', async () => {
    await assist.assistRound(base);
    const prompt = last().prompt;
    for (const id of ['refine', 'plan', 'implement', 'review', 'qa', 'planner', 'writer']) expect(prompt, id).toContain(`- ${id}: `);
    expect(prompt).not.toContain('sketch');
    expect(prompt).not.toContain('A draft that must never be offered');
    expect(prompt).not.toContain('gate1');
  });

  it('reads the questions back: the invalid dropped, the ids made by the app, a secret the model repeated masked, six at most', async () => {
    asked.answer = roundAnswer({
      questions: [choice(`Use ${KEY}?`), { text: '', kind: 'open' }, choice('One option only', ['a']), ...Array.from({ length: 8 }, (_, i) => ({ text: `Extra ${i}`, kind: 'open', options: [], why: '' }))],
      draft: { name: 'Notes', job: `Uses ${KEY}`, instructions: 'x'.repeat(9000) },
      enough: true,
    });
    const out = await assist.assistRound(base);
    expect(out.questions).toHaveLength(ASSIST_LIMITS.questions);
    expect(out.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.draft.instructions).toHaveLength(ASSIST_LIMITS.instructions);
    expect(out.enough).toBe(true);
  });

  it('keeps the draft the screen holds for a text the model left empty', async () => {
    asked.answer = roundAnswer({ draft: { name: '', job: '', instructions: 'New instructions.' } });
    const out = await assist.assistRound({ ...base, draft: { name: 'Kept name', job: 'Kept job', instructions: 'Old.' } });
    expect(out.draft).toEqual({ name: 'Kept name', job: 'Kept job', instructions: 'New instructions.' });
  });

  it('returns a round with no question, and does not fail, when none of them is valid: the screen says so', async () => {
    asked.answer = roundAnswer({ questions: [{ text: '', kind: 'open' }, 'nonsense', null] });
    const out = await assist.assistRound(base);
    expect(out.questions).toEqual([]);
    expect(out.draft.name).toBe('Release notes');
  });

  it('carries the rounds answered, a skipped question marked as such, and the remark of the person', async () => {
    const rounds = [{ questions: [{ id: 'q1', text: 'Which repository?', kind: 'single', options: ['api', 'web'], why: 'x' }, { id: 'q2', text: 'Tone?', kind: 'open', options: [], why: 'y' }], answers: [{ question: 'q1', picked: ['api'], other: '', text: '' }, { question: 'q2', picked: [], other: '', text: '' }] }];
    await assist.assistRound({ ...base, rounds, note: 'It is too formal.' });
    expect(last().prompt).toContain('Round 2 of 4');
    expect(last().prompt).toContain('q1 [single] Which repository?');
    expect(last().prompt).toContain('Answer: api');
    expect(last().prompt).toContain('Answer: skipped, left unanswered by the person');
  });

  it('refuses the fifth round and asks no model', async () => {
    const answered = { questions: [{ id: 'q1', text: 'Which?', kind: 'single', options: ['a', 'b'], why: '' }], answers: [{ question: 'q1', picked: ['a'], other: '', text: '' }] };
    await assist.assistRound({ ...base, rounds: [answered, answered, answered] });
    expect(asked.calls).toHaveLength(1);
    await expect(assist.assistRound({ ...base, rounds: [answered, answered, answered, answered] })).rejects.toThrow(/at most 4 rounds/);
    await expect(assist.assistRound({ ...base, rounds: [answered, answered, answered, answered, answered, answered] })).rejects.toThrow(/at most 4 rounds/);
    expect(asked.calls).toHaveLength(1);
  });

  it('still lets the review come after four rounds, and refuses one that claims more', async () => {
    const answered = { questions: [], answers: [] };
    asked.answer = reviewAnswer();
    await assist.assistReview({ ...base, rounds: [answered, answered, answered, answered] });
    expect(asked.calls).toHaveLength(1);
    await expect(assist.assistReview({ ...base, rounds: Array.from({ length: 5 }, () => answered) })).rejects.toThrow(/at most 4 rounds/);
  });

  it('refuses a request that says nothing, and reads anything that is not an object as one', async () => {
    for (const raw of [undefined, null, 'make an agent', 7, [], { ...base, request: '   ' }]) await expect(assist.assistRound(raw), String(raw)).rejects.toThrow(/Say what the agent should do/);
    expect(asked.calls).toEqual([]);
  });

  it('cuts the request and the answers to the limits', async () => {
    await assist.assistRound({ ...base, request: 'R'.repeat(5000), note: 'N'.repeat(5000) });
    const prompt = last().prompt;
    expect(prompt).toContain('R'.repeat(ASSIST_LIMITS.request));
    expect(prompt).not.toContain('R'.repeat(ASSIST_LIMITS.request + 1));
    expect(prompt).not.toContain('N'.repeat(ASSIST_LIMITS.note + 1));
  });

  it('reads the test conversation of a draft, the last messages, and none of an agent that is not a draft', async () => {
    const forum = forumStore();
    const thread = agentThreadId('sketch');
    forum.ensureThread({ id: thread, kind: 'agent', squad: 'sketch', title: 'Chat with Sketch' });
    for (let i = 1; i <= 50; i++) forum.append(thread, { kind: 'post', author: { type: 'person' }, text: `message number ${i}` });
    await assist.assistRound({ ...base, testId: 'sketch' });
    const prompt = last().prompt;
    expect(prompt).toContain('message number 50');
    expect(prompt).toContain('message number 11');
    expect(prompt).not.toContain('message number 10\n');
    expect(prompt).not.toContain('message number 5\n');

    forum.ensureThread({ id: agentThreadId('writer'), kind: 'agent', squad: 'writer', title: 'Chat with Writer' });
    forum.append(agentThreadId('writer'), { kind: 'post', author: { type: 'person' }, text: 'a private talk with a real agent' });
    await assist.assistRound({ ...base, testId: 'writer' });
    expect(last().prompt).not.toContain('a private talk with a real agent');
  });
});

describe('the review', () => {
  it('offers the model only the values that exist, in the schema and in the text', async () => {
    asked.answer = reviewAnswer();
    await assist.assistReview(base);
    const props = (last().schema as { properties: Record<string, { properties: Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }> }> }).properties;
    expect(props.shell.properties.value.enum).toEqual(['none', 'sandbox', 'allowlist']);
    expect(props.stages.properties.ids.items?.enum).toEqual(expect.arrayContaining(['refine', 'plan', 'implement']));
    expect(props.stages.properties.ids.items?.enum).not.toContain('gate1');
    expect(props.turnsTo.properties.id.enum).toContain('planner');
    expect(props.turnsTo.properties.id.enum).not.toContain('sketch');
    expect(Object.keys(props)).not.toContain('autonomous');
    expect(last().prompt).toContain('"sandbox" is available');
  });

  it('says there is no sandbox, and offers none, on a computer that has none', async () => {
    sandboxWorks = false;
    asked.answer = reviewAnswer({ shell: reasoned('sandbox') });
    const out = await assist.assistReview(base);
    expect(last().prompt).toContain('do not propose "sandbox"');
    expect(((last().schema as { properties: { shell: { properties: { value: { enum: string[] } } } } }).properties.shell.properties.value.enum)).toEqual(['none', 'allowlist']);
    expect(out.settings.shell).toBe('none');
  });

  it('holds the proposal to what exists: each value above the minimum with its reason, host never, an unknown id never', async () => {
    asked.answer = reviewAnswer({
      permission: reasoned('worktree', 'It must change files.'),
      tracker: reasoned('read', 'It reads the issues.'),
      shell: reasoned('host', 'It needs the whole machine.'),
      tools: { files: false, skills: null, vcsCli: null, subagents: true, reason: 'It only talks.' },
      stages: { ids: ['plan', 'nowhere'], reason: 'It plans.' },
      squad: { id: 'ghosts', reason: 'x' },
      turnsTo: { id: 'sketch', reason: 'The draft.' },
    });
    const out = await assist.assistReview(base);
    expect(out.settings).toMatchObject({ permission: 'worktree', tracker: 'read', shell: 'none', stages: ['plan'], squad: null, turnsTo: null });
    expect(out.settings.tools).toMatchObject({ files: false, subagents: true });
    expect(out.reasons).toEqual({ permission: 'It must change files.', tracker: 'It reads the issues.', tools: 'It only talks.', stages: 'It plans.' });
  });

  it('sends a value back to the minimum when the model gave no reason for it', async () => {
    asked.answer = reviewAnswer({ permission: reasoned('worktree', ''), tracker: reasoned('read', '  '), stages: { ids: ['plan'], reason: '' } });
    const out = await assist.assistReview(base);
    expect(out.settings).toMatchObject({ permission: 'read', tracker: 'none', stages: [] });
    expect(out.reasons).toEqual({});
  });

  it('masks a secret in the draft and in a reason', async () => {
    asked.answer = reviewAnswer({ draft: { name: 'N', job: 'J', instructions: `Use ${KEY}.` }, tracker: reasoned('read', `because ${KEY}`) });
    const out = await assist.assistReview(base);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  describe('when adjusting an agent', () => {
    const adjust = { ...base, mode: 'adjust', from: 'writer', request: 'Make it friendlier.' };

    it('starts from the agent as the form holds it, and tells the model what it is', async () => {
      asked.answer = reviewAnswer({ tracker: reasoned('none', 'It no longer reads issues.') });
      const out = await assist.assistReview({ ...adjust, base: { draft: { name: 'Writer (edited)', job: 'Writes the docs.', instructions: 'You write the docs, kindly.' }, settings: { permission: 'worktree', tracker: 'read', shell: 'host', tools: null, stages: [], squad: null, turnsTo: null } } });
      expect(last().prompt).toContain('Writer (edited)');
      expect(last().prompt).toContain('You write the docs, kindly.');
      expect(last().prompt).toContain('"tracker":"read"');
      expect(out.settings).toMatchObject({ permission: 'worktree', tracker: 'none', shell: 'host' });
      expect(out.reasons).toEqual({ tracker: 'It no longer reads issues.' });
    });

    it('falls back to the stored agent when the form sends nothing', async () => {
      asked.answer = reviewAnswer({ permission: reasoned('worktree', ''), tracker: reasoned('read', ''), shell: reasoned('host', '') });
      const out = await assist.assistReview(adjust);
      expect(last().prompt).toContain('You write the docs.');
      expect(out.settings).toMatchObject({ permission: 'worktree', tracker: 'read', shell: 'host' });
      expect(out.reasons).toEqual({});
    });

    it('keeps the host only if the stored agent has it, whatever the form claims', async () => {
      useConfig((c) => {
        c.agents.team.find((a) => a.id === 'writer')!.shell = 'none';
      });
      asked.answer = reviewAnswer({ shell: reasoned('host', 'Claimed.') });
      const out = await assist.assistReview({ ...adjust, base: { settings: { permission: 'worktree', tracker: 'read', shell: 'host', tools: null, stages: [], squad: null, turnsTo: null } } });
      expect(out.settings.shell).toBe('none');
    });

    it('leaves the agent being adjusted out of the agents it could turn to', async () => {
      asked.answer = reviewAnswer({ turnsTo: { id: 'writer', reason: 'Itself.' } });
      const out = await assist.assistReview(adjust);
      expect(last().prompt).not.toContain('- writer: ');
      expect(out.settings.turnsTo).toBeNull();
    });

    it.each([
      ['an id nobody has', 'nobody'],
      ['a system agent', 'turn'],
      ['a draft', 'sketch'],
      ['no agent at all', null],
    ])('refuses to adjust %s, and asks no model', async (_what, from) => {
      await expect(assist.assistReview({ ...adjust, from })).rejects.toThrow(/agent to adjust was not found/);
      await expect(assist.assistRound({ ...adjust, from })).rejects.toThrow(/agent to adjust was not found/);
      expect(asked.calls).toEqual([]);
    });
  });
});

describe('what fails', () => {
  it('says the budget of the provider, with the provider and what it answered, and the person may try again', async () => {
    asked.fail = new ProviderBudgetError('anthropic', 'claude-sdk', 'credit balance is too low');
    await expect(assist.assistRound(base)).rejects.toThrow(/budget of the anthropic key is exhausted.*credit balance is too low/);
    await expect(assist.assistReview(base)).rejects.toThrow(/budget of the anthropic key is exhausted/);
    // The open engine's detail is already its own sentence, which promises a retry the assistant does not make: it is not repeated.
    asked.fail = new ProviderBudgetError('local', 'open', 'The budget of the 127.0.0.1:4000 key is exhausted: the provider refused the call. Add credit, then the app tries again on its own.');
    const said = await assist.assistRound(base).then(() => '', (e: Error) => e.message);
    expect(said).toMatch(/budget of the local key is exhausted/);
    expect(said).not.toMatch(/tries again on its own|127\.0\.0\.1/);
  });

  it('says a model that ran out of steps', async () => {
    asked.fail = new MaxTurnsError('s1', []);
    await expect(assist.assistRound(base)).rejects.toThrow(/ran out of steps/);
  });

  it('says the reason of any other failure, masked and cut', async () => {
    asked.fail = new Error(`no key found: ${KEY} ${'x'.repeat(900)}`);
    const error = await assist.assistRound(base).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^The assistant could not get an answer: no key found:/);
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message.length).toBeLessThan(400);
  });

  it('says an answer that is nothing at all, for the round and for the review', async () => {
    for (const answer of [null, undefined, 'text', 12, []]) {
      asked.answer = answer;
      await expect(assist.assistRound(base), String(answer)).rejects.toThrow(/answered with nothing/);
      await expect(assist.assistReview(base), String(answer)).rejects.toThrow(/answered with nothing/);
    }
  });

  it('says a review with no draft at all', async () => {
    asked.answer = reviewAnswer({ draft: { name: '', job: '', instructions: '' } });
    await expect(assist.assistReview(base)).rejects.toThrow(/answered with nothing/);
  });
});

describe('the channels', () => {
  it('are five, all under agentAssist:', () => {
    const handled = new Map<string, (...args: never[]) => unknown>();
    assist.agentAssist({ handle: (channel, fn) => void handled.set(channel, fn), notify: () => undefined, emit: () => undefined, job: () => undefined });
    expect([...handled.keys()].sort()).toEqual(['agentAssist:conclude', 'agentAssist:discard', 'agentAssist:review', 'agentAssist:round', 'agentAssist:saveDraft']);
  });

  it('serve the round and the review through the same functions', async () => {
    const handled = new Map<string, (...args: never[]) => unknown>();
    assist.agentAssist({ handle: (channel, fn) => void handled.set(channel, fn), notify: () => undefined, emit: () => undefined, job: () => undefined });
    const round = (await (handled.get('agentAssist:round') as (input: unknown) => Promise<{ questions: unknown[] }>)(base)).questions;
    expect(round).toHaveLength(3);
    asked.answer = reviewAnswer();
    const review = (await (handled.get('agentAssist:review') as (input: unknown) => Promise<{ settings: unknown }>)(base)).settings;
    expect(review).toMatchObject({ permission: 'read', tracker: 'none', shell: 'none' });
  });

  it('touch neither the forum nor Actions: a question and a review write nothing anywhere', async () => {
    const forum = forumStore();
    const threadsBefore = forum.list().map((s) => s.id);
    const actionsBefore = actions.listActions().length;
    const teamBefore = JSON.stringify((await import('../src/main/workspaceConfig')).getConfig().agents.team);
    await assist.assistRound(base);
    asked.answer = reviewAnswer({ tracker: reasoned('read'), permission: reasoned('worktree') });
    await assist.assistReview(base);
    await assist.assistReview({ ...base, mode: 'adjust', from: 'writer' });
    expect(forum.list().map((s) => s.id)).toEqual(threadsBefore);
    expect(actions.listActions()).toHaveLength(actionsBefore);
    expect(JSON.stringify((await import('../src/main/workspaceConfig')).getConfig().agents.team)).toBe(teamBefore);
  });
});
