// The learned procedures are curated knowledge: the retention sweep never reads or removes them, and the activities memory beside them in `memory/` is a separate file
// the procedures never touch (and the other way round). The data folder is the test file's own empty one; the transcripts folder is pointed at an empty one too.
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

process.env.CERIMONIAS_TRANSCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'coxia-procedures-transcripts-'));

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { applyRetention, previewRetention, scan } = await import('../src/main/retention');
const { ATAS } = await import('../src/main/env');
const { ACTIVITIES_FILE, MEMORY_DIR, activitiesPath, emptyIndex, readIndex, writeIndex } = await import('../src/main/runner/activities');
const { createProcedureStore, proceduresPath } = await import('../src/main/procedures/store');

const DAY = 86_400_000;
const writer = { by: 'writer', surface: 'stage' as const };
const content = { kind: 'repo', key: 'api', title: 'Run the end-to-end tests', steps: [{ text: 'Run the suite', run: 'npm run test:e2e' }], pitfalls: [], waits: [] };

const filesUnder = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);

function age(path: string, days: number): void {
  const when = new Date(Date.now() - days * DAY);
  utimesSync(path, when, when);
}

describe('retention and the procedures', () => {
  it('a sweep over very old records neither lists nor removes them, nor the deleted ids, nor the activities file', () => {
    const store = createProcedureStore(ATAS);
    const a = store.save({ input: content, writer, repos: ['api'] });
    const b = store.save({ input: { ...content, title: 'Build the api' }, writer, repos: ['api'] });
    if (!a.ok || !b.ok) throw new Error('not saved');
    store.remove(b.record.id);
    writeIndex(ATAS, emptyIndex());
    const memory = join(ATAS, MEMORY_DIR);
    const targets = [...readdirSync(proceduresPath(ATAS)).map((n) => join(proceduresPath(ATAS), n)), activitiesPath(ATAS)];
    for (const t of targets) age(t, 400);
    const before = new Map(targets.map((t) => [t, readFileSync(t, 'utf8')]));

    const selection = scan(30);
    expect([...selection.remove, ...selection.keep].filter((v) => v.file.path.startsWith(memory))).toEqual([]);
    expect(previewRetention(30).items.filter((i) => i.name === ACTIVITIES_FILE || i.name === `${a.record.id}.json` || i.name === 'deleted.json')).toEqual([]);

    const result = applyRetention(30, null);
    expect(result.failed).toEqual([]);
    for (const [t, text] of before) expect(readFileSync(t, 'utf8'), t).toBe(text);
    expect(store.list().records.map((r) => r.id)).toEqual([a.record.id]);
  });

  it('the activities memory and the procedures never read or write each other\'s files', () => {
    const store = createProcedureStore(ATAS);
    const activities = activitiesPath(ATAS);
    writeIndex(ATAS, emptyIndex());
    const activitiesBefore = readFileSync(activities, 'utf8');
    const procedures = filesUnder(proceduresPath(ATAS));

    const saved = store.save({ input: { ...content, title: 'Lint the api' }, writer, repos: ['api'] });
    if (!saved.ok) throw new Error('not saved');
    expect(readFileSync(activities, 'utf8')).toBe(activitiesBefore);

    const procedureFiles = filesUnder(proceduresPath(ATAS));
    const procedureText = readFileSync(join(proceduresPath(ATAS), `${saved.record.id}.json`), 'utf8');
    writeIndex(ATAS, { ...emptyIndex(), agents: { writer: { ref: 'app#1', stage: null, at: '2026-10-09T10:00:00.000Z' } } });
    expect(readIndex(ATAS)?.agents.writer).toBeDefined();
    expect(filesUnder(proceduresPath(ATAS))).toEqual(procedureFiles);
    expect(readFileSync(join(proceduresPath(ATAS), `${saved.record.id}.json`), 'utf8')).toBe(procedureText);
    expect(procedureFiles.length).toBeGreaterThan(procedures.length);
    // The two keep apart: the activities folder holds one file of its own and one folder for the procedures.
    expect(filesUnder(join(ATAS, MEMORY_DIR))).toEqual([ACTIVITIES_FILE, 'procedures']);
  });
});
