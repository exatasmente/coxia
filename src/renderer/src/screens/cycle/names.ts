import type { AgentDef, SquadDef, WaitKind } from '../../../../shared/config/types';
import type { Author } from '../../../../shared/forum';
import { t } from '../../i18n';

// The names the run screens put on agents and squads. An agent's name is a catalog key (the built-in ones) or a literal; `t` answers both.

export const agentOf = (team: readonly AgentDef[] | undefined, id: string): AgentDef | undefined => team?.find((a) => a.id === id);

export const agentName = (team: readonly AgentDef[] | undefined, id: string): string => {
  const a = agentOf(team, id);
  return a ? t(a.name) : id;
};

/** The first sentence of what an agent does, short enough to sit beside its name. */
export function agentRole(team: readonly AgentDef[] | undefined, id: string, max = 60): string {
  const job = agentOf(team, id)?.job;
  if (!job) return '';
  const text = t(job).trim();
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export const squadName = (squads: readonly SquadDef[] | undefined, id: string | null | undefined): string => (id ? (squads?.find((s) => s.id === id)?.name ?? id) : '');

/** Who said it, in words: the agent's name, the person, or the app. */
export function authorName(author: Author, team: readonly AgentDef[] | undefined): string {
  if (author.type === 'agent') return agentName(team, author.id);
  return author.type === 'person' ? t('ui.cycle.author.person') : t('ui.cycle.author.app');
}

/** What a wait stage (or a waiting run) waits for, by the kind of event. */
export const WAIT_KEY: Record<WaitKind, string> = {
  'pr-merged': 'ui.cycle.wait.prMerged',
  'reporter-reply': 'ui.cycle.wait.reporterReply',
  label: 'ui.cycle.wait.label',
  'linked-done': 'ui.cycle.wait.linkedDone',
  time: 'ui.cycle.wait.time',
  'release-approved': 'ui.cycle.wait.releaseApproved',
  'beta-age': 'ui.cycle.wait.betaAge',
};

/** The button that leaves a wait, worded by what it stops waiting for: it moves forward, and says so. */
export const SKIP_WAIT_KEY: Record<WaitKind, string> = {
  'pr-merged': 'ui.cycle.action.skipWait.prMerged',
  'reporter-reply': 'ui.cycle.action.skipWait.reporterReply',
  label: 'ui.cycle.action.skipWait.label',
  'linked-done': 'ui.cycle.action.skipWait.linkedDone',
  time: 'ui.cycle.action.skipWait.time',
  'release-approved': 'ui.cycle.action.skipWait.releaseApproved',
  'beta-age': 'ui.cycle.action.skipWait.betaAge',
};
