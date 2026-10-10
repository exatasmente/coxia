import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { OLD_AFTER_MS } from '../src/shared/memoryView';
import { memoryAuditEntry } from '../src/main/memory/audit';
import { createMemoryChannels, type MemoryChannels } from '../src/main/memory/channels';
import { conversationsPath, createMemoryStore, type MemoryStore, type Scope } from '../src/main/memory/store';

// The channels of the Memory view: the six, their argument checks, the audit with the door the call came through, and that they work with the switch off.

let ws: string;
let store: MemoryStore;
let config: WorkspaceConfig;
let via: 'window' | 'paired';
let clock: number;
let counter: number;
const audited: Omit<AuditEntry, 'at'>[] = [];
let channels: MemoryChannels;

const T0 = Date.parse('2026-10-09T10:00:00Z');
const dev: Scope = { conversation: 'general', agent: 'developer' };
const qa: Scope = { conversation: 'general', agent: 'qa' };
const gone: Scope = { conversation: 'direct-gone', agent: 'ghost' };

function keep(scope: Scope, over: { title?: string; text?: string; handoff?: boolean } = {}): string {
  const r = store.save({ scope, kind: 'decision', title: over.title ?? 'Use the queue', text: over.text ?? 'Retries go through the queue.', handoff: over.handoff, home: '/home/person' });
  if (!r.ok) throw new Error(r.text);
  return r.note.id;
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-memory-channels-'));
  clock = T0;
  counter = 0;
  via = 'window';
  audited.length = 0;
  config = neutralConfig();
  config.agents.team.push(newAgent({ id: 'developer', name: 'Developer' }), newAgent({ id: 'qa', name: 'QA' }));
  store = createMemoryStore(ws, { now: () => clock, hex: () => (++counter).toString(16).padStart(8, '0'), home: '/home/person' });
  channels = createMemoryChannels({ store, config: () => config, audit: (e) => void audited.push(e), via: () => via, titleOf: (c) => (c === 'general' ? 'General conversation' : null), now: () => clock });
});

describe('memory:list', () => {
  it('lists every folder, an empty one included, and a line per note with no text', () => {
    const id = keep(dev);
    keep(qa, { title: 'Second' });
    store.ensureFolder({ conversation: 'direct-qa', agent: 'qa' });
    const view = channels.list();
    expect(view.enabled).toBe(true);
    expect(view.folders).toEqual([
      { conversation: 'direct-qa', agent: 'qa', title: 'direct-qa', left: false },
      { conversation: 'general', agent: 'developer', title: 'General conversation', left: false },
      { conversation: 'general', agent: 'qa', title: 'General conversation', left: false },
    ]);
    expect(view.items.map((n) => `${n.agent}:${n.title}`)).toEqual(['developer:Use the queue', 'qa:Second']);
    expect(view.items[0]).toMatchObject({ id, kind: 'decision', by: 'developer', revision: 1, reviewed: true, foreign: false, unsafe: false, old: false, left: false });
    expect(JSON.stringify(view)).not.toContain('Retries go through the queue');
  });

  it('says whether the switch is on, and works the same way with it off', () => {
    keep(dev);
    config.runner.sharedMemory = false;
    expect(channels.list()).toMatchObject({ enabled: false });
    expect(channels.list().items).toHaveLength(1);
    delete config.runner.sharedMemory;
    expect(channels.list().enabled).toBe(false);
  });

  it('marks a note old after 90 days, and a folder and its notes of an agent that left the team', () => {
    keep(gone);
    keep(dev);
    clock = T0 + OLD_AFTER_MS + 1000;
    const view = channels.list();
    expect(view.folders.find((f) => f.agent === 'ghost')).toMatchObject({ left: true });
    expect(view.items.find((n) => n.agent === 'ghost')).toMatchObject({ left: true, old: true });
    expect(view.items.find((n) => n.agent === 'developer')).toMatchObject({ left: false, old: true });
    clock = T0 + OLD_AFTER_MS - 1000;
    expect(channels.list().items.every((n) => !n.old)).toBe(true);
  });

  it('counts what is not a note and says nothing else about it', () => {
    keep(dev);
    writeFileSync(join(conversationsPath(ws), 'general', 'developer', 'readme.txt'), 'stray');
    expect(channels.list().skipped).toBe(1);
  });

  it('reads a title the app does not know, and one whose lookup throws, as the conversation id', () => {
    keep(dev);
    const throwing = createMemoryChannels({ store, config: () => config, via: () => 'window', titleOf: () => { throw new Error('forum is closed'); } });
    expect(throwing.list().folders[0].title).toBe('general');
    expect(channels.list().folders.find((f) => f.agent === 'developer')?.title).toBe('General conversation');
  });
});

