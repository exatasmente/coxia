import { existsSync } from 'node:fs';
import type { RepoConfig, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import { squadOf, squadsOf } from '../../shared/config/squads';
import { GENERAL_THREAD, SQUADS_CHANNEL, type ThreadSummary, runThreadId } from '../../shared/forum';
import type { Run } from '../../shared/runs';

// Where a person wrote: the place a mention is answered in. A run's thread is answered by the runner and carries its worktree and cycle folder; the rest are a squad
// channel (with or without a squad), the general conversation, or a ceremony. The place says what the agent may read (the squad's mission, the repositories) and,
// when it runs commands, where the throwaway copy of the code comes from. Pure: the caller passes what it reads (the run store, the config).

export interface MentionPlace {
  /** The id of the thread the answer is posted in. */
  thread: string;
  repos: RepoConfig[];
  kind: 'run' | 'channel' | 'general' | 'ceremony';
  /** The run, when the place is a run's thread (only it has a worktree and a cycle folder). */
  run?: Run;
  /** The squad of a squad channel; null for a channel with no squad. */
  squad?: SquadDef | null;
  /** The issue/run or card under discussion, when there is one. */
  ref?: string;
  title?: string;
}

/**
 * The place a thread is: `run-<id>` through the run store; a squad's channel (its mission and its scope's repositories); the channel the squads talk in, or a general
 * conversation (no squad, the workspace's repositories). A run thread of a run that is gone, or any thread that is not one of these, is no place (null).
 */
export function placeOfThread(summary: ThreadSummary | null, runs: (id: string) => Run | null, config: WorkspaceConfig): MentionPlace | null {
  if (!summary) return null;
  const repos = config.projects.repos;
  if (summary.kind === 'run' && summary.runId) {
    const run = runs(summary.runId);
    if (!run) return null;
    const repo = runRepo(config, run);
    return { thread: runThreadId(run.id), kind: 'run', run, repos: repo ? [repo] : [] };
  }
  if (summary.id === GENERAL_THREAD) return { thread: summary.id, kind: 'general', repos };
  if (summary.id === SQUADS_CHANNEL) return { thread: summary.id, kind: 'channel', squad: null, repos };
  if (summary.id.startsWith('squad-')) {
    const squad = squadOf(config, squadIdOfThread(summary.id));
    return { thread: summary.id, kind: 'channel', squad, repos: squad ? repos.filter((r) => squad.scope.repos.includes(r.id)) : repos };
  }
  // A general thread the person opened.
  return { thread: summary.id, kind: 'general', repos };
}

/** The repositories of the place that exist on disk, in the order the config lists them. */
export function reposOnDisk(place: MentionPlace): RepoConfig[] {
  return place.repos.filter((r) => r.path && existsSync(r.path));
}

/** The config repository of a run, by its id; the workspace's only repository when the run names none. */
export function runRepo(config: WorkspaceConfig, run: Run): RepoConfig | null {
  const repos = config.projects.repos;
  return repos.find((r) => r.id === run.repo) ?? (repos.length === 1 ? repos[0] : null);
}

/** The squad id a channel id names (`squad-<id>`); null for any other id. */
export function squadIdOfThread(thread: string): string | null {
  return thread.startsWith('squad-') ? thread.slice('squad-'.length) : null;
}

/** The squads of a workspace, for a caller that only has the config. */
export const allSquads = (config: WorkspaceConfig): SquadDef[] => squadsOf(config);
