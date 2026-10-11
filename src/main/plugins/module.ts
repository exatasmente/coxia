import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { PluginAllow, PluginConfig, PluginsConfig, RunnerSandbox } from '../../shared/config/types';
import { neutralPlugins } from '../../shared/config/defaults';
import { t } from '../../shared/i18n';
import { isPluginAnswer, isPluginNeed, mayReachNetwork, pluginAnswers, pluginNetworkSandbox, pluginWriteStep, type PluginAnswer, type PluginNeed, type PluginPermission } from '../../shared/plugins/grants';
import type { PluginEvent } from '../../shared/plugins/events';
import type { Run } from '../../shared/runs';
import type { ReleaseAction } from '../../shared/types';
import { DATA_ROOT, HOME, WORKSPACE_ID } from '../env';
import type { Module, ModuleContext } from '../module';
import { runStore } from '../runs';
import { forumStore } from '../forum';
import { callOrigin } from '../rpc';
import { sandbox } from '../sandbox/workspace';
import { externalRefusal } from '../workspace';
import { recordWrite } from '../auditoria';
import { getConfig, updateConfig } from '../workspaceConfig';
import { announcePluginWrite, auditPluginRequest, onActionSkipped, pendingPluginAsks, pendingPluginWrites, proposePluginAsk, rearmPluginWrite, releasePluginAsks as releaseAsks, sendDuePluginWrite, settlePluginAsk, withdrawPluginWrite, writePluginNow, type PluginAskUnit, type PluginWriteInput } from '../actions';
import { gatePluginDocuments } from '../gate';
import { workspaceDir } from '../workspaces-core';
import { allowOf, pluginsDirOf, pluginViews, readPlugins, withChoice } from './read';
import { JS_FILES_MAX_BYTES, runJsPlugin, runPlugin, type JsAnswer, type JsCall, type JsPlugin, type JsPluginRun, type PluginCall, type PluginRun, type PluginTarget, type RunnablePlugin } from './runtime';
import { performPluginRequest, pluginSecretRef, realTransport, requestTarget, resolvePluginRequest, type PerformedRequest, type RequestingPlugin, type ResolvedRequest } from './requests';
import { secrets } from '../secrets';
import type { PluginRecord, PluginsView } from './types';

// The plugins of the running workspace: the folder is read at the moment of use, the list is published for the interface, and the person switches a
// plugin on or off on the computer. Nothing is remembered at start-up, so switching a plugin off is in force from the next thing that uses the
// capability, with no restart.
//
// What a plugin may reach is the person's decision, and this service is where it is applied (shared/plugins/grants.ts decides). "Always" lives in the
// workspace's configuration, keyed by identity, and only the entry of the plugin being decided is ever written; "for the session" lives in this process;
// "once" lives in the request it answers. What a plugin was not allowed becomes a request in Actions, and the run it belongs to does not start another
// stage while one of its requests waits (the runner asks `pluginHold`).
//
// A plugin never gets a way to write for itself: an allowed write goes out through the door of Actions (audited, refused in a test workspace); an
// irreversible one is announced there first, for the workspace's deadline. The app writes the document a plugin returned, through the guard of the
// documents of a stage.

export interface PluginContext {
  issue: number;
  issueTitle?: string;
  stage?: string;
  /** The run the event belongs to; when it is absent and there is no conversation either, the plugin is not called. */
  runId?: string;
  /** The conversation a call from it was made in; null on the four events of a cycle. */
  thread?: string;
  /** What the call from a conversation asked; empty on the four events of a cycle. */
  asked?: string;
}

/** What the door of Actions offers the service: requests, their answers and the writes. Injected, so a test needs no data folder. */
export interface PluginDoor {
  ask(input: Parameters<typeof proposePluginAsk>[0]): ReleaseAction | null;
  pending(): ReleaseAction[];
  settle(id: string, allowed: boolean, words: string): ReleaseAction;
  now(w: { issue: number; key: string; summary: string; plugin: string }, input: PluginWriteInput): Promise<string>;
  announce(input: Parameters<typeof announcePluginWrite>[0]): ReleaseAction | null;
  /** The announced writes still waiting for their deadline. */
  writes(): ReleaseAction[];
  /** Sets an announced write aside: it never goes out, and `words` say why. */
  withdraw(id: string, words: string): void;
  /** Sends an announced write whose deadline passed; `execute` makes a plugin's request instead of writing its outbox. */
  send(id: string, execute?: (a: ReleaseAction, origin: Parameters<typeof auditPluginRequest>[0]) => Promise<string>): Promise<unknown>;
  /** A plugin's write request through the audited door. */
  sendRequest: typeof auditPluginRequest;
}

export interface PluginsDeps {
  /** Where the plugins of this workspace are read from. */
  dir(): string;
  /** The workspace's plugins section. */
  config(): PluginsConfig;
  /** Reads the folder and returns one record per plugin. */
  read(dir: string, config: PluginsConfig): PluginRecord[];
  /** Changes the list of what the person decided; the change is applied to the configuration as it is when it is saved. */
  save(change: (list: PluginConfig[]) => PluginConfig[]): void;
  /** Saves the folder and the deadline of the warning. */
  settings(values: { dir: string | null; confirmSeconds: number }): void;
  /** The run a plugin is called for: the worktree and the cycle folder its document goes into, or null when the run or its worktree is gone. */
  target(runId: string): PluginTarget | null;
  /** The target of a call from a conversation that belongs to no run: an empty folder of its own, where nothing is written. */
  chatTarget(): PluginTarget;
  /** The workspace's sandbox settings: its limits and folders (the network of a plugin is its own). */
  sandbox(): RunnerSandbox;
  /** Runs one plugin's entry script inside the stage sandbox, with the settings the person's permission produced. */
  run(plugin: RunnablePlugin, event: PluginEvent | string, target: PluginTarget, config: RunnerSandbox, onProxy: (d: { host: string; port: number; allowed: boolean; why?: string }) => void, call?: PluginCall): Promise<PluginRun>;
  /** Runs a JavaScript plugin, with the reads it asks made through `read`. */
  runJs(plugin: JsPlugin, event: string, context: { issue: number; stage?: string; asked?: string; thread?: string; runId?: string }, target: PluginTarget, config: RunnerSandbox, read: (call: JsCall) => Promise<JsAnswer>, onProxy: (d: { host: string; port: number; allowed: boolean; why?: string }) => void): Promise<JsPluginRun>;
  /** Makes a request the app resolved for a plugin, with its secret. */
  fetchRequest(plugin: RequestingPlugin, resolved: Extract<ResolvedRequest, { ok: true }>): Promise<PerformedRequest>;
  /** Whether a secret setting of a plugin is filled in (never its value). */
  secretFilled(plugin: string, key: string): boolean;
  /** Stores (or, empty, removes) the value of a secret setting. */
  setSecret(plugin: string, key: string, value: string): void;
  door: PluginDoor;
  /** A line the app words in a conversation (a call from a conversation is answered this way). */
  say(thread: string, code: string, params: Record<string, string>): void;
  /** Tells the runner a request of `runId` was answered: it goes on when none is left, and `note` goes to its conversation. */
  settled(runId: string, note: PluginNote | null): void;
}

