// The direct conversation of an agent and what an answer proposes wherever it answers: the owner of an `agent` thread is called without an `@`, each message of a person
// is answered in order, and the writes an answer raises wait in Actions (a comment, a label change, a status, a closing, an issue) through the module's own path — the
// same door every write of the app goes through, with the host that does not have an operation said as such and nothing written. A comment and a label change go out by
// themselves only when the agent is autonomous; everything else always waits.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VcsCommand } from '../src/shared/types';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { type ForumMessage, MAX_MENTIONS, agentThreadId } from '../src/shared/forum';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { answerMentions, answerText } from '../src/main/mentions/answer';
import { callsOf } from '../src/main/mentions/module';
import { placeOfThread } from '../src/main/mentions/place';
import { proposeMention } from '../src/main/mentions/propose';
import { prompt } from '../src/main/cyclePrompts';
import { fakeEngine } from './helpers/runner';
import { fakeGitlabRuntime } from './helpers/vcs';

let dir: string;
let forum: ForumStore;
let ran: VcsCommand[];

const actions = await import('../src/main/actions');
const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { writeRegistry } = await import('../src/main/workspaces-core');
const { installLegacyConfig } = await import('./helpers/config');
const { setVcsRuntimeForTests, vcsProvider } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
await installLegacyConfig();

/** A code host the app reads and writes through the provider, with one issue of the project the workspace works in. A write is recorded, never sent. */
const installForge = (over: { issue?: number } = {}): void => {
  const iid = over.issue ?? 101;
  const read = (endpoint: string): unknown => {
    if (/^projects\/[^/]+\/issues\/\d+$/.test(endpoint)) return { iid, id: iid, project_id: 1, title: 'The thing', state: 'opened', labels: [], web_url: `https://git.acme.test/app/${iid}` };
    if (/^projects\/[^/]+$/.test(endpoint)) return { id: 1, path_with_namespace: 'acme/app' };
    return {};
  };
  setVcsRuntimeForTests(
    fakeGitlabRuntime(read, () => ({ data: { project: { workItems: { nodes: [{ id: `gid://gitlab/WorkItem/${iid}`, widgets: [] }] } } } }), async (command, meta) => {
      ran.push(command);
      if (meta) {
        meta.code = 201;
        meta.response = { id: ran.length };
      }
      return 'ok';
    }),
  );
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-agent-chat-'));
  forum = createForumStore(dir);
  // A real workspace: the person approves the proposals of their own team, so the door is not the refusal of a test workspace. A test workspace is checked on its own.
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  ran = [];
  installForge();
});

afterEach(() => {
  setVcsRuntimeForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const config = () => {
  const c = neutralConfig();
  c.language = 'en';
  // The owner of a direct conversation reads the code host, so it may propose writes.
  c.agents.team = c.agents.team.map((a, i) => ({ ...a, permission: 'read' as const, tracker: (i === 0 ? 'read' : a.tracker) as 'read' | 'none' }));
  c.projects.repos = [];
  c.projects.issues = { vcsId: null, project: 'acme/app', projectId: null, refPrefix: 'app#', cardScope: 'assigned', cardLabels: [] };
  return c;
};

/** The workspace's issue project, without a numeric id, so statuses stay the ids of the host's own statuses. */
const plainProject = (c: ReturnType<typeof config>): void => {
  c.projects.issues = { ...c.projects.issues, projectId: null };
};

const owner = (c: ReturnType<typeof config>): typeof c.agents.team[number] => c.agents.team[0];

const agentThread = (c: ReturnType<typeof config>, id: string): string => {
  ensureAgentThread(forum, { id, name: id }, 'en');
  return agentThreadId(id);
};

const personMessage = (thread: string, text: string, mentions: string[] = []): ForumMessage => {
  const [m] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text, mentions });
  return m;
};

const answered = (thread: string): ForumMessage[] => (forum.read(thread, 0, 2000)?.messages ?? []).filter((m) => m.author.type === 'agent');
const systemLine = (thread: string, code: string) => (forum.read(thread, 0, 2000)?.messages ?? []).find((m) => m.code === code);

