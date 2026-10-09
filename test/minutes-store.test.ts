import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Minutes } from '../src/shared/types';
import { card, ceremony, turn } from './helpers/ceremony';
import { installLegacyConfig } from './helpers/config';
import { specFiles } from './helpers/promptCapture';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

type Store = typeof import('../src/main/minutesStore');
type State = typeof import('../src/main/state');
type Saver = typeof import('../src/main/store');

let store: Store;
let state: State;
let saver: Saver;
let ATAS: string;
let SPECS: string;
const DAY = '2026-10-02';

const A = '2026-10-02T094000';
const B = '2026-10-02T141000';

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T15:00:00'));
  await installLegacyConfig();
  ATAS = (await import('../src/main/env')).ATAS;
  SPECS = process.env.CERIMONIAS_SPECS_DIR as string;
  store = await import('../src/main/minutesStore');
  state = await import('../src/main/state');
  saver = await import('../src/main/store');
});

// Every test starts from an empty workspace folder.
beforeEach(async () => {
  for (const name of readdirSync(ATAS)) if (name !== 'config.json' && name !== 'secrets.json') rmSync(join(ATAS, name), { recursive: true, force: true });
  vi.setSystemTime(new Date('2026-10-02T15:00:00'));
});

afterEach(() => vi.setSystemTime(new Date('2026-10-02T15:00:00')));

const minutes = (over: Partial<Minutes> = {}): Minutes => ({
  startedAt: new Date(`${DAY}T09:40:00`).toISOString(),
  endedAt: new Date(`${DAY}T09:50:00`).toISOString(),
  decisions: [],
  effects: [],
  unanswered: [],
  transcript: [{ who: 'Ana', text: 'good morning', at: '0:01' }],
  ...over,
});

const decision = (over: Partial<Decision> = {}): Decision => ({ ref: 'acme#1', text: 'Ship it today', target: 'ata', dest: 'minutes', ...over });
const files = () => readdirSync(ATAS).sort();

describe('registering the ceremonies of a day as versions', () => {
  it('gives each ceremony that started a call the next number, and nothing to one that did not start', () => {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], spoken: ['acme#1'], turns: { 'acme#1': turn('acme#1') } }));
    state.saveState(ceremony({ id: '2026-10-02T120000', startedAt: null, cards: [card('acme#1')] }));
    state.saveState(ceremony({ id: B, cards: [card('acme#1')] }));
    expect(state.listHistory().map((e) => [e.id, e.version])).toEqual([[B, 2], ['2026-10-02T120000', null], [A, 1]]);
    expect(store.dayView(DAY).versions.map((v) => v.n)).toEqual([1, 2]);
  });

  it('keeps the number when the same ceremony is saved again, and follows what it holds', () => {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [] }));
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [decision()] }));
    const day = store.dayView(DAY);
    expect(day.versions).toHaveLength(1);
    expect(day.versions[0].snapshot.decisions).toHaveLength(1);
  });

  it('marks a call that has not ended as live, and an ended one as not', () => {
    state.saveState(ceremony({ id: A, callEnded: true }));
    state.saveState(ceremony({ id: B, callEnded: false }));
    expect(store.dayView(DAY).versions.map((v) => v.live)).toEqual([false, true]);
    expect(state.listHistory().map((e) => e.live)).toEqual([true, false]);
  });
});

