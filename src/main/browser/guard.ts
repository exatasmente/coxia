import type { AgentDef } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import { agentHosts } from '../../shared/network';
import { isTestWorkspace } from '../workspace';

// A test workspace never reaches the world (`rules/test-workspace.md`), and what an agent can do on a site is the world. A sandbox with network and a host session are
// not stopped by the old guard, which only covers what the app itself writes; so what this feature adds is held here: the agent's own hosts, the persistent profile, and the
// app's browser for an agent that runs on the computer (it would use the person's network). A sandbox with the workspace's own network, a QA stage's display, the app's
// browser with no hosts, and the confirmation tool work as in any workspace. The check fails closed: an unreadable registry counts as a test workspace.

export type Withheld = 'hosts' | 'profile' | 'hostBrowser';

export interface ScreenGrants {
  /** The hosts the agent's sandbox may reach on top of the workspace's own network. */
  allowedHosts: string[];
  /** Whether the app's browser starts on the agent's logged-in profile (otherwise a fresh one). */
  profile: boolean;
  /** Whether the agent gets the app's browser at all. */
  browser: boolean;
  /** What the agent asked for and the workspace refused, to be said in the thread. */
  withheld: Withheld[];
}

type GrantInput = Pick<AgentDef, 'screen' | 'allowedHosts' | 'browserProfile' | 'shell'>;

/** What of the agent's three switches a workspace lets through. Pure: `test` is whether the workspace is a test workspace. */
export function screenGrants(agent: GrantInput, test: boolean): ScreenGrants {
  const own = agentHosts(agent);
  // The list does nothing for an agent on the computer: the person's network is its network.
  const listApplies = agent.shell !== 'host' && own.length > 0;
  const profileAsked = agent.browserProfile === true;
  const browserAsked = agent.screen === true;
  const hostBrowser = test && browserAsked && agent.shell === 'host';
  const withheld: Withheld[] = [];
  if (test && listApplies) withheld.push('hosts');
  if (test && profileAsked) withheld.push('profile');
  if (hostBrowser) withheld.push('hostBrowser');
  return { allowedHosts: test ? [] : agent.allowedHosts ?? [], profile: profileAsked && !test, browser: browserAsked && !hostBrowser, withheld };
}

/** The same, for the workspace that is running. */
export const grantsFor = (agent: GrantInput): ScreenGrants => screenGrants(agent, isTestWorkspace());

/** What is withheld, in words, for the line the thread says. */
export const withheldText = (w: Withheld): string => t(`main.browser.withheld.${w}`);
