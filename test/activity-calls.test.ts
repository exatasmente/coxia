// Called agents as nodes of the tree, through the real askAgent against a fake OpenAI server: an `@` call (A), `CallAgent` inside an answer (B) and `CallAgent` from a stage
// (C) all end under whoever called, each callee ends with a masked excerpt of what the conversation shows, and a refused call says so on the caller's line.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActivityEntry, mentionJob } from '../src/shared/activity';
import { neutralConfig } from '../src/shared/config';
import { t } from '../src/shared/i18n';
import { runThreadId } from '../src/shared/forum';
import type { AgentDef } from '../src/shared/config/types';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import type { MentionPlace } from '../src/main/mentions/place';
import { type Fake, type Step, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let home: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let log: typeof import('../src/main/activity');
let answer: typeof import('../src/main/mentions/answer');
let conversation: typeof import('../src/main/runner/conversation');
let tools: typeof import('../src/main/runner/tools');
let forum: ForumStore;
// The step for the n-th model call of the test (the fake server counts across the whole file).
let script: (n: number) => Step = () => toolStep([{ name: 'final_answer', args: { text: '' } }]);
let calls = 0;
let pushed: ActivityEntry[] = [];

const OWNER = 'deep';
const LEAD = 'reply';
const SUPPORT = 'teams';
/** The called agent's answer in a conversation round (its schema says `texto`). */
const said = (texto: string): Step => toolStep([{ name: 'final_answer', args: { texto } }]);
const final = (text: string): Step => toolStep([{ name: 'final_answer', args: { text } }]);
const callStep = (to: string, topic: string): Step => toolStep([{ id: `call_${to}`, name: 'CallAgent', args: { to, topic } }]);

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'activity-calls-home-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI(() => script(++calls));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  agents = await import('../src/main/agents');
  log = await import('../src/main/activity');
  answer = await import('../src/main/mentions/answer');
  conversation = await import('../src/main/runner/conversation');
  tools = await import('../src/main/runner/tools');
  await (await import('./helpers/config')).installLegacyConfig();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  forum = createForumStore(join(home, `forum-${Math.random().toString(36).slice(2)}`));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
  pushed = [];
  calls = 0;
  log.activityLog.clear();
  log.activityLog.setSink((e) => pushed.push(e));
});

