import { t } from '../shared/i18n';
import { resolvePriority, writableLabels } from '../shared/priority';
import type { Card, Decision, PriorityChange, PriorityNoWrite } from '../shared/types';
import { cycle, prompt as cp } from './cyclePrompts';
import { rc } from './workspaceConfig';

// A person's wish to change the priority of a card ("this one goes first") as a decision: what it means for the tracker, and where it goes.

/** The values the reply may give for "para": the two ends of the scale and every label a priority can be written to. */
export function priorityChoices(): string[] {
  return ['first', 'later', ...writableLabels(cycle().priority.labels)];
}

/** The line of the reply prompt that explains the priority field, with the workspace's own labels when it has them. */
export function priorityRule(card: Card): string {
  const names = writableLabels(cycle().priority.labels);
  const levels = names.length
    ? cp('reply.priority.levels', { labels: names.join(', '), current: card.priority?.label ?? cp('reply.priority.none') })
    : cp('reply.priority.noLevels');
  return cp('reply.priority', { levels });
}

function wording(ref: string, change: PriorityChange): string {
  if (change.label) {
    return change.from ? t('main.priority.text.change', { ref, from: change.from, to: change.label }) : t('main.priority.text.set', { ref, to: change.label });
  }
  if (change.to === 'first') return t('main.priority.text.first', { ref });
  if (change.to === 'later') return t('main.priority.text.later', { ref });
  return t('main.priority.text.other', { ref, to: change.to });
}

function destinationOf(change: PriorityChange): string {
  return change.noWrite ? t(`main.priority.dest.${change.noWrite}`, { label: change.label ?? change.to }) : t('main.priority.dest.proposal');
}

/** The decision for a reply that asked for `to` on this card; its `dest` already says whether the tracker is written or only the minutes. */
export function priorityDecision(card: Card, to: string): Decision {
  const resolved = resolvePriority(card, to, cycle().priority.labels);
  // A host that cannot change labels leaves the decision in the minutes, whatever the config says.
  const noWrite: PriorityNoWrite | null = resolved.noWrite ?? (rc().primaryVcs?.kind === 'bitbucket' ? 'unsupported' : null);
  const change: PriorityChange = { ...resolved, noWrite };
  return { ref: card.ref, text: wording(card.ref, change), target: 'priority', dest: destinationOf(change), priority: change };
}
