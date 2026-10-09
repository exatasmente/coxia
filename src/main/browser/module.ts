import { join } from 'node:path';
import type { WorkspaceConfig } from '../../shared/config/types';
import { ATAS, DATA_ROOT, HOME } from '../env';
import type { Module } from '../module';
import { sandbox } from '../sandbox/workspace';
import { getConfig, onConfigChange } from '../workspaceConfig';
import { BrowserStartError, startBrowser } from './launch';
import { profileLocks, sweepProfiles } from './profile';
import { resolveBrowsers } from './resolve';
import { listAudit } from '../auditoria';
import { candidateHosts, createSitesApi } from './sites';

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

/** A browser with no window and no network, on the profile folder it is given: what listing or clearing the sites of a profile is done with. */
async function launchForSites(profile: string): ReturnType<typeof startBrowser> {
  const config = getConfig().runner.sandbox;
  const st = await sandbox.status(false);
  if (!st.available) throw new BrowserStartError('server', 'no sandbox');
  const found = resolveBrowsers(config, HOME, [DATA_ROOT]);
  if (!found.ok) throw new BrowserStartError('server', `no browser: ${found.why}`);
  return startBrowser({ dir: join(ATAS, 'sandbox'), config, network: { mode: 'off', hosts: [] }, profile, display: null, headless: true, browsers: found.browsers, chromium: found.chromium, seesImages: false });
}

export const browserModule: Module = (ctx) => {
  // Settings lists the sites an agent's logged-in browser holds and revokes them. Both are the computer's own: a pattern over `screen:` keeps a paired browser out of them.
  const api = createSitesApi({
    agents: () => getConfig().agents.team.map((a) => a.id),
    workspaceDir: () => ATAS,
    launch: launchForSites,
    locks: profileLocks,
    // A site that keeps a login in local storage alone has no cookie to name it: the hosts the agent may reach and reached before are asked about as well.
    candidates: (agent) => candidateHosts(getConfig().agents.team.find((a) => a.id === agent)?.allowedHosts, listAudit().filter((e) => e.kind === 'screen-close' && e.by === agent)),
  });
  ctx.handle('screen:sites', (agent: string) => api.sites(agent));
  ctx.handle('screen:revoke', (agent: string, site?: string) => api.revoke(agent, site));
  syncProfiles();
  onConfigChange((config) => void syncProfiles(config));
  // A profile held by a screen while its agent was removed is left until the screen lets it go.
  profileLocks.onRelease(() => void syncProfiles());
};
