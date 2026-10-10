import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForumError, createForumStore, type ForumStore } from '../src/main/forum-core';
import { personPost } from '../src/main/forum';
import { createAttachmentStore } from '../src/main/attachments';
import { deleteAgentThread, ensureAgentThread } from '../src/main/forum-channels';
import { createMemoryStore } from '../src/main/memory/store';
import { MAX_TEXT, parseMentions, type ForumMessage } from '../src/shared/forum';

let dir: string;
let clock: number;
let store: ForumStore;
const make = (extra = {}) => createForumStore(dir, { now: () => new Date(Date.UTC(2026, 9, 3, 10, 0, clock++)), ...extra });
const agent = (id: string) => ({ type: 'agent', id }) as const;
const lines = (id: string) => readFileSync(join(dir, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean);

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'coxia-forum-')), 'forum');
  clock = 0;
  store = make();
});

describe('threads', () => {
  it('open with a header line, once: ensuring an existing thread changes nothing', () => {
    const h = store.ensureThread({ id: 'run-r-abc-1234', kind: 'run', runId: 'r-abc-1234', title: 'app#101 Add the thing' });
    expect(h).toMatchObject({ v: 1, type: 'thread', kind: 'run', runId: 'r-abc-1234' });
    expect(store.ensureThread({ id: 'run-r-abc-1234', kind: 'run', title: 'another title' })).toEqual(h);
    expect(lines('run-r-abc-1234')).toHaveLength(1);
    expect(store.summary('run-r-abc-1234')).toMatchObject({ count: 0, lastAt: null, lastKind: null, openQuestion: false });
  });

  it('refuse a name that could become a path', () => {
    for (const id of ['../x', 'a/b', 'UPPER', '.hidden', '', 'x'.repeat(70)]) {
      expect(() => store.ensureThread({ id, kind: 'general', title: 't' }), id).toThrow(ForumError);
    }
    expect(() => store.read('../x')).toThrow(expect.objectContaining({ code: 'bad-thread' }));
    expect(existsSync(join(dir, '..', 'x.jsonl'))).toBe(false);
  });

  it('general threads get an id made from the title, and never take one that exists', () => {
    const a = store.createGeneral('Release plans: Q4 é ótimo');
    const b = store.createGeneral('Release plans: Q4 é ótimo');
    expect([a.id, b.id]).toEqual(['g-release-plans-q4-e-otimo', 'g-release-plans-q4-e-otimo-2']);
    expect(a).toMatchObject({ kind: 'general', runId: null, title: 'Release plans: Q4 é ótimo' });
    expect(() => store.createGeneral('   ')).toThrow(expect.objectContaining({ code: 'bad-title' }));
    expect(() => store.createGeneral('x'.repeat(121))).toThrow(expect.objectContaining({ code: 'bad-title' }));
  });

  it('are listed with their latest activity first, and only what is a valid thread file', () => {
    store.ensureThread({ id: 'one', kind: 'general', title: 'One' });
    store.ensureThread({ id: 'two', kind: 'general', title: 'Two' });
    store.append('one', { kind: 'post', author: { type: 'person' }, text: 'hello' });
    writeFileSync(join(dir, 'junk.jsonl'), 'not a header\n');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(store.list().map((t) => [t.id, t.count])).toEqual([['one', 1], ['two', 0]]);
  });
});

