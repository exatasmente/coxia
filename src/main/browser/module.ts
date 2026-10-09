import { join } from 'node:path';
import type { WorkspaceConfig } from '../../shared/config/types';
import { ATAS, DATA_ROOT, HOME } from '../env';
import type { Module } from '../module';
import { sandbox } from '../sandbox/workspace';
import { configLoadedCleanly, getConfig, onConfigChange } from '../workspaceConfig';
import { BrowserStartError, startBrowser } from './launch';
import { deleteProfile, profileDirOf, profileLocks, sweepProfiles } from './profile';
import { resolveBrowsers } from './resolve';
import { listAudit } from '../auditoria';
import { candidateHosts, createSitesApi } from './sites';

// The app's browser, as far as the app's start-up and the config reach it: the logged-in profiles of the agents that are gone are deleted, at the start, when the config
// drops an agent (the editor, an import, a template) and when a screen that was holding one lets it go. The browser itself is started where a screen is opened.
// A config that did not load as written (an unreadable or invalid file) never decides what to delete: its team is the repair's, not the person's.

const agentIds = (config: WorkspaceConfig): string[] => config.agents.team.map((a) => a.id);

/**
 * Deletes the profile of every agent that is not in the config, for the running workspace. A new agent with the id of a removed one never inherits its cookies. Never
 * throws: a profile that cannot be deleted is said and tried again at the next start. Without a config given, it does nothing when the running one is a repaired one.
 */
export function syncProfiles(config?: WorkspaceConfig): string[] {
  try {
    if (!config && !configLoadedCleanly()) {
      console.error('[browser] the config did not load as written: the profiles are left alone');
      return [];
    }
    const { removed } = sweepProfiles(ATAS, agentIds(config ?? getConfig()));
    return removed;
  } catch (e) {
    console.error('[browser] could not sweep the profiles', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Deletes the profiles of these agents, and returns the ones a screen holds: those are tried again when the screen lets go. */
function dropProfiles(ids: string[]): string[] {
  const held: string[] = [];
  for (const id of ids) {
    try {
      const dir = profileDirOf(ATAS, id);
      if (profileLocks.holder(dir) !== null) held.push(id);
      else deleteProfile(ATAS, id);
    } catch (e) {
      console.error('[browser] could not delete a profile', e instanceof Error ? e.message : e);
    }
  }
  return held;
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

// What the last start subscribed to: a second start (a test, a reload) replaces it instead of adding another.
let unsubscribe: (() => void)[] = [];

export const browserModule: Module = (ctx) => {
  for (const off of unsubscribe) off();
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
  // Only the agents the config dropped lose their profile: a change never sweeps the folder against a team that may be a repair.
  let known = new Set(agentIds(getConfig()));
  const pending = new Set<string>();
  const offChange = onConfigChange((config) => {
    const next = new Set(agentIds(config));
    for (const id of dropProfiles([...known].filter((x) => !next.has(x)))) pending.add(id);
    for (const id of next) pending.delete(id);
    known = next;
  });
  // A profile held by a screen while its agent was removed is left until the screen lets it go.
  const offRelease = profileLocks.onRelease(() => {
    const still = dropProfiles([...pending]);
    pending.clear();
    for (const id of still) pending.add(id);
  });
  unsubscribe = [offChange, offRelease];
};