/** A line for the run's conversation: a refusal, or a plugin that could not be called. */
export interface PluginNote {
  code: string;
  params: Record<string, string>;
}

/** The runner's side, set by the runner module: a request answered lets the run it held go on. */
export const pluginRunHooks: { settled(runId: string, note: PluginNote | null): void } = {
  settled: () => undefined,
};

// ---- the session ---------------------------------------------------------------------------------------------------------------------------

const NONE: PluginAllow = { network: false, write: false };
const session = new Map<string, { reach: string; allow: PluginAllow }>();

/** What the person allowed a plugin for this session of the app — for the declaration it had then: another one asks again, like "always". */
export const sessionOf = (id: string, reach: string): PluginAllow => {
  const entry = session.get(id);
  return entry && entry.reach === reach ? entry.allow : NONE;
};

const setSession = (id: string, reach: string, change: Partial<PluginAllow>): void => void session.set(id, { reach, allow: { ...sessionOf(id, reach), ...change } });

/** Forgets every session permission (the app closing does it for real; a test does it here). */
export function clearPluginSession(): void {
  session.clear();
}

// ---- the real dependencies -----------------------------------------------------------------------------------------------------------------

const pluginConfig = (): PluginsConfig => ({ ...neutralPlugins(), ...(getConfig().plugins ?? {}) });

/**
 * The folder the plugins of the running workspace are read from: what its own configuration lists, else the `plugins` folder of the workspace's data
 * folder. The workspace is named by the registry, not guessed, so a config a service writes can never make the app read another workspace's plugins.
 */
export const pluginsDir = (): string => pluginsDirOf(pluginConfig(), HOME, workspaceDir(DATA_ROOT, WORKSPACE_ID));

/** The cycle folder a plugin's document is written into: the run's own, as the runner keeps it. */
const targetOf = (runId: string): PluginTarget | null => {
  const run = runStore().get(runId);
  return run && existsSync(run.worktree) ? { worktree: run.worktree, cycleFolder: run.cycleFolder } : null;
};

/**
 * The target of a call from a conversation that belongs to no run: an empty folder of its own in the workspace's data, with nothing written into it.
 * Outside a run there is no worktree and the workspace's data cannot be handed to a sandbox; the plugin gets exactly what the conversation brought.
 */
const chatTargetOf = (): PluginTarget => {
  const dir = join(workspaceDir(DATA_ROOT, WORKSPACE_ID), 'sandbox', 'plugin-call');
  mkdirSync(dir, { recursive: true });
  return { worktree: dir, cycleFolder: '', documents: false };
};

export const pluginsDeps: PluginsDeps = {
  dir: pluginsDir,
  config: pluginConfig,
  read: (dir, config) => readPlugins(dir, config),
  save: (change) => updateConfig((c) => ({ ...c, plugins: { ...neutralPlugins(), ...c.plugins, list: change(c.plugins?.list ?? []) } })),
  settings: (values) => updateConfig((c) => ({ ...c, plugins: { ...neutralPlugins(), ...c.plugins, ...values } })),
  target: targetOf,
  chatTarget: chatTargetOf,
  sandbox: () => getConfig().runner.sandbox,
  run: (plugin, event, target, config, onProxy, call) => runPlugin({ sandbox, config, onProxy }, plugin, event, target, call),
  runJs: (plugin, event, context, target, config, read, onProxy) => runJsPlugin({ sandbox, config, executable: process.execPath, onProxy, read }, plugin, event, context, target),
  fetchRequest: (plugin, resolved) => performPluginRequest({ transport: realTransport, secret: (ref) => (secrets().has(ref) ? secrets().resolve(ref) : null) }, plugin, resolved),
  secretFilled: (plugin, key) => secrets().has(pluginSecretRef(plugin, key)),
  setSecret: (plugin, key, value) => {
    const ref = pluginSecretRef(plugin, key);
    if (value) secrets().set({ ref, source: 'stored', value });
    else if (secrets().has(ref)) secrets().remove(ref);
  },
  door: { ask: proposePluginAsk, pending: pendingPluginAsks, settle: settlePluginAsk, now: writePluginNow, announce: announcePluginWrite, writes: pendingPluginWrites, withdraw: (id, words) => void withdrawPluginWrite(id, words), send: sendDuePluginWrite, sendRequest: auditPluginRequest },
  // A line the app words itself, never a post of an agent or the person: it cannot be read back as a call of its own.
  say: (thread, code, params) => void forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params }),
  settled: (runId, note) => pluginRunHooks.settled(runId, note),
};

// ---- the list and the switches -------------------------------------------------------------------------------------------------------------

