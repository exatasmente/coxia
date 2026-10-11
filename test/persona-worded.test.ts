// What the persona does is worded as the persona's and never as the person's (#248): the moves of a run take a `who` that is the person unless the persona's door says
// otherwise, a post made through the door is authored by the persona and calls nobody, the memory and procedure marks and the proposals say who, and a scan fails when a
// new place words a record as the person's without being listed here.
import { readFileSync, readdirSync, statSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, AuditKind } from '../src/shared/auditoria';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { setLanguage } from '../src/shared/i18n';
import { agentThreadId, type ForumDraft, type ForumMessage } from '../src/shared/forum';
import {
  PERSON_WHO,
  type FlowStage,
  type Run,
  type Transition,
  ask,
  acceptStage,
  answer,
  cancel,
  gateApprove,
  gateReject,
  gateSkip,
  memoryEdited,
  migrateFlow,
  personaWho,
  retry,
  returnStage,
  reviewReturn,
  sendBackTo,
  stageDone,
  stageFailed,
  startRun,
  startStage,
  waitSkip,
} from '../src/shared/runs';
import { createMemoryChannels } from '../src/main/memory/channels';
import { createMemoryStore } from '../src/main/memory/store';
import { createProcedureChannels } from '../src/main/procedures/channels';
import { createProcedureOffers } from '../src/main/procedures/offers';
import { createProcedureStore } from '../src/main/procedures/store';
import { factsOfThread } from '../src/main/runner/memory';
import { agentFlowStages, drive, flowWithAutonomy, startInput } from './helpers/runs';
import { fakeGitlabRuntime } from './helpers/vcs';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { newActId, runAct } = await import('../src/main/persona/act');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore, forumModule, personPost } = await import('../src/main/forum');
const { callsOf } = await import('../src/main/mentions/module');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { ATAS } = await import('../src/main/env');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { gatherEvidence } = await import('../src/main/suggestions');

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const ctx = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined };

const ME = personaWho('me');
const PERSON = { type: 'person' };
const AGENT_ME = { type: 'agent', id: 'me' };
const done = (name: string) => ({ summary: `${name} done`, handoff: `over to the next after ${name}`, artifacts: [`${name}.md`] });
const last = (r: Run) => r.history[r.history.length - 1];
// what the move wrote in the name of whoever made it: the person's own, or the persona's
const decisions = (messages: ForumDraft[]) => messages.filter((m) => m.author.type === 'person' || (m.author.type === 'agent' && m.author.id === 'me'));

