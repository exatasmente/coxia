import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginConfig, PluginGrant, PluginsConfig } from '../../shared/config/types';
import { readPluginDeclaration } from '../../shared/plugins/declaration';
import type { PluginRecord, PluginView } from './types';

// Reads the plugins folder of a workspace. Pure enough to test with a throwaway folder: it opens files and reads them, and touches
// nothing else. What a declaration says is judged by shared/plugins/declaration.ts; here the folder is walked and the person's
// choices (which ones are on and what each may reach) are applied to what was read.
//
// A plugin whose declaration is refused does not stop the app from opening: it comes back in the list with the reason and offers
// nothing. A folder that cannot be read at all is a refusal of the whole read, not a crash.

export const PLUGIN_FILE = 'plugin.json';
export const DEFAULT_PLUGINS_DIR = 'plugins';

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Whether a path is a folder whose real path is itself (no link): a plugin folder must not be a link out of the tree. */
function realFolder(path: string): boolean {
  try {
    if (!lstatSync(path).isDirectory()) return false;
    return realpathSync(path) === path;
  } catch {
    return false;
  }
}

/** The choices as the config stored them, keyed by identity. */
function choicesOf(config: PluginsConfig): Map<string, PluginConfig> {
  const out = new Map<string, PluginConfig>();
  for (const p of config.list ?? []) {
    if (p && typeof p.id === 'string') out.set(p.id, { id: p.id, folder: p.folder ?? null, enabled: p.enabled !== false, network: p.network ?? [], granted: (p.granted ?? 'none') as PluginGrant, refused: p.refused ?? null });
  }
  return out;
}

/** Refuses a folder-wide read with a reason the person reads. */
function refusedRecord(folder: string, reason: string): PluginRecord {
  return { id: '', name: folder, dir: folder, enabled: false, granted: 'none', documents: [], events: [], network: [], write: null, entry: null, refused: reason };
}

/**
 * Reads every plugin under `dir`. Returns one record per plugin, in the order the folders are listed. A plugin the person turned off
 * still comes back, with `enabled: false` and nothing offered. A declaration refused comes back with its reason. A folder that
 * cannot be read returns a single record carrying the reason.
 */
export function readPlugins(dir: string, config: PluginsConfig): PluginRecord[] {
  const choices = choicesOf(config);
  let entries: string[];
  try {
    if (!existsSync(dir)) return [];
    entries = readdirSync(dir).sort();
  } catch (e) {
    return [refusedRecord(dir, e instanceof Error ? e.message : String(e))];
  }

  const out: PluginRecord[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const folder = join(dir, entry);
    if (!realFolder(folder)) continue;
    const file = join(folder, PLUGIN_FILE);
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      out.push({ ...refusedRecord(folder, e instanceof Error ? e.message : String(e)), id: entry });
      continue;
    }
    const reading = readPluginDeclaration(text, folder);
    if (!reading.declaration) {
      out.push({ ...refusedRecord(folder, reading.refused ?? ''), id: entry });
      continue;
    }
    const d = reading.declaration;
    if (seen.has(d.id)) {
      out.push({ ...refusedRecord(folder, `duplicate plugin identity "${d.id}"`), id: d.id });
      continue;
    }
    seen.add(d.id);
    const choice = choices.get(d.id);
    out.push({
      id: d.id,
      name: d.name,
      dir: folder,
      enabled: choice?.enabled ?? false,
      granted: choice?.granted ?? 'none',
      documents: d.offers.documents,
      events: [...d.offers.events],
      network: d.offers.network,
      write: d.offers.write,
      entry: d.offers.entry,
      refused: null,
    });
  }
  return out;
}

/** Resolves the plugins folder of a workspace: what the config lists (with "~/" expanded), or the default under the data folder. */
export function pluginsDirOf(config: PluginsConfig, home: string, dataDir: string): string {
  const raw = config.dir?.trim();
  if (!raw) return join(dataDir, DEFAULT_PLUGINS_DIR);
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
  return resolve(expanded);
}

/** The list the person sees: name, what it offers, what it may reach and whether it is on. */
export function pluginViews(records: PluginRecord[]): PluginView[] {
  return records.map((r) => ({
    id: r.id,
    name: r.name,
    folder: r.dir,
    enabled: r.enabled && !r.refused,
    events: r.events,
    documents: r.documents,
    network: r.network,
    granted: r.granted,
    refused: r.refused,
  }));
}

/** What the config must hold for the plugins read to keep being the same: the read plugin with the person's choice on it, by identity. */
export function choicesFor(records: PluginRecord[], config: PluginsConfig): PluginConfig[] {
  const previous = choicesOf(config);
  return records
    .filter((r) => r.id && !r.refused)
    .map((r) => {
      const before = previous.get(r.id);
      return {
        id: r.id,
        folder: r.dir,
        enabled: before?.enabled ?? false,
        network: r.network,
        granted: before?.granted ?? 'none',
        refused: r.refused,
      } satisfies PluginConfig;
    });
}

export type { PluginRecord, PluginView };
export { asObject };
