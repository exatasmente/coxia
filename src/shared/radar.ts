export type RadarKind = 'same-fix' | 'dependency' | 'file' | 'scope';

export interface RadarSide {
  ref: string;
  iid: string;
  title: string;
  stage: string | null;
  mr: string;
  branch: string;
  target: string;
  url: string;
}

export interface RadarRegion {
  file: string;
  a: [number, number];
  b: [number, number];
  distance: number;
}

export interface RadarFinding {
  key: string;
  kind: RadarKind;
  // For 'dependency', a is the more advanced activity and b is the one that has to wait for it.
  a: RadarSide;
  b: RadarSide;
  files: string[];
  scopes: string[];
  regions: RadarRegion[];
  identicalLines: number;
  // Same-fix with regions that do not overlap: git merges it cleanly, so nothing warns anybody.
  silent: boolean;
  summary: string;
  recommendation: string;
  collideCommand: string | null;
  firstSeen: string;
}

export interface RadarResult {
  checkedAt: string;
  mrsChecked: number;
  findings: RadarFinding[];
  failed: string[];
}

export type BranchIssue = 'unpushed' | 'dirty' | 'off-convention' | 'no-upstream';

export interface BranchHealth {
  repo: string;
  branch: string;
  worktree: string | null;
  issue: string | null;
  dirty: number;
  dirtyFiles: string[];
  // Commits that exist only here: ahead of the upstream, or on no remote when there is no upstream.
  unpushed: number;
  hasUpstream: boolean;
  suggestedName: string | null;
  conventionNote: string | null;
}

export interface WorktreeHealth {
  checkedAt: string;
  byIssue: Record<string, BranchHealth[]>;
  unassigned: BranchHealth[];
}