describe('the moves of a run, worded as whoever made them', () => {
  /** A move made twice from the same run, as the person (the default every existing caller keeps) and as the persona. */
  function both(prepare: () => ReturnType<typeof drive>, move: (d: ReturnType<typeof drive>, who: typeof ME | undefined, at: string) => Transition) {
    const as = (who: typeof ME | undefined) => {
      const d = prepare();
      const before = d.run.history.length;
      const tr = move(d, who, '2026-10-03T12:00:00.000Z');
      // the first entry the move wrote is the one that says who made it; what follows (a stage entered) is the app's
      return { by: tr.run.history[before].by, authors: decisions(tr.messages).map((m) => m.author), run: tr.run };
    };
    return { person: as(undefined), persona: as(ME) };
  }
  const atGate = () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
    return d;
  };

  it('starts a run: the history says who started it', () => {
    const flow = agentFlowStages();
    expect(startRun(startInput(), flow, '2026-10-03T10:00:00.000Z').run.history[0].by).toBe('person');
    expect(startRun(startInput(), flow, '2026-10-03T10:00:00.000Z', ME).run.history[0].by).toBe('persona');
  });

  it('decides a gate: approve, reject and skip carry the persona in the history and in the decision message, and the person as before', () => {
    const approve = both(atGate, (d, who, at) => gateApprove(d.run, d.flow, at, 'ok', 'person', who));
    expect(approve.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(approve.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
    const reject = both(atGate, (d, who, at) => gateReject(d.run, d.flow, 'Needs the empty case.', at, who));
    expect(reject.person.by).toBe('person');
    expect(reject.persona.by).toBe('persona');
    // the reason is the handoff to the producer, from whoever rejected
    expect(reject.person.authors).toEqual([PERSON, PERSON]);
    expect(reject.persona.authors).toEqual([AGENT_ME, AGENT_ME]);
    const skip = both(atGate, (d, who, at) => gateSkip(d.run, d.flow, 'Not needed.', at, who));
    expect(skip.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(skip.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
  });

  it('keeps the app as the author of an automatic approval, whoever is the default', () => {
    const d = atGate();
    const tr = gateApprove(d.run, d.flow, '2026-10-03T12:00:00.000Z', '', 'app', ME);
    expect(last(tr.run).by).toBe('app');
    expect(tr.messages[0].author).toEqual({ type: 'app' });
  });

  it('answers a question of an agent', () => {
    const asked = () => {
      const d = atGate();
      d.do((r, t) => gateApprove(r, d.flow, t));
      d.do((r, t) => ask(r, { by: 'planner', text: 'Which database?' }, t));
      return d;
    };
    const out = both(asked, (d, who, at) => answer(d.run, d.flow, 'The first one.', at, [], who));
    expect(out.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(out.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
  });

  it('starts, accepts and returns the stage of an agent that does not run by itself', () => {
    const toAccept = () => {
      const d = drive(flowWithAutonomy({ reviewer: false }));
      d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
      d.do((r, t) => gateApprove(r, d.flow, t));
      d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
      d.do((r, t) => gateApprove(r, d.flow, t));
      d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
      return d;
    };
    const start = both(toAccept, (d, who, at) => startStage(d.run, d.flow, at, who));
    expect(start.person.by).toBe('person');
    expect(start.persona.by).toBe('persona');
    const waiting = () => {
      const d = toAccept();
      d.do((r, t) => startStage(r, d.flow, t));
      d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F1' }, t));
      return d;
    };
    const accept = both(waiting, (d, who, at) => acceptStage(d.run, d.flow, at, 'fine', who));
    expect(accept.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(accept.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
    const returned = both(waiting, (d, who, at) => returnStage(d.run, d.flow, 'Again, please.', at, who));
    expect(returned.person).toMatchObject({ by: 'person', authors: [PERSON, PERSON] });
    expect(returned.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME, AGENT_ME] });
  });

  it('sends a run back, retries a failed stage, cancels, skips a wait, migrates the flow and corrects the memory', () => {
    const sent = both(atGate, (d, who, at) => sendBackTo(d.run, d.flow, { toStage: 'refine', note: 'The spec misses the empty case.' }, at, who));
    expect(sent.person).toMatchObject({ by: 'person', authors: [PERSON, PERSON] });
    expect(sent.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME, AGENT_ME] });

    const failed = () => {
      const d = atGate();
      d.do((r, t) => gateApprove(r, d.flow, t));
      d.do((r, t) => stageFailed(r, 'the model said no', t));
      return d;
    };
    expect(both(failed, (d, who, at) => retry(d.run, d.flow, at, who))).toMatchObject({ person: { by: 'person' }, persona: { by: 'persona' } });

    const cancelled = both(atGate, (d, who, at) => cancel(d.run, 'person', at, who));
    expect(cancelled.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(cancelled.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
    // the app's own cancel stays the app's
    expect(last(cancel(atGate().run, 'app', '2026-10-03T12:00:00.000Z', ME).run).by).toBe('app');

    const waiting = () => {
      const flow: FlowStage[] = agentFlowStages().map((s) => (s.id === 'plan' ? { ...s, type: 'wait' as const, waitsFor: { kind: 'pr-merged' as const } } : s));
      const d = drive(flow);
      d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
      d.do((r, t) => gateApprove(r, d.flow, t));
      return d;
    };
    const skipped = both(waiting, (d, who, at) => waitSkip(d.run, d.flow, 'Not waiting any longer.', at, who));
    expect(skipped.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(skipped.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });

    expect(both(atGate, (d, who, at) => migrateFlow(d.run, d.flow, at, who))).toMatchObject({ person: { by: 'person' }, persona: { by: 'persona' } });
    const memory = both(atGate, (d, who, at) => memoryEdited(d.run, at, who));
    expect(memory.person).toMatchObject({ by: 'person', authors: [PERSON] });
    expect(memory.persona).toMatchObject({ by: 'persona', authors: [AGENT_ME] });
  });

  it('is the person when nothing says otherwise', () => {
    expect(PERSON_WHO).toEqual({ by: 'person', author: { type: 'person' } });
    expect(ME).toEqual({ by: 'persona', author: { type: 'agent', id: 'me' } });
  });
});

describe('the cycle memory and the activities', () => {
  const message = (over: Partial<ForumMessage>): ForumMessage => ({
    v: 1, type: 'message', seq: 1, thread: 'run-1', at: '2026-10-03T10:00:00.000Z', kind: 'answer', author: { type: 'person' }, text: '', code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null, ...over,
  });

  it('takes an answer the persona gave into the decisions, worded as the persona\'s; another agent\'s answer is still no decision', () => {
    setLanguage('en');
    const facts = factsOfThread(
      [message({ seq: 3, text: 'Go with the second reading.' }), message({ seq: 4, author: { type: 'agent', id: 'me' }, text: 'Use the queue.' }), message({ seq: 5, author: { type: 'agent', id: 'qa' }, text: 'ignored' })],
      ['me'],
    );
    expect(facts.map((f) => f.marker)).toEqual(['answer:3', 'answer:4']);
    expect(facts[0].line).toBe('Answer: Go with the second reading.');
    expect(facts[1].line).toBe('Answer (given by the persona, for the person): Use the queue.');
    // without the persona's id it is any other agent's answer
    expect(factsOfThread([message({ seq: 4, author: { type: 'agent', id: 'me' }, text: 'x' })])).toEqual([]);
  });
});

describe('what the cycle learns from the person', () => {
  it('does not count what the persona decided as the person\'s own decisions', () => {
    const decided = (who: typeof ME | undefined) => {
      const d = drive();
      d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
      d.do((r, t) => gateApprove(r, d.flow, t));
      d.do((r, t) => ask(r, { by: 'planner', text: 'Which database should the plan use?' }, t));
      d.do((r, t) => answer(r, d.flow, 'The first one.', t, [], who));
      d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
      d.do((r, t) => gateReject(r, d.flow, 'Needs the empty case.', t, who));
      return gatherEvidence({ runs: [d.run], audit: [], ceremonies: [] }, { stages: [] }).filter((e) => e.kind === 'needs-person' || e.kind === 'manual-stage');
    };
    expect(decided(undefined).length).toBeGreaterThan(0);
    expect(decided(ME)).toEqual([]);
  });
});

describe('the memory and the procedures, marked as the persona\'s', () => {
  const T0 = Date.parse('2026-10-09T10:00:00Z');
  const content = { kind: 'repo', key: 'api', title: 'Run the tests', steps: [{ text: 'Run them', run: 'npm test' }], pitfalls: [], waits: [] };

  it('locks a note the persona edited like the person\'s, says the persona in the state, and writes an audit line with the persona as who', () => {
    const ws = mkdtempSync(join(tmpdir(), 'coxia-worded-memory-'));
    let counter = 0;
    const store = createMemoryStore(ws, { now: () => T0, hex: () => (++counter).toString(16).padStart(8, '0'), home: '/home/person' });
    const config = { ...neutralConfig() };
    config.agents.team.push(newAgent({ id: 'developer', name: 'Developer' }));
    let via: 'window' | 'persona' = 'persona';
    const lines: Omit<AuditEntry, 'at'>[] = [];
    const channels = createMemoryChannels({ store, config: () => config, audit: (e) => void lines.push(e), via: () => via, now: () => T0 });
    const scope = { conversation: 'general', agent: 'developer' };
    const saved = store.save({ scope, kind: 'decision', title: 'Use the queue', text: 'Retries go through the queue.', home: '/home/person' });
    if (!saved.ok) throw new Error(saved.text);
    const id = saved.note.id;

    const edited = channels.save('general', 'developer', id, saved.note.revision, { text: 'Retries go through the queue, twice.' });
    expect(edited).toMatchObject({ ok: true, note: { person: true, persona: true } });
    expect(lines.at(-1)).toMatchObject({ kind: 'memory', via: 'persona', by: 'persona' });
    // the lock is the person's: an agent can no longer replace it
    expect(store.save({ scope, id, revision: 2, kind: 'decision', title: 'x', text: 'y', home: '/home/person' })).toMatchObject({ ok: false, code: 'person' });
    expect(channels.list().items[0]).toMatchObject({ person: true, persona: true });

    // the person editing it afterwards is the person's: the mark goes
    via = 'window';
    const again = channels.save('general', 'developer', id, 2, { text: 'Retries go through the queue, three times.' });
    expect(again).toMatchObject({ ok: true, note: { person: true } });
    expect(again.ok && again.note.persona).toBeUndefined();
    expect(lines.at(-1)).toMatchObject({ via: 'window', by: 'person' });
  });

  it('marks a note the persona reviewed as its review, and keeps who took it over when the person reviews later', () => {
    const ws = mkdtempSync(join(tmpdir(), 'coxia-worded-memory-'));
    const store = createMemoryStore(ws, { now: () => T0, hex: () => '00000001', home: '/home/person' });
    const config = neutralConfig();
    config.agents.team.push(newAgent({ id: 'developer', name: 'Developer' }));
    const saved = store.save({ scope: { conversation: 'general', agent: 'developer' }, kind: 'note', title: 'A hand-off', text: 'Look at this.', handoff: true, home: '/home/person' });
    if (!saved.ok) throw new Error(saved.text);
    expect(saved.note.reviewed).toBe(false);
    let via: 'window' | 'persona' = 'persona';
    const channels = createMemoryChannels({ store, config: () => config, via: () => via });
    expect(channels.review('general', 'developer', saved.note.id)).toMatchObject({ ok: true, note: { reviewed: true } });
    via = 'window';
    expect(channels.review('general', 'developer', saved.note.id)).toMatchObject({ ok: true, note: { reviewed: true } });
  });

  it('saves a procedure through the persona\'s door with the person\'s permissions and a mark, and says the persona in the audit', () => {
    const ws = mkdtempSync(join(tmpdir(), 'coxia-worded-procedures-'));
    const store = createProcedureStore(ws, {});
    const written = store.save({ input: content, writer: { by: 'writer', surface: 'stage' }, repos: ['api'] });
    if (!written.ok) throw new Error(written.text);
    const id = written.record.id;
    let via: 'window' | 'persona' = 'persona';
    const lines: Omit<AuditEntry, 'at'>[] = [];
    const config = { ...neutralConfig(), projects: { ...neutralConfig().projects, repos: [{ id: 'api', path: '/tmp/api', remoteUrl: null, vcsId: null, projectPath: null }] } };
    const offers = createProcedureOffers({ store, config: () => config, audit: (e: Omit<AuditEntry, 'at'>) => void lines.push(e), now: () => T0 } as never);
    const channels = createProcedureChannels({ store, config: () => config, audit: (e) => void lines.push(e), via: () => via, offers, now: () => T0 });
    const replaced = channels.save(id, 1, { ...content, title: 'Run the end-to-end tests' });
    expect(replaced).toMatchObject({ ok: true, record: { reviewed: true, origin: { by: 'person', persona: true } } });
    expect(lines.at(-1)?.fields.agent).toBe('persona');
    via = 'window';
    const person = channels.save(id, 2, { ...content, title: 'Run the unit tests' });
    expect(person).toMatchObject({ ok: true, record: { reviewed: true, origin: { by: 'person' } } });
    expect(person.ok && person.record.origin.persona).toBeUndefined();
    expect(lines.at(-1)?.fields.agent).toBe('person');
  });
});

describe('a post made through the door', () => {
  const THREAD = agentThreadId('me');
  const session = () => createSession({ persona: 'me', thread: THREAD, seq: 1, door: 'window' });
  const why = 'The person asked me to leave a note.';

  beforeAll(async () => {
    setLanguage('en');
    const base = neutralConfig();
    saveConfig({
      ...base,
      language: 'en',
      agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' }), newAgent({ id: 'developer', name: 'Developer' })] },
    });
    mkdirSync(join(ATAS, 'forum'), { recursive: true });
    const { ensureAgentThread } = await import('../src/main/forum-channels');
    ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
    forumModule(ctx as never);
    handle('actions:approve', ((id: string) => actions.approveAction(id)) as never);
    setVcsRuntimeForTests(fakeGitlabRuntime(async () => ({}), undefined, async () => 'ok'));
  });
  afterAll(() => setVcsRuntimeForTests(null));

  it('is authored by the persona, never as the person, and calls nobody even when it names an agent', async () => {
    const created = (await ipc.get('forum:create')?.('Notes')) as { id: string };
    const out = await personaDoor.run(session(), 'Conversations', { op: 'post', thread: created.id, text: '@developer please look at this', why });
    expect(out).toMatch(/^Done\./);
    const stored = (forumStore().read(created.id, 0, 100)?.messages ?? []).filter((m) => m.kind === 'post');
    expect(stored).toHaveLength(1);
    expect(stored[0].author).toEqual(AGENT_ME);
    expect(stored[0].mentions).toEqual([]);
    expect(callsOf(stored[0])).toEqual([]);
    // no note that the name is unknown either: nobody was addressed
    expect((forumStore().read(created.id, 0, 100)?.messages ?? []).filter((m) => m.code === 'main.forum.mentions.unknown')).toHaveLength(0);
    // the person's own post in the same thread still calls
    const person = personPost(forumStore(), ['developer'], created.id, '@developer hello');
    expect(person.author).toEqual(PERSON);
    expect(callsOf(person)).toEqual(['developer']);
  });

  it('never answers itself in the persona\'s own thread: an agent\'s post in it calls nobody, the person\'s calls its owner', async () => {
    await personaDoor.run(session(), 'Conversations', { op: 'post', thread: THREAD, text: 'A note for later.', why });
    const mine = (forumStore().read(THREAD, 0, 100)?.messages ?? []).filter((m) => m.kind === 'post').at(-1);
    expect(mine?.author).toEqual(AGENT_ME);
    expect(callsOf(mine as ForumMessage, 'me')).toEqual([]);
    const person = personPost(forumStore(), [], THREAD, 'And now?', true);
    expect(callsOf(person, 'me')).toEqual(['me']);
  });

  it('is the person\'s when the person posts it, in the same handler', async () => {
    const created = (await ipc.get('forum:create')?.('Plain')) as { id: string };
    const posted = (await ipc.get('forum:post')?.(created.id, 'Hello')) as ForumMessage;
    expect(posted.author).toEqual(PERSON);
  });

  const asAct = <T>(fn: () => T): T => {
    const act = { open: true, id: newActId(), door: 'window', said: '', mask: (t: string) => t, wrote: { count: 0, kinds: new Set<AuditKind>() } };
    try {
      return runAct(act, fn);
    } finally {
      act.open = false;
    }
  };
  const propose = (key: string) => actions.proposeVcsAction({ key, issue: 31, issueTitle: 'Fix', summary: `Comment ${key}`, command: { via: 'glab', method: 'POST', endpoint: `projects/acme%2Fweb/issues/31/notes`, fields: { body: key } } });

  it('records on a proposal that the persona made it, and on nothing else', () => {
    const mine = asAct(() => propose('k-mine'));
    const theirs = propose('k-theirs');
    expect(mine?.proposedBy).toBe('persona');
    expect(theirs?.proposedBy).toBeUndefined();
    expect(actions.listActions().find((a) => a.id === mine?.id)?.proposedBy).toBe('persona');
  });

  it('says on the line of an approval that the persona approved its own proposal, and that it did not when the person proposed it', async () => {
    const mine = asAct(() => propose('k-own'));
    const theirs = propose('k-person');
    if (!mine || !theirs) throw new Error('no proposal');
    await personaDoor.run(session(), 'Actions', { op: 'approve', id: mine.id, why });
    await personaDoor.run(session(), 'Actions', { op: 'approve', id: theirs.id, why });
    const own = listAudit().find((e) => e.origin?.actionId === mine.id);
    const other = listAudit().find((e) => e.origin?.actionId === theirs.id);
    expect(own).toMatchObject({ actor: 'persona', proposedBy: 'persona' });
    expect(other?.actor).toBe('persona');
    expect(other?.proposedBy).toBeUndefined();
  });

  it('words the decision to go on without a clean check as the persona\'s', () => {
    const catalog = (lang: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../src/shared/i18n/main.${lang}.json`), 'utf8')) as Record<string, string>;
    for (const lang of ['en', 'pt-BR']) {
      const c = catalog(lang);
      expect(c['main.actions.verifySkippedPersona'], lang).toBeTruthy();
      expect(c['main.actions.verifyFailedPersona'], lang).toContain('{code}');
      expect(c['main.actions.verifySkippedPersona'], lang).not.toBe(c['main.actions.verifySkipped']);
    }
  });
});

describe('where the app still words a record as the person\'s', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  const root = join(import.meta.dirname, '..');
  const SITES = /(?:type|by):\s*'person'|\.by\s*[!=]==\s*'person'|author\.type\s*[!=]==\s*'person'/;
  const found = [...walk(join(root, 'src/main')), ...walk(join(root, 'src/shared'))].filter((f) => SITES.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1)).sort();

  // Every file that words something as the person's, and why that stays the person's. A file not here fails: it either takes a `who` (and goes in the plan's table) or is
  // listed with its reason.
  const LISTED: Record<string, string> = {
    'src/main/forum.ts': 'the person is the default author of personPost; the attachment message carries bytes a tool cannot, so the persona has no way to it',
    'src/main/memory/index.ts': 'the label of who edited a note read by the index: the lock is the person\'s whoever used it',
    'src/main/memory/store.ts': 'the lock against agents and the header of a note edited by the person; the persona mark is in the state beside it',
    'src/main/mentions/ceremony.ts': 'a ceremony\'s own turn (`me`) is the person\'s unless the persona\'s door wrote it',
    'src/main/mentions/module.ts': 'callsOf: only a person\'s post calls an agent, so a persona\'s post calls nobody',
    'src/main/persona/stop.ts': 'counts the person\'s messages that waited for Resume',
    'src/main/procedures/channels.ts': 'PERSON is the default writer; PERSONA is the same permissions with a mark',
    'src/main/procedures/offers.ts': 'the offer kept is saved with the person\'s permissions; the persona flag marks it',
    'src/main/procedures/select.ts': 'a record written by the person reads as theirs to the agents',
    'src/main/procedures/store.ts': 'the permissions of the person\'s writer (review, open to all)',
    'src/main/runner/memory.ts': 'the person\'s answers enter the cycle memory; the persona\'s enter by its id',
    'src/main/runner/prompt.ts': 'the author of a message in a stage\'s prompt',
    'src/main/runner/service.ts': 'the default `who` and the person\'s @mention in a run\'s thread',
    'src/main/suggestions.ts': 'learning from what the person decided: the persona\'s answers are not the person\'s decisions',
    'src/main/suggestionsModule.ts': 'a suggestion accepted by the person',
    'src/main/testEnv.ts': 'the test-environment confirmation is the person\'s and not in the door',
    'src/main/turnAsks-core.ts': 'the decision that was the person\'s, as against an abort',
    'src/main/turnLimit.ts': 'the decision that was the person\'s, as against an abort',
    'src/shared/forum.ts': 'the Author type',
    'src/shared/runs/transitions.ts': 'PERSON_WHO, the default every move keeps',
  };

  it('lists every place that does, and fails for a new one', () => {
    expect(found).toEqual(Object.keys(LISTED).sort());
  });

  it('has no move of a run that writes the person into the history or the thread by itself', () => {
    const source = readFileSync(join(root, 'src/shared/runs/transitions.ts'), 'utf8');
    const lines = source.split('\n');
    const logs = lines.filter((l) => /\blog\(/.test(l) && /'person'/.test(l) && !/question-passed/.test(l));
    expect(logs).toEqual([]);
    // the only author of a move that is the person is the default `who`
    const authors = lines.filter((l) => /author:\s*person\b/.test(l) && !/PERSON_WHO/.test(l));
    expect(authors).toEqual([]);
  });
});
