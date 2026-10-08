import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRemote } from '../../shared/wizard';
import { ATAS } from '../env';
import { getConfig, rc } from '../workspaceConfig';
import { type CardReport, type CardState, buildCardReport } from './cards';
import { vcsProvider, vcsReady } from './index';

// The card source a workspace gets when it has no external command (externalTools.cardSource): its own provider. A workspace with
// the command keeps it; a workspace with neither has no cards, which is not an error.

const FILE = (): string => join(ATAS, 'vcs-cards.json');

function readState(): CardState | null {
  try {
    if (existsSync(FILE())) return JSON.parse(readFileSync(FILE(), 'utf8')) as CardState;
  } catch {
    // an unreadable file only means the changes start from now
  }
  return null;
}

function writeState(state: CardState): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE()}.tmp`, JSON.stringify(state));
  renameSync(`${FILE()}.tmp`, FILE());
}

// The workspace's repos on this integration, plus the issue project; empty when none is known, so nothing is filtered out.
export function workspaceProjects(vcsId: string, issueProject: string | null): string[] {
  const repos = rc()
    .repos.filter((r) => r.vcsId === vcsId)
    .map((r) => r.projectPath ?? parseRemote(r.remoteUrl)?.projectPath ?? null);
  return [...repos, issueProject].filter((p): p is string => !!p);
}

/** The issue project of the primary integration and the prefix its references carry; null and empty when the issue project belongs to another integration. */
export function cardRefContext(): { issueProject: string | null; refPrefix: string } {
  const issues = rc().issues;
  const primary = rc().primaryVcs;
  const own = primary !== null && (issues.vcsId === null || issues.vcsId === primary.id);
  return { issueProject: own ? issues.project : null, refPrefix: own ? issues.refPrefix : '' };
}

/** The report built from the primary integration, or null when the workspace has none that is usable. */
export async function providerReport(): Promise<CardReport | null> {
  if (!vcsReady()) return null;
  const provider = vcsProvider();
  const issues = rc().issues;
  const { issueProject, refPrefix } = cardRefContext();
  const { report, state } = await buildCardReport(provider, {
    issueProject,
    refPrefix,
    scope: issues.cardScope,
    labels: issues.cardLabels,
    stages: rc().stages,
    stageMapping: getConfig().devCycle.stageMapping,
    projects: workspaceProjects(provider.id, issueProject),
    kind: provider.kind,
    state: readState(),
    now: () => new Date(),
  });
  try {
    writeState(state);
  } catch (e) {
    console.error('[vcs:cards] could not save the comparison state', (e as Error).message);
  }
  return report;
}
