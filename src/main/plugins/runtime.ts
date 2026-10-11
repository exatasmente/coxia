import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PluginDocumentType } from '../../shared/plugins/declaration';
import { pluginDocumentText } from '../../shared/plugins/grants';
import { ARTIFACT_NAME } from '../../shared/runs/output';
import { checkPath } from '../engine/guard';
import { redact } from '../errorlog-core';
import { writeArtifact } from '../runner/cycleFolder';
import type { RunnerSandbox } from '../../shared/config/types';
import type { SandboxService } from '../sandbox';
import { OUT } from '../sandbox/policy';

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
   * mounted (it may sit in the app's data, which no sandbox sees), and the script reads the event as `$1`, the question of a call from a conversation as
   * `$2` and that conversation as `$3` (both empty on the four events of a cycle).
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
  /** Whether the document a plugin returns is written into the cycle folder. A call from a conversation outside a run hands over an empty folder of its own and writes nothing. */
  documents?: boolean;
}

/** What one call was asked: a call from a conversation carries the question and the conversation; a cycle event carries neither. */
export interface PluginCall {
  asked?: string;
  thread?: string;
}

const fail = (plugin: string, refused: string): PluginRun => ({ plugin, ok: false, text: '', refused, document: null });

/**
 * Runs one plugin's entry script inside the stage sandbox, with the event name as its arguments, and applies what it returned: the text comes back as
 * material for the caller, and the first document type of the plugin gets the document, written by the app through the guard of the cycle folder.
 */
