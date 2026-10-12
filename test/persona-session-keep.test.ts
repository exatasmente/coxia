// The file that keeps the Claude Code session of each conversation of the persona (#279): kept and read by conversation, the same after the app restarts, and nothing at all
// (so a new session, never an error) when the file is missing, broken or of another version. Session ids are made up.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_FILE, createSessionKeep, readSessions } from '../src/main/persona/sessionKeep';

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'persona-sessions-'));
  file = join(root, SESSIONS_FILE);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const entry = (session: string, upTo = 2) => ({ session, engine: 'claude-sdk' as const, provider: 'cli', upTo });

describe('the sessions of the persona\'s conversations', () => {
  it('keeps one session per conversation and reads it back after a restart', () => {
    const keep = createSessionKeep(file);
    expect(keep.get('agent-me')).toBeNull();
    keep.set('agent-me', entry('s-a'));
    keep.set('general-x', entry('s-b', 5));
    expect(keep.get('agent-me')).toEqual(entry('s-a'));
    // A new object over the same file is the app after a restart.
    const again = createSessionKeep(file);
    expect(again.get('agent-me')).toEqual(entry('s-a'));
    expect(again.get('general-x')).toEqual(entry('s-b', 5));
    again.clear('agent-me');
    expect(createSessionKeep(file).get('agent-me')).toBeNull();
    expect(createSessionKeep(file).get('general-x')).toEqual(entry('s-b', 5));
  });

  it('reads no session from a missing, broken or unknown file, and leaves out an entry that does not read', () => {
    expect(readSessions(file).size).toBe(0);
    writeFileSync(file, '{ not json');
    expect(createSessionKeep(file).get('agent-me')).toBeNull();
    writeFileSync(file, JSON.stringify({ v: 2, threads: { 'agent-me': entry('s-a') } }));
    expect(readSessions(file).size).toBe(0);
    writeFileSync(file, JSON.stringify({ v: 1, threads: { 'agent-me': entry('s-a'), bad: { session: 's-b', engine: 'other', provider: 'cli', upTo: 1 } } }));
    expect([...readSessions(file).keys()]).toEqual(['agent-me']);
  });

  it('writes the whole file at once, and a disk that refuses keeps the session in memory without throwing', () => {
    const keep = createSessionKeep(file);
    keep.set('agent-me', entry('s-a'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 1, threads: { 'agent-me': entry('s-a') } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A folder where the file should be: every write fails.
    const blocked = join(root, 'blocked');
    mkdirSync(join(blocked, SESSIONS_FILE), { recursive: true });
    const refused = createSessionKeep(join(blocked, SESSIONS_FILE));
    expect(() => refused.set('agent-me', entry('s-c'))).not.toThrow();
    expect(refused.get('agent-me')).toEqual(entry('s-c'));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
