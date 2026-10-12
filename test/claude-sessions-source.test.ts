// Where the machine's Claude Code sessions come from (#280): the one read of the disk takes only `sessions/<digits>.json` and hands back only the allowed fields; a key, the
// credentials and anything outside the folder are never opened. Every file here is synthetic, in a throwaway folder: nothing of a real ~/.claude is read.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_FIELDS, guardedRead, liveSessions, transcriptOf } from '../src/main/claudeSessions/source';

let dir: string;
const record = (over: Record<string, unknown> = {}) => JSON.stringify({ pid: 4242, sessionId: 's-1', cwd: '/work/app', kind: 'interactive', status: 'idle', updatedAt: 10, startedAt: 1, entrypoint: 'cli', name: 'x', extra: 'not for the app', ...over });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-claude-sessions-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('guardedRead', () => {
  it('reads a session record and keeps only the allowed fields', () => {
    writeFileSync(join(dir, '4242.json'), record());
    const r = guardedRead(join(dir, '4242.json'), dir);
    expect(Object.keys(r ?? {}).sort()).toEqual([...LIVE_FIELDS].sort());
    expect(r).not.toHaveProperty('extra');
  });

  it.each(['.credentials.json', '4242.abc.key', 'control.key', '4242.key', 'roster.json', 'a1.json', '4242.json.bak'])('refuses %s without opening it', (name) => {
    const opened: string[] = [];
    expect(guardedRead(join(dir, name), dir, { read: (p) => (opened.push(p), record()), plain: () => true })).toBeNull();
    expect(opened).toEqual([]);
  });

  it('refuses a record outside the sessions folder', () => {
    const opened: string[] = [];
    expect(guardedRead(join(dir, 'sub', '4242.json'), dir, { read: (p) => (opened.push(p), record()), plain: () => true })).toBeNull();
    expect(opened).toEqual([]);
  });

  it('never follows a record that is a link, so a link to a key is not opened', () => {
    writeFileSync(join(dir, '4242.k.key'), record());
    symlinkSync(join(dir, '4242.k.key'), join(dir, '4242.json'));
    expect(guardedRead(join(dir, '4242.json'), dir)).toBeNull();
  });

  it('answers null for a record that does not parse', () => {
    writeFileSync(join(dir, '7.json'), '{not json');
    expect(guardedRead(join(dir, '7.json'), dir)).toBeNull();
  });
});

describe('liveSessions', () => {
  it('lists the processes alive now, running and background, and never opens a key next to them', () => {
    const opened: string[] = [];
    const files: Record<string, string> = {
      '1.json': record({ pid: 1, sessionId: 'a', kind: 'interactive', status: 'busy', updatedAt: 5 }),
      '2.json': record({ pid: 2, sessionId: 'b', kind: 'background', updatedAt: 9 }),
      '3.json': record({ pid: 3, sessionId: 'c' }),
      '1.k.key': 'secret',
      '.credentials.json': 'secret',
    };
    const live = liveSessions(dir, { list: () => Object.keys(files), read: (p) => (opened.push(p), files[p.slice(dir.length + 1)]), plain: () => true, alive: (pid) => pid !== 3 });
    expect(live.map((s) => [s.sessionId, s.kind, s.status])).toEqual([
      ['b', 'background', 'idle'],
      ['a', 'interactive', 'busy'],
    ]);
    expect(opened.every((p) => /\/\d+\.json$/.test(p))).toBe(true);
  });

  it('is empty when the folder is not there', () => {
    expect(liveSessions(join(dir, 'missing'))).toEqual([]);
  });
});

describe('transcriptOf', () => {
  it('takes the title, first prompt, folder, branch and last change the SDK lists', () => {
    expect(transcriptOf({ sessionId: 's', summary: 'sum', customTitle: 'Mine', firstPrompt: 'hi', gitBranch: 'main', cwd: '/w', lastModified: 3 })).toEqual({ sessionId: 's', title: 'Mine', firstPrompt: 'hi', cwd: '/w', branch: 'main', lastModified: 3 });
  });
});