describe('messages', () => {
  beforeEach(() => store.ensureThread({ id: 'run-1', kind: 'run', runId: 'r-1', title: 'Run 1' }));

  it('are numbered 1, 2, 3 with no gap, one JSON line each, and read back in order', () => {
    const stored = store.append('run-1', [
      { kind: 'system', author: { type: 'app' }, code: 'run.started', params: { issue: 'app#101' } },
      { kind: 'post', author: agent('refiner'), text: 'Spec written', refs: [{ path: '1_SPEC.md', label: 'Spec' }], stage: 'refine', public: true },
    ]);
    store.append('run-1', { kind: 'handoff', author: agent('refiner'), text: 'plan it', to: 'planner', stage: 'refine' });
    expect(stored.map((m) => m.seq)).toEqual([1, 2]);
    expect(lines('run-1')).toHaveLength(4);
    const read = store.read('run-1')!;
    expect(read.messages.map((m) => [m.seq, m.kind, m.author, m.public])).toEqual([
      [1, 'system', { type: 'app' }, false],
      [2, 'post', { type: 'agent', id: 'refiner' }, true],
      [3, 'handoff', { type: 'agent', id: 'refiner' }, false],
    ]);
    expect(read.messages[1]).toMatchObject({ refs: [{ path: '1_SPEC.md', label: 'Spec' }], stage: 'refine', published: null, replyTo: null, at: '2026-10-03T10:00:02.000Z' });
    expect(read.last).toBe(3);
    expect(read.thread).toMatchObject({ count: 3, lastKind: 'handoff', openQuestion: false });
  });

  it('read from a sequence number on, with a limit, and tell where the thread ends', () => {
    store.append('run-1', Array.from({ length: 5 }, (_, i) => ({ kind: 'post' as const, author: agent('qa'), text: `m${i}` })));
    expect(store.read('run-1', 2, 2)!.messages.map((m) => m.seq)).toEqual([3, 4]);
    expect(store.read('run-1', 5)!.messages).toEqual([]);
    expect(store.read('run-1', -3, 0)!.messages).toHaveLength(5);
    expect(store.read('run-1', 0, 2)!.last).toBe(5);
    expect(store.read('nope')).toBeNull();
  });

  it('keep an answer attached to the question it answers, and know when one is open', () => {
    store.append('run-1', { kind: 'question', author: agent('refiner'), text: 'Which users?', public: true });
    expect(store.summary('run-1')!.openQuestion).toBe(true);
    store.append('run-1', { kind: 'post', author: { type: 'person' }, text: 'thinking' });
    expect(store.summary('run-1')!.openQuestion).toBe(true);
    const [a] = store.append('run-1', { kind: 'answer', author: { type: 'person' }, text: 'All of them' });
    expect(a.replyTo).toBe(1);
    expect(store.summary('run-1')!.openQuestion).toBe(false);
    const [orphan] = store.append('run-1', { kind: 'answer', author: { type: 'person' }, text: 'anyway' });
    expect(orphan.replyTo).toBeNull();
  });

  it('carry what an app message needs to be worded later: a code and its parameters, with no text of its own', () => {
    const [m] = store.append('run-1', { kind: 'decision', author: { type: 'person' }, code: 'gate.rejected', params: { stage: 'Gate 1' }, text: 'too vague', public: true });
    expect(m).toMatchObject({ code: 'gate.rejected', params: { stage: 'Gate 1' }, text: 'too vague' });
  });

  it('refuse an empty message, a very long one, a missing author and an unknown thread, writing nothing', () => {
    const before = lines('run-1').length;
    expect(() => store.append('run-1', { kind: 'post', author: { type: 'person' }, text: '   ' })).toThrow(expect.objectContaining({ code: 'empty' }));
    expect(() => store.append('run-1', { kind: 'post', author: { type: 'person' }, text: 'x'.repeat(MAX_TEXT + 1) })).toThrow(expect.objectContaining({ code: 'too-long' }));
    expect(() => store.append('run-1', { kind: 'post', author: { type: 'agent', id: 'Bad Id' }, text: 'x' })).toThrow(expect.objectContaining({ code: 'bad-author' }));
    expect(() => store.append('run-1', { kind: 'post', author: undefined as never, text: 'x' })).toThrow(ForumError);
    expect(() => store.append('ghost', { kind: 'post', author: { type: 'person' }, text: 'x' })).toThrow(expect.objectContaining({ code: 'unknown-thread' }));
    // One bad draft in a batch stops the whole batch.
    expect(() => store.append('run-1', [{ kind: 'post', author: { type: 'person' }, text: 'fine' }, { kind: 'post', author: { type: 'person' }, text: '' }])).toThrow(ForumError);
    expect(lines('run-1')).toHaveLength(before);
    expect(store.summary('run-1')!.count).toBe(0);
  });

  it('drop a reference that is not a file of the cycle folder, and keep the message', () => {
    const [m] = store.append('run-1', { kind: 'post', author: agent('qa'), text: 'x', refs: [{ path: '../../etc/passwd' }, { path: '/abs' }, { path: 'docs/../x' }, { path: 'ok/file.md' }, { path: '5_TEST_PLAN.md' }] });
    expect(m.refs.map((r) => r.path)).toEqual(['ok/file.md', '5_TEST_PLAN.md']);
  });

  it('redact what an agent or the app writes, text and parameters, and leave the person\'s own words alone', () => {
    const s = make({ redact: (t: string) => t.replace(/sekret-\w+/g, '[redacted]') });
    s.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    const out = s.append('g', [
      { kind: 'post', author: agent('developer'), text: 'key is sekret-abc' },
      { kind: 'system', author: { type: 'app' }, code: 'run.stage.failed', params: { stage: 'implement', detail: 'boom sekret-xyz' } },
      { kind: 'post', author: { type: 'person' }, text: 'my own sekret-123' },
    ]);
    expect(out.map((m) => m.text)).toEqual(['key is [redacted]', '', 'my own sekret-123']);
    expect(out[1].params).toEqual({ stage: 'implement', detail: 'boom [redacted]' });
  });

  it('tell the listeners after the write, and a listener that throws breaks nothing', () => {
    const seen: ForumMessage[] = [];
    const off = store.subscribe((m) => seen.push(m));
    store.subscribe(() => {
      throw new Error('listener bug');
    });
    store.append('run-1', [{ kind: 'post', author: agent('qa'), text: 'a' }, { kind: 'post', author: agent('qa'), text: 'b' }]);
    expect(seen.map((m) => [m.thread, m.seq])).toEqual([['run-1', 1], ['run-1', 2]]);
    off();
    store.append('run-1', { kind: 'post', author: agent('qa'), text: 'c' });
    expect(seen).toHaveLength(2);
    expect(store.summary('run-1')!.count).toBe(3);
  });
});

