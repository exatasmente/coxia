import type { WorkspaceConfig } from '../../shared/config/types';
import { ATAS } from '../env';
import type { Module } from '../module';
import { getConfig, onConfigChange } from '../workspaceConfig';
import { profileLocks, sweepProfiles } from './profile';

// The app's browser, as far as the app's start-up and the config reach it: the logged-in profiles of the agents that are gone are deleted, at the start, when the config
// drops an agent (the editor, an import, a template) and when a screen that was holding one lets it go. The browser itself is started where a screen is opened.

const agentIds = (config: WorkspaceConfig): string[] => config.agents.team.map((a) => a.id);

/**
 * Deletes the profile of every agent that is not in the config, for the running workspace. A new agent with the id of a removed one never inherits its cookies. Never
 * throws: a profile that cannot be deleted is said and tried again at the next start.
 */
export function syncProfiles(config: WorkspaceConfig = getConfig()): string[] {
  try {
    const { removed } = sweepProfiles(ATAS, agentIds(config));
    return removed;
  } catch (e) {
    console.error('[browser] could not sweep the profiles', e instanceof Error ? e.message : e);
    return [];
  }
}

export const browserModule: Module = () => {
  syncProfiles();
  onConfigChange((config) => void syncProfiles(config));
  // A profile held by a screen while its agent was removed is left until the screen lets it go.
  profileLocks.onRelease(() => void syncProfiles());
};
