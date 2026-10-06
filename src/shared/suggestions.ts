import type { ReleaseAction } from './types';

// What the suggestion card carries: enough to accept (create the agent), edit (open the editor filled in) or reject (record the reason)
// without reading the workspace history again. It travels with the proposal's `unit` in the action, beside the id of the proposal.

/** The suggestion as the Actions card holds it: name, role, the stage it would cover, the draft prompt and the evidence behind it. */
export interface SuggestionProposal {
  /** The card's stable id: the same between the proposal and the decision in the record. */
  suggestionId: string;
  name: string;
  role: string;
  stage: string;
  /** The draft prompt the agent would start with. */
  prompt: string;
  /** The evidence, already written as lines a person reads. */
  evidence: string;
  /** Set when an impression of this suggestion was rejected before and the evidence changed since. */
  rejectedBefore?: { at: string; changed: string[] } | null;
}

/** How many suggestions the end of a retro may raise on its own. */
export const SUGGEST_PER_RETRO = 2;

/** The decision a suggestion waits for, from the card: accepted creates the agent, edited came from the editor, rejected keeps the reason. */
export type SuggestionDecisionKind = 'accepted' | 'edited' | 'rejected';

/** The suggestion a proposal of `kind: 'suggest-agent'` carries, or null for any other action. */
export function suggestionOf(a: Pick<ReleaseAction, 'kind' | 'unit'>): SuggestionProposal | null {
  if (a.kind !== 'suggest-agent') return null;
  const u = a.unit ?? {};
  if (typeof u.suggestionId !== 'string') return null;
  return {
    suggestionId: u.suggestionId,
    name: typeof u.name === 'string' ? u.name : '',
    role: typeof u.role === 'string' ? u.role : '',
    stage: typeof u.stage === 'string' ? u.stage : '',
    prompt: typeof u.prompt === 'string' ? u.prompt : '',
    evidence: typeof u.evidence === 'string' ? u.evidence : '',
    rejectedBefore: (u.rejectedBefore as { at: string; changed: string[] } | null) ?? null,
  };
}

export type { ReleaseAction };
