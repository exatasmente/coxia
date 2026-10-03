// How another screen asks Settings to open one of the team and cycle sections: `openTeamSettings('flow', squadId)` and then go to the Settings screen.
// The request waits here until the section is on screen (or is delivered at once when it already is).

export const TEAM_TABS = ['team', 'squads', 'flow', 'comments', 'runner'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export interface TeamRequest {
  tab: TeamTab;
  /** For the flow tab: the squad whose flow to edit; absent: the workspace's flow. */
  squad?: string;
}

const events = new EventTarget();
let pending: TeamRequest | null = null;

export function openTeamSettings(tab: TeamTab, squad?: string): void {
  pending = { tab, ...(squad ? { squad } : {}) };
  events.dispatchEvent(new Event('request'));
}

/** The request nobody has taken yet, once. */
export function takeTeamRequest(): TeamRequest | null {
  const r = pending;
  pending = null;
  return r;
}

export function onTeamRequest(fn: () => void): () => void {
  events.addEventListener('request', fn);
  return () => events.removeEventListener('request', fn);
}
