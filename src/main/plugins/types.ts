import type { PluginAllow, PluginConfig, PluginsConfig } from '../../shared/config/types';
import type { PluginRequestDecl, PluginSetting, PluginWrite } from '../../shared/plugins/declaration';

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
  /** What the person allowed it always. */
  allow: PluginAllow;
  /** Document types it adds to the cycle folder. */
  documents: { name: string; label: string }[];
  /** Events of the fixed catalog it observes. */
  events: string[];
  /** Host names it declares it needs from the network. */
  network: string[];
  /** The external write it declares, or null. */
  write: PluginWrite | null;
  /** Entry script relative to the plugin folder, or null. */
  entry: string | null;
  /** How the entry runs. */
  runtime: 'shell' | 'js';
  /** Settings it declares, and the values of the plain ones the person filled in. */
  settings: PluginSetting[];
  values: Record<string, string>;
  /** Requests it may ask the app to make. */
  requests: PluginRequestDecl[];
  /** A digest of everything it declares it reaches (hosts, requests, write): a permission "always" holds only for the same one. */
  reach: string;
  /** Why the declaration was refused, in words; null when the plugin is usable. */
  refused: string | null;
}

export type { PluginAllow, PluginConfig, PluginsConfig };
export type { PluginView, PluginsView } from '../../shared/plugins/view';
