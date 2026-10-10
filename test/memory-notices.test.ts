// A run is told when something relevant to it is written elsewhere in the memory (rule 10, acceptance 7): what counts as relevant (three rules, no model), the merge of entries that
// arrive close together, the five-pointer cap, never repeating an entry, the line in the run's thread that is the record and the state, the stage that is working hearing it
// between two steps, the next stage reading it first and marking it read once an attempt is accepted, and the switch off doing nothing. Fake engines and a temporary
// folder only: no model, no host, no network.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { runThreadId, type ForumMessage } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { prompt as cycleWords } from '../src/main/cyclePrompts';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import type { MemoryWrite } from '../src/main/memory/store';
import { NOTICE_CODE, READ_CODE, openInbox } from '../src/main/runner/inbox';
import { NOTICES_PER_STAGE, concerns, createNoticeHub, entryOfWrite, isOwnConversation, pendingNotices, type NoticeEntry } from '../src/main/runner/notices';
import { stagePrompt, type StageInput } from '../src/main/runner/prompt';
import { boot, doc, work, type Boot } from './helpers/runner';
import { memoryWorld, type MemoryWorld } from './helpers/memory';
import { drive, startInput } from './helpers/runs';

vi.setConfig({ testTimeout: 30_000 });
const { updateConfig } = await import('../src/main/workspaceConfig');

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => updateConfig((c) => ({ ...c, language: 'en' })));

const entry = (over: Partial<NoticeEntry> = {}): NoticeEntry => ({ id: 'm-00000001', kind: 'decision', title: 'Use the queue for retries', conversation: 'squad-core', agent: 'developer', day: '2026-10-09', activity: 'app#101', repo: 'app', ...over });
const runOf = (over: { id?: string; ref?: string; repo?: string } = {}): Pick<Run, 'id' | 'issue' | 'repo'> => ({ id: over.id ?? 'r-abc-0001', issue: { ref: over.ref ?? 'app#101', iid: 101, title: 't', url: null }, repo: over.repo ?? 'app' }) as Pick<Run, 'id' | 'issue' | 'repo'>;

describe('what concerns a run', () => {
  it('is about the same activity, a decision about the same repository, or written by the agent that works it now', () => {
    expect(concerns(runOf(), entry(), null)).toBe('activity');
    expect(concerns(runOf(), entry({ activity: 'app#202' }), null)).toBe('repo');
    expect(concerns(runOf(), entry({ activity: undefined }), null)).toBe('repo');
    expect(concerns(runOf(), entry({ activity: 'app#202', repo: 'other' }), 'developer')).toBe('agent');
  });

  it('applies them in that order and says nothing about everything else', () => {
    expect(concerns(runOf(), entry(), 'developer')).toBe('activity');
    expect(concerns(runOf(), entry({ activity: 'app#202', repo: 'other' }), null)).toBeNull();
    expect(concerns(runOf(), entry({ activity: 'app#202', repo: 'other' }), 'refiner')).toBeNull();
    expect(concerns(runOf(), entry({ activity: undefined, repo: undefined }), 'refiner')).toBeNull();
  });

  it('counts the repository only for a decision: a finding, a note or a document of a busy repository notifies nobody', () => {
    for (const kind of ['finding', 'note', 'document'] as const) expect(concerns(runOf(), entry({ kind, activity: 'app#202' }), null), kind).toBeNull();
  });

  it('never counts the conversations of the run itself, nor the documents it produced', () => {
    expect(isOwnConversation('r-abc-0001', 'run-r-abc-0001')).toBe(true);
    expect(isOwnConversation('r-abc-0001', 'run-r-abc-0001-talk-reviewer-1')).toBe(true);
    expect(isOwnConversation('r-abc-0001', 'run-r-abc-00012')).toBe(false);
    expect(isOwnConversation('r-abc-0001', 'squad-core')).toBe(false);
    expect(concerns(runOf(), entry({ conversation: 'run-r-abc-0001' }), 'developer')).toBeNull();
    expect(concerns(runOf(), entry({ conversation: 'run-r-abc-0001-talk-reviewer-1' }), 'developer')).toBeNull();
    expect(concerns(runOf(), entry({ kind: 'document', id: 'doc:r-abc-0001/1_SPEC.md', conversation: 'run-r-other-0002', runId: 'r-abc-0001' }), 'developer')).toBeNull();
  });
});

