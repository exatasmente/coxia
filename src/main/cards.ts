import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardsResult, SpecInfo } from '../shared/types';
import { boardCardOf } from '../shared/board';
import { isBlockedStage } from '../shared/cycles/stages';
import { priorityOf, sortCards } from '../shared/priority';
import { squadOf, squadsOf } from '../shared/config/squads';
import { t } from '../shared/i18n';
import { cardsOfSquad } from '../shared/squadCards';
import { boardCards } from './boardSource';
import { cycle, language, text as cycleWord } from './cyclePrompts';
import { type ReportItem, readReport } from './report';
import { runStore } from './runs';
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

/** The cards of the day. With `squad`, only that squad's (a ceremony held for one squad); without, the whole workspace's. */
export async function loadCards(limit: number, refresh = false, squad: string | null = null): Promise<CardsResult> {
  const report = await readReport({ refresh });
  const mrsByIssue = new Map<string, ReportItem[]>();
  for (const it of report.items) {
    if (it.kind !== 'mr') continue;
    for (const ref of it.issue_refs ?? []) mrsByIssue.set(String(ref), [...(mrsByIssue.get(String(ref)) ?? []), it]);
  }
  const levels = cycle().priority.labels;
  const cards: Card[] = report.items
    .filter((it) => it.kind === 'issue')
    .map((it) => {
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
      };
    });
  // The cards of the board belong to the day too, and the blocked line of a card in a blocked column is added by the same helper as any other card.
  const refs = new Set(cards.map((c) => c.ref));
  const mine = boardCards()
    .map((c) => boardCardOf(c, { stages: cycle().stages, language: language(), levels }))
    .map((c) => ({ ...c, blockers: withStageBlocker(c.stage, c.blockers) }));
  const merged = [...cards, ...mine.filter((c) => !refs.has(c.ref))];
  const ordered = sortCards(squad ? ofSquad(merged, squad) : merged);
  const rest = ordered.slice(limit);
  return { generatedAt: report.generated_at, total: ordered.length, cards: ordered.slice(0, limit), ...(rest.length ? { rest } : {}) };
}
