import { describe, expect, it } from 'vitest';
import { RELEASE_OPS, RELEASE_TOOL_SCHEMA, ReleaseUnitError, alwaysWaits, isReleasePush, parseReleaseUnit, releaseBlockers, releaseBranchOf, releaseStepNeeds, releaseTagOf } from '../src/shared/release';
import type { ReleaseAction } from '../src/shared/types';

// What a release action may hold: an operation and a version, and only the other fields that operation has. Nothing that names a path, a command or a flag.

const RUN = 'r-abc123-x1y2';
const code = (raw: unknown): string => {
  try {
    parseReleaseUnit(raw);
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(ReleaseUnitError);
    return (e as ReleaseUnitError).code;
  }
};

describe('the unit of a release action', () => {
  it('accepts each operation with the fields it has', () => {
    expect(parseReleaseUnit({ op: 'open', version: '0.6.0' })).toEqual({ op: 'open', version: '0.6.0' });
    expect(parseReleaseUnit({ op: 'open', version: '0.4.1', from: 'v0.4.0', runId: RUN })).toEqual({ op: 'open', version: '0.4.1', from: 'v0.4.0', runId: RUN });
    expect(parseReleaseUnit({ op: 'merge-pr', version: '0.6.0', pr: 12, head: 'ABCDEF1234'.repeat(4) })).toEqual({ op: 'merge-pr', version: '0.6.0', pr: 12, head: 'abcdef1234'.repeat(4) });
    expect(parseReleaseUnit({ op: 'beta', version: '0.6.0' })).toEqual({ op: 'beta', version: '0.6.0' });
    expect(parseReleaseUnit({ op: 'stable', version: '0.6.0' })).toEqual({ op: 'stable', version: '0.6.0' });
    expect(parseReleaseUnit({ op: 'push-branch', version: '0.6.0' })).toEqual({ op: 'push-branch', version: '0.6.0' });
    expect(parseReleaseUnit({ op: 'push-branch', version: '0.6.0', branch: 'main' })).toEqual({ op: 'push-branch', version: '0.6.0', branch: 'main' });
    expect(parseReleaseUnit({ op: 'push-tag', version: '0.6.0', channel: 'beta' })).toEqual({ op: 'push-tag', version: '0.6.0', channel: 'beta' });
  });

  it('refuses a field that names a path, a command, a flag, a remote or anything not listed', () => {
    for (const field of ['path', 'cwd', 'clone', 'command', 'args', 'flags', 'emergency', 'allowBranch', 'remote', 'ref', 'force', 'script', 'author', 'identity']) {
      expect(code({ op: 'beta', version: '0.6.0', [field]: field === 'emergency' || field === 'force' ? true : '/etc/passwd' }), field).toBe('unknown-field');
    }
  });

  it('refuses an operation that is not one of the six, with no way to say --emergency', () => {
    expect([...RELEASE_OPS].sort()).toEqual(['beta', 'merge-pr', 'open', 'push-branch', 'push-tag', 'stable']);
    for (const op of ['emergency', 'push', 'tag', 'force-push', 'delete-branch', 'release', '', 'BETA', undefined, 3]) expect(code({ op, version: '0.6.0' }), String(op)).toBe('unknown-op');
  });

  it('refuses a version that is not X.Y.Z of plain numbers', () => {
    for (const version of ['0.6', '0.6.0-beta.1', 'v0.6.0', '0.06.0', '1.2.3.4', '0.6.0 --emergency', '../0.6.0', '0.6.0\n', '', undefined, 6, '0.6.x', '-1.0.0']) expect(code({ op: 'beta', version }), String(version)).toBe('bad-version');
  });

  it('wants a pull request number for a merge and for nothing else', () => {
    expect(code({ op: 'merge-pr', version: '0.6.0', head: 'abcdef1' })).toBe('bad-pr');
    for (const pr of [0, -1, 1.5, '7', null, 1e12]) expect(code({ op: 'merge-pr', version: '0.6.0', pr, head: 'abcdef1' }), String(pr)).toBe('bad-pr');
    // the commit the pull request was read at is required: a merge of "whatever it is now" is not a step
    expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7 })).toBe('bad-head');
    expect(code({ op: 'beta', version: '0.6.0', pr: 7 })).toBe('field-not-for-op');
    expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7, head: 'not a sha' })).toBe('bad-head');
    expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7, head: 'abc' })).toBe('bad-head');
    expect(code({ op: 'beta', version: '0.6.0', head: 'abcdef1' })).toBe('field-not-for-op');
  });

  it('wants the head in full: an abbreviation could be the prefix of another commit', () => {
    for (const head of ['abcdef1', 'abcdef1234', 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), `${'a'.repeat(39)}g`]) expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7, head }), head).toBe('bad-head');
    for (const head of ['a'.repeat(40), 'B'.repeat(40), 'c'.repeat(64)]) expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7, head }), head).toBe('ok');
  });

  it('takes --from only for open, and only a stable tag', () => {
    expect(code({ op: 'open', version: '0.4.1', from: 'main' })).toBe('bad-from');
    expect(code({ op: 'open', version: '0.4.1', from: 'v0.4.0-beta.1' })).toBe('bad-from');
    expect(code({ op: 'open', version: '0.4.1', from: '--help' })).toBe('bad-from');
    expect(code({ op: 'stable', version: '0.4.1', from: 'v0.4.0' })).toBe('field-not-for-op');
  });

  it('wants a channel for a tag push and a known branch for a branch push', () => {
    expect(code({ op: 'push-tag', version: '0.6.0' })).toBe('bad-channel');
    expect(code({ op: 'push-tag', version: '0.6.0', channel: 'rc' })).toBe('bad-channel');
    expect(code({ op: 'push-branch', version: '0.6.0', channel: 'beta' })).toBe('field-not-for-op');
    expect(code({ op: 'push-branch', version: '0.6.0', branch: 'develop' })).toBe('bad-branch');
    expect(code({ op: 'push-branch', version: '0.6.0', branch: 'refs/heads/other' })).toBe('bad-branch');
  });

  it('refuses a run id that is not one of ours, and anything that is not an object', () => {
    expect(code({ op: 'beta', version: '0.6.0', runId: '../x' })).toBe('bad-run');
    expect(code(null)).toBe('not-object');
    expect(code([])).toBe('not-object');
    expect(code('beta 0.6.0')).toBe('not-object');
  });

  it('names the branch and the tags from the version alone, and knows which operations leave the machine', () => {
    expect(releaseBranchOf('0.6.0')).toBe('release/0.6.0');
    expect(releaseTagOf('0.6.0')).toBe('v0.6.0');
    expect(RELEASE_OPS.filter(isReleasePush)).toEqual(['push-branch', 'push-tag']);
    // what always waits for the person: the pushes (D6) and the cuts, which run the repository's scripts and merged code as the person (D18)
    expect(RELEASE_OPS.filter(alwaysWaits)).toEqual(['beta', 'stable', 'push-branch', 'push-tag']);
  });

  it('is the schema the tool gives the agent: the six operations and the fields above, no path and no flag', () => {
    expect(RELEASE_TOOL_SCHEMA.properties.op.enum).toEqual([...RELEASE_OPS]);
    expect(Object.keys(RELEASE_TOOL_SCHEMA.properties).sort()).toEqual(['branch', 'channel', 'from', 'head', 'op', 'pr', 'version']);
    expect(RELEASE_TOOL_SCHEMA.required).toEqual(['op', 'version']);
  });
});

