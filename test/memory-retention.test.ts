// The notes of the shared memory are curated knowledge, like the procedures: the retention sweep never reads, lists or removes them. The data folder is the test file's own
// empty one; the transcripts folder is pointed at an empty one too.
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

process.env.CERIMONIAS_TRANSCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'coxia-memory-transcripts-'));

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { applyRetention, previewRetention, scan } = await import('../src/main/retention');
const { ATAS } = await import('../src/main/env');
const { MEMORY_DIR } = await import('../src/main/runner/activities');
const { conversationsPath } = await import('../src/main/memory/store');
const { memoryStore } = await import('../src/main/memory/instance');

const DAY = 86_400_000;

function age(path: string, days: number): void {
  const when = new Date(Date.now() - days * DAY);
  utimesSync(path, when, when);
}

const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);

describe('retention and the shared memory', () => {
  it('a sweep over very old notes neither lists nor removes them, nor the state beside them', () => {
    const store = memoryStore();
    const scope = { conversation: 'retention-test', agent: 'developer' };
    const a = store.save({ scope, kind: 'decision', title: 'Use the queue', text: 'Retries go through the queue.' });
    const b = store.save({ scope, kind: 'finding', title: 'Flaky test', text: 'The login test is flaky on slow machines.' });
    if (!a.ok || !b.ok) throw new Error('not saved');
    const root = conversationsPath(ATAS);
    const folder = join(root, scope.conversation, scope.agent);
    const targets = readdirSync(folder).map((n) => join(folder, n));
    expect(targets).toHaveLength(3);
    for (const t of targets) age(t, 400);
    age(folder, 400);
    const before = new Map(targets.map((t) => [t, readFileSync(t, 'utf8')]));

    const selection = scan(30);
    const memory = join(ATAS, MEMORY_DIR);
    expect([...selection.remove, ...selection.keep].filter((v) => v.file.path.startsWith(memory))).toEqual([]);
    expect(previewRetention(30).items.filter((i) => /^m-[0-9a-f]{8}\.md$|^_state\.json$/.test(i.name))).toEqual([]);

    const result = applyRetention(30, null);
    expect(result.failed).toEqual([]);
    for (const [t, text] of before) expect(readFileSync(t, 'utf8'), t).toBe(text);
    expect(filesUnder(folder)).toEqual(targets.map((t) => t.slice(folder.length + 1)).sort());
    expect(store.list({ conversation: scope.conversation }).notes.map((n) => n.id).sort()).toEqual([a.note.id, b.note.id].sort());
    store.removeConversation(scope.conversation);
  });

  it('a note is old after 90 days but is shown as old and never removed by age', () => {
    const store = memoryStore();
    const scope = { conversation: 'retention-old', agent: 'developer' };
    const made = store.save({ scope, kind: 'note', title: 'Ancient', text: 'Written long ago.' });
    if (!made.ok) throw new Error('not saved');
    const file = join(conversationsPath(ATAS), scope.conversation, scope.agent, `${made.note.id}.md`);
    age(file, 1000);
    applyRetention(7, null);
    expect(existsSync(file)).toBe(true);
    store.removeConversation(scope.conversation);
  });
});