describe('the file on disk', () => {
  it('survives a restart: a new store over the same folder continues the numbering', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    store.append('g', [{ kind: 'post', author: { type: 'person' }, text: 'a' }, { kind: 'question', author: agent('qa'), text: 'q?' }]);
    const again = make();
    expect(again.summary('g')).toMatchObject({ count: 2, openQuestion: true });
    expect(again.append('g', { kind: 'answer', author: { type: 'person' }, text: 'a' })[0]).toMatchObject({ seq: 3, replyTo: 2 });
  });

  it('closes a line torn by a crash before the next message, and skips the debris when it reads', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    store.append('g', { kind: 'post', author: { type: 'person' }, text: 'before' });
    appendFileSync(join(dir, 'g.jsonl'), '{"v":1,"type":"message","seq":2,"thr');
    const again = make();
    expect(again.read('g')!.messages.map((m) => m.text)).toEqual(['before']);
    again.append('g', { kind: 'post', author: { type: 'person' }, text: 'after' });
    const reread = make();
    expect(reread.read('g')!.messages.map((m) => [m.seq, m.text])).toEqual([[1, 'before'], [2, 'after']]);
  });

  it('skips a line that is valid JSON but not a message, and a repeated sequence number', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    const [m] = store.append('g', { kind: 'post', author: { type: 'person' }, text: 'one' });
    appendFileSync(join(dir, 'g.jsonl'), `${JSON.stringify({ type: 'message', seq: 2, text: 'forged' })}\n${JSON.stringify({ ...m, text: 'duplicate' })}\n[1,2]\n`);
    expect(make().read('g')!.messages.map((x) => x.text)).toEqual(['one']);
  });

  it('is not a thread without a valid header', () => {
    mkdirOf();
    writeFileSync(join(dir, 'g.jsonl'), `${JSON.stringify({ v: 1, type: 'message' })}\n`);
    expect(make().read('g')).toBeNull();
    expect(() => make().append('g', { kind: 'post', author: { type: 'person' }, text: 'x' })).toThrow(expect.objectContaining({ code: 'unknown-thread' }));
  });
});

