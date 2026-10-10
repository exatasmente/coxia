import type { AgentDef, RunnerSandbox } from './config/types';
import { isRegistryHost } from './sandboxPaths';

// The network an agent's sandbox has: the workspace's setting (`runner.sandbox.network`) met by the agent's own list of hosts (`allowedHosts`). Pure, so the sandbox, the
// app's browser and the tests read the same table.

export type NetworkMode = 'off' | 'proxy' | 'open';

export interface EffectiveNetwork {
  /** `off`: no network. `proxy`: only HTTPS (443) to `hosts`, through the app's filtering proxy. `open`: the computer's own network, whole. */
  mode: NetworkMode;
  /** The exact names the proxy lets through (lowercase, once each); empty unless `mode` is `proxy`. */
  hosts: string[];
}

/** The agent's list as the proxy takes it: lowercase, once each, and only what a host name can be (validation already refused the rest; a file edited by hand never widens this). */
export function agentHosts(agent?: Pick<AgentDef, 'allowedHosts'>): string[] {
  return [...new Set((agent?.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(isRegistryHost))];
}

/**
 * What an agent's sandbox reaches:
 * - no list of its own: the workspace's setting as it is (`off`, `registry` with the registry hosts, `open`);
 * - `off` + a list: the proxy with exactly the agent's hosts;
 * - `registry` + a list: the proxy with the registry hosts and the agent's;
 * - `open` + a list: the proxy with only the agent's hosts, because the person chose a list for this agent (the list narrows, it never widens).
 * An agent on `shell: host` has no sandbox and does not come here: the computer's own network is its network.
 */
export function effectiveNetwork(workspace: Pick<RunnerSandbox, 'network' | 'registryHosts'>, agent?: Pick<AgentDef, 'allowedHosts'>): EffectiveNetwork {
  const own = agentHosts(agent);
  if (!own.length) {
    if (workspace.network === 'open') return { mode: 'open', hosts: [] };
    if (workspace.network === 'registry') return { mode: 'proxy', hosts: [...new Set(workspace.registryHosts.map((h) => h.toLowerCase()))] };
    return { mode: 'off', hosts: [] };
  }
  const base = workspace.network === 'registry' ? workspace.registryHosts.map((h) => h.toLowerCase()) : [];
  return { mode: 'proxy', hosts: [...new Set([...base, ...own])] };
}