describe('what an agent\'s write turns into', () => {
  const write = (over: Record<string, unknown> = {}): MemoryWrite =>
    ({
      scope: { conversation: 'squad-core', agent: 'developer' },
      created: true,
      note: { id: 'm-00000001', conversation: 'squad-core', agent: 'developer', kind: 'decision', title: 'Use the queue', by: 'developer', person: false, revision: 1, reviewed: true, foreign: false, unsafe: false, at: '2026-10-09T10:00:00.000Z', size: 10, activity: 'app#101', repo: 'app', ...over },
    }) as MemoryWrite;

  it('is an entry with its pointer, its day and what it concerns', () => {
    expect(entryOfWrite(write())).toEqual({ id: 'm-00000001', kind: 'decision', title: 'Use the queue', conversation: 'squad-core', agent: 'developer', day: '2026-10-09', activity: 'app#101', repo: 'app' });
  });

  it('is nothing when the person wrote it, when it waits for review or when no agent may read it', () => {
    expect(entryOfWrite(write({ person: true }))).toBeNull();
    expect(entryOfWrite(write({ reviewed: false }))).toBeNull();
    expect(entryOfWrite(write({ foreign: true }))).toBeNull();
    expect(entryOfWrite(write({ unsafe: true }))).toBeNull();
    expect(entryOfWrite(write({ kind: null }))).toBeNull();
  });
});

