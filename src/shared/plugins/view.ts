import type { PluginAllow } from '../config/types';
import type { PluginRequestDecl, PluginSetting, PluginWrite } from './declaration';

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
  /** Settings it declares, with the value of each plain one and whether each secret one is filled in (never its value). */
  settings: (PluginSetting & { value: string | null; filled: boolean })[];
  /** Requests it may ask the app to make. */
  requests: Pick<PluginRequestDecl, 'id' | 'method' | 'url' | 'write' | 'reversible'>[];
  /** What it tells the agents while it is on, or null. */
  agents: string | null;
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