function mkdirOf(): void {
  // The store creates its folder on the first thread; a test that writes a file by hand needs it now.
  createForumStore(dir).ensureThread({ id: 'placeholder', kind: 'general', title: 'p' });
}

describe('publishing a message to the tracker', () => {
  it('links the message to its note without rewriting the file: a later line is folded in when reading', () => {
    store.ensureThread({ id: 'run-1', kind: 'run', runId: 'r-1', title: 'Run 1' });
    store.append('run-1', [{ kind: 'post', author: agent('refiner'), text: 'Spec', public: true }, { kind: 'handoff', author: agent('refiner'), text: 'next', to: 'planner' }]);
    const before = readFileSync(join(dir, 'run-1.jsonl'), 'utf8');
    const m = store.markPublished('run-1', 1, { target: 'issue', noteId: 4411, url: 'https://example.com/n/4411' });
    expect(m).toMatchObject({ seq: 1, published: { target: 'issue', noteId: 4411 } });
    expect(readFileSync(join(dir, 'run-1.jsonl'), 'utf8').startsWith(before)).toBe(true);
    expect(make().read('run-1')!.messages.map((x) => x.published?.noteId ?? null)).toEqual([4411, null]);
    store.markPublished('run-1', 1, { target: 'issue', noteId: 4411, url: 'https://example.com/n/4411#edited' });
    expect(make().read('run-1')!.messages[0].published?.url).toBe('https://example.com/n/4411#edited');
  });

  it('refuses a message that does not exist, a thread that does not exist and a link with no note', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    store.append('g', { kind: 'post', author: agent('qa'), text: 'x' });
    expect(() => store.markPublished('g', 2, { target: 'issue', noteId: 1, url: null })).toThrow(ForumError);
    expect(() => store.markPublished('ghost', 1, { target: 'issue', noteId: 1, url: null })).toThrow(ForumError);
    expect(() => store.markPublished('g', 1, { target: 'issue' } as never)).toThrow(ForumError);
  });

  it('accepts a message that already carries its published link', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    const [m] = store.append('g', { kind: 'post', author: agent('qa'), text: 'x', public: true, published: { target: 'mr', noteId: 'abc', url: null } });
    expect(make().read('g')!.messages[0]).toEqual(m);
  });
});

describe('what a person writes', () => {
  it('finds the agents they name: only team ids, once each, never in an address or a path', () => {
    const team = ['developer', 'reviewer', 'qa'];
    expect(parseMentions('@developer can you check this? cc @QA and @developer', team)).toEqual(['developer', 'qa']);
    expect(parseMentions('mail ana@developer.example.com, see src/@reviewer/x, @ghost, @developer.', team)).toEqual(['developer']);
    expect(parseMentions('(@reviewer) and "@qa"', team)).toEqual(['reviewer', 'qa']);
    expect(parseMentions('no mention here', team)).toEqual([]);
  });

  it('is posted as the person, internal, with the mentions resolved against the team', () => {
    store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
    const m = personPost(store, ['developer'], 'g', '  @developer please look at 1_SPEC.md  ');
    expect(m).toMatchObject({ kind: 'post', author: { type: 'person' }, text: '@developer please look at 1_SPEC.md', mentions: ['developer'], public: false, code: null });
    expect(() => personPost(store, [], 42, 'x')).toThrow(ForumError);
    expect(() => personPost(store, [], 'g', 42)).toThrow(ForumError);
    expect(() => personPost(store, [], 'g', '  ')).toThrow(expect.objectContaining({ code: 'empty' }));
    expect(() => personPost(store, [], 'ghost', 'x')).toThrow(expect.objectContaining({ code: 'unknown-thread' }));
    expect(() => personPost(store, [], 'g', 'x'.repeat(MAX_TEXT + 1))).toThrow(expect.objectContaining({ code: 'too-long' }));
  });
});