describe('the direct conversation of an agent', () => {
  it('belongs to one agent, is listed as a conversation, and is made once', () => {
    const c = config();
    const id = owner(c).id;
    // `forum:list` guarantees one conversation per agent: called again, it keeps the one it has.
    ensureAgentThread(forum, { id, name: id }, 'en');
    ensureAgentThread(forum, { id, name: id }, 'en');
    const summary = forum.summary(agentThreadId(id));
    expect(summary).toMatchObject({ kind: 'agent', agent: id, title: `Chat with ${id}` });
    expect(forum.list().filter((s) => s.kind === 'agent')).toHaveLength(1);
    // The header the format writes is accepted back: a thread of kind `agent`.
    expect(forum.read(agentThreadId(id), 0, 10)?.thread.kind).toBe('agent');
  });

  it('calls its owner without an `@`, first, and calls nobody for an agent post', () => {
    const c = config();
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const alone = personMessage(thread, 'go over the open issues');
    expect(callsOf(alone, id)).toEqual([id]);
    // An `@` for another agent still calls that one, within the limit of three, the owner first.
    const also = personMessage(thread, `@${c.agents.team[1].id} look too`, [c.agents.team[1].id]);
    expect(callsOf(also, id)).toEqual([id, c.agents.team[1].id]);
    expect(callsOf(also, id)).toHaveLength(Math.min(2, MAX_MENTIONS));
    const agentPost = forum.append(thread, { kind: 'post', author: { type: 'agent', id }, text: 'said something' })[0];
    expect(callsOf(agentPost, id)).toEqual([]);
  });

  it('is a place of its own: the workspace to read, the owner named, no squad', () => {
    const c = config();
    c.projects.repos = [{ id: 'app', path: dir, remoteUrl: null, vcsId: null, projectPath: 'group/project' }];
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const place = placeOfThread(forum.summary(thread), () => null, c);
    expect(place).toMatchObject({ kind: 'channel', thread, squad: null, owner: id });
    expect(place?.repos.map((r) => r.id)).toEqual(['app']);
  });

  it('answers the owner, in order, one message after the other, with the conversation as context', async () => {
    const c = config();
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'You asked: first' }), () => ({ text: 'You asked: second' }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    // The two messages are answered one after the other, in the order they arrived; the owner is the one the module calls, without an `@`.
    const first = personMessage(thread, 'the first one');
    const second = personMessage(thread, 'the second one');
    await answerMentions(place, first, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(first, id) });
    await answerMentions(place, second, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(second, id) });
    const answers = answered(thread);
    expect(answers.map((m) => m.text)).toEqual(['You asked: first', 'You asked: second']);
    // The context of the second answer is the conversation of the place.
    expect(engine.calls[1].prompt).toContain('the first one');
  });

  it('never gets the agent a confinement: a conversation writes no file', async () => {
    const c = config();
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'read only' }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'change the code');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id) });
    expect(engine.calls[0].confine).toBeUndefined();
  });

  it('keeps the agent read only on the code even when its own tools turn the file tools on', async () => {
    const c = config();
    // The workspace turns the file tools off; this agent turns them on for itself alone.
    c.agents.tools = { ...c.agents.tools, files: false, skills: false, trackerMcp: false, vcsCli: false, subagents: false };
    const id = owner(c).id;
    c.agents.team = c.agents.team.map((a) => (a.id === id ? { ...a, tools: { ...c.agents.tools, files: true } } : a));
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'read only' }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'change the code');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id) });
    // The call is a mention: no confinement, so the file write tools stay out of the policy whatever the agent's tools say.
    const call = engine.calls[0];
    expect(call.confine).toBeUndefined();
    expect(call.agent.permission).toBe('read');
  });
});

