import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { PluginAllow, PluginConfig, PluginsConfig } from '../../shared/config/types';
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

const NONE: PluginAllow = { network: false, write: false };

/** What the person allowed, read leniently: anything but `true` is not allowed. */
export const allowOf = (raw: unknown): PluginAllow => {
  const o = asObject(raw);
  return { network: o?.network === true, write: o?.write === true };
};

/** The values of the plain settings, read leniently: only string values. */
export const settingsOf = (raw: unknown): Record<string, string> => {
  const o = asObject(raw);
  return o ? Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
};

/** A digest of everything a declaration says it reaches: its hosts, its requests (method, address, where a secret goes, read or write) and its write. */
export function reachOf(offers: { network: string[]; requests: PluginRecord['requests']; write: PluginRecord['write'] }): string {
  const requests = offers.requests.map((r) => [r.id, r.method, r.url, r.secret ? [r.secret.setting, r.secret.in, r.secret.name, r.secret.format] : null, r.write, r.reversible]);
  return createHash('sha256').update(JSON.stringify([[...offers.network].sort(), requests, offers.write])).digest('hex').slice(0, 32);
}

/** The choices as the config stored them, keyed by identity. The config keeps only the person's decision: everything else is read again from the folder. */
function choicesOf(config: PluginsConfig): Map<string, PluginConfig> {
  const out = new Map<string, PluginConfig>();
  for (const p of config.list ?? []) {
    if (p && typeof p.id === 'string') out.set(p.id, { id: p.id, folder: p.folder ?? null, enabled: p.enabled === true, allow: allowOf(p.allow), ...(typeof p.allowedFor === 'string' ? { allowedFor: p.allowedFor } : {}), settings: settingsOf(p.settings) });
  }
  return out;
}

/** Refuses a folder-wide read with a reason the person reads. */
function refusedRecord(folder: string, reason: string): PluginRecord {
  return { id: '', name: folder, dir: folder, enabled: false, allow: NONE, documents: [], events: [], network: [], write: null, entry: null, runtime: 'shell', settings: [], values: {}, requests: [], agents: null, reach: '', refused: reason };
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
    const reach = reachOf(d.offers);
    out.push({
      id: d.id,
      name: d.name,
      dir: folder,
      enabled: choice?.enabled ?? false,
      // "Always" was given for what the plugin declared then; a declaration that reaches somewhere else is asked again.
      allow: choice && choice.allowedFor === reach ? choice.allow : NONE,
      documents: d.offers.documents,
      events: [...d.offers.events],
      network: d.offers.network,
      write: d.offers.write,
      entry: d.offers.entry,
      runtime: d.offers.runtime,
      settings: d.offers.settings,
      values: choice?.settings ?? {},
      requests: d.offers.requests,
      agents: d.offers.agents,
      reach,
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

/** The list the person sees: name, what it offers, what it asks for, what it was allowed and whether it is on. */
export function pluginViews(records: PluginRecord[], session: (id: string) => PluginAllow, waiting: (id: string) => number, secretFilled: (id: string, key: string) => boolean = () => false): PluginView[] {
  return records.map((r) => ({
    id: r.id,
    name: r.name,
    folder: r.dir,
    enabled: r.enabled && !r.refused,
    events: r.events,
    documents: r.documents,
    network: r.network,
    write: r.write,
    allow: r.allow,
    session: session(r.id),
    settings: r.settings.map((x) => ({ ...x, value: x.kind === 'secret' ? null : (r.values[x.key] ?? ''), filled: x.kind === 'secret' ? secretFilled(r.id, x.key) : !!r.values[x.key]?.trim(), goesTo: x.kind === 'secret' ? r.requests.filter((q) => q.secret?.setting === x.key).map((q) => `${q.method} ${q.url}`) : [] })),
    requests: r.requests.map(({ id, method, url, write, reversible }) => ({ id, method, url, write, reversible })),
    agents: r.agents,
    waiting: waiting(r.id),
    refused: r.refused,
  }));
}

/**
 * Changes what the person decided about one plugin and nothing else: the other entries stay as they are, a plugin the read did not find keeps its
 * entry (and what it was allowed), and the list is never rebuilt from what is on disk at that moment.
 */
export function withChoice(list: PluginConfig[], record: Pick<PluginRecord, 'id' | 'dir'>, change: (c: PluginConfig) => PluginConfig): PluginConfig[] {
  const before = list.find((c) => c.id === record.id) ?? { id: record.id, folder: record.dir, enabled: false, allow: NONE, settings: {} };
  const next = change({ ...before, folder: record.dir, allow: allowOf(before.allow), settings: settingsOf(before.settings) });
  return list.some((c) => c.id === record.id) ? list.map((c) => (c.id === record.id ? next : c)) : [...list, next];
}

export type { PluginRecord, PluginView };