describe('the channels of the squads and the requests between them', () => {
  const req = (to: string, n: number) => ({ kind: 'request' as const, author: agent('lead-a'), to, text: `Request ${n}`, params: { from: 'a', squad: 'b', kind: 'change' } });

  it('a channel is a thread of its own kind, with the squad it belongs to; the channel of the squads has none', () => {
    store.ensureThread({ id: 'squads', kind: 'channel', squad: null, title: 'Squads' });
    store.ensureThread({ id: 'squad-a', kind: 'channel', squad: 'a', title: 'Squad A' });
    expect(store.summary('squads')).toMatchObject({ kind: 'channel', squad: null, runId: null });
    expect(store.summary('squad-a')).toMatchObject({ kind: 'channel', squad: 'a', title: 'Squad A' });
    expect(JSON.parse(lines('squad-a')[0])).toMatchObject({ kind: 'channel', squad: 'a' });
    // other threads carry no squad of their own
    store.ensureThread({ id: 'g', kind: 'general', title: 'General' });
    expect('squad' in (store.summary('g') as object)).toBe(false);
    // a channel opened again is the same channel, and it survives a restart of the store
    expect(make().summary('squad-a')).toMatchObject({ squad: 'a' });
  });

  it('a request stays open until an answer closes it, and each answer closes the request it names', () => {
    store.ensureThread({ id: 'squads', kind: 'channel', squad: null, title: 'Squads' });
    const [first, second] = store.append('squads', [req('lead-b', 1), req('lead-c', 2)]);
    expect(store.summary('squads')).toMatchObject({ openQuestion: true, lastKind: 'request' });
    expect(first).toMatchObject({ kind: 'request', to: 'lead-b', params: { from: 'a', squad: 'b', kind: 'change' }, replyTo: null });
    // answering the first while the second is still open: the one it names is closed
    const [answer] = store.append('squads', { kind: 'answer', author: agent('lead-b'), to: 'lead-a', text: 'Done.', replyTo: first.seq });
    expect(answer.replyTo).toBe(first.seq);
    expect(store.summary('squads')!.openQuestion).toBe(true);
    // an answer that names nothing closes the latest one open, as before
    const [last] = store.append('squads', { kind: 'answer', author: agent('lead-c'), text: 'No.' });
    expect(last.replyTo).toBe(second.seq);
    expect(store.summary('squads')!.openQuestion).toBe(false);
    // an answer naming a request that is not open falls back to the latest open one (none: no reply)
    expect(store.append('squads', { kind: 'answer', author: agent('lead-c'), text: 'Late.', replyTo: first.seq })[0].replyTo).toBeNull();
    // and all of it is read back the same after a restart
    expect(make().summary('squads')).toMatchObject({ count: 5, openQuestion: false });
  });
});

describe('the files a message carries', () => {
  it('keeps the evidence of a stage apart from the files a person attached, and reads a message written before either as carrying none', () => {
    store.ensureThread({ id: 'run-r-abc-1234', kind: 'run', runId: 'r-abc-1234', title: 't' });
    store.append('run-r-abc-1234', {
      kind: 'post',
      author: agent('qa'),
      text: 'Saw it.',
      evidence: [
        { id: 'ev-1', name: 'screen.png', media: 'image/png', bytes: 12 },
        { id: '../x', name: 'bad', media: 'image/png', bytes: 1 },
      ],
    });
    // a line written before attachments and evidence existed has neither field
    const legacy = { v: 1, type: 'message', seq: 2, thread: 'run-r-abc-1234', at: '2026-10-03T10:00:30.000Z', kind: 'post', author: { type: 'app' }, text: 'old', code: null, params: {}, mentions: [], refs: [], stage: null, to: null, replyTo: null, public: false, published: null };
    appendFileSync(join(dir, 'run-r-abc-1234.jsonl'), `${JSON.stringify(legacy)}\n`);
    const [first, old] = make().read('run-r-abc-1234')!.messages;
    expect(first.evidence).toEqual([{ id: 'ev-1', name: 'screen.png', media: 'image/png', bytes: 12 }]);
    expect(first.attachments).toEqual([]);
    expect(old).toMatchObject({ text: 'old', attachments: [] });
    expect(old.evidence).toBeUndefined();
  });
});

