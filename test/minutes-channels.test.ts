import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../src/shared/types';
import { webAccess } from '../src/main/webPolicy';
import { card, ceremony } from './helpers/ceremony';
import { installLegacyConfig } from './helpers/config';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

const DAY = '2026-10-02';
let state: typeof import('../src/main/state');

describe('who may reach the minutes channels', () => {
  it('lets a paired browser read, delete and restore minutes: they are local data and deletion is undone by Restore', () => {
    for (const channel of ['minutes:day', 'minutes:delete-preview', 'minutes:delete', 'minutes:trash', 'minutes:restore', 'minutes:day-teams', 'minutes:version-teams', 'sameday:agenda']) {
      expect(webAccess(channel), channel).toBe('allow');
    }
  });
});

describe('the minutes channels', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const events: AppEvent[] = [];
  let ATAS: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T15:00:00'));
    await installLegacyConfig();
    ATAS = (await import('../src/main/env')).ATAS;
    state = await import('../src/main/state');
    const { minutes } = await import('../src/main/minutes');
    minutes({ handle: (channel, fn) => void handlers.set(channel, fn as never), notify: () => {}, emit: (e) => void events.push(e), job: () => {} });
  });

  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(...args);

  it('refuses a date or a version list it cannot read', () => {
    expect(() => call('minutes:day', '02/10/2026')).toThrow();
    expect(() => call('minutes:delete', DAY, [])).toThrow();
    expect(() => call('minutes:delete', DAY, ['1'])).toThrow();
    expect(() => call('minutes:delete-preview', DAY, 'some')).toThrow();
  });

  it('tells every window which ceremonies a deletion took, and lets them be restored', () => {
    state.saveState(ceremony({ id: '2026-10-02T094000', cards: [card('acme#1')] }));
    state.saveState(ceremony({ id: '2026-10-02T141000', cards: [card('acme#1')] }));
    const entry = call('minutes:delete', DAY, [1]) as { id: string; ceremonyIds: string[] };
    expect(events).toEqual([{ type: 'module', name: 'minutes:deleted', payload: ['2026-10-02T094000'] }]);
    expect((call('minutes:trash') as unknown[]).length).toBe(1);
    expect(existsSync(join(ATAS, '.trash', 'atas', entry.id, 'manifest.json'))).toBe(true);
    call('minutes:restore', entry.id);
    expect((call('minutes:day', DAY) as { versions: unknown[] }).versions).toHaveLength(2);
  });
});

describe('a decision for the card note', () => {
  it('is not written again by a later version of the day', async () => {
    vi.setSystemTime(new Date('2026-10-02T15:00:00'));
    const dir = process.env.CERIMONIAS_DATA_DIR as string;
    const log = join(dir, 'note-calls.log');
    const stateFile = join(dir, 'card-state.json');
    const script = join(dir, 'fake-report.mjs');
    // The card source: `note <ref> <text>` stores the note in its state file, like the real tool does.
    writeFileSync(script, `import { appendFileSync, writeFileSync } from 'node:fs';\nconst [, , cmd, ref, note] = process.argv;\nif (cmd === 'note') { appendFileSync(${JSON.stringify(log)}, note + '\\n'); writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({ items: { a: { ref, manual_note: note } } })); }\n`);
    chmodSync(script, 0o755);
    writeFileSync(stateFile, JSON.stringify({ items: { a: { ref: 'acme#1', manual_note: null } } }));
    const { updateConfig } = await import('../src/main/workspaceConfig');
    updateConfig((c) => {
      c.externalTools.cardSource.command = process.execPath;
      c.externalTools.cardSource.noteArgs = [script, 'note', '{ref}', '{note}'];
      c.externalTools.cardSource.stateFile = stateFile;
      return c;
    });
    const { saveMinutes } = await import('../src/main/store');
    const d = { ref: 'acme#1', text: 'Wait for Bruno', target: 'daily-report' as const, dest: 'note' };
    const m = (start: string) => ({ startedAt: new Date(`${DAY}T${start}`).toISOString(), endedAt: new Date(`${DAY}T${start}`).toISOString(), decisions: [d], effects: [], unanswered: [], transcript: [] });
    state.saveState(ceremony({ id: '2026-10-02T094000', decisions: [d] }));
    state.saveState(ceremony({ id: '2026-10-02T141000', decisions: [d] }));
    const one = await saveMinutes(m('09:40:00'), '', [0], '2026-10-02T094000');
    expect(one.written[0].ok).toBe(true);
    const two = await saveMinutes(m('14:10:00'), '', [0], '2026-10-02T141000');
    expect(two.written[0]).toMatchObject({ ok: true, duplicateOf: 1 });
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['2026-10-02: Wait for Bruno']);
    const { selfWritesOf } = await import('../src/main/minutesStore');
    expect(selfWritesOf(DAY).notes['acme#1']).toBe('2026-10-02: Wait for Bruno');
  });
});