describe('moving the old single file to versions', () => {
  const section = (start: string, end: string, extra: string) => `\n## Pré-daily ${start} às ${end}\n\n### Decisões\n- ${extra}\n\n### Transcrição\n- 0:01 **Ana**: hi\n`;

  it('splits the sections into version files, matches them to the ceremonies, and keeps the original next to them', () => {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [decision()], saveResult: { ataPath: join(ATAS, `${DAY}-pre-daily.md`), written: [{ ref: 'acme#1', dest: 'minutes', ok: true, detail: 'x' }] } }));
    state.saveState(ceremony({ id: B, cards: [card('acme#1')] }));
    // The history files were written by the app before versions existed: no index yet.
    for (const name of readdirSync(ATAS)) if (name.endsWith('.versions.json')) rmSync(join(ATAS, name));
    writeFileSync(join(ATAS, `${DAY}-pre-daily.md`), `${section('09:40:00', '09:50:00', 'acme#1: Ship it today → minutes')}${section('14:10:00', '14:20:00', 'nenhuma')}${section('17:00:00', '17:05:00', 'orphan')}`);

    const day = store.dayView(DAY);
    expect(day.versions.map((v) => [v.n, v.ceremonyId])).toEqual([[1, A], [2, B], [3, '']]);
    expect(day.versions.map((v) => v.file)).toEqual([`${DAY}-pre-daily.v1.md`, `${DAY}-pre-daily.v2.md`, `${DAY}-pre-daily.v3.md`]);
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.v1.md`), 'utf8')).toContain('Ship it today');
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.v3.md`), 'utf8')).toContain('orphan');
    expect(files()).toContain(`${DAY}-pre-daily.legacy.md`);
    // The old name now holds the whole day, every version in order.
    const whole = readFileSync(join(ATAS, `${DAY}-pre-daily.md`), 'utf8');
    expect(whole.indexOf('Ship it today')).toBeLessThan(whole.indexOf('orphan'));
    expect(day.versions[0].written).toEqual([{ ref: 'acme#1', dest: 'minutes', ok: true, detail: 'x', text: 'Ship it today', target: 'ata' }]);
  });

  it('shows a day with one old section as version 1', () => {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')] }));
    rmSync(join(ATAS, `${DAY}-pre-daily.versions.json`), { force: true });
    writeFileSync(join(ATAS, `${DAY}-pre-daily.md`), section('09:40:00', '09:50:00', 'nenhuma'));
    expect(state.listHistory()[0].version).toBe(1);
    expect(files()).toContain(`${DAY}-pre-daily.v1.md`);
  });
});

