import type { PluginAllow, RunnerSandbox } from '../config/types';
import { t } from '../i18n';
import type { PluginWrite } from './declaration';
import { isPluginEvent } from './events';

// What the person allowed a plugin decides, and nothing else: whether the plugin runs with the network it declared, what the sandbox that runs it
// reaches, and whether the write it declared goes out, is announced with a deadline or becomes a request. Pure, so a test can pin every decision
// without a sandbox, a file or a process.
//
// A permission has three reaches. "always" is the workspace's (PluginAllow, in the configuration) and lasts until the person takes it back; "session"
// lives in the running app and ends when it closes; "once" is the answer to one request and covers that call only. An irreversible write takes no
// "once" and no "session": it may only be allowed always, and even then it is announced before it goes out.

/** What a plugin may ask the person for. */
export const PLUGIN_NEEDS = ['network', 'write'] as const;
export type PluginNeed = (typeof PLUGIN_NEEDS)[number];

/** How far a "yes" reaches, and the refusal. */
export const PLUGIN_ANSWERS = ['once', 'session', 'always', 'refuse'] as const;
export type PluginAnswer = (typeof PLUGIN_ANSWERS)[number];

/** Everything the app knows of what one plugin may do in one call. */
export interface PluginPermission {
  /** What the person allowed always. */
  allow: PluginAllow;
  /** What the person allowed for the session of the running app. */
  session: PluginAllow;
  /** What the answer being carried out allowed for this call only. */
  once?: Partial<PluginAllow>;
}

const allowed = (p: PluginPermission, need: PluginNeed): boolean => p.allow[need] || p.session[need] || p.once?.[need] === true;

/** Whether a plugin may run in this call as far as the network goes: one that declared no destination never needs a permission for it. */
export function mayReachNetwork(declared: string[], p: PluginPermission): boolean {
  return declared.length === 0 || allowed(p, 'network');
}

/**
 * The sandbox one plugin runs in: the workspace's own limits and folders, and a network of its own. Allowed, it reaches exactly the destinations it
 * declared — not the ones the workspace lets its stages reach, and nothing else. Not allowed, or nothing declared, it reaches nothing.
 */
export function pluginNetworkSandbox(workspace: RunnerSandbox, declared: string[], p: PluginPermission): RunnerSandbox {
  const hosts = [...new Set(declared.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (hosts.length && allowed(p, 'network')) return { ...workspace, network: 'registry', registryHosts: hosts };
  return { ...workspace, network: 'off', registryHosts: [] };
}

/**
 * What happens to the write a plugin declared, once it returned `text`:
 * - `none`: nothing to write (no write declared, or nothing returned);
 * - `go`: allowed and reversible, it goes out now through the single door;
 * - `announce`: allowed always and irreversible, it waits the workspace's deadline in Actions, where the person may block it or take the permission back;
 * - `ask`: not allowed, it becomes a request the person answers.
 */
export type PluginWriteStep = 'none' | 'go' | 'announce' | 'ask';

export function pluginWriteStep(write: PluginWrite | null, text: string, p: PluginPermission): PluginWriteStep {
  if (!write || !text.trim()) return 'none';
  if (!write.reversible) return p.allow.write ? 'announce' : 'ask';
  return allowed(p, 'write') ? 'go' : 'ask';
}

/** The answers a request offers: an irreversible write may only be added to the list of permissions, or refused. */
export function pluginAnswers(need: PluginNeed, reversible: boolean): PluginAnswer[] {
  return need === 'write' && !reversible ? ['always', 'refuse'] : [...PLUGIN_ANSWERS];
}

export const isPluginAnswer = (v: unknown): v is PluginAnswer => typeof v === 'string' && (PLUGIN_ANSWERS as readonly string[]).includes(v);
export const isPluginNeed = (v: unknown): v is PluginNeed => typeof v === 'string' && (PLUGIN_NEEDS as readonly string[]).includes(v);

/** The catalog key of each event a plugin may observe, for the line a document carries. */
const EVENT_LABEL: Record<string, string> = {
  'stage-entered': 'main.plugins.event.stageEntered',
  'stage-finished': 'main.plugins.event.stageFinished',
  'gate-decided': 'main.plugins.event.gateDecided',
  'run-finished': 'main.plugins.event.runFinished',
  'conversation-called': 'main.plugins.event.conversationCalled',
};

/**
 * The document a plugin's answer becomes, or null when there is nothing to write: the result as material, with the plugin it came from and the event
 * that called it. The text is never read as instruction.
 */
export function pluginDocumentText(input: { title: string; body: string; plugin: string; event: string }): string | null {
  const body = input.body.trim();
  if (!body) return null;
  const event = isPluginEvent(input.event) ? t(EVENT_LABEL[input.event]) : null;
  const lines = [`# ${input.title.trim()}`, '', `${t('main.plugins.document.plugin')}: ${input.plugin}`, ...(event ? [`${t('main.plugins.document.event')}: ${event}`] : []), '', body];
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
