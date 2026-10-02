import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATAS } from '../env';
import { rc } from '../workspaceConfig';
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

/** The report built from the primary integration, or null when the workspace has none that is usable. */
export async function providerReport(): Promise<CardReport | null> {
  if (!vcsReady()) return null;
  const provider = vcsProvider();
  const issues = rc().issues;
  const primary = rc().primaryVcs;
  const own = primary !== null && (issues.vcsId === null || issues.vcsId === primary.id);
  const { report, state } = await buildCardReport(provider, {
    issueProject: own ? issues.project : null,
    refPrefix: own ? issues.refPrefix : '',
    stages: rc().stages,
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