describe('deleting a whole conversation', () => {
  it('removes its file and what the store remembers, and gives back the header it had', () => {
    store.ensureThread({ id: 'keep', kind: 'general', title: 'Keep' });
    store.ensureThread({ id: 'gone', kind: 'general', title: 'Gone' });
    store.append('gone', { kind: 'post', author: { type: 'person' }, text: 'one' });
    store.append('keep', { kind: 'post', author: { type: 'person' }, text: 'two' });
    expect(store.summary('gone')).toMatchObject({ count: 1 });
    expect(store.deleteThread('gone')).toMatchObject({ id: 'gone', kind: 'general', title: 'Gone' });
    expect(existsSync(join(dir, 'gone.jsonl'))).toBe(false);
    expect(store.summary('gone')).toBeNull();
    expect(store.read('gone')).toBeNull();
    expect(store.list().map((t) => t.id)).toEqual(['keep']);
    // a store opened over the same folder does not find it either, and the other thread is untouched
    expect(make().summary('gone')).toBeNull();
    expect(make().read('keep')?.messages.map((m) => m.text)).toEqual(['two']);
  });

  it('is nothing to do the second time, and for a conversation that never existed', () => {
    store.ensureThread({ id: 'gone', kind: 'general', title: 'Gone' });
    expect(store.deleteThread('gone')).not.toBeNull();
    expect(store.deleteThread('gone')).toBeNull();
    expect(store.deleteThread('never-was')).toBeNull();
  });

  it('leaves nothing to write to: the thread is unknown afterwards, and a new one of the same id starts from the first message', () => {
    store.ensureThread({ id: 'again', kind: 'general', title: 'First' });
    store.append('again', [{ kind: 'post', author: { type: 'person' }, text: 'a' }, { kind: 'post', author: { type: 'person' }, text: 'b' }]);
    store.deleteThread('again');
    expect(() => store.append('again', { kind: 'post', author: { type: 'person' }, text: 'late' })).toThrow(expect.objectContaining({ code: 'unknown-thread' }));
    store.ensureThread({ id: 'again', kind: 'general', title: 'Second' });
    expect(store.append('again', { kind: 'post', author: { type: 'person' }, text: 'c' })[0].seq).toBe(1);
    expect(store.summary('again')).toMatchObject({ title: 'Second', count: 1 });
  });

  it('tells no listener: the store only announces messages', () => {
    store.ensureThread({ id: 'quiet', kind: 'general', title: 'Quiet' });
    store.append('quiet', { kind: 'post', author: { type: 'person' }, text: 'a' });
    const heard: ForumMessage[] = [];
    store.subscribe((m) => heard.push(m));
    store.deleteThread('quiet');
    expect(heard).toEqual([]);
  });

  it('refuses a name that could become a path, and touches nothing outside the folder', () => {
    const outside = join(dir, '..', 'x.jsonl');
    writeFileSync(outside, 'keep me');
    for (const id of ['../x', 'a/b', 'UPPER', '.hidden', '', 'x'.repeat(70)]) expect(() => store.deleteThread(id), id).toThrow(expect.objectContaining({ code: 'bad-thread' }));
    expect(readFileSync(outside, 'utf8')).toBe('keep me');
  });

  it('removes a file that holds no thread, since its name is a thread\'s, and says there was none', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'debris.jsonl'), 'not a thread\n');
    expect(store.deleteThread('debris')).toBeNull();
    expect(existsSync(join(dir, 'debris.jsonl'))).toBe(false);
  });
});