const unitOf = (a: ReleaseAction): PluginAskUnit => (a.unit ?? {}) as unknown as PluginAskUnit;
const waitingOf = (d: PluginsDeps) => (id: string): number => d.door.pending().filter((a) => unitOf(a).plugin === id).length;

/** The list the interface shows: the folder, the deadline of the warning, and per plugin what it offers, asks for and was allowed. */
export function listPlugins(d: PluginsDeps = pluginsDeps): PluginsView {
  const config = d.config();
  return { dir: d.dir(), confirmSeconds: config.confirmSeconds, plugins: pluginViews(d.read(d.dir(), config), sessionOf, waitingOf(d), d.secretFilled) };
}

const recordOf = (id: string, d: PluginsDeps): PluginRecord => {
  const record = d.read(d.dir(), d.config()).find((r) => r.id === id && !r.refused);
  if (!record) throw new Error(t('main.plugins.unknown', { id }));
  return record;
};

/**
 * Turns a plugin on or off. The choice is the person's, on the computer; only that plugin's entry of the workspace's list changes. Off is off: its
 * waiting requests are refused (the runs they held go on) and its announced writes never go out.
 */
export function setPluginEnabled(id: string, enabled: boolean, d: PluginsDeps = pluginsDeps): PluginsView {
  const record = recordOf(id, d);
  d.save((list) => withChoice(list, record, (c) => ({ ...c, enabled })));
  if (!enabled) {
    withdrawWrites(id, t('main.plugins.write.pluginOff'), d);
    for (const a of d.door.pending().filter((x) => unitOf(x).plugin === id)) {
      d.door.settle(a.id, false, t('main.plugins.ask.pluginOff'));
      noteDelivery(unitOf(a), { code: `run.plugin.refused.${unitOf(a).need}`, params: { plugin: unitOf(a).name } }, d);
    }
  }
  return listPlugins(d);
}

/** Sets aside every announced write of a plugin that is not allowed to go out any more. */
function withdrawWrites(plugin: string, words: string, d: PluginsDeps): void {
  for (const a of d.door.writes().filter((x) => String((x.unit ?? {}).plugin ?? '') === plugin)) {
    disarm(a.id);
    d.door.withdraw(a.id, words);
  }
}

/**
 * The value of one of a plugin's plain settings (text or url), on the computer. Only a declared key is taken; an empty value clears it. A url must be
 * http(s): it is where the app will make the plugin's requests.
 */
export function setPluginSetting(id: string, key: string, value: string, d: PluginsDeps = pluginsDeps): PluginsView {
  const record = recordOf(id, d);
  const setting = record.settings.find((s) => s.key === key && s.kind !== 'secret');
  if (!setting) throw new Error(t('main.plugins.settings.unknown', { key }));
  const v = String(value ?? '').trim().slice(0, 2000);
  if (v && setting.kind === 'url' && !plainUrl(v)) throw new Error(t('main.plugins.settings.badUrl', { setting: setting.label }));
  d.save((list) => withChoice(list, record, (c) => {
    const settings = { ...c.settings };
    if (v) settings[key] = v;
    else delete settings[key];
    return { ...c, settings };
  }));
  return listPlugins(d);
}

/** An http(s) address with no user or password in it: a credential belongs in a secret setting, never in plain text. */
function plainUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The value of one of a plugin's secret settings, on the computer: it goes to the secrets store by reference; empty, it is removed. */
export function setPluginSecret(id: string, key: string, value: string, d: PluginsDeps = pluginsDeps): PluginsView {
  const record = recordOf(id, d);
  if (!record.settings.some((s) => s.key === key && s.kind === 'secret')) throw new Error(t('main.plugins.settings.unknown', { key }));
  d.setSecret(record.id, key, String(value ?? '').trim());
  return listPlugins(d);
}

/**
 * Where the plugins are read from and how long an allowed irreversible write is announced. The folder decides what code the app runs, so this is the
 * computer's only, like the switch. An empty folder goes back to the plugins folder of the workspace's data.
 */
export function setPluginSettings(dir: string, confirmSeconds: number, d: PluginsDeps = pluginsDeps): PluginsView {
  const seconds = Math.round(Number(confirmSeconds));
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) throw new Error(t('main.plugins.settings.badSeconds'));
  d.settings({ dir: dir.trim() || null, confirmSeconds: seconds });
  return listPlugins(d);
}

/** Takes back what a plugin was allowed (always and for the session): it asks again the next time it needs it. Only the computer does this. */
export function revokePluginAllow(id: string, need: PluginNeed, d: PluginsDeps = pluginsDeps): PluginsView {
  const record = recordOf(id, d);
  d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...record.allow, [need]: false }, allowedFor: record.reach })));
  setSession(id, record.reach, { [need]: false });
  // A write already announced went out on this permission: taking it back stops it too.
  if (need === 'write') withdrawWrites(id, t('main.plugins.write.revoked'), d);
  return listPlugins(d);
}

// ---- calling the plugins -------------------------------------------------------------------------------------------------------------------

const askKey = (id: string, need: PluginNeed, event: string, context: PluginContext): string => `plugin-ask:${id}:${need}:${context.runId ?? '-'}:${context.thread ?? '-'}:${event}:${context.stage ?? '-'}`;
const fail = (plugin: string, refused: string): PluginRun => ({ plugin, ok: false, text: '', refused, document: null });

/**
 * Calls every enabled plugin that observes `event`, and returns what each did. A plugin that fails does not stop the rest nor the app: the reason comes
 * back. A plugin whose declaration was refused, or that the person turned off, is never called. One that needs what it was not allowed opens a request
 * instead of running, and the run waits for the person's answer.
 */
export async function firePluginEvent(event: PluginEvent, context: PluginContext, d: PluginsDeps = pluginsDeps): Promise<PluginRun[]> {
  const records = d.read(d.dir(), d.config()).filter((r) => r.enabled && !r.refused && r.events.includes(event) && r.entry);
  const out: PluginRun[] = [];
  for (const record of records) {
    try {
      out.push(await callPlugin(record, event, context, d, {}));
    } catch (e) {
      out.push(fail(record.id, e instanceof Error ? e.message : String(e)));
    }
  }
  return out;
}

