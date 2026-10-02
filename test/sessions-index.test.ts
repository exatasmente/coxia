import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ATAS } from '../src/main/env';
import { selectRetention } from '../src/main/retention-core';
import { noteSession } from '../src/main/sessions';
import { SESSIONS_FILE, entryOf, parseIndex, readIndex, recordEntry, sessionOwners, sessionRefs } from '../src/main/sessions-core';
import { createWorkspace, ensureWorkspaces, workspaceDir } from '../src/main/workspaces-core';

const quiet = { log: () => undefined };
const NOW = new Date('2026-10-02T12:00:00.000Z');
let root: string;

function twoWorkspaces() {
  ensureWorkspaces(root, quiet);
  const reg = createWorkspace(root, { name: 'Testes', copySettings: false }, quiet);
  return { reg, a: workspaceDir(root, 'principal'), b: workspaceDir(root, 'testes') };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cer-sessions-'));
});

describe('entryOf', () => {
  it('records id, time, role, kind and card ref from the first prompt', () => {
    const e = entryOf('s1', 'turn', 'Você é o agente da atividade sz4#15965 na pré-daily por voz.\nCartão...', NOW);
    expect(e).toEqual({ id: 's1', at: '2026-10-02T12:00:00.000Z', role: 'turn', kind: 'turn', ref: 'sz4#15965' });
  });

  it('reads the ref of gate and QA prompts and leaves it null when the prompt has none', () => {
    expect(entryOf('s2', 'deep', 'Gate 1 da issue sz4#14500, quiz', NOW)).toMatchObject({ kind: 'gate', ref: 'sz4#14500' });
    expect(entryOf('s3', 'teams', 'Escreva o texto que o Luiz vai colar no Teams', NOW)).toMatchObject({ kind: 'teams', ref: null });
    expect(entryOf('s4', 'reply', 'uma resposta de continuação', NOW)).toMatchObject({ kind: null, ref: null });
  });
});

describe('parseIndex', () => {
  it('skips broken lines, lines without id or time, and repeated ids (first wins)', () => {
    const text = [
      JSON.stringify({ id: 'a', at: '2026-10-01T10:00:00.000Z', role: 'turn', kind: 'turn', ref: 'sz4#1' }),
      'not json',
      JSON.stringify({ at: '2026-10-01T10:00:00.000Z' }),
      JSON.stringify({ id: 'b', at: 'yesterday' }),
      JSON.stringify({ id: 'a', at: '2026-10-02T10:00:00.000Z' }),
      '',
      JSON.stringify({ id: 'c', at: '2026-10-02T10:00:00.000Z' }),
    ].join('\n');
    expect(parseIndex(text).map((e) => [e.id, e.at, e.role])).toEqual([
      ['a', '2026-10-01T10:00:00.000Z', 'turn'],
      ['c', '2026-10-02T10:00:00.000Z', ''],
    ]);
  });

  it('reads an absent index as empty', () => {
    expect(readIndex(join(root, 'nothing'))).toEqual([]);
  });
});

describe('recordEntry', () => {
  it('appends one line per session and never writes a resumed session twice', () => {
    const dir = join(root, 'ws');
    expect(recordEntry(dir, entryOf('s1', 'turn', 'x', NOW))).toBe(true);
    expect(recordEntry(dir, entryOf('s2', 'deep', 'x', NOW))).toBe(true);
    expect(recordEntry(dir, entryOf('s1', 'reply', 'again', NOW))).toBe(false);
    const lines = readFileSync(join(dir, SESSIONS_FILE), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(readIndex(dir).map((e) => e.id)).toEqual(['s1', 's2']);
  });
});

describe('noteSession', () => {
  it('writes into the running workspace once, ignoring a missing id', () => {
    noteSession(undefined, 'turn', 'x');
    noteSession('note-1', 'turn', 'Você é o agente da atividade sz4#9 na pré-daily por voz.');
    noteSession('note-1', 'turn', 'Você é o agente da atividade sz4#9 na pré-daily por voz.');
    const mine = readIndex(ATAS).filter((e) => e.id === 'note-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: 'turn', kind: 'turn', ref: 'sz4#9' });
  });
});

describe('sessionOwners', () => {
  it('maps each session to the workspace that recorded it, the earliest on a conflict', () => {
    const { reg, a, b } = twoWorkspaces();
    recordEntry(a, { ...entryOf('only-a', 'turn', 'x', NOW) });
    recordEntry(b, entryOf('only-b', 'turn', 'x', NOW));
    recordEntry(a, entryOf('both', 'turn', 'x', new Date('2026-10-02T13:00:00.000Z')));
    recordEntry(b, entryOf('both', 'turn', 'x', new Date('2026-10-02T09:00:00.000Z')));
    const owners = sessionOwners(root, reg);
    expect(owners.get('only-a')).toBe('principal');
    expect(owners.get('only-b')).toBe('testes');
    expect(owners.get('both')).toBe('testes');
    expect(owners.get('unknown')).toBeUndefined();
  });
});

describe('retention keeps working with the index', () => {
  it('counts the sessions of the other workspaces as references, not its own', () => {
    const { reg, a, b } = twoWorkspaces();
    recordEntry(a, entryOf('mine', 'turn', 'x', NOW));
    recordEntry(b, entryOf('theirs', 'turn', 'x', NOW));
    const refs = sessionRefs(root, reg, 'principal');
    expect(refs.map((r) => r.sessionId)).toEqual(['theirs']);
    expect(refs[0]).toMatchObject({ keep: false, from: 'sessão do workspace Testes', at: NOW.getTime() });
  });

  it('spares an old transcript another workspace resumed recently and still removes the unreferenced one', () => {
    const { reg, b } = twoWorkspaces();
    recordEntry(b, entryOf('11111111-1111-1111-1111-111111111111', 'turn', 'x', new Date(NOW.getTime() - 86_400_000)));
    const old = NOW.getTime() - 40 * 86_400_000;
    const file = (sessionId: string) => ({
      kind: 'sessoes' as const,
      path: `/t/${sessionId}.jsonl`,
      size: 1,
      mtimeMs: old,
      sessionId,
      firstPrompt: 'Você é o agente da atividade sz4#1 na pré-daily por voz.',
      entrypoints: ['sdk-ts'],
    });
    const refs = sessionRefs(root, reg, 'principal');
    const sel = selectRetention([file('11111111-1111-1111-1111-111111111111'), file('22222222-2222-2222-2222-222222222222')], refs, { now: NOW.getTime(), days: 30 });
    expect(sel.keep.map((v) => v.reason)).toEqual(['usada por sessão do workspace Testes, ainda dentro do prazo']);
    expect(sel.remove.map((v) => v.file.sessionId)).toEqual(['22222222-2222-2222-2222-222222222222']);
  });
});
