// A spoken message says so: the origin is written with the person's post and read back from disk, and anything but a known origin, or an origin on someone else's
// message, is dropped. Without this the persona could not tell a spoken turn from a typed one.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { personPost } from '../src/main/forum';
import { messageOrigin } from '../src/shared/forum';

let dir: string;
let store: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-forum-origin-'));
  store = createForumStore(join(dir, 'forum'));
  store.ensureThread({ id: 'g', kind: 'general', title: 'g' });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the origin of a message', () => {
  it('is kept for a spoken post of the person and survives a reread from disk', () => {
    const m = personPost(store, [], 'g', 'what is open today', false, undefined, 'voice');
    expect(m.origin).toBe('voice');
    const fresh = createForumStore(join(dir, 'forum'));
    const read = fresh.read('g')!.messages.find((x) => x.seq === m.seq);
    expect(read?.origin).toBe('voice');
    expect(readFileSync(join(dir, 'forum', 'g.jsonl'), 'utf8')).toContain('"origin":"voice"');
  });

  it('is absent on a typed post, and an unknown or malformed origin is ignored', () => {
    expect(personPost(store, [], 'g', 'typed').origin).toBeUndefined();
    expect(personPost(store, [], 'g', 'other', false, undefined, 'phone').origin).toBeUndefined();
    expect(personPost(store, [], 'g', 'number', false, undefined, 1).origin).toBeUndefined();
    expect(personPost(store, [], 'g', 'object', false, undefined, { origin: 'voice' }).origin).toBeUndefined();
    expect(createForumStore(join(dir, 'forum')).read('g')!.messages.every((m) => m.origin === undefined)).toBe(true);
  });

  it('is never kept on a message the person did not write', () => {
    const [m] = store.append('g', { kind: 'post', author: { type: 'agent', id: 'developer' }, text: 'an answer', origin: 'voice' });
    expect(m.origin).toBeUndefined();
    const [app] = store.append('g', { kind: 'system', author: { type: 'app' }, code: 'main.forum.mentions.unknown', params: { names: '@x' }, origin: 'voice' });
    expect(app.origin).toBeUndefined();
  });

  it('messageOrigin accepts only the known value', () => {
    expect(messageOrigin('voice')).toBe('voice');
    for (const v of ['Voice', '', 'text', null, undefined, 0, {}]) expect(messageOrigin(v)).toBeUndefined();
  });
});
