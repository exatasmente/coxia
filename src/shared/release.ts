import { RUN_ID } from './runs/types';
import type { ReleaseAction } from './types';

// The release actions: what the Release manager may ask for and what the app is willing to run for it. The unit that is stored in Actions names an
// operation and a version and nothing else: never a folder, a command line or a flag. `parseReleaseUnit` is the one judge of it, and it runs again when
// a person says "yes" (a stored action is never trusted).

export const RELEASE_OPS = ['open', 'merge-pr', 'beta', 'stable', 'push-branch', 'push-tag'] as const;
export type ReleaseOp = (typeof RELEASE_OPS)[number];

/** The two operations that leave the machine: they wait for a person whatever the agent's autonomy (decision D6). */
export const RELEASE_PUSH_OPS: readonly ReleaseOp[] = ['push-branch', 'push-tag'];
export const isReleasePush = (op: ReleaseOp): boolean => RELEASE_PUSH_OPS.includes(op);

/**
 * The operations that always wait for the person's "sim" (D6 for the pushes, D18 for the cuts): a push leaves the machine, and `beta` and `stable` run the repository's own
 * scripts and the code of merged pull requests, unsandboxed, as the person. Only `open` and `merge-pr` (behind its gate) follow the agent's autonomy.
 */
export const RELEASE_WAIT_OPS: readonly ReleaseOp[] = ['beta', 'stable', 'push-branch', 'push-tag'];
export const alwaysWaits = (op: ReleaseOp): boolean => RELEASE_WAIT_OPS.includes(op);

/** Which branch a `push-branch` sends: the release branch, or `main` after a stable was cut on it (the workflow refuses a stable tag that is not on `origin/main`). */
export const RELEASE_BRANCHES = ['release', 'main'] as const;
export type ReleaseBranch = (typeof RELEASE_BRANCHES)[number];

