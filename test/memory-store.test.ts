import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync as renameSyncReal, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MEMORY_LIMITS, STATE_FILE, type NoteSummary } from '../src/shared/memory';
import { conversationsPath, createMemoryStore, type MemoryStore, type MemoryStoreDeps, type SaveRequest, type Scope } from '../src/main/memory/store';

// Every test has a workspace folder of its own in the temp folder: never the app's real data.
let ws: string;
let clock: number;
let counter: number;

const T0 = Date.parse('2026-10-09T10:00:00Z');
const HOME = '/home/person';
const dev: Scope = { conversation: 'general', agent: 'developer' };
const qa: Scope = { conversation: 'general', agent: 'qa' };

function make(deps: MemoryStoreDeps = {}): MemoryStore {
  return createMemoryStore(ws, { now: () => clock, hex: () => (++counter).toString(16).padStart(8, '0'), home: HOME, ...deps });
}

const req = (over: Partial<SaveRequest> = {}): SaveRequest => ({ scope: dev, kind: 'decision', title: 'Use the queue for retries', text: 'Retries go through the queue, never inline.', home: HOME, ...over });

function created(store: MemoryStore, over: Partial<SaveRequest> = {}): NoteSummary {
  const r = store.save(req(over));
  if (!r.ok) throw new Error(r.text);
  return r.note;
}

const folder = (s: Scope): string => join(conversationsPath(ws), s.conversation, s.agent);
const fileOf = (s: Scope, id: string): string => join(folder(s), `${id}.md`);
const stateOf = (s: Scope): { notes: Record<string, { by: string; person: boolean; revision: number; reviewed: boolean; sha: string }> } => JSON.parse(readFileSync(join(folder(s), STATE_FILE), 'utf8'));
const leftovers = (s: Scope): string[] => (existsSync(folder(s)) ? readdirSync(folder(s)).filter((n) => n.includes('.tmp-')) : []);

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-memory-'));
  clock = T0;
  counter = 0;
});

