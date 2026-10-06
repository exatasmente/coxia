// Reading the cycle history into suggestions: the pure layer that groups what the app already writes (runs, the audit log, the minutes) into
// patterns, and the record of the decisions that keeps a rejected impression from coming back unchanged.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import type { StageDef } from '../src/shared/config/types';
import type { HistoryEntry, Run } from '../src/shared/runs';
import type { Decision, SavedCeremony } from '../src/shared/types';
import {
  DEFAULT_THRESHOLD,
  type Evidence,
  type SuggestionRecord,
  blockedByRejection,
  evidenceKeyOf,
  gatherEvidence,
  impressionOf,
  normalize,
  patterns,
  readSuggestions,
  scoreFindings,
  stageExists,
  writeSuggestions,
} from '../src/main/suggestions';

const stages: StageDef[] = [
  { id: 'refine', label: 'Refine', match: [], kind: 'development', rank: 1, type: 'work' },
  { id: 'review', label: 'Review', match: [], kind: 'review', rank: 2, type: 'work' },
];
const ctx = { stages };

/** A run with the fields the reading touches, filled in the way the runner writes them. */
function run(over: Partial<Run> = {}): Run {
  return {
    version: 1,
    rev: 1,
    id: 'r-test-1',
    issue: { ref: 'app#123', iid: 123, title: 'Something', url: null },
    repo: 'app',
    branch: 'b',
    worktree: '/tmp/w',
    cycleFolder: 'docs/cycles/1-x',
    cycleId: 'agent-flow',
    status: 'working',
    stage: 'refine',
    stages: [],
    question: null,
    pending: null,
    returns: {},
    wait: null,
    error: null,
    history: [],
    comments: {},
    reviews: [],
    qa: [],
    base: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  } as Run;
}

const history = (type: HistoryEntry['type'], stage: string, by: string, detail: string | null = null): HistoryEntry => ({ at: '2026-10-01T00:00:00Z', type, stage, by, detail });

const audit = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  at: '2026-10-01T00:00:00Z',
  kind: 'exec',
  issue: 123,
  target: 'npm run test',
  via: 'sandbox',
  fields: { agent: 'developer', run: 'r-test-1', stage: 'review' },
  ok: true,
  code: 0,
  result: 'ok',
  origin: { actionId: '', kind: 'run-exec', key: 'k', summary: null },
  by: 'developer',
  ...over,
});

const ceremony = (over: Partial<SavedCeremony> = {}): SavedCeremony =>
  ({
    version: 1,
    id: '2026-10-01T090000',
    kind: 'pre-daily',
    date: '2026-10-01',
    cards: null,
    turns: {},
    decisions: [],
    effects: [],
    answered: {},
    log: [],
    startedAt: null,
    endedAt: null,
    callIdx: 0,
    callEnded: true,
    spoken: {},
    deep: {},
    teams: null,
    teamsKey: null,
    saveResult: null,
    ...over,
  }) as SavedCeremony;