// ---- a call made from a conversation ------------------------------------------------------------------------------------------------------

/** What a message of a conversation asked of a plugin: the command, the question and the conversation, with the context of the conversation. */
export interface ConversationCall {
  command: string;
  asked: string;
  thread: string;
  issue: number;
  issueTitle?: string;
  stage?: string;
  runId?: string;
}

/** Why a plugin cannot answer a call from a conversation, or null when it can (off, refused, not offered, no entry, a required setting empty). */
function callRefusal(record: PluginRecord, d: PluginsDeps): string | null {
  if (record.refused) return t('main.plugins.call.refused', { reason: record.refused });
  if (!record.enabled) return t('main.plugins.call.off');
  if (!record.events.includes('conversation-called')) return t('main.plugins.call.notOffered');
  if (!record.entry) return t('main.plugins.refusal.entry', { plugin: record.name });
  const missing = record.settings.find((s) => s.required && (s.kind === 'secret' ? !d.secretFilled(record.id, s.key) : !(record.values[s.key] ?? '').trim()));
  return missing ? t('main.plugins.refusal.setting', { plugin: record.name, setting: missing.label }) : null;
}

/**
 * Calls the plugin a message of a conversation named with what it asked, and delivers the outcome to that same conversation: the answer as material, a
 * request open in Actions while it waits, or the reason the plugin was not called. A conversation of a run also carries the run to the plugin (and its
 * document goes into the cycle folder); any other conversation hands over an empty folder, where nothing is written.
 */
