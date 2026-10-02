import { describe, expect, it } from 'vitest';
import { type GenStat, byWorkspaceOf, inScope, summarize } from '../src/main/custo-core';
import type { WorkspaceInfo } from '../src/shared/workspaces';

const NOW = Date.parse('2026-10-15T15:00:00.000Z');
const DAY = 86_400_000;
const workspaces: WorkspaceInfo[] = [
  { id: 'principal', name: 'Principal', createdAt: '2026-09-01T00:00:00.000Z', test: false },
  { id: 'testes', name: 'Testes', createdAt: '2026-09-01T00:00:00.000Z', test: true },
];
const owners = new Map([
  ['s-principal', 'principal'],
  ['s-testes', 'testes'],
]);

const gen = (session: string, cost: number, ago: number, extra: Partial<GenStat> = {}): GenStat => ({
  cost,
  prompt: 100,
  cached: 50,
  completion: 10,
  at: NOW - ago,
  kind: 'turn',
  session,
  ...extra,
});

const gens = [
  gen('s-principal', 1, 0),
  gen('s-principal', 2, 3 * DAY, { kind: 'gate' }),
  gen('s-testes', 4, 0),
  gen('s-testes', 8, 10 * DAY),
  gen('s-old', 16, 1 * DAY),
];

const base = { gens, pending: 0, goal: 20, key: null, keyError: null, refreshedAt: null, now: NOW, owners, workspaces, current: workspaces[0] };

describe('inScope', () => {
  it('current keeps only the sessions the workspace started; all keeps everything', () => {
    const current = inScope('current', 'principal', owners);
    expect(['s-principal', 's-testes', 's-old'].map(current)).toEqual([true, false, false]);
    expect(['s-principal', 's-testes', 's-old'].map(inScope('all', 'principal', owners))).toEqual([true, true, true]);
  });
});

describe('summarize by scope', () => {
  it('current: totals, days and kinds come only from this workspace', () => {
    const s = summarize({ ...base, scope: 'current' });
    expect(s.scope).toBe('current');
    expect(s.today.cost).toBe(1);
    expect(s.week.cost).toBe(3);
    expect(s.month.cost).toBe(3);
    expect(s.sessions).toBe(1);
    expect(s.days.map((d) => d.cost)).toEqual([2, 1]);
    expect(s.kinds.map((k) => [k.key, k.cost])).toEqual([['gate', 2], ['turn', 1]]);
    expect(s.workspace).toEqual({ id: 'principal', name: 'Principal', test: false });
  });

  it('all: totals include other workspaces and the sessions nobody claimed', () => {
    const s = summarize({ ...base, scope: 'all' });
    expect(s.today.cost).toBe(5);
    expect(s.week.cost).toBe(1 + 2 + 4 + 16);
    expect(s.month.cost).toBe(31);
    expect(s.sessions).toBe(3);
    expect(s.unassigned).toBe(1);
  });

  it('breaks the total down by workspace with "sem workspace" for sessions before the index', () => {
    const rows = summarize({ ...base, scope: 'all' }).byWorkspace;
    expect(rows.map((r) => [r.id, r.name, r.month])).toEqual([
      [null, 'sem workspace', 16],
      ['testes', 'Testes', 12],
      ['principal', 'Principal', 3],
    ]);
    const testes = rows.find((r) => r.id === 'testes');
    expect(testes).toMatchObject({ test: true, today: 4, week: 4, calls: 2, sessions: 1 });
    expect(rows.reduce((n, r) => n + r.month, 0)).toBe(summarize({ ...base, scope: 'all' }).month.cost);
  });

  it('the breakdown does not change with the scope', () => {
    expect(summarize({ ...base, scope: 'current' }).byWorkspace).toEqual(summarize({ ...base, scope: 'all' }).byWorkspace);
  });

  it('omits "sem workspace" when every session is claimed and lists workspaces without cost', () => {
    const rows = byWorkspaceOf([gen('s-principal', 1, 0)], owners, workspaces, NOW);
    expect(rows.map((r) => r.id)).toEqual(['principal', 'testes']);
    expect(rows[1]).toMatchObject({ month: 0, calls: 0, sessions: 0 });
  });

  it('a session owned by a workspace that no longer exists falls into "sem workspace"', () => {
    const rows = byWorkspaceOf([gen('s-gone', 3, 0)], new Map([['s-gone', 'deleted']]), workspaces, NOW);
    expect(rows.find((r) => r.id === null)).toMatchObject({ month: 3, sessions: 1 });
  });

  it('prices a speech from every workspace but counts only this workspace\'s reuses', () => {
    const all = [gen('s-principal', 2, 0), gen('s-testes', 4, 0)];
    const s = summarize({ ...base, gens: all, scope: 'current', reuses: [NOW - 1000, NOW - 2000] });
    expect(s.falas.avgPerSpeech).toBe(3);
    expect(s.falas.reusedToday).toBe(2);
    expect(s.falas.avoidedToday).toBe(6);
    expect(s.today.cost).toBe(2);
  });
});
