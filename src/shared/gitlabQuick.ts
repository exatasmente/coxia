export interface QuickPerson {
  id: number;
  username: string;
  name: string;
}

export interface QuickJob {
  id: number;
  name: string;
  stage: string;
}

export interface QuickMr {
  ref: string;
  projectPath: string;
  iid: number;
  title: string;
  webUrl: string;
  draft: boolean;
  hasConflicts: boolean;
  pipeline: string | null;
  reviewers: QuickPerson[];
  author: string;
  mine: boolean;
  manualJobs: QuickJob[];
}

export interface QuickTransition {
  to: string;
  // Label that goes in and the ones that come out (already filtered by what the issue really has).
  addLabel: string | null;
  removeLabels: string[];
  allowed: boolean;
  reason: string | null;
}

export interface QuickIssue {
  iid: number;
  status: string | null;
  stageLabels: string[];
  transitions: QuickTransition[];
}

export interface QuickContext {
  me: string;
  issue: QuickIssue | null;
  mrs: QuickMr[];
  warnings: string[];
}

export interface QuickMember extends QuickPerson {
  // How many of my recent MRs in the project this person reviewed.
  usual: number;
}

export type QuickRequest =
  | { kind: 'reviewer'; projectPath: string; mrIid: number; userId: number; issue?: number }
  | { kind: 'undraft'; projectPath: string; mrIid: number; issue?: number }
  | { kind: 'play'; projectPath: string; jobId: number }
  | { kind: 'transition'; issue: number; to: string };

export interface QuickResult {
  created: string[];
  duplicated: number;
}