export async function callPluginFromConversation(call: ConversationCall, d: PluginsDeps = pluginsDeps): Promise<PluginRun | null> {
  const context: PluginContext = { issue: call.issue, issueTitle: call.issueTitle, stage: call.stage, runId: call.runId, thread: call.thread, asked: call.asked };
  const record = d.read(d.dir(), d.config()).find((r) => r.id === call.command);
  // A command no plugin goes by is answered with one line, and the rest of the conversation is left alone.
  if (!record) {
    d.say(call.thread, 'plugin.unknownCommand', { command: call.command });
    return null;
  }
  const why = callRefusal(record, d);
  if (why) {
    d.say(call.thread, 'plugin.notCalled', { plugin: record.name, reason: why });
    return null;
  }
  try {
    const done = await callPlugin(record, 'conversation-called', context, d, {});
    if (done.ok) d.say(call.thread, 'plugin.answered', { plugin: record.name, text: done.text });
    else if (done.refused === null) d.say(call.thread, 'plugin.waiting', { plugin: record.name });
    else d.say(call.thread, 'plugin.notCalled', { plugin: record.name, reason: done.refused });
    return done;
  } catch (e) {
    d.say(call.thread, 'plugin.notCalled', { plugin: record.name, reason: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** One call of one plugin, with what the person allowed it now and, when an answer is being carried out, what that answer allowed for this call. */
async function callPlugin(record: PluginRecord, event: string, context: PluginContext, d: PluginsDeps, once: Partial<PluginAllow>): Promise<PluginRun> {
  const permission: PluginPermission = { allow: record.allow, session: sessionOf(record.id, record.reach), once };
  // A call from a conversation of a run takes the run's own target; one from any other conversation takes an empty folder of its own (nothing is written
  // there). Without a run and without a conversation there is nowhere the document could go, and the plugin is not called.
  const target = context.runId ? d.target(context.runId) : context.thread ? d.chatTarget() : null;
  if (!target) return fail(record.id, t('main.plugins.refusal.noRun', { plugin: record.name }));
  // A plugin that cannot run (a required setting is empty) is not asked a permission for.
  const missing = record.settings.find((s) => s.required && (s.kind === 'secret' ? !d.secretFilled(record.id, s.key) : !(record.values[s.key] ?? '').trim()));
  if (missing) return fail(record.id, t('main.plugins.refusal.setting', { plugin: record.name, setting: missing.label }));
  // What the plugin reaches: the hosts its sandbox goes to and the reads it asks the app to make. Either needs the network permission.
  const reads = record.requests.filter((r) => !r.write);
  const reached = [...record.network, ...reads.map((r) => `${r.method} ${r.url}`)];
  if (!mayReachNetwork(reached, permission)) {
    const refused = ask(record, 'network', event, context, d, { hosts: reached });
    // `ok: false` with no reason is the sign of a request in Actions opened in place of the call: nothing ran and the person answers there.
    return refused === null ? { ...fail(record.id, ''), refused: null } : fail(record.id, refused);
  }
  if (record.runtime === 'js') return callJs(record, event, context, target, permission, d);
  const script = scriptOf(record);
  if (script === null) return fail(record.id, t('main.plugins.refusal.entry', { plugin: record.name }));
  const config = pluginNetworkSandbox(d.sandbox(), record.network, permission);
  const result = await d.run({ id: record.id, script, documents: record.documents.map((x) => ({ ...x, title: x.label })) }, event, target, config, (decision) => auditProxy(record, context, decision), { asked: context.asked, thread: context.thread });
  if (!result.ok || !record.write) return result;
  const write: PluginWriteInput = { plugin: record.id, to: record.write.to, text: result.text };
  const step = pluginWriteStep(record.write, result.text, permission);
  const summary = t('main.plugins.write.summary', { plugin: record.name, to: record.write.to });
  if (step === 'go') await d.door.now({ issue: context.issue, key: `plugin-write:${record.id}:${Date.now()}`, summary, plugin: record.id }, write);
  else if (step === 'announce') announce(record, context, write, d);
  else if (step === 'ask') {
    const refused = ask(record, 'write', event, context, d, { text: result.text });
    if (refused) return { ...result, refused };
  }
  return result;
}

/** A JavaScript plugin's call: it runs with the reads made by the app, and what it asked to write follows the permission contract. */
async function callJs(record: PluginRecord, event: string, context: PluginContext, target: PluginTarget, permission: PluginPermission, d: PluginsDeps): Promise<PluginRun> {
  const files = jsFilesOf(record);
  if (!files || !record.entry) return fail(record.id, t('main.plugins.refusal.entry', { plugin: record.name }));
  const plain = Object.fromEntries(record.settings.filter((s) => s.kind !== 'secret').map((s) => [s.key, record.values[s.key] ?? '']));
  const config = pluginNetworkSandbox(d.sandbox(), record.network, permission);
  const result = await d.runJs({ id: record.id, files, entry: record.entry, settings: plain, documents: record.documents.map((x) => ({ ...x, title: x.label })) }, event, { issue: context.issue, stage: context.stage, asked: context.asked, thread: context.thread, runId: context.runId }, target, config, (call) => readFor(record, call, context, d), (decision) => auditProxy(record, context, decision));
  if (!result.ok) return result;
  for (const call of result.writes) {
    const refused = await writeFor(record, call, event, context, permission, d);
    if (refused) return { ...result, refused };
  }
  return result;
}

/** A read a JavaScript plugin asked for: checked against its declaration, made by the app with its secret, and written in the audit log. */
async function readFor(record: PluginRecord, call: JsCall, context: PluginContext, d: PluginsDeps): Promise<JsAnswer> {
  const resolved = resolvePluginRequest(record, call);
  if (!resolved.ok) return { id: call.id, refused: resolved.refused };
  if (resolved.decl.write || resolved.method !== 'GET') return { id: call.id, refused: t('main.plugins.request.isWrite', { id: call.id.slice(0, 40) }) };
  // A test workspace widens nothing: no request of a plugin goes out of it, a read included.
  const test = externalRefusal(t('main.plugins.request.title'));
  if (test) return { id: call.id, refused: test };
  const done = await d.fetchRequest(record, resolved);
  auditRequest(record, context, requestTarget(resolved), done.ok ? done.status < 400 : false, done.ok ? `HTTP ${done.status}` : done.refused);
  return done.ok ? { id: call.id, status: done.status, contentType: done.contentType, body: done.body, truncated: done.truncated } : { id: call.id, refused: done.refused };
}

/** The words a write request is shown with: where it goes and what it sends. */
const describeCall = (target: string, call: JsCall): string => [target, call.body ?? ''].filter(Boolean).join('\n\n');

/** A write a JavaScript plugin asked for: it goes out, is announced, or becomes a request, exactly like the write of a plugin's outbox. */
async function writeFor(record: PluginRecord, call: JsCall, event: string, context: PluginContext, permission: PluginPermission, d: PluginsDeps): Promise<string | null> {
  const resolved = resolvePluginRequest(record, call);
  if (!resolved.ok) return resolved.refused;
  if (!resolved.decl.write) return t('main.plugins.request.isRead', { id: call.id });
  const target = requestTarget(resolved);
  const request = { ...call, target, reach: record.reach };
  const step = pluginWriteStep({ to: resolved.decl.id, reversible: resolved.decl.reversible }, 'x', permission);
  const summary = t('main.plugins.request.summary', { plugin: record.name, target });
  if (step === 'go') {
    await sendRequestWrite(record, request, { issue: context.issue, key: `plugin-request:${record.id}:${Date.now()}`, summary, plugin: record.id }, d).catch((e) => console.error('[plugins] a write request', e instanceof Error ? e.message : e));
    return null;
  }
  const write = { plugin: record.id, to: resolved.decl.id, text: describeCall(target, call) };
  if (step === 'announce') {
    try {
      const a = d.door.announce({ key: `plugin-write:${record.id}:${context.runId ?? '-'}:${Date.now()}`, issue: context.issue, issueTitle: context.issueTitle, summary, runId: context.runId ?? null, seconds: d.config().confirmSeconds, write, request });
      if (a) arm(a, d);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  }
  return ask(record, 'write', event, context, d, { text: write.text, reversible: resolved.decl.reversible, request, to: resolved.decl.id });
}

/** Makes a plugin's write request through the audited door; a refusal or an error status is a failure the audit log keeps. */
async function sendRequestWrite(record: PluginRecord, request: JsCall & { target: string; reach?: string }, origin: Parameters<typeof auditPluginRequest>[0], d: PluginsDeps): Promise<string> {
  const resolved = resolvePluginRequest(record, request);
  if (!resolved.ok) throw new Error(resolved.refused);
  // What goes out is what the person saw: a declaration or a setting that changed since leads the call elsewhere, and it does not go.
  const target = requestTarget(resolved);
  // The whole declaration counts, not only the address: where the key goes or how it is written changed is another request too.
  if (target !== request.target || (request.reach !== undefined && request.reach !== record.reach)) throw new Error(t('main.plugins.write.changed'));
  return d.door.sendRequest(origin, target, { plugin: record.id, request: resolved.decl.id, method: resolved.method }, async () => {
    const done = await d.fetchRequest(record, resolved);
    if (!done.ok) throw new Error(done.refused);
    if (done.status >= 400) throw new Error(t('main.plugins.request.status', { id: resolved.decl.id, status: done.status }));
    return t('main.plugins.request.sent', { target: request.target, status: done.status });
  });
}

/** The files of a JavaScript plugin's folder the app hands over (`.mjs`, `.js`, `.json`), or null when the folder cannot be read or is too big. */
function jsFilesOf(record: PluginRecord): Record<string, string> | null {
  try {
    const root = realpathSync(record.dir);
    const out: Record<string, string> = {};
    let total = 0;
    const walk = (dir: string, depth: number): void => {
      if (depth > 4) return;
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const path = join(dir, name);
        const st = lstatSync(path);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) walk(path, depth + 1);
        else if (st.isFile() && /\.(mjs|js|json)$/.test(name)) {
          total += st.size;
          if (total > JS_FILES_MAX_BYTES) throw new Error('too big');
          out[relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8');
        }
      }
    };
    walk(root, 0);
    return record.entry && out[record.entry] !== undefined ? out : null;
  } catch {
    return null;
  }
}

/** A read a plugin asked the app to make is a fact of the audit log: what a plugin reached is never invisible. Never the query, the body or the secret. */
function auditRequest(record: PluginRecord, context: PluginContext, target: string, ok: boolean, result: string): void {
  try {
    recordWrite({ kind: 'plugin-request', issue: context.issue, target, via: 'plugin', fields: { plugin: record.id }, ok, code: null, result, origin: { actionId: '', kind: 'plugin', key: record.id, summary: null }, by: record.id });
  } catch (e) {
    console.error('[plugins] could not record a request', e instanceof Error ? e.message : e);
  }
}

/** The entry script's text, read from inside the plugin folder (no link out of it), or null when it cannot be read. */
function scriptOf(record: PluginRecord): string | null {
  if (!record.entry) return null;
  try {
    const file = join(record.dir, record.entry);
    const real = realpathSync(file);
    if (real !== file || !real.startsWith(`${realpathSync(record.dir)}${sep}`) || statSync(real).size > 64 * 1024) return null;
    return readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}

/** Opens the request of a plugin, or returns why it could not be opened (a test workspace widens nothing). */
function ask(record: PluginRecord, need: PluginNeed, event: string, context: PluginContext, d: PluginsDeps, extra: { hosts?: string[]; text?: string; reversible?: boolean; to?: string; request?: PluginAskUnit['request'] }): string | null {
  const reversible = need === 'write' ? (extra.reversible ?? record.write?.reversible === true) : true;
  const unit: PluginAskUnit = {
    plugin: record.id,
    name: record.name,
    need,
    reversible,
    runId: context.runId ?? null,
    thread: context.thread ?? null,
    asked: context.asked ?? '',
    event,
    stage: context.stage ?? null,
    hosts: extra.hosts ?? [],
    to: extra.to ?? record.write?.to ?? null,
    text: extra.text ?? '',
    // A request of a call from a conversation never holds a run: the answer is delivered to the conversation when the person gives one.
    ...(context.thread ? { holdsRun: false } : {}),
    ...(extra.request ? { request: extra.request } : {}),
  };
  try {
    d.door.ask({
      key: `${askKey(record.id, need, event, context)}${extra.request ? `:${extra.request.id}:${createHash('sha256').update(JSON.stringify([extra.request.path, extra.request.query, extra.request.body])).digest('hex').slice(0, 12)}` : ''}`,
      issue: context.issue,
      issueTitle: context.issueTitle,
      summary: t(`main.plugins.ask.summary.${need}`, { plugin: record.name }),
      unit,
      notify: { title: t('main.plugins.ask.notifyTitle', { plugin: record.name }), body: t(`main.plugins.ask.summary.${need}`, { plugin: record.name }) },
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Announces an allowed irreversible write for the workspace's deadline, and arms the moment it goes out. */
function announce(record: PluginRecord, context: PluginContext, write: PluginWriteInput, d: PluginsDeps): void {
  try {
    const a = d.door.announce({ key: `plugin-write:${record.id}:${context.runId ?? '-'}:${Date.now()}`, issue: context.issue, issueTitle: context.issueTitle, summary: t('main.plugins.write.summary', { plugin: record.name, to: write.to }), runId: context.runId ?? null, seconds: d.config().confirmSeconds, write });
    if (a) arm(a, d);
  } catch (e) {
    console.error('[plugins] could not announce a write', e instanceof Error ? e.message : e);
  }
}

// ---- the person's answer -------------------------------------------------------------------------------------------------------------------

/**
 * The person's answer to a plugin's request, on the computer — and, only for a request a call from a conversation opened, also from the paired
 * browser. Allowing carries the call out at once (the plugin runs with the network, or the write goes out); "session" and "always" also answer the
 * other requests of the same plugin for the same thing. Refusing closes the request with the reason; the plugin asks again at the next event it
 * observes. Either way, a run held by the request goes on when none of its requests is left.
 */
export async function answerPluginAsk(id: string, answer: PluginAnswer, d: PluginsDeps = pluginsDeps, origin: 'ipc' | 'web' = callOrigin()): Promise<PluginsView> {
  if (!isPluginAnswer(answer)) throw new Error(t('main.plugins.ask.badAnswer'));
  const action = d.door.pending().find((a) => a.id === id);
  if (!action) throw new Error(t('main.actions.handled'));
  const unit = unitOf(action);
  if (!isPluginNeed(unit.need) || !pluginAnswers(unit.need, unit.reversible).includes(answer)) throw new Error(t('main.plugins.ask.badAnswer'));
  // Allowing a request of the cycle's own events stays the computer's; a paired browser answers only what a call from a conversation opened.
  if (origin !== 'ipc' && !unit.thread) throw new Error(t('main.web.appOnly'));
  if (answer === 'refuse') {
    d.door.settle(id, false, t('main.plugins.ask.refused'));
    noteDelivery(unit, { code: `run.plugin.refused.${unit.need}`, params: { plugin: unit.name } }, d);
    return listPlugins(d);
  }
  const record = d.read(d.dir(), d.config()).find((r) => r.id === unit.plugin && !r.refused) ?? null;
  // Built on what holds now (`record.allow`, already empty for a declaration that changed), never on what was stored: allowing the network for a new
  // declaration must not bring an old "always" of its write back to life.
  if (answer === 'always' && record) d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...record.allow, [unit.need]: true }, allowedFor: record.reach })));
  if (answer === 'session' && record) setSession(unit.plugin, record.reach, { [unit.need]: true });
  // "Session" and "always" answer every request of the plugin for the same thing; "once" answers this one.
  const answered = answer === 'once' ? [action] : d.door.pending().filter((a) => unitOf(a).plugin === unit.plugin && unitOf(a).need === unit.need);
  for (const a of answered) d.door.settle(a.id, true, t(`main.plugins.ask.allowed.${answer}`));
  for (const a of answered) await carryOut(a, record, d);
  return listPlugins(d);
}

/** Carries out the call a request kept: the plugin runs again with the network, or the write it asked for goes out (an irreversible one is announced). */
async function carryOut(a: ReleaseAction, record: PluginRecord | null, d: PluginsDeps): Promise<void> {
  const unit = unitOf(a);
  const runId = unit.runId;
  let note: PluginNote | null = null;
  let answered: PluginRun | null = null;
  try {
    if (!record || !record.enabled) note = { code: 'run.plugin.unavailable', params: { plugin: unit.name } };
    else {
      const context: PluginContext = { issue: a.issue, issueTitle: a.issueTitle, stage: unit.stage ?? undefined, runId: runId ?? undefined, thread: unit.thread ?? undefined, asked: unit.asked || undefined };
      if (unit.need === 'network') {
        const done = await callPlugin(d.read(d.dir(), d.config()).find((r) => r.id === record.id) ?? record, unit.event, context, d, { network: true });
        if (done.ok) answered = done;
        else if (done.refused) note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: done.refused } };
        else note = { code: 'plugin.waiting', params: { plugin: unit.name } };
      } else if (unit.request) {
        // A JavaScript plugin's write request, carried out on the declaration as it is now: a request that is gone, or became irreversible without the
        // permission to go always, does not go out.
        const fresh = d.read(d.dir(), d.config()).find((r) => r.id === record.id) ?? record;
        const decl = fresh.requests.find((r) => r.id === unit.request?.id && r.write);
        const origin = { issue: a.issue, key: `${a.key}:go`, summary: a.summary ?? '', plugin: unit.plugin };
        if (!decl) note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: t('main.plugins.write.changed') } };
        else if (decl.reversible) await sendRequestWrite(fresh, unit.request, origin, d);
        else if (fresh.allow.write) {
          const announced = d.door.announce({ key: `plugin-write:${fresh.id}:${runId ?? '-'}:${Date.now()}`, issue: a.issue, issueTitle: a.issueTitle, summary: a.summary ?? '', runId: runId ?? null, seconds: d.config().confirmSeconds, write: { plugin: unit.plugin, to: decl.id, text: unit.text }, request: unit.request });
          if (announced) arm(announced, d);
        } else note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: t('main.plugins.write.changed') } };
      } else {
        // The declaration is read again: a write that became irreversible since it asked never goes out at once, and one that is gone goes nowhere.
        const fresh = d.read(d.dir(), d.config()).find((r) => r.id === record.id) ?? record;
        const write = { plugin: unit.plugin, to: unit.to ?? '', text: unit.text };
        if (!fresh.write || fresh.write.to !== unit.to) note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: t('main.plugins.write.changed') } };
        else if (fresh.write.reversible) await d.door.now({ issue: a.issue, key: `${a.key}:go`, summary: a.summary ?? '', plugin: unit.plugin }, write);
        else if (fresh.allow.write) announce(fresh, context, write, d);
        else note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: t('main.plugins.write.changed') } };
      }
    }
  } catch (e) {
    note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: e instanceof Error ? e.message : String(e) } };
  }
  // A request of a call from a conversation reports back to that conversation (the answer, or why there is none); a run's request reports to its run.
  if (unit.thread) {
    if (answered) d.say(unit.thread, 'plugin.answered', { plugin: unit.name, text: answered.text });
    else if (note) noteDelivery(unit, note, d);
  } else if (runId) d.settled(runId, note);
}