describe('saving the minutes of a version', () => {
  function plan(): { plan: string; dest: string } {
    const { plan } = specFiles(SPECS);
    return { plan, dest: `${plan} › Registro` };
  }

  it('writes each call to its own version file and never appends to an earlier one', async () => {
    state.saveState(ceremony({ id: A }));
    state.saveState(ceremony({ id: B }));
    const first = await saver.saveMinutes(minutes(), 'teams one', [], A);
    const second = await saver.saveMinutes(minutes({ startedAt: new Date(`${DAY}T14:10:00`).toISOString() }), 'teams two', [], B);
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(first.ataPath).toBe(join(ATAS, `${DAY}-pre-daily.v1.md`));
    expect(readFileSync(first.ataPath, 'utf8')).not.toContain('teams two');
    expect(readFileSync(second.ataPath, 'utf8')).toContain('teams two');
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.md`), 'utf8')).toContain('teams one');
    expect(store.dayView(DAY).versions.map((v) => [v.n, !!v.savedAt, v.teams])).toEqual([[1, true, 'teams one'], [2, true, 'teams two']]);
  });

  it('does not write a decision again that an earlier version of the day wrote to the Registro', async () => {
    const { plan: file, dest } = plan();
    const d = decision({ target: 'spec', dest });
    state.saveState(ceremony({ id: A, decisions: [d] }));
    state.saveState(ceremony({ id: B, decisions: [d, decision({ target: 'spec', dest, text: 'Hold the release' })] }));
    const one = await saver.saveMinutes(minutes({ decisions: [d] }), '', [0], A);
    expect(one.written).toEqual([{ ref: 'acme#1', dest, ok: true, detail: file }]);
    const two = await saver.saveMinutes(minutes({ startedAt: new Date(`${DAY}T14:10:00`).toISOString(), decisions: [d, decision({ target: 'spec', dest, text: 'Hold the release' })] }), '', [0, 1], B);
    expect(two.written[0]).toMatchObject({ ok: true, duplicateOf: 1 });
    expect(two.written[0].detail).toMatch(/versão 1|version 1/);
    expect(two.written[1]).toMatchObject({ ok: true, detail: file });
    const text = readFileSync(file, 'utf8');
    expect(text.match(/Ship it today/g)).toHaveLength(1);
    expect(text.match(/Hold the release/g)).toHaveLength(1);
  });

  it('does not duplicate a line already in the Registro even when no earlier version recorded it', async () => {
    const { plan: file, dest } = plan();
    const d = decision({ target: 'spec', dest });
    state.saveState(ceremony({ id: A, decisions: [d] }));
    await saver.saveMinutes(minutes({ decisions: [d] }), '', [0], A);
    // The index is gone (a restored backup, a copied folder): the document itself says it was written.
    rmSync(join(ATAS, `${DAY}-pre-daily.versions.json`));
    state.saveState(ceremony({ id: B, decisions: [d] }));
    const again = await saver.saveMinutes(minutes({ startedAt: new Date(`${DAY}T14:10:00`).toISOString(), decisions: [d] }), '', [0], B);
    expect(again.written[0]).toMatchObject({ ok: true, duplicateOf: 'document' });
    expect(readFileSync(file, 'utf8').match(/Ship it today/g)).toHaveLength(1);
  });

  it('remembers what it wrote to a spec, so the next meeting does not take it for news', async () => {
    const { plan: file, dest } = plan();
    state.saveState(ceremony({ id: A, decisions: [decision({ target: 'spec', dest })] }));
    await saver.saveMinutes(minutes({ decisions: [decision({ target: 'spec', dest })] }), '', [0], A);
    expect(store.selfWritesOf(DAY).files[file]).toBe(Math.floor(statSync(file).mtimeMs));
  });
});

describe('deleting minutes', () => {
  async function twoSaved() {
    const { plan: file, dest } = (() => {
      const { plan } = specFiles(SPECS);
      return { plan, dest: `${plan} › Registro` };
    })();
    const d = decision({ target: 'spec', dest });
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [d], effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }], spoken: ['acme#1'], turns: { 'acme#1': turn('acme#1') } }));
    state.saveState(ceremony({ id: B, cards: [card('acme#1')] }));
    await saver.saveMinutes(minutes({ decisions: [d], effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }] }), 'teams one', [0], A);
    await saver.saveMinutes(minutes({ startedAt: new Date(`${DAY}T14:10:00`).toISOString() }), 'teams two', [], B);
    return { file, dest };
  }

  it('tells what stays where it was written, version by version', async () => {
    const { dest } = await twoSaved();
    const preview = store.previewDelete(DAY, [1]);
    expect(preview.blocked).toBeNull();
    expect(preview.scope).toBe('versions');
    expect(preview.files).toEqual([`${DAY}-pre-daily.v1.md`]);
    expect(preview.ceremonies).toBe(1);
    expect(preview.kept.registro).toEqual([{ n: 1, ref: 'acme#1', text: 'Ship it today', dest }]);
    expect(preview.kept.notes).toEqual([]);
    expect(preview.kept.effects).toEqual([{ n: 1, ref: 'acme#1', text: 'Open the MR', dest: 'app' }]);
    const whole = store.previewDelete(DAY, 'all');
    expect(whole.scope).toBe('day');
    expect(whole.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(whole.files).toEqual(expect.arrayContaining([`${DAY}-pre-daily.v1.md`, `${DAY}-pre-daily.v2.md`, `${DAY}-pre-daily.md`, `${DAY}-pre-daily.versions.json`]));
  });

  it('moves the version file and the ceremony record to the trash, leaves the other version, and writes nothing to the spec', async () => {
    const { file } = await twoSaved();
    const before = readFileSync(file, 'utf8');
    const entry = store.deleteMinutes(DAY, [1], new Date('2026-10-02T15:30:00Z'));
    expect(entry.versions).toEqual([1]);
    expect(entry.ceremonyIds).toEqual([A]);
    const folder = join(ATAS, '.trash', 'atas', entry.id);
    expect(existsSync(join(folder, `${DAY}-pre-daily.v1.md`))).toBe(true);
    expect(existsSync(join(folder, 'historico', `${A}.json`))).toBe(true);
    expect(existsSync(join(ATAS, 'historico', `${A}.json`))).toBe(false);
    expect(existsSync(join(ATAS, `${DAY}-pre-daily.v1.md`))).toBe(false);
    expect(existsSync(join(ATAS, `${DAY}-pre-daily.v2.md`))).toBe(true);
    expect(store.dayView(DAY).versions.map((v) => v.n)).toEqual([2]);
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.md`), 'utf8')).not.toContain('teams one');
    // The decision already in the plan is still there: deleting minutes does not undo it.
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(state.listHistory().map((e) => e.id)).toEqual([B]);
  });

  it('takes the whole day: every version, the index, the generated document, and the drafts', async () => {
    await twoSaved();
    state.saveState(ceremony({ id: '2026-10-02T120000', startedAt: null, cards: [card('acme#1')] }));
    const entry = store.deleteMinutes(DAY, 'all');
    expect(entry.scope).toBe('day');
    expect(entry.ceremonyIds.sort()).toEqual([A, '2026-10-02T120000', B].sort());
    expect(files().filter((f) => f.startsWith(DAY))).toEqual([]);
    expect(readdirSync(join(ATAS, 'historico'))).toEqual([]);
    expect(store.listTrash().map((e) => e.id)).toEqual([entry.id]);
  });

  it('refuses to delete the version of a call that has not ended, alone or with the day', () => {
    state.saveState(ceremony({ id: A, callEnded: true }));
    state.saveState(ceremony({ id: B, callEnded: false }));
    expect(store.previewDelete(DAY, [2]).blocked).toMatch(/call|chamada|andamento|going/i);
    expect(() => store.deleteMinutes(DAY, [2])).toThrow();
    expect(() => store.deleteMinutes(DAY, 'all')).toThrow();
    expect(existsSync(join(ATAS, 'historico', `${B}.json`))).toBe(true);
    expect(store.deleteMinutes(DAY, [1]).versions).toEqual([1]);
    // Once the call ends the version can go.
    state.saveState(ceremony({ id: B, callEnded: true }));
    expect(store.deleteMinutes(DAY, [2]).versions).toEqual([2]);
  });

  it('refuses an empty selection, and a call left unfinished on an earlier day does not block anything', () => {
    expect(() => store.deleteMinutes(DAY, [9])).toThrow();
    state.saveState(ceremony({ id: '2026-10-01T094000', callEnded: false }));
    expect(store.previewDelete('2026-10-01', [1]).blocked).toBeNull();
  });

  it('does not let a stale save bring a deleted ceremony back', async () => {
    await twoSaved();
    store.deleteMinutes(DAY, [1]);
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [] }));
    expect(existsSync(join(ATAS, 'historico', `${A}.json`))).toBe(false);
    expect(store.dayView(DAY).versions.map((v) => v.n)).toEqual([2]);
  });

  it('records the deletion and the restore in the audit log', async () => {
    await twoSaved();
    const entry = store.deleteMinutes(DAY, [1]);
    store.restoreMinutes(entry.id);
    const rows = readFileSync(join(ATAS, 'auditoria.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => [r.kind, r.origin.kind, r.origin.key])).toEqual([['minutes', 'ata-delete', entry.id], ['minutes', 'ata-restore', entry.id]]);
    expect(rows[0].fields.versions).toBe('1');
  });
});