/** Which tag a `push-tag` sends: the latest beta of the version (found when the person approves), or the stable. */
export const RELEASE_CHANNELS = ['beta', 'stable'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export interface ReleaseUnit {
  op: ReleaseOp;
  /** `X.Y.Z`: the version being released, without a suffix and without a leading `v`. */
  version: string;
  /** The run this belongs to: the repository and the release it acts on are read from it, never from the unit. */
  runId?: string;
  /** `merge-pr`: the pull request to merge into the release branch. */
  pr?: number;
  /** `merge-pr` (required): the commit the pull request was at when the plan was made; the merge is refused when it moved, or when it is not the head the person approved. */
  head?: string;
  /** `open`: the stable tag a patch is cut from (`vA.B.C`). */
  from?: string;
  /** `push-branch`: which branch (default `release`). */
  branch?: ReleaseBranch;
  /** `push-tag`: which tag. */
  channel?: ReleaseChannel;
}

export const RELEASE_UNIT_ERRORS = ['not-object', 'unknown-field', 'unknown-op', 'bad-version', 'bad-pr', 'bad-head', 'bad-from', 'bad-run', 'bad-branch', 'bad-channel', 'field-not-for-op'] as const;
export type ReleaseUnitErrorCode = (typeof RELEASE_UNIT_ERRORS)[number];

export class ReleaseUnitError extends Error {
  constructor(
    readonly code: ReleaseUnitErrorCode,
    readonly detail: string = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'ReleaseUnitError';
  }
}

// Every number of a version is 0 or has no leading zero, as `scripts/release.sh` has it (`NUM`): 0.06.0 would make a tag that says 0.6.0.
const NUM = '(?:0|[1-9][0-9]{0,8})';
export const RELEASE_VERSION = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}$`);
export const RELEASE_FROM = new RegExp(`^v${NUM}\\.${NUM}\\.${NUM}$`);
// A commit is named in full (SHA-1 or SHA-256): an abbreviation could be the prefix of another commit, and what a merge is checked against must be exact.
const HEAD = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const ALLOWED = new Set(['op', 'version', 'runId', 'pr', 'head', 'from', 'branch', 'channel']);

/** The release branch of a version. */
export const releaseBranchOf = (version: string): string => `release/${version}`;
/** The stable tag of a version. */
export const releaseTagOf = (version: string): string => `v${version}`;
/** The text a person reads for a unit: what will be done to which version. */
export const releaseUnitSummary = (u: ReleaseUnit): string => `${u.op} ${u.version}${u.pr !== undefined ? ` #${u.pr}` : ''}${u.channel ? ` (${u.channel})` : ''}${u.branch === 'main' ? ' (main)' : ''}`;

/**
 * The unit a stored or proposed release action holds, or the reason it is not one. Only the fields of its operation are accepted: a path, a command, a flag, a
 * remote or anything else that is not listed is refused, not ignored.
 */
export function parseReleaseUnit(raw: unknown): ReleaseUnit {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ReleaseUnitError('not-object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED.has(k)) throw new ReleaseUnitError('unknown-field', k.slice(0, 40));
  const op = RELEASE_OPS.find((x) => x === o.op);
  if (!op) throw new ReleaseUnitError('unknown-op', String(o.op).slice(0, 40));
  if (typeof o.version !== 'string' || !RELEASE_VERSION.test(o.version)) throw new ReleaseUnitError('bad-version', String(o.version).slice(0, 40));
  const unit: ReleaseUnit = { op, version: o.version };
  const only = (field: string, ops: readonly ReleaseOp[]): boolean => {
    if (o[field] === undefined) return false;
    if (!ops.includes(op)) throw new ReleaseUnitError('field-not-for-op', `${field} on ${op}`);
    return true;
  };
  if (o.runId !== undefined) {
    if (typeof o.runId !== 'string' || !RUN_ID.test(o.runId)) throw new ReleaseUnitError('bad-run', String(o.runId).slice(0, 40));
    unit.runId = o.runId;
  }
  if (op === 'merge-pr' && o.pr === undefined) throw new ReleaseUnitError('bad-pr', 'missing');
  if (only('pr', ['merge-pr'])) {
    if (typeof o.pr !== 'number' || !Number.isSafeInteger(o.pr) || o.pr < 1 || o.pr > 999_999_999) throw new ReleaseUnitError('bad-pr', String(o.pr).slice(0, 20));
    unit.pr = o.pr;
  }
  if (op === 'merge-pr' && o.head === undefined) throw new ReleaseUnitError('bad-head', 'missing');
  if (only('head', ['merge-pr'])) {
    if (typeof o.head !== 'string' || !HEAD.test(o.head)) throw new ReleaseUnitError('bad-head', String(o.head).slice(0, 20));
    unit.head = o.head.toLowerCase();
  }
  if (only('from', ['open'])) {
    if (typeof o.from !== 'string' || !RELEASE_FROM.test(o.from)) throw new ReleaseUnitError('bad-from', String(o.from).slice(0, 40));
    unit.from = o.from;
  }
  if (only('branch', ['push-branch'])) {
    const branch = RELEASE_BRANCHES.find((b) => b === o.branch);
    if (!branch) throw new ReleaseUnitError('bad-branch', String(o.branch).slice(0, 40));
    unit.branch = branch;
  }
  if (op === 'push-tag' && o.channel === undefined) throw new ReleaseUnitError('bad-channel', 'missing');
  if (only('channel', ['push-tag'])) {
    const channel = RELEASE_CHANNELS.find((c) => c === o.channel);
    if (!channel) throw new ReleaseUnitError('bad-channel', String(o.channel).slice(0, 40));
    unit.channel = channel;
  }
  return unit;
}

/**
 * Whether `step` must wait for `other` when both were asked in the same stage: a push sends what a cut or a merge made, so it goes after them, and the tag goes after the
 * branch it must be on. Approving a push before the cut it belongs to would send what the remote already has, and the person's "sim" was given on a preview of that.
 */
export function releaseStepNeeds(step: ReleaseUnit, other: ReleaseUnit): boolean {
  const local = other.op === 'open' || other.op === 'merge-pr';
  switch (step.op) {
    case 'open':
      return false;
    case 'merge-pr':
      return other.op === 'open';
    case 'beta':
    case 'stable':
      return local;
    case 'push-branch':
      return step.branch === 'main' ? other.op === 'stable' : local || other.op === 'beta';
    case 'push-tag':
      return step.channel === 'stable'
        ? other.op === 'stable' || (other.op === 'push-branch' && other.branch === 'main')
        : local || other.op === 'beta' || (other.op === 'push-branch' && other.branch !== 'main');
  }
}

const unitOrNull = (raw: unknown): ReleaseUnit | null => {
  try {
    return parseReleaseUnit(raw);
  } catch {
    return null;
  }
};

/**
 * The steps of the same stage that a release action still waits for: asked in its group, needed before it (`releaseStepNeeds`), and not carried out yet (waiting, running,
 * or failed). A step the person skipped is the person's decision and holds nothing back. An action with no group (made before groups existed) waits for nothing.
 */
export function releaseBlockers(action: ReleaseAction, all: readonly ReleaseAction[]): ReleaseAction[] {
  if (action.kind !== 'release-git' || !action.group) return [];
  const step = unitOrNull(action.unit);
  if (!step) return [];
  return all.filter((o) => {
    if (o.id === action.id || o.kind !== 'release-git' || o.group !== action.group) return false;
    if (o.state !== 'pending' && o.state !== 'running' && o.state !== 'failed') return false;
    const other = unitOrNull(o.unit);
    return !!other && releaseStepNeeds(step, other);
  });
}

/** The JSON Schema of the `ReleaseAction` tool the Release manager calls: the operations above with a version, and nothing that names a path or a flag. */
export const RELEASE_TOOL_NAME = 'ReleaseAction';
export const RELEASE_MCP_SERVER = 'coxia_release';
export const RELEASE_MCP_TOOL_NAME = `mcp__${RELEASE_MCP_SERVER}__release_action`;

// i18n-ignore-start: the tool text for the model: English by design
export const RELEASE_TOOL_DESCRIPTION =
  'Asks the app to do one step of the release of this run\'s version, by the release script of the repository. `open` makes release/<version> (`from` is the stable tag a patch is cut from), ' +
  '`merge-pr` merges an approved pull request into it locally (`pr` is its number, `head` is required: the commit you read it at, which must be the one the plan approved), `beta` and `stable` cut the next beta or the stable version locally, ' +
  '`push-branch` and `push-tag` send the branch (`release`, or `main` after a stable) or the tag (`beta`, the latest one, or `stable`). The version is X.Y.Z. A push, a beta and a stable ALWAYS wait for the person; ' +
  '`open` and `merge-pr` run by themselves only when you are set to run by themselves, and otherwise wait for the person too. Steps asked in the same stage are carried out in the order they ' +
  'need each other: a push can only be approved once the cut or merge it sends is done, and the tag once its branch is sent. The answer says which happened.';

export const RELEASE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...RELEASE_OPS], description: 'The step' },
    version: { type: 'string', description: 'The version of this release: X.Y.Z' },
    pr: { type: 'integer', description: 'merge-pr: the number of the pull request' },
    head: { type: 'string', description: 'merge-pr (required): the commit the pull request was at when you read it' },
    from: { type: 'string', description: 'open: the stable tag a patch is cut from, vA.B.C' },
    branch: { type: 'string', enum: [...RELEASE_BRANCHES], description: 'push-branch: release (default) or main' },
    channel: { type: 'string', enum: [...RELEASE_CHANNELS], description: 'push-tag: beta or stable' },
  },
  required: ['op', 'version'],
} as const;
// i18n-ignore-end
