import type { VcsKind } from './config/types';
import { crMarkOf } from './i18n/terms';

// What the setup wizard gets back from probing a VCS integration (channel `vcs:probe`): enough to say "connected as X, here are your
// issues and merge requests" or to name the one thing that is missing. Nothing in it is a secret.

export type VcsProbeCheckId = 'auth' | 'scopes' | 'issues' | 'mrs' | 'repo';

export interface VcsProbeCheck {
  id: VcsProbeCheckId;
  ok: boolean;
  /** Already translated, one line. */
  detail: string;
}

export interface VcsProbeSample {
  /** "#12" or "!34" with the repository when it is not the issue project. */
  ref: string;
  title: string;
  /** Workflow status, state or CI status, whichever the host has. */
  status: string | null;
  url: string;
}

export interface VcsProbeScopes {
  /** false: the host does not say (fine-grained tokens, the CLI's own login, app passwords). */
  known: boolean;
  granted: string[];
  /** What the app's reads need that the token lacks (only when known). */
  missing: string[];
  /** What the app's writes (comments, status, reviewers) additionally need. */
  forWrites: string[];
  expiresAt: string | null;
}

export interface VcsProbeResult {
  /** The credential works: the host answered "who am I". */
  ok: boolean;
  kind: VcsKind;
  host: string;
  transport: 'cli' | 'api';
  user: { username: string; name: string } | null;
  scopes: VcsProbeScopes | null;
  checks: VcsProbeCheck[];
  issues: { total: number; sample: VcsProbeSample[] } | null;
  mrs: { total: number; sample: VcsProbeSample[] } | null;
  rateLimit: { limit: number | null; remaining: number | null; resetAt: string | null } | null;
  warnings: string[];
  /** One line for the screen: who it connected as, or why it did not (already translated). */
  message: string;
  /** HTTP status of the failure, when the host answered with one. */
  status: number | null;
  durationMs: number;
}

/** What the wizard sends: the integration as it would be saved, plus a token typed but not stored yet. */
export interface VcsProbeRequest {
  integration: { id: string; kind: VcsKind; host: string; apiUrl: string; user: string; secretRef: string | null; cliPreference: 'auto' | 'cli' | 'api'; cliCommand: string | null };
  /** A token to test without storing it. Never saved, never logged. */
  token?: string;
  /** "group/name" of the issue project, and repositories to look in (Bitbucket). */
  issueProject?: string | null;
  repos?: string[];
}

/**
 * The ref of a change request as the person reads it: "app!7" on GitLab, "app#7" on the other hosts. The short form drops the group or owner;
 * `full` keeps the whole project path ("group/app!7"), which is what a ref must carry to be resolved without the card around it.
 */
export function crRef(kind: VcsKind | null, project: string, iid: number | string, options: { full?: boolean } = {}): string {
  const name = options.full ? project : (project.split('/').pop() ?? project);
  return `${name}${crMarkOf(kind)}${iid}`;
}