describe('the folders', () => {
  it('makes the agent\'s folder in the conversation the first time, reuses it the next, and makes another for another conversation', () => {
    const store = make();
    expect(existsSync(folder(dev))).toBe(false);
    expect(store.ensureFolder(dev)).toBe(true);
    expect(existsSync(folder(dev))).toBe(true);
    created(store);
    expect(store.ensureFolder(dev)).toBe(true);
    expect(readdirSync(folder(dev)).filter((n) => n.startsWith('m-'))).toHaveLength(1);
    expect(store.ensureFolder({ conversation: 'direct-qa', agent: 'developer' })).toBe(true);
    expect(store.list().folders).toEqual([{ conversation: 'direct-qa', agent: 'developer' }, dev]);
  });

  it('lists an empty folder, so the person sees where an agent was called', () => {
    const store = make();
    store.ensureFolder(qa);
    expect(store.list()).toEqual({ notes: [], folders: [qa], skipped: 0 });
  });

  it('lists nothing before anything was kept, and makes no folder to say so', () => {
    expect(make().list()).toEqual({ notes: [], folders: [], skipped: 0 });
    expect(existsSync(conversationsPath(ws))).toBe(false);
  });

  it('refuses to make or write in a folder whose ids are not ids, and builds no path from them', () => {
    const store = make();
    for (const bad of [{ conversation: '../escape', agent: 'developer' }, { conversation: 'general', agent: '..' }, { conversation: 'General', agent: 'developer' }, { conversation: 'general', agent: 'dev/eloper' }, { conversation: '', agent: 'developer' }]) {
      expect(store.ensureFolder(bad)).toBe(false);
      expect(store.save(req({ scope: bad }))).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(existsSync(conversationsPath(ws))).toBe(false);
  });

  it('removes an agent\'s folder, or a whole conversation, and only those', () => {
    const store = make();
    created(store);
    created(store, { scope: qa });
    created(store, { scope: { conversation: 'other', agent: 'developer' } });
    expect(store.removeFolder(dev)).toBe(true);
    expect(store.list().folders).toEqual([qa, { conversation: 'other', agent: 'developer' }]);
    expect(store.removeConversation('general')).toBe(true);
    expect(store.list().folders).toEqual([{ conversation: 'other', agent: 'developer' }]);
    expect(store.removeConversation('general')).toBe(false);
    expect(store.removeConversation('../other')).toBe(false);
    expect(store.removeFolder({ conversation: 'nope', agent: 'developer' })).toBe(false);
  });
});

describe('writing a note', () => {
  it('creates a note in the agent\'s folder, with a file the person can read, and the app\'s state beside it', () => {
    const store = make();
    const note = created(store, { activity: 'app#123', repo: 'api' });
    expect(note).toMatchObject({ id: 'm-00000001', conversation: 'general', agent: 'developer', kind: 'decision', title: 'Use the queue for retries', by: 'developer', person: false, revision: 1, reviewed: true, foreign: false, unsafe: false, activity: 'app#123', repo: 'api', at: '2026-10-09T10:00:00.000Z' });
    const raw = readFileSync(fileOf(dev, note.id), 'utf8');
    expect(raw).toContain('title: Use the queue for retries\nby: developer\n');
    expect(raw).toContain('---\nRetries go through the queue, never inline.\n');
    expect(stateOf(dev).notes[note.id]).toMatchObject({ by: 'developer', person: false, revision: 1, reviewed: true });
    expect(leftovers(dev)).toEqual([]);
  });

  it('replaces its own note when it names the revision it read, and the revision moves', () => {
    const store = make();
    const note = created(store);
    clock += 1000;
    const r = store.save(req({ id: note.id, revision: 1, text: 'Retries go through the queue, with a limit of three.' }));
    expect(r).toMatchObject({ ok: true, created: false, note: { id: note.id, revision: 2, at: '2026-10-09T10:00:01.000Z' } });
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ status: 'ok', text: 'Retries go through the queue, with a limit of three.' });
    expect(store.list().notes).toHaveLength(1);
  });

  it('refuses a replace that does not name the revision it read, or names an old one', () => {
    const store = make();
    const note = created(store);
    expect(store.save(req({ id: note.id }))).toMatchObject({ ok: false, code: 'revision' });
    expect(store.save(req({ id: note.id, revision: 0 }))).toMatchObject({ ok: false, code: 'revision' });
    expect(store.save(req({ id: note.id, revision: 1, text: 'second' }))).toMatchObject({ ok: true });
    const stale = store.save(req({ id: note.id, revision: 1, text: 'third' }));
    expect(stale).toMatchObject({ ok: false, code: 'revision' });
    expect(!stale.ok && stale.text).toContain('revision 2');
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ text: 'second' });
  });

  it('refuses a note by field, with the reason, without the value, and writes nothing', () => {
    const store = make();
    const r = store.save(req({ title: 'dev@example.com', text: 'password = hunter2', kind: 'opinion' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid');
    expect(r.refusals?.map((x) => `${x.field}:${x.code}`)).toEqual(['kind:type', 'title:email', 'text:credential']);
    expect(r.text).not.toContain('hunter2');
    expect(r.text).not.toContain('dev@example.com');
    expect(store.list()).toEqual({ notes: [], folders: [], skipped: 0 });
  });

  it('refuses a text, a title or a field over its cap and never cuts it', () => {
    const store = make();
    expect(store.save(req({ text: 'x'.repeat(MEMORY_LIMITS.note + 1) }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.save(req({ title: 'x'.repeat(MEMORY_LIMITS.title + 1) }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.save(req({ activity: 'x'.repeat(81) }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.save(req({ repo: 'a\nb' }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.list().notes).toEqual([]);
    const note = created(store, { text: 'x'.repeat(MEMORY_LIMITS.note), title: 'y'.repeat(MEMORY_LIMITS.title) });
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ text: 'x'.repeat(MEMORY_LIMITS.note) });
    expect(note.title).toHaveLength(MEMORY_LIMITS.title);
  });

  it('refuses a text the call\'s exact-value mask would change: it holds a secret value', () => {
    const store = make();
    const mask = (v: string): string => v.split('opensesame').join('[masked]');
    const r = store.save(req({ text: 'the vault opens with opensesame', mask }));
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(JSON.stringify(r)).not.toContain('opensesame');
    expect(store.save(req({ text: 'nothing to hide', mask })).ok).toBe(true);
  });

  it('holds at most 50 notes per agent and conversation: a create over the cap is refused, a replace is not', () => {
    const store = make();
    let last = created(store);
    for (let i = 1; i < MEMORY_LIMITS.filesPerAgent; i++) last = created(store, { title: `Note ${i}` });
    expect(store.list({ conversation: 'general', agent: 'developer' }).notes).toHaveLength(50);
    const over = store.save(req({ title: 'One too many' }));
    expect(over).toMatchObject({ ok: false, code: 'cap-files' });
    expect(!over.ok && over.text).toContain('50');
    expect(store.save(req({ id: last.id, revision: 1, text: 'changed' })).ok).toBe(true);
    // another agent, and the same agent elsewhere, have folders of their own
    expect(store.save(req({ scope: qa })).ok).toBe(true);
    expect(store.save(req({ scope: { conversation: 'other', agent: 'developer' } })).ok).toBe(true);
    expect(store.remove(dev, last.id)).toEqual({ ok: true });
    expect(store.save(req({ title: 'Now it fits' })).ok).toBe(true);
  });

  it('keeps the optional fields of a note through a replace only as the replace names them', () => {
    const store = make();
    const note = created(store, { activity: 'app#123', repo: 'api' });
    const r = store.save(req({ id: note.id, revision: 1, text: 'again' }));
    expect(r.ok && r.note.activity).toBeUndefined();
    expect(r.ok && r.note.repo).toBeUndefined();
  });

  it('draws a fresh id and never reuses one that is in the folder or in the state', () => {
    const ids = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb'];
    const store = make({ hex: () => ids.shift() ?? 'cccccccc' });
    expect(created(store).id).toBe('m-aaaaaaaa');
    expect(created(store).id).toBe('m-bbbbbbbb');
  });
});

describe('one writer per file', () => {
  it('lets two agents answer in one conversation at once without sharing a file: neither note changes the other', async () => {
    const store = make();
    const [a, b] = await Promise.all([Promise.resolve().then(() => store.save(req({ title: 'From the developer' }))), Promise.resolve().then(() => store.save(req({ scope: qa, title: 'From QA' })))]);
    expect(a.ok && b.ok).toBe(true);
    const listed = store.list();
    expect(listed.notes.map((n) => `${n.agent}:${n.title}`).sort()).toEqual(['developer:From the developer', 'qa:From QA']);
    expect(existsSync(join(folder(dev), STATE_FILE))).toBe(true);
    expect(existsSync(join(folder(qa), STATE_FILE))).toBe(true);
    expect(Object.keys(stateOf(dev).notes)).toHaveLength(1);
    expect(Object.keys(stateOf(qa).notes)).toHaveLength(1);
  });

  it('lets two calls of the same agent in the same conversation share the state file without losing an entry', async () => {
    const store = make();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => Promise.resolve().then(() => store.save(req({ title: `Note ${i}` })))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(Object.keys(stateOf(dev).notes)).toHaveLength(12);
    expect(store.list().notes).toHaveLength(12);
  });

  it('refuses to replace or remove a note of another agent in the same conversation, naming whose it is', () => {
    const store = make();
    const mine = created(store);
    for (const r of [store.save(req({ scope: qa, id: mine.id, revision: 1 })), store.remove(qa, mine.id)]) {
      expect(r).toMatchObject({ ok: false, code: 'other-agent', owner: dev });
      expect(!r.ok && r.text).toBe(`note ${mine.id} is developer's; only that agent or the person changes it`);
    }
    expect(store.read(dev, mine.id, 'agent')).toMatchObject({ status: 'ok', text: 'Retries go through the queue, never inline.' });
    expect(existsSync(folder(qa))).toBe(false);
  });

  it('refuses a note of the same agent in another conversation, and one that does not exist', () => {
    const store = make();
    const mine = created(store);
    const elsewhere = { conversation: 'direct-developer', agent: 'developer' };
    expect(store.save(req({ scope: elsewhere, id: mine.id, revision: 1 }))).toMatchObject({ ok: false, code: 'other-conversation' });
    expect(store.remove(elsewhere, mine.id)).toMatchObject({ ok: false, code: 'other-conversation' });
    expect(store.save(req({ id: 'm-deadbeef', revision: 1 }))).toMatchObject({ ok: false, code: 'not-found' });
    expect(store.save(req({ id: '../escape', revision: 1 }))).toMatchObject({ ok: false, code: 'not-found' });
    expect(store.remove(dev, 'm-deadbeef')).toMatchObject({ ok: false, code: 'not-found' });
    expect(store.locate(mine.id)).toEqual(dev);
    expect(store.locate('m-deadbeef')).toBeNull();
    expect(store.locate('not an id')).toBeNull();
  });
});

describe('removing a note', () => {
  it('lets an agent remove its own, and the next reader no longer finds it', () => {
    const store = make();
    const a = created(store);
    const b = created(store, { title: 'Another' });
    expect(store.remove(dev, a.id)).toEqual({ ok: true });
    expect(store.list().notes.map((n) => n.id)).toEqual([b.id]);
    expect(store.read(dev, a.id, 'agent')).toEqual({ status: 'missing' });
    expect(existsSync(fileOf(dev, a.id))).toBe(false);
    expect(Object.keys(stateOf(dev).notes)).toEqual([b.id]);
  });

  it('lets the person remove any note, whoever wrote it, and never a file that is not a note', () => {
    const store = make();
    const mine = created(store, { scope: qa });
    expect(store.removeNote(qa, mine.id)).toEqual({ ok: true });
    expect(store.removeNote(qa, mine.id)).toMatchObject({ ok: false, code: 'not-found' });
    writeFileSync(join(folder(qa), 'm-0000abcd.md'), 'not a note, no header\n');
    expect(store.removeNote(qa, 'm-0000abcd')).toMatchObject({ ok: false, code: 'not-found' });
    expect(existsSync(join(folder(qa), 'm-0000abcd.md'))).toBe(true);
  });

  it('drops the state entry of a note the person removed on disk at the next write', () => {
    const store = make();
    const a = created(store);
    const b = created(store, { title: 'Another' });
    rmSyncFile(fileOf(dev, a.id));
    created(store, { title: 'Third' });
    expect(Object.keys(stateOf(dev).notes)).not.toContain(a.id);
    expect(Object.keys(stateOf(dev).notes)).toContain(b.id);
  });
});

const rmSyncFile = (path: string): void => rmSync(path);

describe('the person\'s edit', () => {
  it('makes the note the person\'s: reviewed, a new revision, the header says who, the agent\'s replace and remove are refused and the text stays', () => {
    const store = make();
    const note = created(store);
    clock += 1000;
    const r = store.edit({ scope: dev, id: note.id, text: 'Retries go through the queue, three times at most.', title: 'Retries and the queue', revision: 1 });
    expect(r).toMatchObject({ ok: true, note: { id: note.id, person: true, reviewed: true, revision: 2, title: 'Retries and the queue', by: 'developer', at: '2026-10-09T10:00:01.000Z' } });
    expect(readFileSync(fileOf(dev, note.id), 'utf8')).toContain('by: person\n');
    const replace = store.save(req({ id: note.id, revision: 2, text: 'the agent rewrites it' }));
    expect(replace).toMatchObject({ ok: false, code: 'person' });
    expect(!replace.ok && replace.text).toContain('edited by the person');
    const remove = store.remove(dev, note.id);
    expect(remove).toMatchObject({ ok: false, code: 'person' });
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ status: 'ok', text: 'Retries go through the queue, three times at most.' });
    // the person still removes it
    expect(store.removeNote(dev, note.id)).toEqual({ ok: true });
  });

  it('masks the person\'s text instead of refusing it, with the call\'s mask too, and checks only its shape', () => {
    const store = make();
    const note = created(store);
    const r = store.edit({ scope: dev, id: note.id, text: 'Ask dev@example.com about opensesame, and call 555 123 4567', mask: (v) => v.split('opensesame').join('[masked]') });
    expect(r.ok).toBe(true);
    const text = readFileSync(fileOf(dev, note.id), 'utf8');
    expect(text).toContain('Ask [email] about [masked], and call 555 123 4567');
    expect(text).not.toContain('dev@example.com');
    expect(store.edit({ scope: dev, id: note.id, text: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: note.id, text: 'x'.repeat(8001) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: note.id, title: 'two\nlines' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: note.id, title: 'x'.repeat(81) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: note.id, kind: 'opinion' as never })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: 'm-deadbeef', text: 'x' })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('refuses an edit from an editor that opened an older revision', () => {
    const store = make();
    const note = created(store);
    store.save(req({ id: note.id, revision: 1, text: 'the agent moved on' }));
    expect(store.edit({ scope: dev, id: note.id, text: 'mine', revision: 1 })).toMatchObject({ ok: false, code: 'revision' });
    expect(store.read(dev, note.id, 'person')).toMatchObject({ text: 'the agent moved on' });
  });

  it('can fix a note whose kind or title the header lost, by naming them', () => {
    const store = make();
    const note = created(store);
    const raw = readFileSync(fileOf(dev, note.id), 'utf8');
    writeFileSync(fileOf(dev, note.id), raw.replace('kind: decision', 'kind: opinion'));
    expect(store.list().notes[0]).toMatchObject({ unsafe: true, kind: null, person: true });
    expect(store.edit({ scope: dev, id: note.id, text: 'fixed' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(store.edit({ scope: dev, id: note.id, text: 'fixed', kind: 'finding' })).toMatchObject({ ok: true, note: { kind: 'finding', unsafe: false, person: true } });
  });
});

describe('the header is untrusted: the state decides', () => {
  const rewrite = (s: Scope, id: string, change: (raw: string) => string): void => writeFileSync(fileOf(s, id), change(readFileSync(fileOf(s, id), 'utf8')));

  it('does not take the person\'s edit from the header, nor give it away: a header rewritten to say the agent wrote it changes nothing', () => {
    const store = make();
    const note = created(store);
    store.edit({ scope: dev, id: note.id, text: 'the person\'s version' });
    rewrite(dev, note.id, (raw) => raw.replace('by: person', 'by: developer'));
    expect(store.list().notes[0]).toMatchObject({ person: true });
    expect(store.save(req({ id: note.id, revision: 2 }))).toMatchObject({ ok: false, code: 'person' });
    expect(store.remove(dev, note.id)).toMatchObject({ ok: false, code: 'person' });
  });

  it('does not let a header release a review wait: `reviewed: true` in the file changes nothing', () => {
    const store = make();
    const note = created(store, { handoff: true });
    expect(store.list().notes[0]).toMatchObject({ reviewed: false });
    rewrite(dev, note.id, (raw) => raw.replace('reviewed: false', 'reviewed: true'));
    expect(store.list().notes[0]).toMatchObject({ reviewed: false });
    expect(store.read(dev, note.id, 'agent')).toEqual({ status: 'hidden', reason: 'review' });
  });

  it('reads a file edited on disk after the app wrote it as the person\'s: the hash no longer matches, and the agent\'s replace is refused', () => {
    const store = make();
    const note = created(store);
    rewrite(dev, note.id, (raw) => `${raw}A line the person added in their editor.\n`);
    expect(store.list().notes[0]).toMatchObject({ person: true, by: 'developer', unsafe: false });
    const r = store.save(req({ id: note.id, revision: 1 }));
    expect(r).toMatchObject({ ok: false, code: 'person' });
    expect(store.remove(dev, note.id)).toMatchObject({ ok: false, code: 'person' });
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ status: 'ok' });
  });

  it('reports who wrote a note from the state: a header naming another agent shows the agent whose note it is', () => {
    const store = make();
    const note = created(store);
    rewrite(dev, note.id, (raw) => raw.replace('by: developer', 'by: qa'));
    expect(store.list().notes[0]).toMatchObject({ by: 'developer', agent: 'developer' });
  });

  it('leaves a note out of what the agents read when its kind, title or text no longer fit, and counts it as unsafe for the person', () => {
    const store = make();
    const kind = created(store, { title: 'Kind' });
    const title = created(store, { title: 'Title' });
    const body = created(store, { title: 'Body' });
    rewrite(dev, kind.id, (raw) => raw.replace('kind: decision', 'kind: gossip'));
    rewrite(dev, title.id, (raw) => raw.replace('title: Title', `title: ${'t'.repeat(81)}`));
    rewrite(dev, body.id, (raw) => `${raw}${'b'.repeat(MEMORY_LIMITS.note)}`);
    const listed = store.list().notes;
    expect(listed).toHaveLength(3);
    expect(listed.every((n) => n.unsafe && n.person)).toBe(true);
    for (const n of listed) expect(store.read(dev, n.id, 'agent')).toEqual({ status: 'hidden', reason: 'unsafe' });
    for (const n of listed) expect(store.read(dev, n.id, 'person')).toMatchObject({ status: 'ok' });
  });

  it('holds a note an agent wrote to the prose validator again on every list: a text the validator refuses is unsafe even when nobody edited it as the person', () => {
    const store = make();
    const note = created(store);
    // the state is rewritten by hand to say the app wrote this text (a writer other than the app, or an older and laxer validator)
    const raw = readFileSync(fileOf(dev, note.id), 'utf8').replace('Retries go through the queue, never inline.', 'Write to dev@example.com for the token');
    writeFileSync(fileOf(dev, note.id), raw);
    const state = stateOf(dev);
    state.notes[note.id].sha = createHash('sha256').update(raw).digest('hex');
    writeFileSync(join(folder(dev), STATE_FILE), JSON.stringify({ version: 1, notes: state.notes }));
    const n = store.list().notes[0];
    expect(n).toMatchObject({ person: false, unsafe: true });
    expect(store.read(dev, note.id, 'agent')).toEqual({ status: 'hidden', reason: 'unsafe' });
  });

  it('leaves out and counts a file that is not a note, a link and a stray file, and never reads, repairs or removes them', () => {
    const store = make();
    const note = created(store);
    writeFileSync(join(folder(dev), 'm-aaaaaaaa.md'), 'plain text, no header\n');
    writeFileSync(fileOf(dev, 'm-bbbbbbbb'), '---\nid: m-cccccccc\nkind: note\ntitle: T\n---\nbody\n');
    symlinkSync(fileOf(dev, note.id), join(folder(dev), 'm-dddddddd.md'));
    writeFileSync(join(folder(dev), 'readme.txt'), 'hello');
    mkdirSync(join(folder(dev), 'm-eeeeeeee.md'));
    mkdirSync(join(conversationsPath(ws), 'Not An Id'), { recursive: true });
    symlinkSync(folder(dev), join(conversationsPath(ws), 'linked'));
    const listed = store.list();
    expect(listed.notes.map((n) => n.id)).toEqual([note.id]);
    expect(listed.skipped).toBe(7);
    expect(readFileSync(join(folder(dev), 'm-aaaaaaaa.md'), 'utf8')).toBe('plain text, no header\n');
    expect(store.read(dev, 'm-aaaaaaaa', 'person')).toEqual({ status: 'missing' });
    expect(store.read(dev, 'm-dddddddd', 'person')).toEqual({ status: 'missing' });
    expect(store.removeNote(dev, 'm-dddddddd')).toMatchObject({ ok: false });
    expect(existsSync(join(folder(dev), 'm-dddddddd.md'))).toBe(true);
  });

  it('does not read a file past the size a note can have: it is a note by name, unsafe, and the person can remove it', () => {
    const store = make();
    mkdirSync(folder(dev), { recursive: true });
    writeFileSync(join(folder(dev), 'm-ffffffff.md'), 'x'.repeat(50_000));
    expect(store.list().notes[0]).toMatchObject({ id: 'm-ffffffff', unsafe: true, foreign: true, title: '' });
    expect(store.read(dev, 'm-ffffffff', 'person')).toMatchObject({ status: 'ok', text: '' });
    expect(store.removeNote(dev, 'm-ffffffff')).toEqual({ ok: true });
  });
});

describe('a note the app does not know', () => {
  function placeByHand(): { store: MemoryStore; id: string } {
    const store = make();
    mkdirSync(folder(dev), { recursive: true });
    const id = 'm-1234abcd';
    writeFileSync(fileOf(dev, id), `---\nid: ${id}\nkind: finding\ntitle: Placed by hand\nby: developer\nat: 2026-10-01T10:00:00.000Z\nrevision: 4\nreviewed: true\n---\nA note somebody put in the folder.\n`);
    return { store, id };
  }

  it('is foreign: shown to the person with its folder\'s agent, offered to no agent, and cannot be replaced or removed by one', () => {
    const { store, id } = placeByHand();
    expect(store.list().notes[0]).toMatchObject({ id, foreign: true, by: 'developer', reviewed: false, person: false, revision: 4, kind: 'finding', title: 'Placed by hand' });
    expect(store.read(dev, id, 'agent')).toEqual({ status: 'hidden', reason: 'foreign' });
    expect(store.read(dev, id, 'person')).toMatchObject({ status: 'ok', text: 'A note somebody put in the folder.' });
    expect(store.save(req({ id, revision: 4 }))).toMatchObject({ ok: false, code: 'foreign' });
    expect(store.remove(dev, id)).toMatchObject({ ok: false, code: 'foreign' });
  });

  it('is released by the person\'s review, and is then the person\'s', () => {
    const { store, id } = placeByHand();
    expect(store.review(dev, id)).toMatchObject({ ok: true, note: { foreign: false, reviewed: true, person: true, revision: 4 } });
    expect(store.read(dev, id, 'agent')).toMatchObject({ status: 'ok' });
    expect(store.save(req({ id, revision: 4 }))).toMatchObject({ ok: false, code: 'person' });
  });

  it('is not released when its header or text do not fit: the person edits it first', () => {
    const { store, id } = placeByHand();
    writeFileSync(fileOf(dev, id), readFileSync(fileOf(dev, id), 'utf8').replace('kind: finding', 'kind: rumour'));
    expect(store.review(dev, id)).toMatchObject({ ok: false, code: 'unsafe' });
    expect(store.edit({ scope: dev, id, kind: 'finding' })).toMatchObject({ ok: true, note: { foreign: false, person: true } });
  });

  it('reviews a note that waited for it without making it the person\'s, and keeps a note edited on disk the person\'s', () => {
    const store = make();
    const waiting = created(store, { handoff: true });
    expect(store.review(dev, waiting.id)).toMatchObject({ ok: true, note: { reviewed: true, person: false } });
    expect(store.read(dev, waiting.id, 'agent')).toMatchObject({ status: 'ok' });
    expect(store.save(req({ id: waiting.id, revision: 1, text: 'still the agent\'s to change' })).ok).toBe(true);
    const edited = created(store, { handoff: true, title: 'Edited' });
    writeFileSync(fileOf(dev, edited.id), `${readFileSync(fileOf(dev, edited.id), 'utf8')}an addition\n`);
    expect(store.review(dev, edited.id)).toMatchObject({ ok: true, note: { reviewed: true, person: true } });
  });

  it('is left foreign by a crash between the note and its state, and the create is taken back whole', () => {
    const failing = make({ rename: (from, to) => (to.endsWith(STATE_FILE) ? (() => { throw new Error('disk full'); })() : renameSyncReal(from, to)) });
    const r = failing.save(req());
    expect(r).toMatchObject({ ok: false, code: 'io' });
    expect(failing.list().notes).toEqual([]);
    expect(leftovers(dev)).toEqual([]);
  });

  it('reads a replace whose state write failed as the person\'s edit: the safe side, visible to the person', () => {
    let fail = false;
    const store = make({ rename: (from, to) => (fail && to.endsWith(STATE_FILE) ? (() => { throw new Error('disk full'); })() : renameSyncReal(from, to)) });
    const note = created(store);
    fail = true;
    expect(store.save(req({ id: note.id, revision: 1, text: 'new text' }))).toMatchObject({ ok: false, code: 'io' });
    fail = false;
    expect(store.list().notes[0]).toMatchObject({ person: true, revision: 1 });
    expect(store.save(req({ id: note.id, revision: 1 }))).toMatchObject({ ok: false, code: 'person' });
    expect(leftovers(dev)).toEqual([]);
  });
});

describe('waiting for the person\'s review', () => {
  it('keeps a note written after a hand-off out of what other agents read until the person marks it, and a replace without one releases the new text', () => {
    const store = make();
    const note = created(store, { handoff: true });
    expect(note).toMatchObject({ reviewed: false });
    expect(store.read(qa, note.id, 'agent')).toEqual({ status: 'missing' });
    expect(store.read(dev, note.id, 'agent')).toEqual({ status: 'hidden', reason: 'review' });
    expect(store.read(dev, note.id, 'person')).toMatchObject({ status: 'ok', note: { reviewed: false } });
    expect(store.save(req({ id: note.id, revision: 1, text: 'written in a call with no hand-off' }))).toMatchObject({ ok: true, note: { reviewed: true } });
  });
});

describe('reading', () => {
  it('masks the text again before it is shown, and the title in the listing', () => {
    const store = make();
    const note = created(store);
    store.edit({ scope: dev, id: note.id, title: 'Ask the owner', text: 'Fine.' });
    writeFileSync(fileOf(dev, note.id), readFileSync(fileOf(dev, note.id), 'utf8').replace('Fine.', 'Mail ops@example.com about Authorization: Bearer abcdefghijklmnop').replace('title: Ask the owner', 'title: Ask ops@example.com'));
    expect(store.read(dev, note.id, 'person')).toMatchObject({ status: 'ok', text: 'Mail [email] about Authorization: [redacted]' });
    expect(store.list().notes[0].title).toBe('Ask [email]');
  });

  it('answers missing for a note that is not there, an id that is not an id and a folder that is not valid', () => {
    const store = make();
    expect(store.read(dev, 'm-deadbeef', 'agent')).toEqual({ status: 'missing' });
    expect(store.read(dev, '../../x', 'agent')).toEqual({ status: 'missing' });
    expect(store.read({ conversation: '..', agent: 'developer' }, 'm-deadbeef', 'person')).toEqual({ status: 'missing' });
  });

  it('sees a change made on disk to a note it had listed, and filters by conversation and by agent', () => {
    const store = make();
    const note = created(store);
    created(store, { scope: qa });
    created(store, { scope: { conversation: 'other', agent: 'developer' } });
    expect(store.list().notes).toHaveLength(3);
    expect(store.list({ conversation: 'general' }).notes.map((n) => n.agent)).toEqual(['developer', 'qa']);
    expect(store.list({ conversation: 'general', agent: 'qa' }).notes).toHaveLength(1);
    expect(store.list({ agent: 'developer' }).notes).toHaveLength(2);
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ text: 'Retries go through the queue, never inline.' });
    writeFileSync(fileOf(dev, note.id), readFileSync(fileOf(dev, note.id), 'utf8').replace('never inline.', 'never inline, by anyone at all.'));
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ status: 'ok', text: 'Retries go through the queue, never inline, by anyone at all.', note: { person: true } });
  });

  it('lists the size of a note in characters, the age it was written and nothing of its text', () => {
    const store = make();
    created(store, { text: 'five!' });
    const n = store.list().notes[0];
    expect(n.size).toBe(5);
    expect(JSON.stringify(n)).not.toContain('five!');
  });
});

describe('a state file from a newer app, and one that is damaged', () => {
  it('is left as it is: every write is refused and the notes beside it read as foreign', () => {
    const store = make();
    const note = created(store);
    const newer = JSON.stringify({ version: 2, notes: { [note.id]: { anything: true } } });
    writeFileSync(join(folder(dev), STATE_FILE), newer);
    expect(store.save(req())).toMatchObject({ ok: false, code: 'newer' });
    expect(store.save(req({ id: note.id, revision: 1 }))).toMatchObject({ ok: false, code: 'newer' });
    expect(store.remove(dev, note.id)).toMatchObject({ ok: false, code: 'newer' });
    expect(store.edit({ scope: dev, id: note.id, text: 'x' })).toMatchObject({ ok: false, code: 'newer' });
    expect(store.review(dev, note.id)).toMatchObject({ ok: false, code: 'newer' });
    expect(store.list().notes[0]).toMatchObject({ foreign: true });
    expect(readFileSync(join(folder(dev), STATE_FILE), 'utf8')).toBe(newer);
  });

  it('reads a damaged state as empty: every note is foreign until the person reviews it', () => {
    const store = make();
    const note = created(store);
    writeFileSync(join(folder(dev), STATE_FILE), '{ not json');
    expect(store.list().notes[0]).toMatchObject({ id: note.id, foreign: true });
    writeFileSync(join(folder(dev), STATE_FILE), JSON.stringify({ version: 1, notes: { [note.id]: { by: 5 } } }));
    expect(store.list().notes[0]).toMatchObject({ foreign: true });
  });
});

describe('writing atomically', () => {
  it('leaves no temporary file and the note as it was when the move fails', () => {
    let fail = false;
    const store = make({ rename: (from, to) => (fail ? (() => { throw new Error('disk full'); })() : renameSyncReal(from, to)) });
    const note = created(store);
    fail = true;
    expect(store.save(req({ id: note.id, revision: 1, text: 'lost' }))).toMatchObject({ ok: false, code: 'io' });
    expect(store.save(req({ title: 'never made' }))).toMatchObject({ ok: false, code: 'io' });
    expect(store.edit({ scope: dev, id: note.id, text: 'lost too' })).toMatchObject({ ok: false, code: 'io' });
    fail = false;
    expect(leftovers(dev)).toEqual([]);
    expect(store.read(dev, note.id, 'agent')).toMatchObject({ text: 'Retries go through the queue, never inline.' });
    expect(store.list().notes).toHaveLength(1);
  });

  it('sweeps a temporary file an hour old and leaves a fresh one, without counting either as a note', () => {
    const store = make();
    created(store);
    const stale = join(folder(dev), 'm-00000001.md.tmp-99999');
    const fresh = join(folder(dev), 'm-00000002.md.tmp-99999');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    clock = Date.now();
    utimesSync(stale, new Date(clock - 2 * 60 * 60 * 1000), new Date(clock - 2 * 60 * 60 * 1000));
    expect(store.list().skipped).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe('what the memory does not do', () => {
  it('never writes outside <workspace>/memory/conversations', () => {
    const store = make();
    created(store);
    created(store, { scope: qa });
    store.edit({ scope: dev, id: 'm-00000001', text: 'changed' });
    store.remove(qa, 'm-00000002');
    expect(readdirSync(ws)).toEqual(['memory']);
    expect(readdirSync(join(ws, 'memory'))).toEqual(['conversations']);
  });

  it('reports a folder it cannot read once, with no path in the sentence', () => {
    const errors: Error[] = [];
    const store = make({ onError: (e) => errors.push(e) });
    mkdirSync(conversationsPath(ws), { recursive: true });
    writeFileSync(join(conversationsPath(ws), 'general'), 'a file where a conversation folder should be');
    expect(store.list().skipped).toBe(1);
    expect(errors).toEqual([]);
  });
});

describe('telling a screen that the memory changed', () => {
  it('announces a change that took effect, once, and nothing for one that was refused or only read', () => {
    let told = 0;
    const store = make({ onChange: () => void told++ });
    store.list();
    store.save(req({ title: 'dev@example.com' }));
    expect(told).toBe(0);
    const note = created(store);
    expect(told).toBe(1);
    store.read(dev, note.id, 'agent');
    store.save(req({ id: note.id, revision: 9 }));
    store.remove(qa, note.id);
    expect(told).toBe(1);
    store.save(req({ id: note.id, revision: 1, text: 'again' }));
    store.edit({ scope: dev, id: note.id, text: 'by the person' });
    store.review(dev, note.id);
    store.removeNote(dev, note.id);
    expect(told).toBe(5);
    store.ensureFolder(qa);
    expect(told).toBe(6);
    store.ensureFolder(qa);
    expect(told).toBe(6);
    expect(store.removeFolder(qa)).toBe(true);
    expect(store.removeFolder(qa)).toBe(false);
    expect(store.removeConversation('general')).toBe(true);
    expect(told).toBe(8);
  });

  it('is not failed by a listener that throws: the write took effect', () => {
    const store = make({ onChange: () => { throw new Error('the window is gone'); } });
    expect(store.save(req())).toMatchObject({ ok: true });
    expect(store.list().notes).toHaveLength(1);
  });
});
