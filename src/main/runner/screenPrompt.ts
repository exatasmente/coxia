import type { AgentDef, RunnerSandbox } from '../../shared/config/types';
import { effectiveNetwork } from '../../shared/network';
import { t } from '../../shared/i18n';
import { prompt as cp } from '../cyclePrompts';

// What an agent is told about its screen, its hosts and its browser (rule 45 of #177): the facts of this call, read from the agent's settings and from what the screen sessions
// said, and the words for them. An agent with none of the switches (no screen, no host list) has no `ScreenPrompt` at all, and its prompt is what it was, byte for byte.

export interface ScreenPrompt {
  /** The agent has the virtual-screen switch. */
  screen: boolean;
  /** The app's browser is there for this call (its tools, and the state of the logged-in profile), or why it is not. */
  browser: { ok: true; tools: string[]; profile: 'own' | 'busy' | 'none' } | { ok: false; reason: string };
  /** The hosts the person allowed for this agent, as the proxy takes them; empty for an agent on the computer, where a list does nothing. */
  ownHosts: string[];
  /** What the agent's network is: nothing, a proxy to these hosts (the workspace's and the agent's), or the computer's own. */
  network: { mode: 'off' } | { mode: 'proxy'; hosts: string[] } | { mode: 'open' };
  /** The agent's shell session has a display, the one the app's browser draws on. */
  display: boolean;
  /** The confirmation tool is offered. */
  confirm: boolean;
}

/** The fact of the agent's network, from the workspace's setting and the agent's own hosts (the table of rule 25). */
export function networkFor(workspace: Pick<RunnerSandbox, 'network' | 'registryHosts'>, agent: Pick<AgentDef, 'shell'>, allowedHosts: string[]): ScreenPrompt['network'] {
  if (agent.shell === 'host') return { mode: 'open' };
  const net = effectiveNetwork(workspace, { allowedHosts });
  return net.mode === 'proxy' ? { mode: 'proxy', hosts: net.hosts } : net.mode === 'open' ? { mode: 'open' } : { mode: 'off' };
}

/** The text an agent reads of why it has no browser. */
export function refusalText(why: string, detail?: string): string {
  switch (why) {
    case 'platform':
    case 'disabled':
    case 'withheld':
    case 'cap':
    case 'closing':
      return t(`main.browser.noBrowser.${why}`);
    case 'in-use':
      return t('main.browser.noBrowser.inUse');
    case 'no-browsers':
      return t(`main.browser.noBrowser.${detail === 'unset' || detail === 'missing' || detail === 'refused' || detail === 'none' ? detail : 'none'}`);
    case 'no-sandbox':
      return t('main.browser.noBrowser.noSandbox');
    case 'start-failed':
      return t(`main.browser.start.${detail === 'folder' || detail === 'proxy' || detail === 'display' || detail === 'contract' ? detail : 'server'}`);
    default:
      return t('main.browser.noBrowser.unavailable');
  }
}

/**
 * The facts, or none when the agent has neither the screen switch nor a host list that applies to it (then nothing is added to its prompt).
 * `screen` is what the call got of the sessions: a lease (with the state of its profile), or the reason it did not.
 */
export function screenPromptOf(o: {
  agent: Pick<AgentDef, 'screen' | 'shell' | 'browserProfile'>;
  workspace: Pick<RunnerSandbox, 'network' | 'registryHosts'>;
  /** The hosts the workspace let through for the agent (none in a test workspace). */
  allowedHosts: string[];
  /** What the call got: a browser, or the reason there is none; null when nothing asked for one. */
  browser: { tools: string[]; profile: 'own' | 'fresh' | 'none' } | { refusal: string } | null;
  display: boolean;
  confirm: boolean;
}): ScreenPrompt | undefined {
  const ownHosts = o.agent.shell === 'host' ? [] : o.allowedHosts;
  if (o.agent.screen !== true && ownHosts.length === 0) return undefined;
  const browser: ScreenPrompt['browser'] =
    o.browser && 'tools' in o.browser
      ? { ok: true, tools: o.browser.tools, profile: o.browser.profile === 'own' ? 'own' : o.agent.browserProfile === true ? 'busy' : 'none' }
      : { ok: false, reason: o.browser && 'refusal' in o.browser ? o.browser.refusal : refusalText('unavailable') };
  return { screen: o.agent.screen === true, browser, ownHosts, network: networkFor(o.workspace, o.agent, ownHosts), display: o.display, confirm: o.confirm };
}

/** The sentence that says which shell the agent has, in the words of its network: the plain ones, or the one that lists the agent's own hosts. */
export function shellRules(s: { host?: boolean; network: 'off' | 'registry' | 'open' }, screen?: ScreenPrompt): string {
  if (s.host) return cp('runner.rules.shell.host');
  if (screen && screen.ownHosts.length > 0 && screen.network.mode === 'proxy') return cp('runner.rules.shell.hosts', { hosts: screen.network.hosts.join(', ') });
  return s.network === 'open' ? cp('runner.rules.shell.open') : s.network === 'registry' ? cp('runner.rules.shell.registry') : cp('runner.rules.shell');
}

/** The part of the prompt about the app's browser, the hosts it may reach and the confirmation tool; empty for an agent with none of the switches. */
export function screenRules(p?: ScreenPrompt): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.screen) {
    if (p.browser.ok) {
      parts.push(cp('runner.rules.screen', { tools: p.browser.tools.join(', ') }));
      parts.push(p.network.mode === 'open' ? cp('runner.rules.screen.open') : p.network.mode === 'proxy' ? cp('runner.rules.screen.hosts', { hosts: p.network.hosts.join(', ') }) : cp('runner.rules.screen.noHosts'));
      parts.push(p.browser.profile === 'own' ? cp('runner.rules.screen.profile.own') : p.browser.profile === 'busy' ? cp('runner.rules.screen.profile.busy') : cp('runner.rules.screen.profile.none'));
      if (p.display) parts.push(cp('runner.rules.screen.display'));
    } else {
      parts.push(cp('runner.rules.screen.noBrowser', { reason: p.browser.reason }));
    }
  }
  if (p.confirm) parts.push(cp('runner.rules.screen.confirm'));
  return parts.join(' ');
}