/** Where the outcome of a request goes: the conversation of the call it came from, or the run it belonged to. */
function noteDelivery(unit: PluginAskUnit, note: PluginNote, d: PluginsDeps): void {
  if (unit.thread) d.say(unit.thread, note.code, note.params);
  else if (unit.runId) d.settled(unit.runId, note);
}

/** Whether a run has a plugin request waiting for the person, and which: the runner does not start another stage of it meanwhile. */
export function pluginHold(runId: string, d: PluginsDeps = pluginsDeps): { plugin: string; need: PluginNeed } | null {
  const a = d.door.pending().find((x) => unitOf(x).runId === runId && (x.unit ?? {}).holdsRun !== false);
  return a ? { plugin: unitOf(a).name, need: unitOf(a).need } : null;
}

// ---- the warning with a deadline -----------------------------------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The person went on without answering: the requests of the run stay in Actions and no longer hold it. */
export const releasePluginAsks = (runId: string): void => releaseAsks(runId);

/**
 * At the deadline the write goes out only if the plugin is still on, not refused and still allowed always: a permission taken back, or the plugin
 * switched off, while the warning counted down stops it. Blocked meanwhile, there is nothing to send.
 */
async function sendIfAllowed(id: string, d: PluginsDeps): Promise<void> {
  const a = d.door.writes().find((x) => x.id === id);
  if (!a) return;
  const record = d.read(d.dir(), d.config()).find((r) => r.id === String((a.unit ?? {}).plugin ?? ''));
  if (!record || !record.enabled || record.refused || !record.allow.write) {
    d.door.withdraw(id, t(record && record.enabled && !record.refused ? 'main.plugins.write.revoked' : 'main.plugins.write.pluginOff'));
    return;
  }
  const request = (a.unit ?? {}).request as PluginAskUnit['request'] | undefined;
  await d.door.send(id, request ? () => sendRequestWrite(record, request, { issue: a.issue, actionId: a.id, kind: a.kind, key: a.key, summary: a.summary }, d) : undefined);
}

