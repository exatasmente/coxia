import type { VcsKind } from './config/types';

// What each code host can do, as plain data: the providers declare them as their `caps`, and the screens read them (through the cycle view)
// to hide what the host does not have instead of renaming it.

export interface VcsCaps {
  /** The tracker has a workflow status separate from labels. */
  issueStatus: boolean;
  /** MR discussions can be marked resolved. */
  resolvableThreads: boolean;
  /** CI jobs that wait for a person (GitLab manual jobs). */
  manualJobs: boolean;
  draftToggle: boolean;
  /** The host exposes whether the branch conflicts with the target. */
  conflictFlag: boolean;
  /** The host can list issues assigned to me. */
  issues: boolean;
  /** Issues carry labels the card source can filter by (Bitbucket's tracker has none). */
  issueLabels: boolean;
}

export const VCS_CAPS: Record<VcsKind, VcsCaps> = {
  gitlab: { issueStatus: true, resolvableThreads: true, manualJobs: true, draftToggle: true, conflictFlag: true, issues: true, issueLabels: true },
  github: { issueStatus: false, resolvableThreads: true, manualJobs: false, draftToggle: true, conflictFlag: true, issues: true, issueLabels: true },
  bitbucket: { issueStatus: true, resolvableThreads: true, manualJobs: false, draftToggle: true, conflictFlag: false, issues: true, issueLabels: false },
};
