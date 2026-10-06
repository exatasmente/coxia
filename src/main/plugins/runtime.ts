import type { RunnerSandbox } from '../../shared/config/types';
import { redact } from '../errorlog-core';
import type { SandboxService } from '../sandbox';

// Runs a plugin script through the same sandbox the app gives a stage: no second boundary, no policy of its own. The session is
// opened with the workspace's own `runner.sandbox` (closed by default; the network only by the list the person wrote), the script
// runs inside, and its output comes back as material. Nothing of the app's environment, no key and no folder outside the sandbox
// reaches it, because it never runs through the app's process.
//
// A plugin that fails, throws or is stopped does not take the app with it: the reason comes back in words. A plugin with no entry
// script, or one the person turned off or with a refused declaration, is never called.

export interface PluginRuntimeDeps {
  sandbox: SandboxService;
  /** The workspace's sandbox settings; a closed one by default. */
  config(): RunnerSandbox;
  /** Where the plugin runs, from the runner: the worktree it belongs to. */
  worktree(): string;
}

export interface RunnablePlugin {
  id: string;
  /** Absolute path of the entry script. */
  entry: string;
}

export interface PluginRun {
  plugin: string;
  ok: boolean;
  text: string;
  refused: string | null;
}

/** The most text one plugin's answer keeps. */
const OUTPUT_MAX = 20_000;

/**
 * Runs one plugin's entry script inside the stage sandbox. The script is run with `/bin/sh` from the sandbox's own working directory,
 * with the event name as its argument: a plugin that reads the web uses whatever the sandbox already allows, and nothing more.
 */
export async function runPlugin(deps: PluginRuntimeDeps, plugin: RunnablePlugin, event: string): Promise<PluginRun> {
  const fail = (refused: string): PluginRun => ({ plugin: plugin.id, ok: false, text: '', refused });
  if (!plugin.entry) return fail('the plugin has no entry script');
  let session: Awaited<ReturnType<SandboxService['open']>>;
  try {
    session = await deps.sandbox.open({ worktree: deps.worktree(), reader: true, config: deps.config() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  try {
    const command = `/bin/sh ${shellQuote(plugin.entry)} ${shellQuote(event)}`;
    const result = await session.exec(command);
    if (result.refused) return fail(`the command was not run (${result.refused})`);
    if (result.exitCode !== 0) return fail(`the plugin ended with code ${result.exitCode ?? '—'}`);
    return { plugin: plugin.id, ok: true, text: redact(result.output).slice(0, OUTPUT_MAX), refused: null };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** One plain argument, quoted for `/bin/sh`, so a path or an event name never becomes a second command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