describe('deleting the direct conversation of an agent', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const attachments = () => createAttachmentStore({ base: join(dir, '..') });

  it('deletes the conversation and its files, and leaves the conversation of another agent alone', () => {
    const files = attachments();
    ensureAgentThread(store, { id: 'trial', name: 'Trial' }, 'en');
    ensureAgentThread(store, { id: 'other', name: 'Other' }, 'en');
    store.append('agent-trial', { kind: 'post', author: { type: 'person' }, text: 'hello' });
    store.append('agent-other', { kind: 'post', author: { type: 'person' }, text: 'hello' });
    const mine = files.put('agent-trial', 'shot.png', png);
    const theirs = files.put('agent-other', 'shot.png', png);
    expect(deleteAgentThread(store, files, 'trial')).toBe(true);
    expect(store.summary('agent-trial')).toBeNull();
    expect(files.get('agent-trial', mine.id)).toBeNull();
    expect(existsSync(files.dirOf('agent-trial'))).toBe(false);
    expect(store.summary('agent-other')).toMatchObject({ kind: 'agent', count: 1 });
    expect(files.get('agent-other', theirs.id)).not.toBeNull();
    // nothing left to delete the second time
    expect(deleteAgentThread(store, files, 'trial')).toBe(false);
  });

  it('tells the caller which conversation is about to go, once, and not for one that is not an agent\'s', () => {
    const files = attachments();
    ensureAgentThread(store, { id: 'trial', name: 'Trial' }, 'en');
    store.ensureThread({ id: 'agent-odd', kind: 'general', title: 'Odd' });
    const told: string[] = [];
    expect(deleteAgentThread(store, files, 'odd', (thread) => told.push(thread))).toBe(false);
    expect(told).toEqual([]);
    expect(deleteAgentThread(store, files, 'trial', (thread) => told.push(thread))).toBe(true);
    expect(told).toEqual(['agent-trial']);
  });

  it('only ever deletes a conversation of kind agent', () => {
    const files = attachments();
    // threads that carry an agent\'s name in their id but are not an agent\'s conversation
    store.ensureThread({ id: 'agent-odd', kind: 'general', title: 'Odd' });
    store.ensureThread({ id: 'run-r-abc-1234', kind: 'run', runId: 'r-abc-1234', title: 'Run' });
    store.ensureThread({ id: 'squad-a', kind: 'channel', squad: 'a', title: 'Squad A' });
    const kept = files.put('agent-odd', 'shot.png', png);
    expect(deleteAgentThread(store, files, 'odd')).toBe(false);
    expect(deleteAgentThread(store, files, 'r-abc-1234')).toBe(false);
    expect(deleteAgentThread(store, files, 'squad-a')).toBe(false);
    expect(store.list().map((t) => t.id).sort()).toEqual(['agent-odd', 'run-r-abc-1234', 'squad-a']);
    expect(files.get('agent-odd', kept.id)).not.toBeNull();
  });

  it('takes the memory folder of the conversation with it, before the thread, and never the memory of a conversation that is not an agent\'s', () => {
    const files = attachments();
    const memory = createMemoryStore(join(dir, '..', 'workspace'));
    ensureAgentThread(store, { id: 'trial', name: 'Trial' }, 'en');
    store.ensureThread({ id: 'agent-odd', kind: 'general', title: 'Odd' });
    const note = (conversation: string) => memory.save({ scope: { conversation, agent: 'trial' }, kind: 'note', title: 'A note', text: 'Written by the agent.' }).ok;
    expect(note('agent-trial') && note('agent-odd') && note('general')).toBe(true);
    const order: string[] = [];
    expect(deleteAgentThread(store, files, 'odd', undefined, memory)).toBe(false);
    expect(memory.list().folders.map((f) => f.conversation)).toEqual(['agent-odd', 'agent-trial', 'general']);
    expect(deleteAgentThread(store, files, 'trial', undefined, { removeConversation: (c) => (order.push(`${c}:${store.summary(c) ? 'thread-still-there' : 'thread-gone'}`), memory.removeConversation(c)) })).toBe(true);
    expect(order).toEqual(['agent-trial:thread-still-there']);
    expect(memory.list().folders.map((f) => f.conversation)).toEqual(['agent-odd', 'general']);
  });

  it('refuses an agent id that could become a path', () => {
    expect(() => deleteAgentThread(store, attachments(), '../x')).toThrow(expect.objectContaining({ code: 'bad-thread' }));
  });
});