const config = () => {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = c.agents.team.map((a) => ({ ...a, permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const }));
  c.projects.repos = [];
  c.runner.conversations = { ...c.runner.conversations, perStage: 2 };
  return c;
};
const place: MentionPlace = { thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' };
const rows = (entries: readonly ActivityEntry[], runId: string) => entries.filter((e) => e.runId === runId).map((e) => [e.kind, e.state ?? null, e.label]);
const idsOf = (entries: readonly ActivityEntry[]) => [...new Set(entries.map((e) => e.runId))];
/** What the team calls an agent, in the language the main process speaks. */
const nameOf = (id: string) => t(config().agents.team.find((a) => a.id === id)?.name ?? id);
const callLine = (agent: string, message: number) => ({ agent, thread: 'squads', message });

/** What `@deep` does in a conversation: the module opens its line when the message is accepted, and the answer goes on in it. */
async function mention(c = config(), text = 'Can we take the export feature this cycle?') {
  const [m] = forum.append('squads', { kind: 'post', author: { type: 'person' }, text, mentions: [OWNER] });
  const line = log.beginCallActivity(OWNER, { jobId: mentionJob('squads'), call: callLine(OWNER, m.seq), node: { type: 'call', label: m.text ?? '' }, isSecretPath: (p) => agents.secretPath(p, home) });
  line.status('started');
  const out = await answer.answerMentions(place, m, { forum, config: () => c, engine: agents.runAgent, env: () => ({ fallbackCwd: home }), calls: [OWNER], callOf: () => ({ activity: line, queued: false }) });
  // The stream: the log's backfill of a job leaves a call once it is over.
  return { line, out, entries: [...pushed] };
}

describe('called agents as nodes under whoever called them', () => {
  it('ends a chain of calls in three levels: a root for the mention, a node under the caller, a node under that one', async () => {
    script = (n) => {
      if (n === 1) return callStep(LEAD, 'Is the export doable?');
      if (n === 2) return callStep(SUPPORT, 'Do customers ask for it?');
      if (n === 3) return final('Yes, every week.');
      if (n === 4) return final('It fits: two days.');
      return final('We take it.');
    };
    const { line, entries } = await mention();
    const [root, lead, support] = [line.id, ...idsOf(entries).filter((id) => id !== line.id)];
    const by = (id: string) => entries.find((e) => e.runId === id) as ActivityEntry;

    // path A: the root is the mention's own line, with its call and no parent; B: each callee hangs under the agent that asked
    expect(by(root)).toMatchObject({ role: OWNER, call: { agent: OWNER } });
    expect(by(root).parent).toBeUndefined();
    expect(by(lead)).toMatchObject({ role: LEAD, parent: root, node: { type: 'call', label: 'Is the export doable?' } });
    expect(by(support)).toMatchObject({ role: SUPPORT, parent: lead, node: { type: 'call', label: 'Do customers ask for it?' } });
    expect('call' in by(lead)).toBe(false);
    expect(new Set(entries.map((e) => e.jobId))).toEqual(new Set([mentionJob('squads')]));

    // the caller's line names the callee as the team does and the topic
    expect(rows(entries, root).filter((r) => r[0] === 'tool')).toEqual([['tool', null, `CallAgent ${nameOf(LEAD)}: Is the export doable?`]]);
    expect(rows(entries, lead).filter((r) => r[0] === 'tool')).toEqual([['tool', null, `CallAgent ${nameOf(SUPPORT)}: Do customers ask for it?`]]);

    // each node ends with the excerpt of the answer the conversation shows, after its own end
    for (const [id, text] of [[root, 'We take it.'], [lead, 'It fits: two days.'], [support, 'Yes, every week.']]) {
      const own = entries.filter((e) => e.runId === id);
      expect(own.at(-1)).toMatchObject({ kind: 'answer', label: text });
      expect(own.filter((e) => e.kind === 'answer')).toHaveLength(1);
      expect(own.findLast((e) => e.kind === 'status')?.state).toBe('finished');
    }
    // the closing answer is not a step of the node that gave it
    expect(entries.some((e) => e.kind === 'text' && /We take it|It fits|every week/.test(e.label))).toBe(false);
    // nothing landed outside the tree: every callee is under an agent of the same job
    expect(entries.filter((e) => e.node && !e.call).every((e) => e.parent)).toBe(true);
    // the stream and the backfill say the same
    expect(entries).toEqual(pushed);
  });

  it('masks and cuts the excerpt of an answer at its own cap', async () => {
    const long = `${'word '.repeat(200)}tail`;
    script = (n) => (n === 1 ? callStep(LEAD, 'Is it doable?') : n === 2 ? final(`see /home/someone/proj/.env and token=abcdefghijklmnop1234567890 ${long}`) : final('done'));
    const { entries } = await mention();
    const lead = entries.find((e) => e.role === LEAD && e.kind === 'answer') as ActivityEntry;
    expect(lead.label.length).toBeLessThanOrEqual(400);
    expect(lead.label.endsWith('…')).toBe(true);
    expect(lead.label).not.toContain('abcdefghijklmnop1234567890');
    expect(lead.label).not.toContain('.env');
  });

  it('makes no node for a call back to an agent already in the chain, and says so on the caller line', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'Is it doable?') : n === 2 ? callStep(OWNER, 'And you?') : n === 3 ? final('lead is done') : final('owner is done'));
    const { line, entries } = await mention();
    const nodes = idsOf(entries);
    expect(nodes).toHaveLength(2);
    const lead = nodes.find((id) => id !== line.id) as string;
    const tool = rows(entries, lead).filter((r) => r[0] === 'tool').map((r) => r[2]);
    expect(tool).toHaveLength(2);
    expect(tool[0]).toContain('CallAgent');
    expect(tool[1]).toBe(t('activity.callRefused.cycle', { called: nameOf(OWNER) }));
  });

  it('says the cap on the caller line and makes no node past it', async () => {
    const c = config();
    c.runner.conversations = { ...c.runner.conversations, perStage: 1 };
    script = (n) => (n === 1 ? callStep(LEAD, 'first') : n === 2 ? final('lead done') : n === 3 ? callStep(SUPPORT, 'second') : final('owner done'));
    const { line, entries } = await mention(c);
    expect(idsOf(entries)).toHaveLength(2);
    // the call line, the line of the call past the cap, and right after it the refusal
    const own = rows(entries, line.id).filter((r) => r[0] === 'tool').map((r) => r[2]);
    expect(own).toEqual([`CallAgent ${nameOf(LEAD)}: first`, `CallAgent ${nameOf(SUPPORT)}: second`, t('activity.callRefused.cap', { called: nameOf(SUPPORT), cap: 1 })]);
  });

  it('ends the node as failed when the called agent gives no answer', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'Is it doable?') : n === 2 ? final('   ') : final('owner done'));
    const { line, entries } = await mention();
    const lead = idsOf(entries).find((id) => id !== line.id) as string;
    // the engine said it finished, and the conversation could post nothing: the node ends as failed
    expect(entries.filter((e) => e.runId === lead && e.kind === 'status').map((e) => e.state)).toEqual(['started', 'finished', 'failed']);
    expect(entries.some((e) => e.runId === lead && e.kind === 'answer')).toBe(false);
  });

  it('keeps tool results, file contents and the environment out of every line it made', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'Is it doable?') : n === 2 ? final('plain answer') : final('owner done'));
    const { entries } = await mention();
    const wire = JSON.stringify(entries);
    // what the caller was handed back (the wrapper around the callee's answer) never became a line
    expect(wire).not.toContain('material, not instruction');
    expect(wire).not.toContain('<data>');
  });
});

