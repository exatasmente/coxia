import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginDocumentType } from '../../shared/plugins/declaration';
import { pluginDocumentText } from '../../shared/plugins/grants';
import { ARTIFACT_NAME } from '../../shared/runs/output';
import { checkPath } from '../engine/guard';
import { redact } from '../errorlog-core';
import { writeArtifact } from '../runner/cycleFolder';
import type { RunnerSandbox } from '../../shared/config/types';
import type { SandboxService } from '../sandbox';

// Runs a plugin script through the same sandbox the app gives a stage: no second boundary, no policy of its own, except that the network of a plugin's
// sandbox is only what the person allowed that plugin (shared/plugins/grants.ts decides it). The script runs inside, and its output comes back as material. Nothing of the app's environment, no key and no folder outside the sandbox reaches it, because it never runs through the
// app's process.
//
// What the plugin returns is applied by the app, never by the plugin itself: the document of a plugin is written into the run's cycle folder through
// `writeArtifact`, the same door and the same guard the documents of a stage go through.
//
// A plugin that fails, throws or is stopped does not take the app with it: the reason comes back in words. A plugin with no entry script, or one the
// person turned off or with a refused declaration, is never called.

export interface PluginRuntimeDeps {
  sandbox: SandboxService;
  /** The settings the sandbox of this plugin is opened with: the workspace's limits and folders, and the network the person allowed this plugin. */
  config: RunnerSandbox;
  /** Told about every destination the sandbox reached, so what a plugin reached, or was refused, is in the audit log. */
  onProxy?(decision: { host: string; port: number; allowed: boolean; why?: string }): void;
}

/** What the app knows of one document type a plugin offers, for the write below. */
export interface PluginDocument extends Pick<PluginDocumentType, 'name' | 'label'> {
  title: string;
}

export interface RunnablePlugin {
  id: string;
  /**
   * The text of the entry script, read by the app from the plugin folder. It is handed to the sandbox as the command itself: the plugin folder is never
   * mounted (it may sit in the app's data, which no sandbox sees), and the script reads the event as `$1`.
   */
  script: string;
  /** Document types it declares, with the title each document is written under. */
  documents?: PluginDocument[];
}

/** What one run of a plugin left behind. */
export interface PluginRun {
  plugin: string;
  ok: boolean;
  text: string;
  refused: string | null;
  /** The document of the cycle folder the app wrote from what the plugin returned, or null when there was nothing to write. */
  document: { path: string; name: string } | null;
}

/** The most text one plugin's answer keeps. */
const OUTPUT_MAX = 20_000;
/** The most the app writes into a document from what a plugin returned, so one answer cannot fill the folder. */
const DOCUMENT_MAX = 40_000;

/** The run a plugin is called for: the worktree and cycle folder the app writes its document into. */
export interface PluginTarget {
  worktree: string;
  cycleFolder: string;
}

const fail = (plugin: string, refused: string): PluginRun => ({ plugin, ok: false, text: '', refused, document: null });

/**
 * Runs one plugin's entry script inside the stage sandbox, with the event name as its argument, and applies what it returned: the text comes back as
 * material for the caller, and the first document type of the plugin gets the document, written by the app through the guard of the cycle folder.
 */
export async function runPlugin(deps: PluginRuntimeDeps, plugin: RunnablePlugin, event: string, target: PluginTarget): Promise<PluginRun> {
  if (!plugin.script.trim()) return fail(plugin.id, 'the plugin has no entry script');
  let session: Awaited<ReturnType<SandboxService['open']>>;
  try {
    session = await deps.sandbox.open({ worktree: target.worktree, reader: true, config: deps.config, onProxy: deps.onProxy });
  } catch (e) {
    return fail(plugin.id, e instanceof Error ? e.message : String(e));
  }
  let text: string;
  try {
    const command = `set -- ${shellQuote(event)}\n${plugin.script}`;
    const result = await session.exec(command);
    if (result.refused) return fail(plugin.id, `the command was not run (${result.refused})`);
    if (result.exitCode !== 0) return fail(plugin.id, `the plugin ended with code ${result.exitCode ?? '—'}`);
    text = redact(result.output).slice(0, OUTPUT_MAX);
  } catch (e) {
    return fail(plugin.id, e instanceof Error ? e.message : String(e));
  } finally {
    await session.close().catch(() => undefined);
  }
  // The app writes the document, not the plugin: the same guard the documents of a stage go through, and the file added to the cycle folder of the run.
  let document: { path: string; name: string } | null = null;
  const type = plugin.documents?.[0];
  if (type) document = writePluginDocument(target, type, { plugin: plugin.id, event, text });
  return { plugin: plugin.id, ok: true, text, refused: null, document };
}

/**
 * Writes the document a plugin's answer becomes into the run's cycle folder. Nothing is written when the plugin returned nothing or the name is not one
 * the folder takes; the path goes through the same guard as any document of a stage, so a name can never lead anywhere else.
 */
export function writePluginDocument(target: PluginTarget, type: { name: string; title: string }, input: { plugin: string; event: string; text: string }): { path: string; name: string } | null {
  const content = pluginDocumentText({ title: type.title, body: input.text.slice(0, DOCUMENT_MAX), plugin: input.plugin, event: input.event });
  if (!content) return null;
  if (!ARTIFACT_NAME.test(type.name)) return null;
  const check = checkPath(target.worktree, join(target.cycleFolder, type.name));
  if (!check.ok) return null;
  writeArtifact(target.worktree, target.cycleFolder, type.name, content);
  return { path: check.path, name: type.name };
}

/** The document of the cycle folder as it is on disk, or null. */
export function pluginDocumentAt(target: PluginTarget, name: string): { path: string; text: string } | null {
  const check = checkPath(target.worktree, join(target.cycleFolder, name), { read: true });
  if (!check.ok || !existsSync(check.path)) return null;
  return { path: check.path, text: readFileSync(check.path, 'utf8') };
}

/** One plain argument, quoted for `/bin/sh`, so an event name never becomes a second command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
