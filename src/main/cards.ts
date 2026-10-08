import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardsResult, SpecInfo } from '../shared/types';
import { boardCardOf } from '../shared/board';
import { isBlockedStage } from '../shared/cycles/stages';
import { priorityOf, sortCards } from '../shared/priority';
import { squadOf, squadsOf } from '../shared/config/squads';
import { t } from '../shared/i18n';
import { cardsOfSquad } from '../shared/squadCards';
import { sameIssue } from '../shared/boardHost';
import type { BoardCard } from '../shared/board';
import { boardWaiting } from './board';
import { boardCards } from './boardSource';
import { cycle, language, text as cycleWord } from './cyclePrompts';
import { type ReportItem, readReport } from './report';
import { runStore } from './runs';
import { type TrackedRead, mirrorTracked, readTracked } from './vcs/boardRead';
import { vcsReady } from './vcs';
import { getConfig, rc } from './workspaceConfig';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function specInfo(iid: string): SpecInfo | null {
  const specs = rc().specsDir;
  if (!cycle().enrichment.specFolder || !specs || !existsSync(specs)) return null;
  const layout = rc().specLayout;
  const prefix = layout.folderPrefix.replace('{iid}', iid);
  const name = readdirSync(specs).filter((n) => n.startsWith(prefix)).sort()[0];
  if (!name) return null;
  const folder = join(specs, name);
  const files = walk(folder);
  const has = (base: string) => files.find((f) => f.endsWith(`/${base}`)) ?? null;
  const phase = cycleWord(layout.phaseFiles.find(({ file }) => has(file))?.label ?? 'cycle.sdd.phase.none');
  return { folder, phase, planFile: layout.planFiles.map(has).find((f) => f !== null) ?? null };
}

// A card in a stage the cycle counts as blocked (a "Blocked" column) is blocked even when the source reports no reason.
export function withStageBlocker(stage: string | null, blockers: string[]): string[] {
  return !blockers.length && stage && isBlockedStage(cycle(), stage) ? [cycleWord('cycle.blocker.stage', { stage })] : blockers;
}

function describe(c: { field: string; from: unknown; to: unknown }, prefix = ''): string {
  return `${prefix}${c.field}: ${String(c.from)} → ${String(c.to)}`;
}

/** The cards of one squad: its runs' issues, and the issues its scope claims (see `squadsOfCard`). */
function ofSquad(cards: Card[], squadId: string): Card[] {
  const config = getConfig();
  if (!squadOf(config, squadId)) throw new Error(t('main.squad.unknown', { id: squadId }));
  return cardsOfSquad(cards, squadsOf(config), squadId, { runs: runStore().list(), repos: rc().repos });
}

/**
 * What the host says about the cards the board opened, and the board's copies brought up to it. Never fails the day: a host that cannot be read leaves the
 * stored copies as they were.
 */
async function trackedIssues(refresh: boolean): Promise<TrackedRead | null> {
  try {
    const read = await readTracked(refresh);
    if (read) mirrorTracked(read);
    return read;
  } catch (e) {
    console.error('[cards] tracked read', (e as Error).message);
    return null;
  }
}

/** The cards of the day. With `squad`, only that squad's (a ceremony held for one squad); without, the whole workspace's. */
export async function loadCards(limit: number, refresh = false, squad: string | null = null): Promise<CardsResult> {
  const report = await readReport({ refresh });
  // An issue the board opened shows in the day whichever scope the listing used; the listing's own item stands when it holds it, so it is one card.
  const tracked = await trackedIssues(refresh);
  const inListing = (it: ReportItem): boolean => report.items.some((x) => x.kind === 'issue' && sameIssue({ project: x.project, iid: x.iid }, { project: it.project, iid: it.iid }));
  const items: ReportItem[] = [...report.items, ...(tracked?.items ?? []).filter((it) => !inListing(it))];
  const hosted = vcsReady();
  const waiting = hosted ? boardWaiting() : new Map();
  const linked = boardCards().filter((c): c is BoardCard & Required<Pick<BoardCard, 'host'>> => !!c.host);
  const mrsByIssue = new Map<string, ReportItem[]>();
  for (const it of items) {
    if (it.kind !== 'mr') continue;
    for (const ref of it.issue_refs ?? []) mrsByIssue.set(String(ref), [...(mrsByIssue.get(String(ref)) ?? []), it]);
  }
  const levels = cycle().priority.labels;
  const cards: Card[] = items
    .filter((it) => it.kind === 'issue')
    .map((it) => {
      const own = linked.find((c) => sameIssue(c.host, { project: it.project, iid: it.iid }));
      const iid = it.ref.split('#').pop() ?? it.ref;
      const mrs = mrsByIssue.get(iid) ?? [];
      return {
        ref: it.ref,
        iid,
        title: it.title,
        stage: it.stage,
        spec: /^\d+$/.test(iid) ? specInfo(iid) : null,
        mrs: mrs.map((m) => m.ref),
        mrPaths: mrs.map((m) => ({ ref: m.ref, project: m.project, iid: m.iid })),
        mrConflicts: mrs.filter((m) => m.has_conflicts === true).map((m) => m.ref),
        blockers: withStageBlocker(it.stage, [...it.blockers, ...mrs.flatMap((m) => m.blockers.map((b) => `${m.ref}: ${b}`))]),
        pending: [...it.pending, ...mrs.flatMap((m) => m.pending.map((p) => `${m.ref}: ${p}`))],
        changes: [...it.changes.map((c) => describe(c)), ...mrs.flatMap((m) => m.changes.map((c) => describe(c, `${m.ref} `)))],
        note: it.manual_note,
        url: it.web_url,
        labels: it.labels ?? [],
        milestone: it.milestone ?? null,
        updatedAt: it.updated_at ?? null,
        project: it.project,
        priority: priorityOf(it.labels, levels),
        ...(own && hosted ? { board: { id: own.id, host: waiting.has(own.id) ? ('waiting' as const) : ('linked' as const) } } : {}),
      };
    });
  // The cards of the board belong to the day too, and the blocked line of a card in a blocked column is added by the same helper as any other card. A card linked
  // to an issue is that issue's card above, never a second one; when the host does not return it (or was not read) its stored copy stands, said so.
  const mine = boardCards()
    .filter((c) => !c.host || !items.some((it) => it.kind === 'issue' && sameIssue(c.host!, { project: it.project, iid: it.iid })))
    .map((c): Card => {
      const card = boardCardOf(c, { stages: cycle().stages, language: language(), levels });
      const seen = tracked?.seen[c.id]?.state;
      const host = waiting.has(c.id) ? 'waiting' : !c.host ? 'notSent' : seen === 'missing' || seen === 'unread' ? seen : 'linked';
      return { ...card, blockers: withStageBlocker(card.stage, card.blockers), ...(hosted ? { board: { id: c.id, host } } : {}) };
    });
  const merged = [...cards, ...mine];
  const ordered = sortCards(squad ? ofSquad(merged, squad) : merged);
  const rest = ordered.slice(limit);
  return { generatedAt: report.generated_at, total: ordered.length, cards: ordered.slice(0, limit), ...(rest.length ? { rest } : {}) };
}