describe('unanswered questions that repeat across days', () => {
  const PREV = '2026-10-01';
  const QUESTION = (text: string) => [{ ref: 'acme#1', question: text, stage: 'Doing' } as const];

  it('keeps the stage of the activity a question was asked about in the day index', () => {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Ship it?' }) }, spoken: ['acme#1'] }));
    expect(store.dayView(DAY).versions[0].snapshot.unanswered).toEqual([{ ref: 'acme#1', question: 'Ship it?', stage: 'Doing' }]);
  });

  it('lists the question repeated from an earlier day in the day view, with both dates, and omits the section when there is none', () => {
    state.saveState(ceremony({ id: '2026-10-01T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Can the plan be approved today?' }) }, spoken: ['acme#1'] }));
    state.saveState(ceremony({ id: '2026-10-01T141000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1') }, spoken: [] }));
    store.dayView(PREV);
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Was the plan approved?' }) }, spoken: ['acme#1'] }));
    const day = store.dayView(DAY);
    expect(day.repeated).toEqual([{ ref: 'acme#1', question: 'Was the plan approved?', stage: 'Doing', dates: [PREV, DAY], count: 2 }]);
  });

  it('does not rewrite an earlier day\'s document when today is saved, and shows the section only on days with a repetition', async () => {
    state.saveState(ceremony({ id: '2026-10-01T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1') }, spoken: [] }));
    store.dayView(PREV);
    // No earlier day holds the question: no section on either day.
    await saver.saveMinutes(minutes({ decisions: [decision()] }), '', [0], '2026-10-01T141000');
    const earlierText = readFileSync(join(ATAS, `${PREV}-pre-daily.md`), 'utf8');
    expect(earlierText).not.toContain('Perguntas repetidas sem resposta');
    state.saveState(ceremony({ id: '2026-10-02T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1') }, spoken: [] }));
    await saver.saveMinutes(minutes(), '', [], '2026-10-02T094000');
    expect(readFileSync(join(ATAS, `${PREV}-pre-daily.md`), 'utf8')).toBe(earlierText);
  });

  it('writes the repetition into the generated document, after the versions of the day', async () => {
    state.saveState(ceremony({ id: '2026-10-01T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Can the plan be approved today?' }) }, spoken: ['acme#1'] }));
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Was the plan approved?' }) }, spoken: ['acme#1'] }));
    const result = await saver.saveMinutes(minutes({ unanswered: [...QUESTION('Was the plan approved?')] }), '', [], A);
    const text = readFileSync(result.ataPath, 'utf8');
    const dayText = readFileSync(join(ATAS, `${DAY}-pre-daily.md`), 'utf8');
    expect(dayText).toContain('## Perguntas repetidas sem resposta');
    expect(dayText).toContain('Was the plan approved? (acme#1)');
    expect(dayText).toContain('2 dias');
    expect(dayText.indexOf('Was the plan approved? (acme#1)')).toBeGreaterThan(dayText.indexOf('Versão'));
    expect(text).not.toContain('Perguntas repetidas sem resposta');
  });

  it('takes at most the 7 most recent days with an index, and skips the days without one', () => {
    // Eight ceremonies on five earlier days; only those with an index are read, at most 7.
    store.dayView(PREV);
    const days = store.previousDayAnswers(DAY, 7);
    expect(days.length).toBeLessThanOrEqual(7);
    for (const d of days) {
      expect(() => Date.parse(d.date)).not.toThrow();
      expect(d.date < DAY).toBe(true);
    }
  });

  it('skips a day the folder holds without a day index and a day with a malformed one, and creates no index for them', () => {
    state.saveState(ceremony({ id: '2026-09-28T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Can the plan be approved today?' }) }, spoken: ['acme#1'] }));
    store.dayView('2026-09-28');
    // A day with only the old single file (no index was ever written for it) and a day with a corrupted index.
    writeFileSync(join(ATAS, '2026-09-29-pre-daily.md'), 'leftover of an old layout');
    writeFileSync(join(ATAS, '2026-09-30-pre-daily.versions.json'), '{ not json');
    expect(store.previousDayAnswers(DAY).map((d) => d.date)).toEqual(['2026-09-28']);
    expect(existsSync(join(ATAS, '2026-09-29-pre-daily.versions.json'))).toBe(false);
    expect(readFileSync(join(ATAS, '2026-09-30-pre-daily.versions.json'), 'utf8')).toBe('{ not json');
  });

  it('gives the ceremony the dates the card\'s question-forma was left unanswered on, before today', () => {
    state.saveState(ceremony({ id: '2026-10-01T094000', cards: [card('acme#1')], turns: { 'acme#1': turn('acme#1', { question: 'Can the plan be approved today?' }) }, spoken: ['acme#1'] }));
    store.dayView(PREV);
    expect(store.crossDayRepeats(card('acme#1'), DAY)).toEqual([PREV]);
    // A card whose activity was not left unanswered: nothing to say.
    expect(store.crossDayRepeats(card('acme#2'), DAY)).toEqual([]);
  });
});