describe('memory:read', () => {
  it('answers the note whole, masked, with who wrote it', () => {
    const id = keep(dev);
    expect(channels.read('general', 'developer', id)).toMatchObject({ status: 'ok', text: 'Retries go through the queue.', note: { id, by: 'developer', person: false } });
  });

  it('reads a note whatever state it is in: waiting for review, foreign or not accepted', () => {
    const waiting = keep(dev, { handoff: true });
    expect(channels.read('general', 'developer', waiting)).toMatchObject({ status: 'ok', note: { reviewed: false } });
    const file = join(conversationsPath(ws), 'general', 'developer', `${waiting}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('kind: decision', 'kind: gossip'));
    expect(channels.read('general', 'developer', waiting)).toMatchObject({ status: 'ok', note: { unsafe: true } });
  });

  it('answers missing for a note that is not there and for arguments that are not what they must be', () => {
    const id = keep(dev);
    for (const args of [['general', 'developer', 'm-deadbeef'], ['general', 'qa', id], ['nope', 'developer', id], ['../x', 'developer', id], ['general', '..', id], ['general', 'developer', '../m-1'], ['general', 'developer', 5], [5, 'developer', id], [null, null, null], [undefined, undefined, undefined]]) {
      expect(channels.read(...(args as [unknown, unknown, unknown])), JSON.stringify(args)).toEqual({ status: 'missing' });
    }
  });
});

describe('memory:save, the person\'s edit', () => {
  it('edits a note, marks it the person\'s, and the answer is the note as stored', () => {
    const id = keep(dev);
    const r = channels.save('general', 'developer', id, 1, { title: 'Retries and the queue', text: 'Retries go through the queue, three at most.', kind: 'finding' });
    expect(r).toMatchObject({ ok: true, note: { id, title: 'Retries and the queue', kind: 'finding', person: true, revision: 2, reviewed: true } });
    expect(store.read(dev, id, 'agent')).toMatchObject({ text: 'Retries go through the queue, three at most.' });
    expect(store.save({ scope: dev, id, revision: 2, kind: 'note', title: 'x', text: 'agent text' })).toMatchObject({ ok: false, code: 'person' });
  });

  it('refuses a stale revision, an empty change and a field of the wrong type, and says why', () => {
    const id = keep(dev);
    channels.save('general', 'developer', id, 1, { text: 'one' });
    expect(channels.save('general', 'developer', id, 1, { text: 'two' })).toMatchObject({ ok: false, code: 'revision' });
    expect(channels.save('general', 'developer', id, 2, {})).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.save('general', 'developer', id, 2, null)).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.save('general', 'developer', id, 2, { title: 5 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.save('general', 'developer', id, 2, { kind: 'opinion' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.save('general', 'developer', id, 2, { text: '' })).toMatchObject({ ok: false, code: 'invalid' });
    const long = channels.save('general', 'developer', id, 2, { title: 'x'.repeat(81) });
    expect(long).toMatchObject({ ok: false, code: 'invalid', refusals: [{ field: 'title' }] });
    expect(store.read(dev, id, 'person')).toMatchObject({ text: 'one' });
  });

  it('cannot create a note: an id nobody has is not found', () => {
    expect(channels.save('general', 'developer', 'm-deadbeef', 1, { text: 'x' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(store.list().notes).toEqual([]);
  });

  it('masks a credential in the person\'s text instead of refusing it', () => {
    const id = keep(dev);
    expect(channels.save('general', 'developer', id, 1, { text: 'Ask dev@example.com about the vault' }).ok).toBe(true);
    expect(channels.read('general', 'developer', id)).toMatchObject({ text: 'Ask [email] about the vault' });
  });
});

describe('memory:review', () => {
  it('releases a note that waited, without changing its text', () => {
    const id = keep(dev, { handoff: true });
    expect(store.read(dev, id, 'agent')).toMatchObject({ status: 'hidden' });
    expect(channels.review('general', 'developer', id)).toMatchObject({ ok: true, note: { reviewed: true, revision: 1, person: false } });
    expect(store.read(dev, id, 'agent')).toMatchObject({ status: 'ok', text: 'Retries go through the queue.' });
  });

  it('releases a note placed by hand in the folder (foreign), which becomes the person\'s', () => {
    store.ensureFolder(qa);
    const file = join(conversationsPath(ws), 'general', 'qa', 'm-aaaa0001.md');
    writeFileSync(file, '---\nid: m-aaaa0001\nkind: finding\ntitle: By hand\n---\nSomebody wrote this.\n');
    expect(channels.list().items[0]).toMatchObject({ foreign: true, reviewed: false });
    expect(channels.review('general', 'qa', 'm-aaaa0001')).toMatchObject({ ok: true, note: { foreign: false, reviewed: true, person: true } });
  });

  it('refuses a note that is not there, one that does not pass the checks, and bad arguments', () => {
    expect(channels.review('general', 'developer', 'm-deadbeef')).toMatchObject({ ok: false, code: 'not-found' });
    expect(channels.review('general', 'developer', 'x')).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.review('Bad', 'developer', 'm-deadbeef')).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('memory:remove and memory:remove-folder', () => {
  it('removes any note, whoever wrote it, and the next reader no longer finds it', () => {
    const id = keep(dev);
    const edited = keep(dev, { title: 'Edited' });
    channels.save('general', 'developer', edited, 1, { text: 'mine' });
    expect(channels.remove('general', 'developer', id)).toEqual({ ok: true });
    expect(channels.remove('general', 'developer', edited)).toEqual({ ok: true });
    expect(store.read(dev, id, 'agent')).toEqual({ status: 'missing' });
    expect(channels.list().items).toEqual([]);
    expect(channels.remove('general', 'developer', id)).toMatchObject({ ok: false, code: 'not-found' });
    expect(channels.remove('general', 'developer', '../m-1')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('removes an agent\'s folder, or a whole conversation, and counts what went', () => {
    keep(dev);
    keep(dev, { title: 'Two' });
    keep(qa);
    expect(channels.removeFolder('general', 'developer')).toEqual({ ok: true });
    expect(channels.list().folders.map((f) => f.agent)).toEqual(['qa']);
    expect(channels.removeFolder('general')).toEqual({ ok: true });
    expect(channels.list().folders).toEqual([]);
    expect(channels.removeFolder('general')).toMatchObject({ ok: false, code: 'not-found' });
    expect(channels.removeFolder('../x')).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.removeFolder('general', '..')).toMatchObject({ ok: false, code: 'invalid' });
    expect(channels.removeFolder(5)).toMatchObject({ ok: false, code: 'invalid' });
    expect(audited.filter((a) => a.result === 'removed the folder').map((a) => a.fields.removed)).toEqual(['2', '1']);
  });
});

describe('what a path can be made of', () => {
  it('builds nothing from an argument that is not an id: no channel touches a file outside the memory folder', () => {
    keep(dev);
    const tricks = ['../etc', '..', '.', 'a/b', 'a\\b', '', ' ', 'GENERAL', 'général', 'x'.repeat(65), 'general\0', '~', '/etc/passwd'];
    for (const bad of tricks) {
      expect(channels.read(bad, 'developer', 'm-00000001'), bad).toEqual({ status: 'missing' });
      expect(channels.save(bad, 'developer', 'm-00000001', 1, { text: 'x' }), bad).toMatchObject({ ok: false, code: 'invalid' });
      expect(channels.review(bad, 'developer', 'm-00000001'), bad).toMatchObject({ ok: false, code: 'invalid' });
      expect(channels.remove(bad, 'developer', 'm-00000001'), bad).toMatchObject({ ok: false, code: 'invalid' });
      expect(channels.removeFolder(bad), bad).toMatchObject({ ok: false, code: 'invalid' });
      expect(channels.read('general', bad, 'm-00000001'), bad).toEqual({ status: 'missing' });
      expect(channels.removeFolder('general', bad), bad).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(channels.list().items).toHaveLength(1);
  });
});

describe('the audit', () => {
  it('records the door each write came through, the window or a paired browser, and never the text', () => {
    const a = keep(dev);
    const b = keep(dev, { title: 'Second' });
    via = 'window';
    channels.save('general', 'developer', a, 1, { text: 'edited in the window, with a private sentence' });
    via = 'paired';
    channels.save('general', 'developer', b, 1, { text: 'edited in the phone, with another private sentence' });
    channels.remove('general', 'developer', b);
    expect(audited.map((e) => `${e.target}:${e.via}:${e.fields.surface}:${e.result}`)).toEqual(['memory:edit:window:window:edited', 'memory:edit:paired:paired:edited', 'memory:remove:paired:paired:removed']);
    expect(audited[0]).toMatchObject({ kind: 'memory', issue: 0, ok: true, by: 'person', origin: { kind: 'memory', key: 'general' }, fields: { conversation: 'general', agent: 'developer', id: a, kind: 'decision', title: 'Use the queue', revision: '2' } });
    expect(JSON.stringify(audited)).not.toContain('private sentence');
  });

  it('records a refusal by its code and the fields it named, not by what was refused', () => {
    const id = keep(dev);
    channels.save('general', 'developer', id, 1, { title: 'x'.repeat(81), text: 'a secret sentence that was refused' });
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ ok: false, result: 'refused', target: 'memory:save', fields: { code: 'invalid', fields: 'title' } });
    expect(JSON.stringify(audited)).not.toContain('secret sentence');
    expect(audited[0].fields).not.toHaveProperty('title');
  });

  it('records the review and the removal of a folder, and a failing log never fails the write', () => {
    const id = keep(dev, { handoff: true });
    channels.review('general', 'developer', id);
    channels.removeFolder('general', 'developer');
    expect(audited.map((e) => e.result)).toEqual(['marked reviewed', 'removed the folder']);
    const broken = createMemoryChannels({ store, config: () => config, audit: () => { throw new Error('log is full'); }, via: () => 'window' });
    const other = keep(qa);
    expect(broken.remove('general', 'qa', other)).toEqual({ ok: true });
  });

  it('names the two other moves of the memory, the correction of an activity and the cycle memory, with the door and no text', () => {
    expect(memoryAuditEntry({ op: 'activity-correct', via: 'paired', ref: 'app#123' })).toMatchObject({ kind: 'memory', target: 'memory:activity-correct', via: 'paired', result: 'corrected the activity', fields: { surface: 'paired', ref: 'app#123' }, origin: { key: 'app#123' } });
    expect(memoryAuditEntry({ op: 'cycle-memory-edit', via: 'window', ref: 'r-abc-1234' })).toMatchObject({ target: 'memory:cycle-memory-edit', via: 'window', result: 'edited the cycle memory', fields: { surface: 'window', ref: 'r-abc-1234' } });
  });

  it('masks a title that holds an address before it reaches the log', () => {
    const entry = memoryAuditEntry({ op: 'edit', via: 'window', conversation: 'general', agent: 'developer', note: { id: 'm-00000001', kind: 'note', title: 'Ask dev@example.com', revision: 2 } });
    expect(entry.fields.title).toBe('Ask [email]');
  });
});

describe('the channels never import anything that can run or send', () => {
  it('has no network, shell or Electron in its modules', () => {
    for (const f of ['channels.ts', 'audit.ts']) {
      const source = readFileSync(join(import.meta.dirname, '../src/main/memory', f), 'utf8');
      expect(source, f).not.toMatch(/from 'electron'|child_process|node:http|fetch\(/);
    }
  });
});
