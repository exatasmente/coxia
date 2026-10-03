import type { SquadDef } from './config/types';
import type { Card } from './types';

// Which cards and runs belong to a squad, for the ceremonies that are held for one squad (its runs and cards only) instead of the whole workspace.
// A card is a squad's when a run of that squad works its issue; a card with no run is its squad's by its labels (the squad's scope labels, and the label
// the squad puts on its issues) and by the project it lives in (the project of a repository the squad owns). What nobody claims is the squad's that takes
// what is left. A card may belong to more than one squad (scopes may overlap). Pure.

export interface CardScopeContext {
  /** The runs of the workspace: what says, for an issue that has one, which squad works it. */
  runs: { issue: { ref: string }; squad?: string | null; status: string; createdAt: string }[];
  /** The repositories of the workspace and the project each lives in on the host. */
  repos: { id: string; projectPath: string | null }[];
}

const lower = (v: string): string => v.trim().toLowerCase();

function latestRunOf(ref: string, ctx: CardScopeContext): CardScopeContext['runs'][number] | null {
  const mine = ctx.runs.filter((r) => r.issue.ref === ref);
  // The run that is going wins over one that ended or was cancelled; among equals, the newest.
  const rank = (r: { status: string }): number => (r.status === 'cancelled' ? 0 : r.status === 'done' ? 1 : 2);
  return mine.sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

// Whether the squad's own scope says the card is its: by the labels, or by the project of a repository it owns.
function claims(card: Pick<Card, 'labels' | 'project'>, squad: SquadDef, ctx: CardScopeContext): boolean {
  const labels = new Set((card.labels ?? []).map(lower));
  const own = [...squad.scope.labels, ...(squad.label ? [squad.label] : [])];
  if (own.some((l) => labels.has(lower(l)))) return true;
  const repos = new Set([...squad.scope.repos, ...squad.scope.paths.map((p) => p.repo)]);
  return !!card.project && ctx.repos.some((r) => repos.has(r.id) && r.projectPath === card.project);
}

/** The squads a card belongs to, by id. A card with a run belongs to the squad of the run (none when the run has no squad); without one, to the squads whose scope claims it, else to those that take what is left. */
export function squadsOfCard(card: Pick<Card, 'ref' | 'labels' | 'project'>, squads: SquadDef[], ctx: CardScopeContext): string[] {
  const run = latestRunOf(card.ref, ctx);
  if (run) return run.squad && squads.some((s) => s.id === run.squad) ? [run.squad] : [];
  const claimed = squads.filter((s) => claims(card, s, ctx)).map((s) => s.id);
  return claimed.length ? claimed : squads.filter((s) => s.scope.unclaimed).map((s) => s.id);
}

/** The cards of one squad, in the order they came. */
export function cardsOfSquad<T extends Pick<Card, 'ref' | 'labels' | 'project'>>(cards: T[], squads: SquadDef[], squadId: string, ctx: CardScopeContext): T[] {
  return cards.filter((c) => squadsOfCard(c, squads, ctx).includes(squadId));
}

/** The refs of the issues a squad's runs work: what a ceremony for the squad looks at besides its cards (the gates and the release actions of those issues). */
export const refsOfSquad = (squadId: string, ctx: Pick<CardScopeContext, 'runs'>): Set<string> => new Set(ctx.runs.filter((r) => r.squad === squadId).map((r) => r.issue.ref));