describe('the store tells only of an agent\'s write', () => {
  let w: MemoryWorld;
  afterEach(() => rmSync(w.ws, { recursive: true, force: true }));

  it('tells of a create and a replace by an agent, and of nothing the person does', async () => {
    w = memoryWorld();
    const seen: string[] = [];
    w.onWrite((x) => seen.push(`${x.note.id}:${x.created ? 'created' : 'replaced'}`));
    const s = await w.session({ agent: 'developer', conversation: 'squad-core' });
    const saved = await s.tools!.save!({ kind: 'decision', title: 'Use the queue', text: 'Retries go through the queue.' });
    const id = /m-[0-9a-f]{8}/.exec(saved.text)![0];
    await s.tools!.save!({ id, revision: 1, kind: 'decision', title: 'Use the queue', text: 'Retries go through the queue, never inline.' });
    expect(seen).toEqual([`${id}:created`, `${id}:replaced`]);
    const scope = { conversation: 'squad-core', agent: 'developer' };
    expect(w.store.edit({ scope, id, title: 'Use the queue (edited)', text: 'The person rewrote it.' }).ok).toBe(true);
    expect(w.store.review(scope, id).ok).toBe(true);
    expect(w.store.removeNote(scope, id).ok).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it('survives a listener that throws', async () => {
    w = memoryWorld();
    w.onWrite(() => {
      throw new Error('boom');
    });
    const s = await w.session({ agent: 'developer', conversation: 'squad-core' });
    expect((await s.tools!.save!({ kind: 'note', title: 'A note', text: 'Text of the note.' })).text).toMatch(/^Saved m-/);
  });
});

describe('the hub', () => {
  let dir: string;
  let forum: ForumStore;
  let runs: Run[];
  let on: boolean;
  const working = new Map<string, string | null>();

  const run = (id: string, ref: string, over: Partial<Run> = {}): Run => ({ ...drive(undefined, startInput({ id, issue: { ref, iid: Number(ref.split('#')[1]), title: `Work on ${ref}`, url: null }, repo: over.repo ?? 'app', worktree: join(dir, 'wt', id) })).run, ...over });
  const hubOf = (over: { mergeMs?: number } = {}) =>
    createNoticeHub({
      runs: { list: () => runs, get: (id) => runs.find((r) => r.id === id) ?? null },
      forum,
      config: () => ({ ...neutralConfig(), runner: { ...neutralConfig().runner, sharedMemory: on } }),
      workingAgent: (r) => working.get(r.id) ?? null,
      onError: (e) => {
        throw e;
      },
      ...over,
    });
  const write = (id: string, over: Record<string, unknown> = {}): MemoryWrite =>
    ({
      scope: { conversation: 'squad-core', agent: 'developer' },
      created: true,
      note: { id, conversation: 'squad-core', agent: 'developer', kind: 'decision', title: `Decision ${id}`, by: 'developer', person: false, revision: 1, reviewed: true, foreign: false, unsafe: false, at: '2026-10-09T10:00:00.000Z', size: 10, activity: 'app#101', repo: 'app', ...over },
    }) as MemoryWrite;
  const lines = (runId: string, code: string): ForumMessage[] => (forum.read(runThreadId(runId), 0, 2000)?.messages ?? []).filter((m) => m.code === code);

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'memory-notices-'));
    forum = createForumStore(join(dir, 'forum'));
    on = true;
    working.clear();
    runs = [run('r-aaa-0001', 'app#101'), run('r-bbb-0002', 'app#202', { repo: 'other' })];
    for (const r of runs) forum.ensureThread({ id: runThreadId(r.id), kind: 'run', runId: r.id, title: r.id });
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one line in the thread of the run it concerns after the window, with pointers and no body, and none in the other', () => {
    const hub = hubOf();
    hub.noteWritten(write('m-0000000a'));
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    const [line] = lines('r-aaa-0001', NOTICE_CODE);
    expect(line.kind).toBe('system');
    expect(line.author.type).toBe('app');
    expect(line.params).toMatchObject({ ids: 'm-0000000a', n: 1 });
    const text = String(line.params.text);
    expect(text).toContain('m-0000000a decision: Decision m-0000000a (developer, squad-core, 2026-10-09)');
    expect(text).toContain(cycleWords('runner.notice.sharedWhy.activity'));
    expect(text).toContain('memory_read');
    expect(lines('r-bbb-0002', NOTICE_CODE)).toHaveLength(0);
  });

  it('carries no body of the note: only the title the list already shows', () => {
    const hub = hubOf();
    hub.noteWritten(write('m-0000000a', { size: 8000 }));
    vi.advanceTimersByTime(2000);
    expect(String(lines('r-aaa-0001', NOTICE_CODE)[0].params.text).length).toBeLessThan(900);
  });

  it('merges what arrives close together into one line, with at most five pointers and the rest counted', () => {
    const hub = hubOf();
    for (let i = 1; i <= 8; i++) hub.noteWritten(write(`m-0000000${i}`));
    vi.advanceTimersByTime(1999);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const found = lines('r-aaa-0001', NOTICE_CODE);
    expect(found).toHaveLength(1);
    const text = String(found[0].params.text);
    expect(text.match(/^- m-/gm)).toHaveLength(5);
    expect(text).toContain(cycleWords('runner.notice.sharedMore', { n: 3 }));
    // The ids of all eight are in one string, so none of them is told again.
    expect(String(found[0].params.ids).split(',')).toHaveLength(8);
    expect(found[0].params.n).toBe(8);
    expect(typeof found[0].params.ids).toBe('string');
  });

  it('does not tell the same entry twice, not even when it is replaced, nor after a restart', () => {
    let hub = hubOf();
    hub.noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(2000);
    hub.noteWritten(write('m-0000000a', { revision: 2, title: 'Decision again' }));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
    hub = hubOf();
    hub.noteWritten(write('m-0000000a', { revision: 3 }));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
    hub.noteWritten(write('m-0000000b'));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(2);
  });

  it('holds an entry per run: one that concerns two runs is told to both', () => {
    runs = [run('r-aaa-0001', 'app#101'), run('r-ccc-0003', 'app#101')];
    forum.ensureThread({ id: runThreadId('r-ccc-0003'), kind: 'run', runId: 'r-ccc-0003', title: 'r-ccc-0003' });
    hubOf().noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
    expect(lines('r-ccc-0003', NOTICE_CODE)).toHaveLength(1);
  });

  it('tells a run by the agent that works it now, in another conversation than its own', () => {
    working.set('r-bbb-0002', 'developer');
    const hub = hubOf();
    hub.noteWritten(write('m-0000000a', { activity: 'app#999', repo: 'elsewhere' }));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
    const [line] = lines('r-bbb-0002', NOTICE_CODE);
    expect(String(line.params.text)).toContain(cycleWords('runner.notice.sharedWhy.agent', { agent: 'developer' }));
    hub.noteWritten(write('m-0000000b', { conversation: 'run-r-bbb-0002-talk-developer-1', activity: 'app#999', repo: 'elsewhere' }));
    vi.advanceTimersByTime(2000);
    expect(lines('r-bbb-0002', NOTICE_CODE)).toHaveLength(1);
  });

  it('leaves out a finished run, a person\'s note and a note held for review', () => {
    runs = [run('r-aaa-0001', 'app#101', { status: 'done' })];
    const hub = hubOf();
    hub.noteWritten(write('m-0000000a'));
    runs = [run('r-aaa-0001', 'app#101')];
    hub.noteWritten(write('m-0000000b', { person: true }));
    hub.noteWritten(write('m-0000000c', { reviewed: false }));
    vi.advanceTimersByTime(5000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
  });

  it('tells a failed run, which can be retried', () => {
    runs = [run('r-aaa-0001', 'app#101', { status: 'failed' })];
    hubOf().noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
  });

  it('does nothing with the switch off, at the write and at the end of the window', () => {
    const hub = hubOf();
    on = false;
    hub.noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(5000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
    on = true;
    hub.noteWritten(write('m-0000000b'));
    on = false;
    vi.advanceTimersByTime(5000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
  });

  it('tells a run of a document another run\'s stage produced, by its activity or its agent, and never the run that produced it', () => {
    runs = [run('r-aaa-0001', 'app#101'), run('r-bbb-0002', 'app#202'), run('r-ccc-0003', 'app#303')];
    for (const r of runs) forum.ensureThread({ id: runThreadId(r.id), kind: 'run', runId: r.id, title: r.id });
    working.set('r-ccc-0003', 'refiner');
    hubOf().documentsWritten(runOf({ id: 'r-bbb-0002', ref: 'app#202' }), 'refiner', ['1_SPEC.md']);
    vi.advanceTimersByTime(2000);
    expect(lines('r-bbb-0002', NOTICE_CODE)).toHaveLength(0);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(0);
    const [line] = lines('r-ccc-0003', NOTICE_CODE);
    expect(String(line.params.text)).toContain('doc:r-bbb-0002/1_SPEC.md document: 1_SPEC.md (refiner, run-r-bbb-0002');
    // The same activity: a document of the same issue concerns a run that is about it.
    hubOf().documentsWritten(runOf({ id: 'r-zzz-0009', ref: 'app#101' }), 'planner', ['2_PLAN.md']);
    vi.advanceTimersByTime(2000);
    expect(String(lines('r-aaa-0001', NOTICE_CODE)[0].params.text)).toContain('doc:r-zzz-0009/2_PLAN.md');
  });

  it('hands the text to the mailbox of a stage that is working, and writes no second line', () => {
    working.set('r-aaa-0001', 'refiner');
    const inbox = openInbox('r-aaa-0001', 'refine', 'refiner', forum, () => '2026-10-09T10:00:00.000Z');
    hubOf().noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(2000);
    const [line] = lines('r-aaa-0001', NOTICE_CODE);
    expect(inbox.take()).toBe(String(line.params.text));
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
    expect(lines('r-aaa-0001', READ_CODE).map((m) => m.params)).toEqual([{ agent: 'refiner', n: 1, seqs: String(line.seq) }]);
    expect(pendingNotices(forum.read(runThreadId('r-aaa-0001'), 0, 2000)!.messages)).toEqual([]);
    inbox.close();
  });

  it('writes only the line for a stage that is closing: the next stage reads it back', () => {
    const inbox = openInbox('r-aaa-0001', 'refine', 'refiner', forum, () => '2026-10-09T10:00:00.000Z');
    inbox.closing();
    hubOf().noteWritten(write('m-0000000a'));
    vi.advanceTimersByTime(2000);
    expect(lines('r-aaa-0001', NOTICE_CODE)).toHaveLength(1);
    expect(lines('r-aaa-0001', 'runner.message.afterClose')).toHaveLength(0);
    expect(inbox.take()).toBeNull();
    expect(pendingNotices(forum.read(runThreadId('r-aaa-0001'), 0, 2000)!.messages)).toHaveLength(1);
    inbox.close();
  });
});

describe('the notices a stage reads back', () => {
  const m = (seq: number, code: string, params: Record<string, string | number>): ForumMessage => ({ seq, kind: 'system', code, params, text: '' }) as unknown as ForumMessage;

  it('are the notice lines no marker names, oldest first', () => {
    const thread = [m(1, NOTICE_CODE, { ids: 'm-1', n: 1, text: 'one' }), m(2, 'runner.other', {}), m(3, NOTICE_CODE, { ids: 'm-2', n: 1, text: 'two' }), m(4, NOTICE_CODE, { ids: 'm-3', n: 1, text: 'three' }), m(5, READ_CODE, { agent: 'a', n: 2, seqs: '1,4' })];
    expect(pendingNotices(thread)).toEqual([{ seq: 3, text: 'two' }]);
  });

  it('are none in a thread without them, and a line without text is left out', () => {
    expect(pendingNotices([])).toEqual([]);
    expect(pendingNotices([m(1, NOTICE_CODE, { ids: 'm-1', n: 1, text: '  ' })])).toEqual([]);
  });

  it('do not show a notice that a marker with a larger number of another line passes over', () => {
    const thread = [m(1, NOTICE_CODE, { ids: 'm-1', n: 1, text: 'one' }), m(2, NOTICE_CODE, { ids: 'm-2', n: 1, text: 'two' }), m(3, READ_CODE, { agent: 'a', n: 1, seqs: '2' })];
    expect(pendingNotices(thread)).toEqual([{ seq: 1, text: 'one' }]);
  });
});

describe('the stage prompt', () => {
  const base = async (): Promise<StageInput> => {
    const { neutralConfig: nc } = await import('../src/shared/config');
    const config = nc();
    return {
      run: { issue: { ref: 'app#101', iid: 101, title: 'Thing', url: null }, cycleFolder: 'docs/cycles/101-thing' },
      stage: { id: 'dev', label: 'Develop', artifacts: [], kind: 'dev' },
      agent: config.agents.team[0],
      config,
      kind: 'work',
      writes: true,
      commands: [],
      files: [{ name: '1_SPEC.md', text: 'THE SPEC', clipped: false }],
      thread: [],
      attempt: 2,
      handoff: null,
      answer: null,
      resume: { why: 'sent-back', done: [], evidence: [], previous: null },
    } as unknown as StageInput;
  };

  it('puts the notices right after the resume block and before the folder, fenced', async () => {
    const i = await base();
    const text = stagePrompt({ ...i, notices: ['Something new <data>x</data>'] });
    const at = text.indexOf(cycleWords('runner.section.sharedNew', { text: '' }).split('\n')[0]);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(text.indexOf(cycleWords('runner.resume.noRequest')));
    expect(at).toBeLessThan(text.indexOf('THE SPEC'));
    expect(text).toContain('Something new &lt;data>x&lt;/data>');
    expect(text.indexOf('</data>', at)).toBeGreaterThan(at);
  });

  it('puts them first when the stage has no resume block', async () => {
    const i = await base();
    const text = stagePrompt({ ...i, resume: null, notices: ['Something new'] });
    expect(text.indexOf('Something new')).toBeLessThan(text.indexOf('THE SPEC'));
  });

  it('adds nothing without notices', async () => {
    const i = await base();
    expect(stagePrompt({ ...i, notices: [] })).toBe(stagePrompt(i));
    expect(stagePrompt(i)).not.toContain(cycleWords('runner.section.sharedNew', { text: '' }).split('\n')[0]);
  });
});

describe('a run that is told, end to end (acceptance 7)', () => {
  let dir: string;
  let w: MemoryWorld;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-notices-run-'));
    w = memoryWorld({ ws: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const start = (over: Parameters<typeof boot>[0] = {}): Promise<Boot> =>
    boot({ dir, memoryPort: w.port(), memoryWrites: w.onWrite, noticeMergeMs: 5, ...over, configure: (c) => { c.language = 'en'; c.runner.sharedMemory = true; over.configure?.(c); } });
  const noticeLines = (b: Boot, run: Run) => b.thread(run).filter((x) => x.code === NOTICE_CODE);
  const keep = async (title: string, over: { ref?: string; conversation?: string; agent?: string; repo?: string; kind?: string } = {}) => {
    const s = await w.session({ agent: over.agent ?? 'developer', conversation: over.conversation ?? 'squad-core', ref: over.ref ?? 'app#101', repo: over.repo ?? 'app' });
    return (await s.tools!.save!({ kind: over.kind ?? 'decision', title, text: 'Retries go through the queue.' })).text;
  };
  const scripts = (b: Boot, refiner: Parameters<Boot['engine']['script']>[1] = () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' })): void => {
    b.engine.script('refiner', refiner);
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  };
  const planner = (b: Boot) => b.engine.calls.filter((c) => c.agent.id === 'planner');
  const SECTION = (): string => cycleWords('runner.section.sharedNew', { text: '' }).split('\n')[0];
  const line = (b: Boot, run: Run, text: string, ids = 'm-0000000a') => b.forum.append(runThreadId(run.id), { kind: 'system', author: { type: 'app' }, code: NOTICE_CODE, params: { ids, n: 1, text }, stage: 'refine' })[0];

  it('tells the stage that is working between two steps, shows the person the line, and the next stage does not read it again', async () => {
    const b = await start();
    let heard: string | null = null;
    let other = '';
    scripts(b, async (call) => {
      other = await keep('Unrelated finding', { ref: 'app#555', repo: 'elsewhere', kind: 'finding' });
      await keep('Use the queue for retries');
      const run = b.runner.list()[0];
      await vi.waitFor(() => expect(noticeLines(b, run)).toHaveLength(1));
      heard = (await call.incoming?.(() => undefined)) ?? null;
      return work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(other).toMatch(/^Saved m-/);
    expect(heard).toMatch(/m-[0-9a-f]{8} decision: Use the queue for retries \(developer, squad-core, 2026-10-09\)/);
    expect(heard).toContain('memory_read');
    expect(heard).not.toContain('Retries go through the queue.');
    // Only the decision that concerns the run produced a notice.
    const lines = noticeLines(b, run);
    expect(lines).toHaveLength(1);
    expect(String(lines[0].params.text)).not.toContain('Unrelated finding');
    // The handover marked it read, so the next stage's prompt has no such section.
    expect(b.thread(run).filter((x) => x.code === READ_CODE).map((x) => x.params.seqs)).toEqual([String(lines[0].seq)]);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(planner(b)).toHaveLength(1);
    expect(planner(b)[0].prompt).not.toContain(SECTION());
    expect(b.thread(run).filter((x) => x.code === READ_CODE)).toHaveLength(1);
  });

  it('shows a notice that arrived between stages first in the next stage, and marks it read once that attempt is accepted', async () => {
    const b = await start();
    scripts(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)?.status).toBe('gate');
    // No stage is working: the line is all there is.
    await keep('Use the queue for retries');
    await vi.waitFor(() => expect(noticeLines(b, run)).toHaveLength(1));
    const seq = noticeLines(b, run)[0].seq;
    expect(b.thread(run).filter((x) => x.code === READ_CODE)).toHaveLength(0);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    const prompt = planner(b)[0].prompt;
    const at = prompt.indexOf(SECTION());
    expect(at).toBeGreaterThan(-1);
    expect(prompt).toContain('m-00000001 decision: Use the queue for retries');
    expect(at).toBeLessThan(prompt.indexOf(cycleWords('runner.section.file', { name: '1_SPEC.md', text: '' }).split('\n')[0]));
    expect(prompt).not.toContain('Retries go through the queue.');
    expect(b.thread(run).filter((x) => x.code === READ_CODE).map((x) => x.params)).toEqual([{ agent: 'planner', n: 1, seqs: String(seq) }]);
    expect(pendingNotices(b.thread(run))).toEqual([]);
  });

  it('shows it again in a retried attempt, and marks it only when an attempt is accepted', async () => {
    const b = await start();
    scripts(b);
    let attempts = 0;
    b.engine.script('planner', () => {
      attempts++;
      if (attempts === 1) throw new Error('the model fell over');
      return work('Plan.', { artifacts: [doc('2_PLAN.md')] });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    line(b, run, 'NOTICE-TEXT pointer');
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(b.runner.get(run.id)?.status).toBe('failed');
    expect(b.thread(run).filter((x) => x.code === READ_CODE)).toHaveLength(0);
    b.runner.retry(run.id);
    await b.settle();
    expect(planner(b)).toHaveLength(2);
    for (const c of planner(b)) expect(c.prompt).toContain('NOTICE-TEXT pointer');
    expect(b.thread(run).filter((x) => x.code === READ_CODE)).toHaveLength(1);
  });

  it('shows a stage at most five notices, the rest wait for the next stage', async () => {
    const b = await start();
    scripts(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    for (let n = 1; n <= NOTICES_PER_STAGE + 2; n++) line(b, run, `NOTICE-${n}`, `m-0000000${n}`);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(planner(b)[0].prompt).toContain(`NOTICE-${NOTICES_PER_STAGE}`);
    expect(planner(b)[0].prompt).not.toContain(`NOTICE-${NOTICES_PER_STAGE + 1}`);
    expect(pendingNotices(b.thread(run)).map((x) => x.text)).toEqual([`NOTICE-${NOTICES_PER_STAGE + 1}`, `NOTICE-${NOTICES_PER_STAGE + 2}`]);
  });

  it('tells nobody, and shows nothing, with the switch off', async () => {
    w.config.runner.sharedMemory = false;
    const b = await start({ configure: (c) => void (c.runner.sharedMemory = false) });
    scripts(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    await keep('Use the queue for retries');
    await new Promise((r) => setTimeout(r, 50));
    expect(noticeLines(b, run)).toHaveLength(0);
    // A line that is there (written while the switch was on) is not shown to a stage that has no memory tools to open what it points at.
    line(b, run, 'NOTICE-TEXT pointer');
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(planner(b)[0].prompt).not.toContain('NOTICE-TEXT');
    expect(b.thread(run).filter((x) => x.code === READ_CODE)).toHaveLength(0);
  });

  it('tells a run of the document another run produced, once that stage was accepted', async () => {
    const b = await start();
    scripts(b);
    // A second run, about another activity, whose working agent is the one that writes the document: it concerns it by that agent.
    const other = drive(undefined, startInput({ id: 'r-other-0002', issue: { ref: 'app#202', iid: 202, title: 'Other', url: null }, repo: 'elsewhere', worktree: join(dir, 'wt-other') })).run;
    b.runs.create(other);
    b.forum.ensureThread({ id: runThreadId(other.id), kind: 'run', runId: other.id, title: other.id });
    expect(b.runner.get(other.id)?.status).toBe('working');
    const run = await b.runner.start('app#101');
    await b.settle();
    const told = b.thread(other).filter((x) => x.code === NOTICE_CODE);
    expect(b.runner.get(run.id)?.status).toBe('gate');
    await vi.waitFor(() => expect(b.thread(other).filter((x) => x.code === NOTICE_CODE)).toHaveLength(1));
    expect(told).toHaveLength(0);
    expect(String(b.thread(other).find((x) => x.code === NOTICE_CODE)!.params.text)).toContain(`doc:${run.id}/1_SPEC.md document: 1_SPEC.md (refiner, run-${run.id}`);
    // The run that wrote it is not told of its own document.
    expect(noticeLines(b, run)).toHaveLength(0);
  });
});
