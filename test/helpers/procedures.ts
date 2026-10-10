import { PROCEDURE_VERSION, type ProcedureRecord } from '../../src/shared/procedures';

let n = 0;

/** A stored record with every field set, for the tests of what reads records. Neutral names and hosts only. */
export function procedureRecord(over: Partial<ProcedureRecord> = {}): ProcedureRecord {
  n++;
  return {
    v: PROCEDURE_VERSION,
    id: `p-${n.toString(16).padStart(8, '0')}`,
    revision: 1,
    kind: 'repo',
    key: 'api',
    title: `Task number ${n}`,
    steps: [{ text: 'Do the first thing', run: 'npm test' }],
    pitfalls: [],
    waits: [],
    state: 'unverified',
    lastVerified: null,
    lastFailed: null,
    stats: { uses: 0, failures: 0, failuresSinceSave: 0, lastUsed: null, baseline: null, recent: [] },
    origin: { by: 'writer', createdBy: 'writer', surface: 'stage', permission: 'worktree', shell: 'sandbox', at: '2026-10-01T10:00:00.000Z' },
    stepsFrom: 'agent',
    reviewed: false,
    previous: null,
    ...over,
  };
}
