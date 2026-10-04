import type { Language } from '../../shared/config/types';
import { createTranslator } from '../../shared/i18n';
import { releaseBranchOf } from '../../shared/release';
import type { ReleaseActivity, Run } from '../../shared/runs';
import { git } from '../conflictGit';
import { redact } from '../errorlog-core';
import { prompt as cp } from '../cyclePrompts';
import { SAFE } from './git';
import { fence } from './prompt';

// What a release run says about its subject: the synthesized issue the run carries, the activities of the version as lines of text, the brief the first stage reads,
// and the section of the prompt of every stage. Pure text work: nothing here reads a host or a repository.

/** The reference of a release run: what "one run at a time" keys on. */
export const releaseRef = (version: string): string => `release:${version}`;

/** The title of the run and of its tracking issue: "Release X.Y.Z" (the tracker's own text, English whatever the workspace's language). */
// i18n-ignore-next-line: the title of the issue on the tracker
export const releaseTitle = (version: string): string => `Release ${version}`;

/** An open issue of the milestone of the version that no activity carries yet. */
export interface MilestoneIssue {
  iid: number;
  title: string;
  url: string;
}

/** Whether the release branch exists in the clone: here, on the remote (as last fetched), both or neither. */
export type BranchState = 'both' | 'local' | 'remote' | 'none';

export const branchStateOf = (local: boolean, remote: boolean): BranchState => (local && remote ? 'both' : local ? 'local' : remote ? 'remote' : 'none');

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** A title from the host is one line of text and cannot break the markdown of the line it stands in. */
const oneLine = (text: string): string => clip(text.replace(/[\r\n]+/g, ' ').replace(/[[\]]/g, '').trim(), 120);

/** The list of the activities, one line each, as the comment on the tracking issue and the brief show it. */
export function activitiesText(version: string, activities: readonly ReleaseActivity[], milestone: readonly MilestoneIssue[], language: Language, issueUrl: (iid: number) => string | null, crMark: string): string {
  const tr = createTranslator(language);
  const lines = activities.length
    ? activities.map((a) => {
        const link = a.issue ? issueUrl(a.issue) : null;
        const closes = a.issue && link ? tr('main.runner.release.activity.closes', { issue: a.issue, url: link }) : '';
        const kind = a.state === 'merged' ? 'merged' : a.approved ? 'ready' : 'waiting';
        const at = a.head && a.state !== 'merged' ? tr('main.runner.release.activity.at', { sha: a.head.slice(0, 9) }) : '';
        return tr(`main.runner.release.activity.${kind}`, { crMark, pr: a.pr, title: oneLine(a.title), url: a.url, at, closes });
      })
    : [tr('main.runner.release.activities.none', { branch: releaseBranchOf(version) })];
  const extra = milestone.length ? ['', tr('main.runner.release.milestone.title', { version }), ...milestone.map((i) => tr('main.runner.release.milestone.item', { iid: i.iid, title: oneLine(i.title), url: i.url }))] : [];
  return [...lines, ...extra].join('\n');
}

export interface ReleaseBrief {
  version: string;
  from: string | null;
  branch: BranchState;
  activities: ReleaseActivity[];
  milestone: MilestoneIssue[];
  /** The host could be read. */
  read: boolean;
}

/** The brief a release run starts with, as the document its first stage reads (`0_ISSUE.md`). */
export function releaseRecord(b: ReleaseBrief, language: Language, issueUrl: (iid: number) => string | null, crMark: string): string {
  const tr = createTranslator(language);
  const state = tr(`main.runner.release.branch.${b.branch}`);
  const lines = [
    tr('main.runner.release.record.title', { version: b.version }),
    '',
    `- ${tr('main.runner.release.record.branch', { branch: releaseBranchOf(b.version), branchState: state })}`,
    ...(b.from ? [`- ${tr('main.runner.release.record.from', { tag: b.from })}`] : []),
    '',
    tr('main.runner.release.record.activities'),
    '',
    b.read ? activitiesText(b.version, b.activities, b.milestone, language, issueUrl, crMark) : tr('main.runner.release.record.hostUnread'),
    '',
  ];
  return redact(lines.join('\n'));
}

/** What the app knows of the repository for the section of the prompt: the branch, and the latest beta tag it has. */
export interface ReleaseState {
  branch: BranchState;
  beta: string | null;
}

/** The section every stage of a release run is given: the version, the state of the branch and the tag, and the activities as last read. */
export function releaseSection(run: Run, state: ReleaseState, language: Language, issueUrl: (iid: number) => string | null, crMark: string): string {
  const subject = run.subject;
  if (!subject) return '';
  const tr = createTranslator(language);
  return cp('runner.section.release', {
    version: subject.version,
    branch: releaseBranchOf(subject.version),
    branchState: tr(`main.runner.release.branch.${state.branch}`),
    beta: state.beta ?? tr('main.runner.release.none'),
    text: fence(activitiesText(subject.version, subject.activities, [], language, issueUrl, crMark)),
  });
}

/** What the clone says of the release branch and of the betas of a version (read from the repository, which a worktree shares with its clone). */
export async function releaseStateOf(wt: string, version: string): Promise<ReleaseState> {
  const has = async (ref: string): Promise<boolean> => (await git(wt, ['show-ref', '--verify', '--quiet', ref], { fail: false })).code === 0;
  const branch = branchStateOf(await has(`refs/heads/${releaseBranchOf(version)}`), await has(`refs/remotes/origin/${releaseBranchOf(version)}`));
  const tags = (await git(wt, ['tag', '--list', `v${version}-beta.*`], { fail: false })).stdout.split('\n').filter((n) => new RegExp(`^v${version.replace(/\./g, '\\.')}-beta\\.[1-9][0-9]*$`).test(n));
  const beta = tags.sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop())).at(-1) ?? null;
  return { branch, beta };
}

/** What the remote of a release run's repository has of the version: its tags (by name, to the commit each names) and whether the stable's commit is on main there. */
export interface RemoteRelease {
  tags: Record<string, string>;
  stableOnMain: boolean;
}

/**
 * The remote as it is now (`git ls-remote`, not the refs of the last fetch): what a wait for the host reads, so a tag that only exists here never counts. Null when the remote
 * could not be read, which a wait takes as "not yet".
 */
export async function remoteReleaseOf(wt: string, version: string): Promise<RemoteRelease | null> {
  const listed = await git(wt, [...SAFE, 'ls-remote', 'origin', 'refs/heads/main', `refs/tags/v${version}*`], { fail: false });
  if (listed.code !== 0) return null;
  const mine = new RegExp(`^refs/tags/(v${version.replace(/\./g, '\\.')}(?:-beta\\.[1-9][0-9]*)?)(\\^\\{\\})?$`);
  const tags: Record<string, string> = {};
  let main: string | null = null;
  for (const [sha, name] of listed.stdout.split('\n').map((l) => l.trim().split('\t'))) {
    if (!sha || !name) continue;
    if (name === 'refs/heads/main') main = sha;
    const m = mine.exec(name);
    // an annotated tag is listed twice: the tag itself, then the commit it names (`^{}`), which is the one kept
    if (m && (m[2] || !tags[m[1]])) tags[m[1]] = sha;
  }
  const stable = tags[`v${version}`];
  let stableOnMain = !!stable && stable === main;
  if (stable && main && !stableOnMain) {
    // main moved on after the stable: its commit has to be read before it can be asked whether the stable is in its history
    await git(wt, [...SAFE, 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { fail: false });
    stableOnMain = (await git(wt, ['merge-base', '--is-ancestor', stable, main], { fail: false })).code === 0;
  }
  return { tags, stableOnMain };
}