export async function runPlugin(deps: PluginRuntimeDeps, plugin: RunnablePlugin, event: string, target: PluginTarget, call: PluginCall = {}): Promise<PluginRun> {
  if (!plugin.script.trim()) return fail(plugin.id, 'the plugin has no entry script');
  let session: Awaited<ReturnType<SandboxService['open']>>;
  try {
    session = await deps.sandbox.open({ worktree: target.worktree, reader: true, config: deps.config, onProxy: deps.onProxy });
  } catch (e) {
    return fail(plugin.id, e instanceof Error ? e.message : String(e));
  }
  let text: string;
  try {
    // The event is `$1`; on a call from a conversation the question is `$2` and the conversation `$3` (empty on the four events of a cycle).
    const command = `set -- ${shellQuote(event)} ${shellQuote(call.asked ?? '')} ${shellQuote(call.thread ?? '')}\n${plugin.script}`;
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
  // The only new write this adds: a call from a conversation outside a run writes nothing anywhere.
  if (target.documents === false) return null;
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

// ---- plugins in JavaScript ----------------------------------------------------------------------------------------------------------------
// A JavaScript plugin is a module whose default export gets a context and returns its result. It runs in the same sandbox as a stage, through the
// app's own executable in Node mode (ELECTRON_RUN_AS_NODE), so nothing has to be installed on the machine. Its folder is never mounted: the app reads
// its files and hands them over, with a harness of its own, through the control folder of the session (`put`).
//
// The session does not talk to the plugin while it runs, so `ctx.request` works by replay: a call with no answer yet is recorded and ends the round;
// the app makes the recorded calls and runs the plugin again with the answers, which `ctx.request` returns in the order they were asked. A plugin has
// to ask the same things in the same order every round (the kit says so).

/** The most a result the harness leaves may weigh (the document is cut to OUTPUT_MAX afterwards). */
const RESULT_MAX_BYTES = 512 * 1024;

/** The most rounds of one call, and the most requests one round may ask. */
export const JS_ROUNDS = 3;
export const JS_REQUESTS_PER_ROUND = 5;

/** What a JavaScript plugin asked of the app in a round or as its result. */
export interface JsCall {
  id: string;
  path?: string;
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/** The answer to one call, as the plugin gets it. */
export type JsAnswer = { id: string; status: number; contentType: string; body: string; truncated: boolean } | { id: string; refused: string };

export interface JsPlugin {
  id: string;
  /** The files of the plugin folder, by relative path. */
  files: Record<string, string>;
  entry: string;
  documents?: PluginDocument[];
  /** The values of its plain settings. */
  settings: Record<string, string>;
}

export interface JsRuntimeDeps {
  sandbox: SandboxService;
  config: RunnerSandbox;
  /** The app's executable, run in Node mode inside the sandbox. */
  executable: string;
  onProxy?(decision: { host: string; port: number; allowed: boolean; why?: string }): void;
  /** Makes one read the plugin asked for (checked, with its secret, audited); never throws. */
  read(call: JsCall): Promise<JsAnswer>;
}

/** What a JavaScript plugin left: the run, and the writes it asked for (they follow the permission contract afterwards). */
export interface JsPluginRun extends PluginRun {
  writes: JsCall[];
}

interface HarnessResult {
  pending: JsCall[];
  writes: JsCall[];
  document: string | null;
  error: string | null;
}

/**
 * The harness the app hands the session: it unpacks the plugin, builds the context and calls the default export, then prints one line with what the
 * plugin asked and returned. Written for Node; nothing of the app is imported.
 */
export const HARNESS_MJS = String.raw`import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
const [inputPath, bundlePath, resultPath] = process.argv.slice(-3);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const root = '/tmp/coxia/plugin';
for (const [rel, text] of Object.entries(bundle)) {
  const p = normalize(join(root, rel));
  if (!p.startsWith(root + '/')) continue;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
const NEED = { coxia: 'needs-an-answer' };
const pending = [];
const writes = [];
let calls = 0;
const plain = (o) => ({ path: typeof o.path === 'string' ? o.path : undefined, query: o.query && typeof o.query === 'object' ? Object.fromEntries(Object.entries(o.query).map(([k, v]) => [k, String(v)])) : undefined, body: typeof o.body === 'string' ? o.body : o.body === undefined ? undefined : JSON.stringify(o.body), contentType: typeof o.contentType === 'string' ? o.contentType : undefined });
const ctx = Object.freeze({
  event: input.event,
  issue: input.issue,
  stage: input.stage,
  asked: input.asked ?? null,
  thread: input.thread ?? null,
  runId: input.runId ?? null,
  round: input.round,
  settings: Object.freeze({ ...input.settings }),
  async readCycleFile(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw new Error('readCycleFile takes a plain file name of the cycle folder');
    try { return readFileSync(join(input.cycleDir, name), 'utf8'); } catch { return null; }
  },
  request(id, options = {}) {
    const i = calls++;
    const answer = input.answers[i];
    if (answer) {
      if (answer.id !== id) return Promise.reject(new Error('the plugin asked other requests than in the round before: ask the same things in the same order'));
      return answer.refused ? Promise.reject(new Error(answer.refused)) : Promise.resolve(answer);
    }
    pending.push({ id: String(id), ...plain(options) });
    return Promise.reject(NEED);
  },
  write(id, options = {}) { writes.push({ id: String(id), ...plain(options) }); },
  log(...parts) { console.error(parts.join(' ')); },
});
let document = null;
let error = null;
try {
  const mod = await import(pathToFileURL(join(root, input.entry)).href);
  if (typeof mod.default !== 'function') throw new Error('the plugin module has no default export function');
  const out = await mod.default(ctx);
  if (out && typeof out.document === 'string') document = out.document;
} catch (e) {
  if (e !== NEED && !pending.length) error = e instanceof Error ? e.message : String(e);
}
writeFileSync(resultPath, JSON.stringify({ pending, writes: pending.length ? [] : writes, document: pending.length ? null : document, error }));
`;

/** The result the harness left, or null when the plugin never got there (the runtime failed to start, the command was stopped). */
export function harnessResult(text: string | null): HarnessResult | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<HarnessResult>;
    const calls = (v: unknown): JsCall[] => (Array.isArray(v) ? v.filter((c): c is JsCall => !!c && typeof (c as JsCall).id === 'string') : []);
    return { pending: calls(raw.pending), writes: calls(raw.writes), document: typeof raw.document === 'string' ? raw.document : null, error: typeof raw.error === 'string' ? raw.error : null };
  } catch {
    return null;
  }
}

/**
 * Runs a JavaScript plugin for one event: up to `JS_ROUNDS` rounds in one session, the reads it asked made by the app between them. The document it
 * returned is written into the run's cycle folder through the guard of a stage's documents; the writes it asked come back for the permission contract.
 */
export async function runJsPlugin(deps: JsRuntimeDeps, plugin: JsPlugin, event: string, context: { issue: number; stage?: string; asked?: string; thread?: string; runId?: string }, target: PluginTarget): Promise<JsPluginRun> {
  const failJs = (refused: string): JsPluginRun => ({ ...fail(plugin.id, refused), writes: [] });
  const exeDir = dirname(deps.executable);
  let session: Awaited<ReturnType<SandboxService['open']>>;
  try {
    session = await deps.sandbox.open({ worktree: target.worktree, reader: true, config: { ...deps.config, readOnlyPaths: [...deps.config.readOnlyPaths, exeDir] }, onProxy: deps.onProxy });
  } catch (e) {
    return failJs(e instanceof Error ? e.message : String(e));
  }
  try {
    if (!session.put || !session.take) return failJs('this sandbox cannot be handed files');
    const harness = session.put('harness.mjs', HARNESS_MJS);
    const bundle = session.put('bundle.json', JSON.stringify(plugin.files));
    const answers: JsAnswer[] = [];
    let result: HarnessResult | null = null;
    for (let round = 1; round <= JS_ROUNDS; round++) {
      const input = session.put(`input-${round}.json`, JSON.stringify({ event, issue: context.issue, stage: context.stage ?? null, asked: context.asked ?? null, thread: context.thread ?? null, runId: context.runId ?? null, round, settings: plugin.settings, cycleDir: join(target.worktree, target.cycleFolder), entry: plugin.entry, answers }));
      const resultName = `plugin-result-${round}.json`;
      const command = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(deps.executable)} ${shellQuote(harness)} ${shellQuote(input)} ${shellQuote(bundle)} ${shellQuote(`${OUT}/${resultName}`)}`;
      const ran = await session.exec(command);
      if (ran.refused) return failJs(`the command was not run (${ran.refused})`);
      result = harnessResult(session.take?.(resultName, RESULT_MAX_BYTES) ?? null);
      if (!result) return failJs(`the plugin ended with code ${ran.exitCode ?? '—'} and no result`);
      if (result.error) return failJs(redact(result.error).slice(0, 500));
      if (!result.pending.length) break;
      if (round === JS_ROUNDS) return failJs(`the plugin still asked for requests after ${JS_ROUNDS} rounds`);
      if (result.pending.length > JS_REQUESTS_PER_ROUND) return failJs(`the plugin asked for more than ${JS_REQUESTS_PER_ROUND} requests in one round`);
      for (const call of result.pending) answers.push(await deps.read(call));
    }
    const text = redact(result?.document ?? '').slice(0, OUTPUT_MAX);
    const type = plugin.documents?.[0];
    const document = type ? writePluginDocument(target, type, { plugin: plugin.id, event, text }) : null;
    return { plugin: plugin.id, ok: true, text, refused: null, document, writes: (result?.writes ?? []).slice(0, JS_REQUESTS_PER_ROUND) };
  } catch (e) {
    return failJs(e instanceof Error ? e.message : String(e));
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** The files of a JavaScript plugin's folder the app hands over: `.mjs`, `.js` and `.json`, no link, nothing outside it, within a size limit. */
export const JS_FILES_MAX_BYTES = 256 * 1024;
