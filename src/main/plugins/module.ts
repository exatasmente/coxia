import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginConfig, PluginsConfig, PluginGrant } from '../../shared/config/types';
import type { PluginEvent } from '../../shared/plugins/events';
import { t } from '../../shared/i18n';
import { ATAS, HOME } from '../env';
import type { Module, ModuleContext } from '../module';
import { runStore } from '../runs';
import { sandbox } from '../sandbox/workspace';
import { getConfig, rc, updateConfig } from '../workspaceConfig';
import { proposePluginWrite } from '../actions';
import { gatePluginDocuments } from '../gate';
import { choicesFor, pluginsDirOf, pluginViews, readPlugins } from './read';
import { runPlugin, type PluginRun } from './runtime';
import type { PluginRecord, PluginView } from './types';

// The plugins of the running workspace: the folder is read at the moment of use, the list is published for the interface, and the
// person switches a plugin on or off on the computer. Nothing is remembered at start-up, so switching a plugin off is in force from
// the next thing that uses the capability, with no restart. A plugin never gets a way to write for itself: what it asks for comes in
// through the same door as everything else (Actions), waits for a "sim" and lands in the audit log.

export interface PluginsDeps {
  /** The workspace's plugins section. */
  config(): PluginsConfig;
  /** Reads the folder and returns one record per plugin. */
  read(config: PluginsConfig): PluginRecord[];
  /** The worktree a plugin runs inside; the runner's own, so a plugin sees what a stage sees and nothing more. */
  worktree(): string;
  /** Runs one plugin's entry script inside the stage sandbox. */
  run(plugin: PluginRecord, event: PluginEvent): Promise<PluginRun>;
  /** Saves the list of this workspace's plugins, with the person's choices on it. */
  save(list: PluginConfig[]): void;
}

const pluginConfig = (): PluginsConfig => getConfig().plugins ?? { dir: null, list: [] };

const worktreeOf = (): string => {
  const runs = runStore().list().filter((r) => existsSync(r.worktree));
  return runs[0]?.worktree ?? rc().projectsRoot ?? ATAS;
};

export const pluginsDeps: PluginsDeps = {
  config: pluginConfig,
  read: (config) => readPlugins(pluginsDirOf(config, HOME, ATAS), config),
  worktree: worktreeOf,
  run: (plugin, event) =>
    runPlugin({ sandbox, config: () => getConfig().runner.sandbox, worktree: worktreeOf }, { id: plugin.id, entry: plugin.entry ? join(plugin.dir, plugin.entry) : '' }, event),
  save: (list) => updateConfig((c) => ({ ...c, plugins: { ...c.plugins, list } })),
};

/** The list the interface shows: name, what each plugin offers, what it may reach and whether it is on. */
export const listPlugins = (d: PluginsDeps = pluginsDeps): PluginView[] => pluginViews(d.read(d.config()));

/** Turns a plugin on or off. The choice is the person's, on the computer; only the stored list of the workspace changes. */
export function setPluginEnabled(id: string, enabled: boolean, d: PluginsDeps = pluginsDeps): PluginView[] {
  const records = d.read(d.config());
  const list = choicesFor(records, d.config());
  if (!list.some((c) => c.id === id)) throw new Error(t('main.plugins.unknown', { id }));
  d.save(list.map((c) => (c.id === id ? { ...c, enabled } : c)));
  return pluginViews(d.read(d.config()));
}

/** Grants or takes back what a plugin may reach. Only the computer decides; a paired browser cannot call this. */
export function setPluginGrant(id: string, granted: PluginGrant, d: PluginsDeps = pluginsDeps): PluginView[] {
  const records = d.read(d.config());
  const list = choicesFor(records, d.config());
  if (!list.some((c) => c.id === id)) throw new Error(t('main.plugins.unknown', { id }));
  d.save(list.map((c) => (c.id === id ? { ...c, granted } : c)));
  return pluginViews(d.read(d.config()));
}

/**
 * Calls every enabled plugin that observes `event`, inside the stage sandbox, and returns what each answered. A plugin that fails
 * does not stop the rest nor the app: the reason comes back. A plugin whose declaration was refused, or that the person turned off,
 * is never called.
 */
export async function firePluginEvent(event: PluginEvent, context: { issue: number; issueTitle?: string; stage?: string }, d: PluginsDeps = pluginsDeps): Promise<PluginRun[]> {
  const records = d.read(d.config()).filter((r) => r.enabled && !r.refused && r.events.includes(event));
  const out: PluginRun[] = [];
  for (const plugin of records) {
    const result = await d.run(plugin, event);
    out.push(result);
    // What the plugin asked to write for goes through the single door, not through a write of its own: it waits for a "sim".
    if (result.ok && plugin.write && result.text.trim()) {
      proposePluginWrite({
        key: `plugin-write:${plugin.id}:${context.issue}:${event}`,
        issue: context.issue,
        issueTitle: context.issueTitle,
        summary: t('main.plugins.writeSummary', { plugin: plugin.name }),
        plugin: plugin.id,
        destination: plugin.write,
        detail: result.text,
      });
    }
  }
  return out;
}

export const pluginsModule: Module = (ctx: ModuleContext) => {
  ctx.handle('plugins:list', () => listPlugins());
  // Only the computer switches a plugin on or off: these two are desktop-only (webPolicy.ts), like the other boundary decisions.
  ctx.handle('plugins:set-enabled', (id: string, enabled: boolean) => setPluginEnabled(id, !!enabled));
  ctx.handle('plugins:set-grant', (id: string, granted: PluginGrant) => setPluginGrant(id, granted));
  // The document types the plugins that are on add enter the list the gate already walks: read at the moment of use, so switching a plugin off retires them.
  const source = gatePluginDocuments;
  source.files = () => pluginsDeps.read(pluginsDeps.config()).filter((r) => r.enabled && !r.refused).flatMap((r) => r.documents.map((d): [string, string] => [d.name, d.label]));
};
