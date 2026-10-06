import type { PluginConfig, PluginGrant } from '../../shared/config/types';

// The plugins of the workspace, as a service reads them from disk. The declaration itself is handled by shared/plugins
// (a pure function); this is the reading of the folder plus what the person decided about each plugin.

/** What the app knows of one plugin. */
export interface PluginRecord {
  /** Stable identity the declaration announces. */
  id: string;
  name: string;
  /** Absolute folder of the plugin. */
  dir: string;
  /** Whether the person switched it on. */
  enabled: boolean;
  /** What the person granted it. */
  granted: PluginGrant;
  /** Document types it adds to the cycle folder. */
  documents: { name: string; label: string }[];
  /** Events of the fixed catalog it observes. */
  events: string[];
  /** Host names it declares it needs from the network. */
  network: string[];
  /** Neutral destination of the external write of its example, or null. */
  write: string | null;
  /** Entry script relative to the plugin folder, or null. */
  entry: string | null;
  /** Why the declaration was refused, in words; null when the plugin is usable. */
  refused: string | null;
}

/** The list the person sees: what each plugin offers, what it may reach and whether it is on. */
export interface PluginView {
  id: string;
  name: string;
  folder: string;
  enabled: boolean;
  events: string[];
  documents: { name: string; label: string }[];
  network: string[];
  granted: PluginGrant;
  refused: string | null;
}

/** What leaves the app when a plugin runs: which plugin, and the text it returned. */
export interface PluginRunResult {
  plugin: string;
  ok: boolean;
  /** Text the plugin returned, masked; empty when it failed or returned nothing. */
  text: string;
  /** Why it failed, in words; null when it ran. */
  refused: string | null;
}

export type { PluginConfig, PluginGrant };
