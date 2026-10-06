import type { PluginAllow } from '../config/types';
import type { PluginWrite } from './declaration';

// What the interface is told about the plugins of the workspace: shared by the main process, which builds it, and the window, which shows it.

/** The list the person sees: what each plugin offers, what it asks for, what it was allowed and whether it is on. */
export interface PluginView {
  id: string;
  name: string;
  folder: string;
  enabled: boolean;
  events: string[];
  documents: { name: string; label: string }[];
  network: string[];
  write: PluginWrite | null;
  /** Allowed always: kept until taken back. */
  allow: PluginAllow;
  /** Allowed for this session of the app. */
  session: PluginAllow;
  /** Requests of this plugin waiting for the person in Actions. */
  waiting: number;
  refused: string | null;
}

/** The plugins section the interface shows: the folder, the deadline of the warning and the list. */
export interface PluginsView {
  dir: string;
  confirmSeconds: number;
  plugins: PluginView[];
}