/** Arms the moment an announced write goes out: at its deadline, unless the person blocked it meanwhile. */
function arm(a: ReleaseAction, d: PluginsDeps = pluginsDeps): void {
  disarm(a.id);
  const due = Date.parse(String((a.unit ?? {}).due ?? ''));
  const wait = Number.isFinite(due) ? Math.max(0, due - Date.now()) : 0;
  timers.set(
    a.id,
    setTimeout(() => {
      timers.delete(a.id);
      void sendIfAllowed(a.id, d).catch((e) => console.error('[plugins] announced write', e instanceof Error ? e.message : e));
    }, wait),
  );
}

function disarm(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

/** Blocks an announced write and takes back the permission that let it go: the write never goes out and the plugin asks again next time. */
export async function revokePluginWrite(actionId: string, d: PluginsDeps = pluginsDeps): Promise<PluginsView> {
  const a = d.door.writes().find((x) => x.id === actionId);
  if (!a) throw new Error(t('main.actions.handled'));
  disarm(actionId);
  d.door.withdraw(actionId, t('main.plugins.write.revoked'));
  const plugin = String((a.unit ?? {}).plugin ?? '');
  const record = d.read(d.dir(), d.config()).find((r) => r.id === plugin);
  if (record) {
    d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...record.allow, write: false }, allowedFor: record.reach })));
    setSession(plugin, record.reach, { write: false });
  }
  return listPlugins(d);
}