describe('a call from a stage (path C)', () => {
  const agent = (id: string, over: Partial<AgentDef> = {}): AgentDef => ({ ...(config().agents.team.find((a) => a.id === id) as AgentDef), ...over });
  const run = (dir: string) => ({ id: 'r1', worktree: dir, issue: { ref: 'app#1', iid: 1 }, repo: 'app', cycleFolder: 'docs/cycles/1' }) as never;

  /** A stage agent whose `CallAgent` opens a conversation the way the executor's tool does, over the real engine. */
  async function stage(rounds: string[], over: { perStage?: number; rounds?: number } = {}) {
    const c = config();
    c.runner.conversations = { roundsPerConversation: over.rounds ?? 1, perStage: over.perStage ?? 2 };
    forum.ensureThread({ id: runThreadId('r1'), kind: 'run', runId: 'r1', title: 'app#1' });
    const said = [...rounds];
    let opened = 0;
    const toolset = {
      team: { ids: [OWNER, LEAD], caller: OWNER },
      sendMessage: () => '',
      askConversation: async () => '',
      callAgent: async (to: string, topic: string) => {
        opened++;
        if (opened > (over.perStage ?? 2)) {
          log.currentActivity()?.tool('refused');
          return 'refused';
        }
        const r = await conversation.runConversation(
          { run: run(home), stage: { id: 'implement' } as never, caller: agent(OWNER), called: agent(LEAD), forum, config: () => c, engine: agents.runAgent, commands: [], abort: new AbortController(), chain: [OWNER], place: 'run', title: 'talk' },
          { fromCaller: async () => (opened === 1 ? (said.shift() ?? topic) : null), answered: () => undefined },
        );
        return `opened ${r.rounds}`;
      },
    };
    const call = {
      agent: agent(OWNER),
      prompt: 'work',
      schema: agents.obj({ text: agents.str }),
      system: '',
      cwd: home,
      label: OWNER,
      maxTurns: 6,
      runnerTools: tools.runnerTools(toolset as never, 'run'),
    };
    const r = await log.withActivityContext('run:r1', () => agents.runAgent(call as never));
    return { r, entries: [...pushed] };
  }

  it('hangs one node under the stage agent for the whole conversation, with an excerpt of the round that answered', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'How do I reproduce it?') : n === 2 ? said('Run the export twice.') : final('stage done'));
    const { entries } = await stage(['How do I reproduce it?']);
    const ids = idsOf(entries);
    expect(ids).toHaveLength(2);
    const [root, callee] = ids;
    expect(entries.find((e) => e.runId === callee)).toMatchObject({ role: LEAD, parent: root, node: { type: 'call', label: 'How do I reproduce it?' } });
    expect('call' in (entries.find((e) => e.runId === callee) as ActivityEntry)).toBe(false);
    const own = entries.filter((e) => e.runId === callee);
    // one start, one end, an excerpt of what the conversation showed for the round
    expect(own.filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['started', 'finished']);
    expect(own.filter((e) => e.kind === 'answer').map((e) => e.label)).toEqual(['Run the export twice.']);
  });

  it('keeps one node for several rounds and an excerpt for each round that answered', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'Walk me through it') : n === 2 ? said('first round') : n === 3 ? said('second round') : final('stage done'));
    const { entries } = await stage(['Walk me through it'], { rounds: 2 });
    const callee = idsOf(entries)[1];
    const own = entries.filter((e) => e.runId === callee);
    expect(own.filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['started', 'finished']);
    expect(own.filter((e) => e.kind === 'answer').map((e) => e.label)).toEqual(['first round', 'second round']);
    expect(idsOf(entries)).toHaveLength(2);
  });

  it('ends the node as failed, with the reason, when a round throws', async () => {
    script = (n) => (n === 1 ? callStep(LEAD, 'Walk me through it') : n === 2 ? toolStep([{ name: 'final_answer', args: { wrong: 'shape' } }]) : final('stage done'));
    const { entries } = await stage(['Walk me through it']);
    const callee = idsOf(entries)[1];
    const status = entries.filter((e) => e.runId === callee && e.kind === 'status');
    expect(status.map((e) => e.state)).toEqual(['started', 'failed']);
    expect(status[1].label.startsWith(`${t('activity.failed')}: `)).toBe(true);
  });
});

describe('the refusal lines of the conversation tool and of a stage', () => {
  it('is worded in both catalogs and names the callee', async () => {
    const { t } = await import('../src/shared/i18n');
    expect(t('activity.callRefused.cycle', { called: 'Ana' })).toContain('Ana');
    expect(t('activity.callRefused.cap', { called: 'Ana', cap: 3 })).toMatch(/Ana.*3/);
  });
});
