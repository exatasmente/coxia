import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { SECRET_PATH, noSecrets, secretPath } from '../src/main/agents';
import { NOTE_FILE, STATE_FILE } from '../src/shared/memory';
import { conversationsPath, createMemoryStore } from '../src/main/memory/store';

// `SECRET_PATH` judges the whole path, and a conversation or an agent whose id the person chose may hold one of its words. The app opens a note by the id it validated and
// never asks the filter, so the store works for every id; a direct Read of such a note by path stays refused, which is the safe side (spec rule 4: the tool is the
// supported way). The names the app generates never carry the words.

const ws = mkdtempSync(join(tmpdir(), 'coxia-memory-secret-'));
const scope = { conversation: 'token-rotation', agent: 'secret-keeper' };
const store = createMemoryStore(ws, { home: '/home/person' });

describe('a conversation or an agent whose id holds a word the secret filter holds back', () => {
  it('keeps notes: the store lists, reads, replaces and removes them by the id it validated', () => {
    const r = store.save({ scope, kind: 'decision', title: 'Rotate on Fridays', text: 'The rotation happens on Fridays.', home: '/home/person' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.list().notes.map((n) => `${n.conversation}/${n.agent}/${n.id}`)).toEqual([`token-rotation/secret-keeper/${r.note.id}`]);
    expect(store.read(scope, r.note.id, 'agent')).toMatchObject({ status: 'ok', text: 'The rotation happens on Fridays.' });
    expect(store.save({ scope, id: r.note.id, revision: 1, kind: 'decision', title: 'Rotate on Fridays', text: 'Mondays now.', home: '/home/person' }).ok).toBe(true);
    expect(store.edit({ scope, id: r.note.id, text: 'The person says Wednesdays.' }).ok).toBe(true);
    expect(store.locate(r.note.id)).toEqual(scope);
    expect(store.removeNote(scope, r.note.id)).toEqual({ ok: true });
  });

  it('is refused to a direct Read by path, which judges the whole path: the documented behaviour, not a bug of the memory', () => {
    const r = store.save({ scope, kind: 'note', title: 'A note', text: 'Text.', home: '/home/person' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const path = join(conversationsPath(ws), scope.conversation, scope.agent, `${r.note.id}.md`);
    expect(secretPath(path)).toBe(true);
    expect(SECRET_PATH.test(path)).toBe(true);
  });

  it('is refused by the hook the SDK engine runs before a Read, a Grep and a Glob', async () => {
    const r = store.save({ scope, kind: 'note', title: 'Another', text: 'Text.', home: '/home/person' });
    if (!r.ok) throw new Error(r.text);
    const path = join(conversationsPath(ws), scope.conversation, scope.agent, `${r.note.id}.md`);
    for (const tool_name of ['Read', 'Grep', 'Glob']) {
      const input = { hook_event_name: 'PreToolUse', tool_name, tool_input: tool_name === 'Glob' ? { pattern: path } : { file_path: path, path }, cwd: ws } as unknown as HookInput;
      const out = await noSecrets(input, undefined, { signal: new AbortController().signal });
      expect(JSON.stringify(out)).toContain('"permissionDecision":"deny"');
    }
  });
});

describe('the names the app generates', () => {
  it('never carry the words, so only an id the person chose can trigger the filter', () => {
    const fresh = createMemoryStore(mkdtempSync(join(tmpdir(), 'coxia-memory-names-')), { home: '/home/person' });
    const scope2 = { conversation: 'general', agent: 'developer' };
    const made = fresh.save({ scope: scope2, kind: 'note', title: 'Name check', text: 'Text.', home: '/home/person' });
    if (!made.ok) throw new Error(made.text);
    const where = join(conversationsPath('/data/ws'), scope2.conversation, scope2.agent);
    expect(NOTE_FILE.test(`${made.note.id}.md`)).toBe(true);
    expect(secretPath(join(where, `${made.note.id}.md`))).toBe(false);
    expect(secretPath(join(where, STATE_FILE))).toBe(false);
    expect(SECRET_PATH.test(join(where, `${made.note.id}.md`))).toBe(false);
    expect(SECRET_PATH.test(join(where, STATE_FILE))).toBe(false);
    for (let i = 0; i < 200; i++) expect(SECRET_PATH.test(`m-${(i * 2654435761 >>> 0).toString(16).padStart(8, '0')}.md`)).toBe(false);
  });
});