describe('the order of the steps asked in one stage', () => {
  const u = (op: string, extra: Record<string, unknown> = {}) => parseReleaseUnit({ op, version: '0.6.0', ...extra });
  const action = (id: string, op: string, extra: Record<string, unknown> = {}): ReleaseAction =>
    ({ id, key: id, kind: 'release-git', state: 'pending', group: 'r:release-beta:1', summary: id, unit: { op, version: '0.6.0', runId: RUN, ...extra } }) as unknown as ReleaseAction;

  it('puts a push after the cut and the merges it sends, and the tag after its branch', () => {
    expect(releaseStepNeeds(u('push-branch'), u('beta'))).toBe(true);
    expect(releaseStepNeeds(u('push-branch'), u('merge-pr', { pr: 1, head: 'a'.repeat(40) }))).toBe(true);
    expect(releaseStepNeeds(u('push-tag', { channel: 'beta' }), u('beta'))).toBe(true);
    expect(releaseStepNeeds(u('push-tag', { channel: 'beta' }), u('push-branch'))).toBe(true);
    expect(releaseStepNeeds(u('push-branch', { branch: 'main' }), u('stable'))).toBe(true);
    expect(releaseStepNeeds(u('push-tag', { channel: 'stable' }), u('stable'))).toBe(true);
    expect(releaseStepNeeds(u('push-tag', { channel: 'stable' }), u('push-branch', { branch: 'main' }))).toBe(true);
    expect(releaseStepNeeds(u('beta'), u('merge-pr', { pr: 1, head: 'a'.repeat(40) }))).toBe(true);
    // and never the other way round, nor across the channels
    expect(releaseStepNeeds(u('beta'), u('push-branch'))).toBe(false);
    expect(releaseStepNeeds(u('push-branch'), u('push-tag', { channel: 'beta' }))).toBe(false);
    expect(releaseStepNeeds(u('push-tag', { channel: 'stable' }), u('push-branch'))).toBe(false);
    expect(releaseStepNeeds(u('push-tag', { channel: 'beta' }), u('push-branch', { branch: 'main' }))).toBe(false);
    expect(releaseStepNeeds(u('push-branch', { branch: 'main' }), u('beta'))).toBe(false);
    expect(releaseStepNeeds(u('open'), u('beta'))).toBe(false);
  });

  it('holds a push back while its cut waits, runs or failed; not when the cut was skipped, is in another stage, or the push has no group', () => {
    const tag = action('tag', 'push-tag', { channel: 'beta' });
    const branch = action('branch', 'push-branch');
    const cut = action('cut', 'beta');
    expect(releaseBlockers(tag, [tag, branch, cut]).map((a) => a.id).sort()).toEqual(['branch', 'cut']);
    expect(releaseBlockers(branch, [tag, branch, cut]).map((a) => a.id)).toEqual(['cut']);
    expect(releaseBlockers(cut, [tag, branch, cut])).toEqual([]);
    for (const state of ['running', 'failed'] as const) expect(releaseBlockers(branch, [branch, { ...cut, state }]), state).toHaveLength(1);
    expect(releaseBlockers(branch, [branch, { ...cut, state: 'done' }])).toEqual([]);
    expect(releaseBlockers(branch, [branch, { ...cut, state: 'skipped' }])).toEqual([]);
    expect(releaseBlockers(branch, [branch, { ...cut, group: 'r:release-beta:2' }])).toEqual([]);
    expect(releaseBlockers({ ...branch, group: undefined }, [branch, { ...cut, group: undefined }])).toEqual([]);
    // a stored unit that is not one is no reason to hold anything back, nor held back itself
    expect(releaseBlockers(branch, [branch, { ...cut, unit: { op: 'beta', version: '0.6.0', cwd: '/etc' } }])).toEqual([]);
  });
});