describe('the trash', () => {
  async function trashed(versions: number[] | 'all' = [1]) {
    state.saveState(ceremony({ id: A, cards: [card('acme#1')], decisions: [decision()] }));
    state.saveState(ceremony({ id: B, cards: [card('acme#1')] }));
    await saver.saveMinutes(minutes({ decisions: [decision()] }), 'teams one', [0], A);
    return store.deleteMinutes(DAY, versions, new Date('2026-10-02T12:00:00'));
  }

  it('restores a version with its file and its ceremony record, as it was', async () => {
    const entry = await trashed();
    const restored = store.restoreMinutes(entry.id);
    expect(restored).toEqual({ date: DAY, versions: [{ from: 1, to: 1 }] });
    expect(existsSync(join(ATAS, 'historico', `${A}.json`))).toBe(true);
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.v1.md`), 'utf8')).toContain('Ship it today');
    expect(store.dayView(DAY).versions.map((v) => [v.n, v.ceremonyId])).toEqual([[1, A], [2, B]]);
    expect(store.listTrash()).toEqual([]);
    expect(existsSync(join(ATAS, '.trash', 'atas', entry.id))).toBe(false);
    // Saved again by a window, it is registered once.
    state.saveState(ceremony({ id: A, cards: [card('acme#1')] }));
    expect(store.dayView(DAY).versions).toHaveLength(2);
  });

  it('brings a deleted day back, and gives a version a new number when its number was taken meanwhile', async () => {
    const entry = await trashed('all');
    expect(store.dayView(DAY).versions).toEqual([]);
    state.saveState(ceremony({ id: '2026-10-02T150000', cards: [card('acme#1')] }));
    expect(store.dayView(DAY).versions.map((v) => v.n)).toEqual([1]);
    const restored = store.restoreMinutes(entry.id);
    expect(restored.versions).toEqual([{ from: 1, to: 2 }, { from: 2, to: 3 }]);
    expect(store.dayView(DAY).versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(existsSync(join(ATAS, `${DAY}-pre-daily.v2.md`))).toBe(true);
    expect(readFileSync(join(ATAS, `${DAY}-pre-daily.v2.md`), 'utf8')).toContain('Ship it today');
  });

  it('lists what is in it with the days left, and refuses to restore an item past 30 days', async () => {
    const entry = await trashed();
    const now = new Date('2026-10-02T12:00:00').getTime();
    expect(store.listTrash(now + 5 * 86_400_000)[0]).toMatchObject({ id: entry.id, date: DAY, versions: [1], scope: 'versions', daysLeft: 25 });
    expect(store.listTrash(now + 31 * 86_400_000)).toEqual([]);
    expect(() => store.restoreMinutes(entry.id, now + 31 * 86_400_000)).toThrow();
    expect(() => store.restoreMinutes('does-not-exist')).toThrow();
  });

  it('purges what stayed past 30 days and keeps the rest', async () => {
    const entry = await trashed();
    const now = new Date('2026-10-02T12:00:00').getTime();
    expect(store.purgeTrash(now + 29 * 86_400_000)).toBe(0);
    expect(existsSync(join(ATAS, '.trash', 'atas', entry.id))).toBe(true);
    // An old folder with no manifest is purged by its own time.
    const stray = join(ATAS, '.trash', 'atas', 'stray');
    mkdirSync(stray, { recursive: true });
    utimesSync(stray, new Date(now - 40 * 86_400_000), new Date(now - 40 * 86_400_000));
    expect(store.purgeTrash(now + 31 * 86_400_000)).toBe(2);
    expect(existsSync(join(ATAS, '.trash', 'atas', entry.id))).toBe(false);
    expect(store.listTrash()).toEqual([]);
  });

  it('lets the retention job purge it', async () => {
    const entry = await trashed();
    const { retention } = await import('../src/main/retention');
    let job: { run(): Promise<void> } | null = null;
    retention({ handle: () => {}, notify: () => {}, emit: () => {}, job: (j) => (job = j) });
    expect(job).not.toBeNull();
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    await (job as unknown as { run(): Promise<void> }).run();
    expect(existsSync(join(ATAS, '.trash', 'atas', entry.id))).toBe(false);
  });
});
