import { describe, expect, it } from 'vitest';
import { RELEASE_OPS, RELEASE_TOOL_SCHEMA, ReleaseUnitError, isReleasePush, parseReleaseUnit, releaseBranchOf, releaseTagOf } from '../src/shared/release';

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
    expect(parseReleaseUnit({ op: 'merge-pr', version: '0.6.0', pr: 12, head: 'ABCDEF1234' })).toEqual({ op: 'merge-pr', version: '0.6.0', pr: 12, head: 'abcdef1234' });
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
    expect(code({ op: 'merge-pr', version: '0.6.0' })).toBe('bad-pr');
    for (const pr of [0, -1, 1.5, '7', null, 1e12]) expect(code({ op: 'merge-pr', version: '0.6.0', pr }), String(pr)).toBe('bad-pr');
    expect(code({ op: 'beta', version: '0.6.0', pr: 7 })).toBe('field-not-for-op');
    expect(code({ op: 'merge-pr', version: '0.6.0', pr: 7, head: 'not a sha' })).toBe('bad-head');
    expect(code({ op: 'beta', version: '0.6.0', head: 'abcdef1' })).toBe('field-not-for-op');
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
  });

  it('is the schema the tool gives the agent: the six operations and the fields above, no path and no flag', () => {
    expect(RELEASE_TOOL_SCHEMA.properties.op.enum).toEqual([...RELEASE_OPS]);
    expect(Object.keys(RELEASE_TOOL_SCHEMA.properties).sort()).toEqual(['branch', 'channel', 'from', 'head', 'op', 'pr', 'version']);
    expect(RELEASE_TOOL_SCHEMA.required).toEqual(['op', 'version']);
  });
});
