// How another screen asks Settings to open one of the team and cycle sections: `openTeamSettings('flow', squadId)` and then go to the Settings screen.
// The request waits here until the section is on screen (or is delivered at once when it already is).

export const TEAM_TABS = ['team', 'squads', 'flow', 'comments', 'attachments', 'runner', 'testenv'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

import type { AgentDraft } from './agentEdit';

export interface TeamRequest {
  tab: TeamTab;
  /** For the flow tab: the squad whose flow to edit; absent: the workspace's flow. */
  squad?: string;
  /** For the team tab: an agent draft to open the editor with (a suggestion the person chose to edit), and the id it came from. */
  draft?: { draft: AgentDraft; suggestionId: string };
}

const events = new EventTarget();
let pending: TeamRequest | null = null;

export function openTeamSettings(tab: TeamTab, squad?: string): void {
  pending = { tab, ...(squad ? { squad } : {}) };
  events.dispatchEvent(new Event('request'));
}

/** Opens the team editor filled in with a suggestion: the person chose "edit" on the card in Actions. */
export function openAgentDraft(draft: AgentDraft, suggestionId: string): void {
  pending = { tab: 'team', draft: { draft, suggestionId } };
  events.dispatchEvent(new Event('request'));
}

/** The request nobody has taken yet, once. */
export function takeTeamRequest(): TeamRequest | null {
  const r = pending;
  pending = null;
  return r;
}

/** The tab, squad and draft the section holds after a request: the whole state of one request, so the two pieces of a draft cannot cancel each other. */
export function viewOfRequest(r: TeamRequest): { tab: TeamTab; squad: string | undefined; suggestion: { draft: AgentDraft; suggestionId: string } | undefined } {
  return { tab: r.tab, squad: r.squad, suggestion: r.draft };
}

export function onTeamRequest(fn: () => void): () => void {
  events.addEventListener('request', fn);
  return () => events.removeEventListener('request', fn);
}