const decision = (text: string, ref = 'app#123'): Decision => ({ ref, text, target: 'note', dest: '' });

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('gatherEvidence reads what the app already writes', () => {
  it('turns a question that reached the person in repeated runs into a needs-person finding, and says the run and the issue', () => {
    const asked = 'Should the export keep the legacy columns?';
    const runs = [run({ id: 'r-test-1', question: { by: 'product-owner', holder: null, kind: 'agent', text: asked, askedAt: '2026-10-01T00:00:00Z', stage: 'refine' } }), run({ id: 'r-test-2', question: { by: 'product-owner', holder: null, kind: 'agent', text: asked, askedAt: '2026-10-02T00:00:00Z', stage: 'refine' } })];

    const found = gatherEvidence({ runs, audit: [], ceremonies: [] }, ctx).filter((e) => e.kind === 'needs-person');

    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ source: 'run', stage: 'refine', agent: 'product-owner', subject: normalize(asked) });
    expect(found.map((e) => e.ref)).toEqual(['r-test-1', 'r-test-2']);
  });

  it('ignores a question that is still with an agent: it never reached the person', () => {
    const runs = [run({ question: { by: 'developer', holder: 'tech-lead', kind: 'agent', text: 'And this?', askedAt: '2026-10-01T00:00:00Z', stage: 'review' } })];
    expect(gatherEvidence({ runs, audit: [], ceremonies: [] }, ctx).some((e) => e.kind === 'needs-person')).toBe(false);
  });

  it('reads the returns per stage and the manual work of the person from the run history', () => {
    const runs = [
      run({ id: 'r-test-1', returns: { review: 2 }, stages: [{ stage: 'review', agent: 'developer', status: 'skipped', artifacts: [], startedAt: null, endedAt: null, attempts: 1, autonomous: false }] }),
      run({ id: 'r-test-2', history: [history('stage-returned', 'review', 'person')] }),
    ];

    const found = gatherEvidence({ runs, audit: [], ceremonies: [] }, ctx);
    expect(found.filter((e) => e.kind === 'returns').map((e) => e.stage)).toEqual(['review', 'review']);
    expect(found.filter((e) => e.kind === 'manual-stage')).toHaveLength(2);
  });

  it('groups the review findings and the QA scenarios by the kind of thing they repeat', () => {
    const runs = [run({ id: 'r-test-1', reviews: [{ round: 1, stage: 'review', by: 'tech-lead', at: '2026-10-01T00:00:00Z', verdict: 'changes', summary: '', head: null, findings: [{ path: 'a.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'Missing null check', suggestion: null }] }], qa: [{ stage: 'review', by: 'qa', at: '2026-10-01T00:00:00Z', summary: '', head: null, scenarios: [{ name: 'Login with empty password', result: 'fail', detail: '', severity: 'blocking' }] }] })];

    const found = gatherEvidence({ runs, audit: [], ceremonies: [] }, ctx);
    expect(found.map((e) => e.kind).sort()).toEqual(['qa-scenarios', 'review-rounds']);
    expect(found.find((e) => e.kind === 'review-rounds')?.subject).toBe(normalize('Missing null check'));
  });

  it('reads the same command allowed again from the audit log, and says nothing when the log has no exec line', () => {
    const rows = [audit({ at: '2026-10-01T00:00:00Z' }), audit({ at: '2026-10-02T00:00:00Z', fields: { agent: 'developer', run: 'r-test-2', stage: 'review' } }), audit({ kind: 'publish', target: 'release-sync publish' }), audit({ ok: false })];

    const found = gatherEvidence({ runs: [], audit: rows, ceremonies: [] }, ctx).filter((e) => e.kind === 'command');

    expect(found).toHaveLength(2);
    expect(found.map((e) => e.ref)).toEqual(['r-test-1', 'r-test-2']);
    expect(found[0].subject).toBe(normalize('npm run test'));
    expect(gatherEvidence({ runs: [], audit: [], ceremonies: [] }, ctx)).toEqual([]);
  });

  it('reads the decisions of the ceremonies by the theme they repeat', () => {
    const rows = [ceremony({ id: '2026-10-01T090000', decisions: [decision('Keep the legacy exporter for one release')] })];
    const found = gatherEvidence({ runs: [], audit: [], ceremonies: rows }, ctx).filter((e) => e.kind === 'ceremony-decision');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'ceremony', ref: '2026-10-01T090000' });
  });
});

const finding = (over: Partial<Evidence> = {}): Evidence => ({ source: 'run', kind: 'returns', stage: 'review', agent: null, ref: 'r-test-1', link: null, subject: 'returns:review', text: '1', at: null, ...over });

describe('the threshold and the patterns', () => {
  it('drops a pattern below the threshold, both in count and in sources', () => {
    expect(patterns([finding(), finding({ ref: 'r-test-2' })], { count: 3, sources: 2 })).toEqual([]);
    expect(patterns([finding(), finding(), finding()], { count: 3, sources: 2 })).toEqual([]);
  });

  it('keeps a pattern repeated enough times across enough executions, strongest first', () => {
    const many = [finding({ ref: 'r-1' }), finding({ ref: 'r-2' }), finding({ ref: 'r-3' }), finding({ ref: 'r-4' })];
    const fewer = [finding({ kind: 'qa-scenarios', subject: 'scenario' }), finding({ kind: 'qa-scenarios', subject: 'scenario', ref: 'r-2' }), finding({ kind: 'qa-scenarios', subject: 'scenario', ref: 'r-3' })];

    const list = patterns([...many, ...fewer]);

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: 'returns', stage: 'review', count: 4, sources: 4 });
    expect(list[1].kind).toBe('qa-scenarios');
  });

  it('keeps the default threshold of the v1', () => {
    expect(DEFAULT_THRESHOLD).toEqual({ count: 3, sources: 2 });
  });

  it('has scoreFindings as the name of the report', () => {
    const one = [finding({ ref: 'r-1' }), finding({ ref: 'r-2' }), finding({ ref: 'r-3' })];
    expect(scoreFindings(one)).toEqual(patterns(one));
  });
});

describe('the impression and the evidence key', () => {
  it('normalizes the parts, so a role written two ways is the same impression', () => {
    expect(impressionOf('Tech Lead', 'Review', 'returns')).toBe(impressionOf('tech-lead', 'review', 'returns'));
    expect(impressionOf('Tech Lead', 'review', 'returns')).not.toBe(impressionOf('Tech Lead', 'review', 'qa-scenarios'));
  });

  it('hashes the evidence: the same refs give the same key, a new execution a different one', () => {
    const a = [finding({ ref: 'r-1' }), finding({ ref: 'r-2' })];
    const b = [finding({ ref: 'r-2' }), finding({ ref: 'r-1' })];
    expect(evidenceKeyOf(a)).toBe(evidenceKeyOf(b));
    expect(evidenceKeyOf(a)).not.toBe(evidenceKeyOf([...a, finding({ ref: 'r-3' })]));
  });
});

describe('the record of the decisions', () => {
  const record = (over: Partial<SuggestionRecord> = {}): SuggestionRecord => ({
    id: 's-1',
    impression: impressionOf('tech-lead', 'review', 'returns'),
    proposed: { name: 'Reviewer', role: 'tech-lead', stage: 'review', prompt: 'p', permission: 'read' },
    evidence: [finding({ ref: 'r-1' })],
    decision: 'rejected',
    reason: 'not now',
    by: 'person',
    at: '2026-10-01T00:00:00Z',
    agentId: null,
    evidenceKey: evidenceKeyOf([finding({ ref: 'r-1' })]),
    ...over,
  });

  it('blocks an impression that was never rejected', () => {
    expect(blockedByRejection({ records: [] }, impressionOf('tech-lead', 'review', 'returns'), ['run:r-1:returns:review'])).toBeNull();
  });

  it('holds a rejected impression with nothing new, and lets it back with an execution the rejection never saw', () => {
    const store = { records: [record()] };
    const impression = impressionOf('tech-lead', 'review', 'returns');

    expect(blockedByRejection(store, impression, ['run:r-1:returns:review'])).toEqual({ at: '2026-10-01T00:00:00Z', changed: [] });
    expect(blockedByRejection(store, impression, ['run:r-1:returns:review', 'run:r-2:returns:review'])).toEqual({ at: '2026-10-01T00:00:00Z', changed: ['run:r-2:returns:review'] });
  });

  it('does not block a different kind of evidence of the same stage, nor a different impression', () => {
    const store = { records: [record({ impression: impressionOf('tech-lead', 'review', 'qa-scenarios') })] };
    expect(blockedByRejection(store, impressionOf('tech-lead', 'review', 'returns'), ['run:r-1:returns:review'])).toBeNull();
  });

  it('writes and reads the record back, and starts empty when the file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'suggestions-'));
    tempDirs.push(dir);
    const file = join(dir, 'suggestions.json');

    expect(readSuggestions(file)).toEqual({ records: [] });
    writeSuggestions({ records: [record()] }, file);
    expect(readSuggestions(file).records[0]).toMatchObject({ id: 's-1', decision: 'rejected', reason: 'not now' });
  });
});

describe('the stage an agent would cover must exist', () => {
  it('accepts a stage of the workspace and refuses one that is not there', () => {
    expect(stageExists(stages, 'review')).toBe(true);
    expect(stageExists(stages, 'nope')).toBe(false);
    expect(stageExists(stages, null)).toBe(false);
  });
});
