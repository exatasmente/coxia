// The contract of a Coxia plugin written in JavaScript (see plugins/web-search/ for a real one). A plugin is a module (`index.mjs`) whose default export receives a `PluginContext` and returns a
// `PluginResult`. Reference these types from the plugin with a JSDoc import, for example:
//
//   /** @param {import('./coxia-plugin').PluginContext} ctx */
//   export default async function (ctx) { ... }
//
// The plugin runs inside the same sandbox as a stage of the cycle, by the app's own runtime: no network of its own, the run's worktree read-only, and
// nothing of the person's machine. It reaches a service only through `request` and `write`, which the app makes for it when the person allowed it.

/** The events of the fixed catalog a plugin may observe. */
export type PluginEvent = 'stage-entered' | 'stage-finished' | 'gate-decided' | 'run-finished';

/** One query parameter or the body of a request: the app checks the call against the request the plugin declared in `plugin.json`. */
export interface RequestOptions {
  /** A path under the declared one ("/v1/search"); it may never leave it. */
  path?: string;
  /** Query parameters, as strings. */
  query?: Record<string, string | number | boolean>;
  /** A body (not for GET): a string, or a value the app sends as JSON. */
  body?: string | unknown;
  /** `application/json` (default with a body), `text/plain` or `application/x-www-form-urlencoded`. */
  contentType?: string;
}

/** What the app got back. The body is cut at 200 KiB (`truncated` says so), masked, and never holds a secret the app put in the call. */
export interface RequestAnswer {
  id: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

export interface PluginContext {
  /** The event that called the plugin. */
  readonly event: PluginEvent;
  /** The issue of the run, and the stage it is at. */
  readonly issue: number;
  readonly stage: string | null;
  /** Which round this is (1 to 3): see `request`. */
  readonly round: number;
  /** The values of the plugin's `text` and `url` settings. A `secret` setting is never here: the app puts it in the request itself. */
  readonly settings: Readonly<Record<string, string>>;
  /** A document of the run's cycle folder (a plain file name), or null when it is not there. */
  readCycleFile(name: string): Promise<string | null>;
  /**
   * Asks the app to make a read the plugin declared. It works by replay: the first time a call has no answer, the round ends, the app makes the
   * calls asked so far and runs the plugin again, and this time the same call returns the answer. So ask the same things in the same order every
   * round, and ask the ones that do not depend on each other together (`Promise.all`) so they go in one round. Rejects with the reason when the app
   * refused the call (not declared, setting empty, not allowed).
   */
  request(id: string, options?: RequestOptions): Promise<RequestAnswer>;
  /** Asks for a write the plugin declared. It follows the person's permission after the plugin ends: it may go out, be announced first, or wait. */
  write(id: string, options?: RequestOptions): void;
  /** A line for the log of the run of the plugin. */
  log(...parts: unknown[]): void;
}

export interface PluginResult {
  /** The text of the document the plugin declared, written by the app into the run's cycle folder. Nothing is written when absent or empty. */
  document?: string;
}

export type Plugin = (ctx: PluginContext) => Promise<PluginResult | void> | PluginResult | void;
