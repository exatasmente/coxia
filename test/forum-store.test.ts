import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForumError, createForumStore, type ForumStore } from '../src/main/forum-core';
import { personPost } from '../src/main/forum';
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
