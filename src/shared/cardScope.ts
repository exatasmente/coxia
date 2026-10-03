import { CARD_SCOPES, type CardScope, type VcsKind } from './config/types';
import { VCS_CAPS } from './vcsCaps';

// What a stored "which issues become cards" choice really does. The card source, the configuration warnings and the wizard note all ask
// here, so what is said on screen and what is read from the host cannot disagree.

/** Why the stored choice is not the one applied; null when it is applied as stored. */
export type CardScopeFallback = 'noProject' | 'noLabels' | 'noLabelSupport';

export interface EffectiveCardScope {
  scope: CardScope;
  /** The labels to ask for, cleaned; empty unless the scope is `labels`. */
  labels: string[];
  fallback: CardScopeFallback | null;
}

export interface CardScopeInput {
  scope: CardScope;
  labels: readonly string[];
  /** The issue project the cards are read from; null or blank when the workspace has none. */
  project: string | null;
  /** The host of the integration that holds the issues; null when there is none. */
  kind: VcsKind | null;
}

/** Trimmed, non-blank, and without a name that only differs in case from an earlier one (the hosts match labels case-insensitively). */
export function cleanLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label && !seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      out.push(label);
    }
  }
  return out;
}

// Anything the choice cannot be honoured with becomes "assigned to me", never "all": a filter that cannot work must not widen the day.
export function effectiveCardScope(i: CardScopeInput): EffectiveCardScope {
  const assigned = (fallback: CardScopeFallback | null): EffectiveCardScope => ({ scope: 'assigned', labels: [], fallback });
  if (i.scope === 'assigned') return assigned(null);
  if (!i.project?.trim()) return assigned('noProject');
  if (i.scope === 'all') return { scope: 'all', labels: [], fallback: null };
  if (i.kind !== null && !VCS_CAPS[i.kind].issueLabels) return assigned('noLabelSupport');
  const labels = cleanLabels(i.labels);
  return labels.length ? { scope: 'labels', labels, fallback: null } : assigned('noLabels');
}

/** The labels field of the wizard: names separated by commas; quotes and backslashes (which the configuration refuses) are dropped as they are typed. */
export function parseLabelsField(text: string): string[] {
  // The schema keeps at most 10 labels of 100 characters: what is typed past that is cut here, not refused on save.
  return cleanLabels(text.replace(/["\\\u0000-\u001f]/g, '').split(',').map((l) => l.trim().slice(0, 100)))
    .slice(0, 10);
}

/** The scopes the wizard offers for the tracker of this integration; a `labels` already stored stays listed so the choice is not hidden from its owner. */
export function scopesOffered(kind: VcsKind | null, current: CardScope): CardScope[] {
  return CARD_SCOPES.filter((s) => s !== 'labels' || current === 'labels' || kind === null || VCS_CAPS[kind].issueLabels);
}