// ---- the audit of what a plugin reached ----------------------------------------------------------------------------------------------------

/** The destination a plugin's sandbox reached is a fact of the app's audit log: what went out from a plugin is never invisible. */
function auditProxy(record: PluginRecord, context: PluginContext, decision: { host: string; port: number; allowed: boolean; why?: string }): void {
  try {
    recordWrite({
      kind: 'plugin-write',
      issue: context.issue,
      target: decision.host ? `${decision.host}:${decision.port}` : '—',
      via: 'plugin',
      fields: { plugin: record.id, allowed: String(decision.allowed), ...(decision.why ? { why: decision.why } : {}) },
      ok: decision.allowed,
      code: null,
      result: decision.allowed ? t('main.plugins.network.allowed') : t(`main.plugins.network.refused.${decision.why ?? 'host'}`),
      origin: { actionId: '', kind: 'plugin', key: record.id, summary: null },
      by: record.id,
    });
  } catch (e) {
    console.error('[plugins] could not record a network decision', e instanceof Error ? e.message : e);
  }
}

/** What the plugins that are on tell the agents: one note per plugin, with its name, added to every stage's context as the plugin's own words. */
export function pluginNotes(d: PluginsDeps = pluginsDeps): { name: string; note: string }[] {
  // Only a plugin that can run: one missing a required setting would have the agents ask for something nothing answers.
  const runnable = (r: PluginRecord): boolean => !r.settings.some((s) => s.required && (s.kind === 'secret' ? !d.secretFilled(r.id, s.key) : !(r.values[s.key] ?? '').trim()));
  const oneLine = (s: string, max: number): string => s.replace(/\s+/g, ' ').trim().slice(0, max);
  const out: { name: string; note: string }[] = [];
  let size = 0;
  // Every stage carries these lines: each on one line (no note can pass for another plugin's), and all of them within a budget.
  for (const r of d.read(d.dir(), d.config()).filter((x) => x.enabled && !x.refused && x.agents && runnable(x))) {
    const note = { name: oneLine(r.name, 60), note: oneLine(r.agents as string, 1000) };
    size += note.name.length + note.note.length + 3;
    if (size > NOTES_MAX) break;
    out.push(note);
  }
  return out;
}

/** The most the plugins' notes may add to a stage's context, all of them together. */
const NOTES_MAX = 4000;

/** The run a live event of the runner carries: the app reads its state here and never trusts a stored one. */
export function liveContext(run: Run, context: { stage?: string } = {}): PluginContext {
  return { issue: run.issue.iid, issueTitle: run.issue.title, stage: context.stage ?? run.stage, runId: run.id };
}

export const pluginsModule: Module = (ctx: ModuleContext) => {
  ctx.handle('plugins:list', () => listPlugins());
  // Only the computer switches a plugin or takes a permission back: desktop-only (webPolicy.ts), like the other boundary decisions. Answering a request
  // is open to a paired browser only for what a call from a conversation opened (`answerPluginAsk` refuses the rest by the call's origin); blocking an
  // announced write is `actions:skip`, which a paired browser may do: it only ever takes something away.
  ctx.handle('plugins:set-enabled', (id: string, enabled: boolean) => setPluginEnabled(String(id), enabled === true));
  ctx.handle('plugins:settings', (dir: string, confirmSeconds: number) => setPluginSettings(String(dir ?? ''), Number(confirmSeconds)));
  ctx.handle('plugins:set-setting', (id: string, key: string, value: string) => setPluginSetting(String(id), String(key), String(value ?? '')));
  ctx.handle('plugins:set-secret', (id: string, key: string, value: string) => setPluginSecret(String(id), String(key), String(value ?? '')));
  ctx.handle('plugins:answer', (id: string, answer: PluginAnswer) => answerPluginAsk(String(id), answer));
  ctx.handle('plugins:revoke', (id: string, need: PluginNeed) => {
    if (!isPluginNeed(need)) throw new Error(t('main.plugins.ask.badAnswer'));
    return revokePluginAllow(String(id), need);
  });
  ctx.handle('plugins:revoke-write', (actionId: string) => revokePluginWrite(String(actionId)));
  // The document types the plugins that are on add enter the list the gate already walks: read at the moment of use, so switching a plugin off retires them.
  gatePluginDocuments.files = () => pluginsDeps.read(pluginsDeps.dir(), pluginsDeps.config()).filter((r) => r.enabled && !r.refused).flatMap((r) => r.documents.map((x): [string, string] => [x.name, x.label]));
  // A request set aside from the list (a paired browser may refuse) lets its run go on and says so where the request came from; a blocked write is never sent.
  onActionSkipped((a) => {
    if (a.kind === 'plugin-write') disarm(a.id);
    if (a.kind === 'plugin-ask') noteDelivery(unitOf(a), { code: `run.plugin.refused.${unitOf(a).need}`, params: { plugin: unitOf(a).name } }, pluginsDeps);
  });
  // A write announced before the app closed gets its whole deadline again: nothing goes out without the person having had the interval.
  for (const a of pluginsDeps.door.writes()) arm(rearmPluginWrite(a.id, pluginConfig().confirmSeconds));
};

export type { PluginsView };