describe('the writes an answer proposes', () => {
  const place = () => ({ thread: 'general', kind: 'general' as const, repos: [], ref: 'app#101', title: 'The thing' });
  const propose = async (writes: Parameters<typeof proposeMention>[0]['writes'], over: Partial<Parameters<typeof proposeMention>[0]> = {}) => {
    const c = config();
    return proposeMention({ writes, place: place(), agent: c.agents.team[0], autonomous: false, config: c, issue: 101, seq: 3, ...over });
  };

  it('plans each operation as a proposal in Actions, with the write to run', async () => {
    const outcomes = await propose([
      { op: 'comment', issue: 101, body: 'A note.' },
      { op: 'labels', issue: 101, add: ['P1'], remove: ['P2'] },
      { op: 'status', issue: 101, status: '1' },
      { op: 'close', issue: 101, body: 'Done.' },
      { op: 'createIssue', title: 'A new direction', body: 'Body.', labels: ['idea'] },
    ]);
    expect(outcomes.map((o) => `${o.status}:${(o as { op?: string }).op ?? ''}`)).toEqual(['proposed:', 'proposed:', 'proposed:', 'proposed:', 'proposed:']);
    const waiting = actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(waiting).toHaveLength(5);
    expect(waiting.every((a) => a.state === 'pending' && a.command)).toBe(true);
    // Each write carries its operation and the answer's batch, and nothing ran before the person's yes.
    expect(waiting.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['close', 'comment', 'createIssue', 'labels', 'status']);
    expect(new Set(waiting.map((a) => (a.unit as { batch: string }).batch))).toEqual(new Set(['general:3']));
    expect(ran).toEqual([]);
  });

  it('keeps every command a write needs: a label change the host plans as several calls is not cut to the first', async () => {
    // A host that plans a write as several calls (GitHub removes one label per call): the proposal must hold all of them, or a removal is silently dropped.
    const c = config();
    const base = vcsProvider();
    const commands: VcsCommand[] = [
      { vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/101/labels', fields: {}, json: '{"labels":["P1"]}' },
      { vcs: 'github', via: 'api', method: 'DELETE', endpoint: 'repos/acme/app/issues/101/labels/P2', fields: {} },
      { vcs: 'github', via: 'api', method: 'DELETE', endpoint: 'repos/acme/app/issues/101/labels/P3', fields: {} },
    ];
    setVcsRuntimeForTests({ provider: { ...base, planWrite: async () => commands }, exec: { run: async () => 'ok' } } as never);
    const outcome = await proposeMention({ writes: [{ op: 'labels', issue: 101, add: ['P1'], remove: ['P2', 'P3'] }], place: place(), agent: c.agents.team[0], autonomous: false, config: c, issue: 101, seq: 3 });
    expect(outcome[0]).toMatchObject({ status: 'proposed', count: 3 });
    // The write is proposed whole: one proposal per command the host planned, none dropped.
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write')).toHaveLength(3);
  });

  it('distinguishes two equal writes of one answer, and does not repeat one across answers', async () => {
    const one = { op: 'comment' as const, issue: 101, body: 'Same text.' };
    await propose([one, one]);
    const after = actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(after).toHaveLength(2);
    // The same answer again: the keys already wait, so nothing is proposed twice.
    await propose([one]);
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write')).toHaveLength(2);
    // Another answer of the same conversation: a new proposal of the same text.
    await propose([one], { seq: 4 });
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write')).toHaveLength(3);
  });

  it('says a host that does not have the operation and proposes nothing', async () => {
    const { VcsError } = await import('../src/main/vcs/errors');
    const base = vcsProvider();
    setVcsRuntimeForTests({ provider: { ...base, planWrite: async () => { throw new VcsError('unsupported', { kind: 'Bitbucket', what: 'labels' }); } } } as never);
    const outcomes = await propose([{ op: 'labels', issue: 101, add: ['P1'], remove: [] }]);
    expect(outcomes[0]).toMatchObject({ status: 'unsupported', op: 'labels' });
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write')).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('lets a comment and a label change go out by themselves when the agent is autonomous, audited, and makes everything else wait', async () => {
    const outcomes = await propose(
      [
        { op: 'comment', issue: 101, body: 'Runs itself.' },
        { op: 'labels', issue: 101, add: ['P1'], remove: [] },
        { op: 'close', issue: 101, body: 'Waits.' },
        { op: 'status', issue: 101, status: '1' },
        { op: 'createIssue', title: 'Waits too', body: 'Body.', labels: [] },
      ],
      { autonomous: true, seq: 4 },
    );
    expect(outcomes.map((o) => o.status)).toEqual(['auto', 'auto', 'proposed', 'proposed', 'proposed']);
    // Each says what it wrote and on which issue: outside a run, the place names none.
    expect(outcomes.map((o) => ('summary' in o ? o.summary : null))).toEqual(['#101 — a comment', '#101 — labels +P1', '#101 — close', '#101 — status 1', 'a new issue: Waits too']);
    // The two low-risk writes ran audited, with the agent as who; the rest only waits.
    const audit = listAudit();
    expect(audit).toHaveLength(2);
    expect(audit.every((l) => l.ok === true && l.by === config().agents.team[0].id)).toBe(true);
    const waiting = actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(waiting.map((a) => (a.unit as { op: string }).op).sort()).toEqual(['close', 'createIssue', 'status']);
  });

  it('tells an autonomous agent that its comments and labels go out as it answers, and the thread says what was written', async () => {
    const c = config();
    const id = owner(c).id;
    c.agents.team = c.agents.team.map((a) => (a.id === id ? { ...a, autonomous: true } : a));
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'Labelled it.', proposals: [{ op: 'labels', issue: 101, add: ['coxia'], remove: [] }] }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'label 101');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id), propose: proposeMention });
    expect(engine.calls[0].system).toContain(prompt('runner.mention.proposalsAuto'));
    expect(engine.calls[0].system).not.toContain(prompt('runner.mention.proposals'));
    expect(systemLine(thread, 'runner.mention.autoWrote')?.params).toMatchObject({ agent: id, what: '#101 — labels +coxia' });
  });

  it('tells an agent that may write labels which label starts the cycle and which are the priority levels', async () => {
    const c = config();
    c.runner.triggerLabel = 'coxia';
    c.devCycle.priority.labels = ['^priority:high$', '^priority:low$', 'p[0-9]'];
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'ok', proposals: [] }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'prioritize 101');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id), propose: proposeMention });
    const system = engine.calls[0].system;
    expect(system).toContain(prompt('runner.mention.labels.trigger', { label: 'coxia' }));
    // Only the levels a priority can be written to: a pattern is a level the app reads, not a label it can put.
    expect(system).toContain(prompt('runner.mention.labels.priority', { labels: '`priority:high`, `priority:low`' }));
  });

  it('tells an agent that the workspace has no priority labels, so it does not invent one', async () => {
    const c = config();
    c.devCycle.priority.labels = [];
    const id = owner(c).id;
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'ok', proposals: [] }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'prioritize 101');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id), propose: proposeMention });
    expect(engine.calls[0].system).toContain(prompt('runner.mention.labels.noPriority'));
  });

  it('tells an agent that is not autonomous that every write waits, and the thread says what waits', async () => {
    const c = config();
    const id = owner(c).id;
    c.agents.team = c.agents.team.map((a) => (a.id === id ? { ...a, autonomous: false } : a));
    const thread = agentThread(c, id);
    const engine = fakeEngine();
    engine.script(id, () => ({ text: 'Proposed it.', proposals: [{ op: 'labels', issue: 101, add: ['coxia'], remove: [] }] }));
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const message = personMessage(thread, 'label 101');
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: callsOf(message, id), propose: proposeMention });
    expect(engine.calls[0].system).toContain(prompt('runner.mention.proposals'));
    expect(systemLine(thread, 'runner.mention.proposed')?.params).toMatchObject({ agent: id, what: '#101 — labels +coxia' });
  });

  it('registers a proposal of a place that names no issue on the workspace issue project, never on 0', async () => {
    const c = config();
    const outcomes = await proposeMention({ writes: [{ op: 'comment', issue: 101, body: 'A note.' }], place: { thread: 'agent-planner', kind: 'channel', repos: [], title: 'Chat with planner' }, agent: c.agents.team[0], autonomous: false, config: c, issue: 0, seq: 2 });
    expect(outcomes[0]).toMatchObject({ status: 'proposed' });
    const waiting = actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(waiting).toHaveLength(1);
    // The workspace's own issue project, not the 0 of a place that names no issue: the registration and the audit line point at an issue.
    const { getConfig } = await import('../src/main/workspaceConfig');
    expect(waiting[0].issue).toBe(getConfig().projects.issues.projectId);
    expect(waiting[0].issue).not.toBe(0);
    // A place that is not a run carries no `runId`: the runner is not told about a proposal it did not raise.
    expect(waiting[0].unit).not.toHaveProperty('runId');
  });

  it('is refused whole in a test workspace: nothing is written', async () => {
    writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: true }] });
    const outcomes = await propose([{ op: 'comment', issue: 101, body: 'Nope.' }], { autonomous: true });
    // The proposal waits either way; the door refuses the write when the person approves.
    const waiting = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    if (waiting) await expect(actions.approveAction(waiting.id)).rejects.toThrow();
    expect(listAudit()).toEqual([]);
    expect(outcomes.some((o) => o.status === 'proposed' || o.status === 'failed')).toBe(true);
  });
});

describe('the text of an answer', () => {
  it('is the text inside an answer the model wrote whole as its text, and anything else as it came', () => {
    expect(answerText('{"text": "Tested it.\\n\\nThe app is up."}')).toBe('Tested it.\n\nThe app is up.');
    expect(answerText('  Plain answer.  ')).toBe('Plain answer.');
    expect(answerText('{"other": 1}')).toBe('{"other": 1}');
    expect(answerText('{not json}')).toBe('{not json}');
    expect(answerText(undefined)).toBe('');
  });
});
