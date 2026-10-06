import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
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
import { sandbox } from '../sandbox/workspace';
import { recordWrite } from '../auditoria';
import { getConfig, updateConfig } from '../workspaceConfig';
import { announcePluginWrite, onActionSkipped, pendingPluginAsks, pendingPluginWrites, proposePluginAsk, rearmPluginWrite, sendDuePluginWrite, settlePluginAsk, skipAction, writePluginNow, type PluginAskUnit, type PluginWriteInput } from '../actions';
import { gatePluginDocuments } from '../gate';
import { workspaceDir } from '../workspaces-core';
import { allowOf, pluginsDirOf, pluginViews, readPlugins, withChoice } from './read';
import { runPlugin, type PluginRun, type PluginTarget, type RunnablePlugin } from './runtime';
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
  /** The run the event belongs to; a plugin is only called for a run, whose cycle folder its document goes into. */
  runId?: string;
}

/** What the door of Actions offers the service: requests, their answers and the writes. Injected, so a test needs no data folder. */
export interface PluginDoor {
  ask(input: Parameters<typeof proposePluginAsk>[0]): ReleaseAction | null;
  pending(): ReleaseAction[];
  settle(id: string, allowed: boolean, words: string): ReleaseAction;
  now(w: { issue: number; key: string; summary: string; plugin: string }, input: PluginWriteInput): Promise<string>;
  announce(input: Parameters<typeof announcePluginWrite>[0]): ReleaseAction | null;
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
  /** The workspace's sandbox settings: its limits and folders (the network of a plugin is its own). */
  sandbox(): RunnerSandbox;
  /** Runs one plugin's entry script inside the stage sandbox, with the settings the person's permission produced. */
  run(plugin: RunnablePlugin, event: PluginEvent | string, target: PluginTarget, config: RunnerSandbox, onProxy: (d: { host: string; port: number; allowed: boolean; why?: string }) => void): Promise<PluginRun>;
  door: PluginDoor;
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
const session = new Map<string, PluginAllow>();

/** What the person allowed a plugin for this session of the app. */
export const sessionOf = (id: string): PluginAllow => session.get(id) ?? NONE;

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

export const pluginsDeps: PluginsDeps = {
  dir: pluginsDir,
  config: pluginConfig,
  read: (dir, config) => readPlugins(dir, config),
  save: (change) => updateConfig((c) => ({ ...c, plugins: { ...neutralPlugins(), ...c.plugins, list: change(c.plugins?.list ?? []) } })),
  settings: (values) => updateConfig((c) => ({ ...c, plugins: { ...neutralPlugins(), ...c.plugins, ...values } })),
  target: targetOf,
  sandbox: () => getConfig().runner.sandbox,
  run: (plugin, event, target, config, onProxy) => runPlugin({ sandbox, config, onProxy }, plugin, event, target),
  door: { ask: proposePluginAsk, pending: pendingPluginAsks, settle: settlePluginAsk, now: writePluginNow, announce: announcePluginWrite },
  settled: (runId, note) => pluginRunHooks.settled(runId, note),
};

// ---- the list and the switches -------------------------------------------------------------------------------------------------------------

const unitOf = (a: ReleaseAction): PluginAskUnit => (a.unit ?? {}) as unknown as PluginAskUnit;
const waitingOf = (d: PluginsDeps) => (id: string): number => d.door.pending().filter((a) => unitOf(a).plugin === id).length;

/** The list the interface shows: the folder, the deadline of the warning, and per plugin what it offers, asks for and was allowed. */
export function listPlugins(d: PluginsDeps = pluginsDeps): PluginsView {
  const config = d.config();
  return { dir: d.dir(), confirmSeconds: config.confirmSeconds, plugins: pluginViews(d.read(d.dir(), config), sessionOf, waitingOf(d)) };
}

const recordOf = (id: string, d: PluginsDeps): PluginRecord => {
  const record = d.read(d.dir(), d.config()).find((r) => r.id === id && !r.refused);
  if (!record) throw new Error(t('main.plugins.unknown', { id }));
  return record;
};

/** Turns a plugin on or off. The choice is the person's, on the computer; only that plugin's entry of the workspace's list changes. */
export function setPluginEnabled(id: string, enabled: boolean, d: PluginsDeps = pluginsDeps): PluginsView {
  const record = recordOf(id, d);
  d.save((list) => withChoice(list, record, (c) => ({ ...c, enabled })));
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
  d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...allowOf(c.allow), [need]: false } })));
  session.set(id, { ...sessionOf(id), [need]: false });
  return listPlugins(d);
}

// ---- calling the plugins -------------------------------------------------------------------------------------------------------------------

const askKey = (id: string, need: PluginNeed, event: string, context: PluginContext): string => `plugin-ask:${id}:${need}:${context.runId ?? '-'}:${event}:${context.stage ?? '-'}`;
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

/** One call of one plugin, with what the person allowed it now and, when an answer is being carried out, what that answer allowed for this call. */
async function callPlugin(record: PluginRecord, event: string, context: PluginContext, d: PluginsDeps, once: Partial<PluginAllow>): Promise<PluginRun> {
  const permission: PluginPermission = { allow: record.allow, session: sessionOf(record.id), once };
  const target = context.runId ? d.target(context.runId) : null;
  if (!target) return fail(record.id, t('main.plugins.refusal.noRun', { plugin: record.name }));
  if (!mayReachNetwork(record.network, permission)) {
    const refused = ask(record, 'network', event, context, d, { hosts: record.network });
    return fail(record.id, refused ?? t('main.plugins.waiting.network', { plugin: record.name }));
  }
  const script = scriptOf(record);
  if (script === null) return fail(record.id, t('main.plugins.refusal.entry', { plugin: record.name }));
  const config = pluginNetworkSandbox(d.sandbox(), record.network, permission);
  const result = await d.run({ id: record.id, script, documents: record.documents.map((x) => ({ ...x, title: x.label })) }, event, target, config, (decision) => auditProxy(record, context, decision));
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
function ask(record: PluginRecord, need: PluginNeed, event: string, context: PluginContext, d: PluginsDeps, extra: { hosts?: string[]; text?: string }): string | null {
  const reversible = need === 'write' ? record.write?.reversible === true : true;
  const unit: PluginAskUnit = { plugin: record.id, name: record.name, need, reversible, runId: context.runId ?? null, event, stage: context.stage ?? null, hosts: extra.hosts ?? [], to: record.write?.to ?? null, text: extra.text ?? '' };
  try {
    d.door.ask({
      key: askKey(record.id, need, event, context),
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
    if (a) arm(a);
  } catch (e) {
    console.error('[plugins] could not announce a write', e instanceof Error ? e.message : e);
  }
}

// ---- the person's answer -------------------------------------------------------------------------------------------------------------------

/**
 * The person's answer to a plugin's request, on the computer. Allowing carries the call out at once (the plugin runs with the network, or the write
 * goes out); "session" and "always" also answer the other requests of the same plugin for the same thing. Refusing closes the request with the reason;
 * the plugin asks again at the next event it observes. Either way, a run held by the request goes on when none of its requests is left.
 */
export async function answerPluginAsk(id: string, answer: PluginAnswer, d: PluginsDeps = pluginsDeps): Promise<PluginsView> {
  if (!isPluginAnswer(answer)) throw new Error(t('main.plugins.ask.badAnswer'));
  const action = d.door.pending().find((a) => a.id === id);
  if (!action) throw new Error(t('main.actions.handled'));
  const unit = unitOf(action);
  if (!isPluginNeed(unit.need) || !pluginAnswers(unit.need, unit.reversible).includes(answer)) throw new Error(t('main.plugins.ask.badAnswer'));
  if (answer === 'refuse') {
    d.door.settle(id, false, t('main.plugins.ask.refused'));
    if (unit.runId) d.settled(unit.runId, { code: `run.plugin.refused.${unit.need}`, params: { plugin: unit.name } });
    return listPlugins(d);
  }
  const record = d.read(d.dir(), d.config()).find((r) => r.id === unit.plugin && !r.refused) ?? null;
  if (answer === 'always' && record) d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...allowOf(c.allow), [unit.need]: true } })));
  if (answer === 'session') session.set(unit.plugin, { ...sessionOf(unit.plugin), [unit.need]: true });
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
  try {
    if (!record || !record.enabled) note = { code: 'run.plugin.unavailable', params: { plugin: unit.name } };
    else {
      const context: PluginContext = { issue: a.issue, issueTitle: a.issueTitle, stage: unit.stage ?? undefined, runId: runId ?? undefined };
      if (unit.need === 'network') {
        const done = await callPlugin(d.read(d.dir(), d.config()).find((r) => r.id === record.id) ?? record, unit.event, context, d, { network: true });
        if (!done.ok && done.refused) note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: done.refused } };
      } else if (unit.reversible) {
        await d.door.now({ issue: a.issue, key: `${a.key}:go`, summary: a.summary ?? '', plugin: unit.plugin }, { plugin: unit.plugin, to: unit.to ?? '', text: unit.text });
      } else {
        announce(record, context, { plugin: unit.plugin, to: unit.to ?? '', text: unit.text }, d);
      }
    }
  } catch (e) {
    note = { code: 'run.plugin.failed', params: { plugin: unit.name, reason: e instanceof Error ? e.message : String(e) } };
  }
  if (runId) d.settled(runId, note);
}

/** Whether a run has a plugin request waiting for the person, and which: the runner does not start another stage of it meanwhile. */
export function pluginHold(runId: string, d: PluginsDeps = pluginsDeps): { plugin: string; need: PluginNeed } | null {
  const a = d.door.pending().find((x) => unitOf(x).runId === runId);
  return a ? { plugin: unitOf(a).name, need: unitOf(a).need } : null;
}

// ---- the warning with a deadline -----------------------------------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Arms the moment an announced write goes out: at its deadline, unless the person blocked it meanwhile. */
function arm(a: ReleaseAction): void {
  disarm(a.id);
  const due = Date.parse(String((a.unit ?? {}).due ?? ''));
  const wait = Number.isFinite(due) ? Math.max(0, due - Date.now()) : 0;
  timers.set(
    a.id,
    setTimeout(() => {
      timers.delete(a.id);
      void sendDuePluginWrite(a.id).catch((e) => console.error('[plugins] announced write', e instanceof Error ? e.message : e));
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
  const a = pendingPluginWrites().find((x) => x.id === actionId);
  if (!a) throw new Error(t('main.actions.handled'));
  disarm(actionId);
  await skipAction(actionId);
  const plugin = String((a.unit ?? {}).plugin ?? '');
  const record = d.read(d.dir(), d.config()).find((r) => r.id === plugin);
  if (record) d.save((list) => withChoice(list, record, (c) => ({ ...c, allow: { ...allowOf(c.allow), write: false } })));
  session.set(plugin, { ...sessionOf(plugin), write: false });
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

/** The run a live event of the runner carries: the app reads its state here and never trusts a stored one. */
export function liveContext(run: Run, context: { stage?: string } = {}): PluginContext {
  return { issue: run.issue.iid, issueTitle: run.issue.title, stage: context.stage ?? run.stage, runId: run.id };
}

export const pluginsModule: Module = (ctx: ModuleContext) => {
  ctx.handle('plugins:list', () => listPlugins());
  // Only the computer switches a plugin, answers its requests or takes a permission back: desktop-only (webPolicy.ts), like the other boundary decisions.
  // Blocking an announced write is `actions:skip`, which a paired browser may do: it only ever takes something away.
  ctx.handle('plugins:set-enabled', (id: string, enabled: boolean) => setPluginEnabled(String(id), enabled === true));
  ctx.handle('plugins:settings', (dir: string, confirmSeconds: number) => setPluginSettings(String(dir ?? ''), Number(confirmSeconds)));
  ctx.handle('plugins:answer', (id: string, answer: PluginAnswer) => answerPluginAsk(String(id), answer));
  ctx.handle('plugins:revoke', (id: string, need: PluginNeed) => {
    if (!isPluginNeed(need)) throw new Error(t('main.plugins.ask.badAnswer'));
    return revokePluginAllow(String(id), need);
  });
  ctx.handle('plugins:revoke-write', (actionId: string) => revokePluginWrite(String(actionId)));
  // The document types the plugins that are on add enter the list the gate already walks: read at the moment of use, so switching a plugin off retires them.
  gatePluginDocuments.files = () => pluginsDeps.read(pluginsDeps.dir(), pluginsDeps.config()).filter((r) => r.enabled && !r.refused).flatMap((r) => r.documents.map((x): [string, string] => [x.name, x.label]));
  // A request set aside from the list (a paired browser may refuse) lets its run go on; a blocked write is never sent.
  onActionSkipped((a) => {
    if (a.kind === 'plugin-write') disarm(a.id);
    if (a.kind === 'plugin-ask' && unitOf(a).runId) pluginsDeps.settled(unitOf(a).runId as string, { code: `run.plugin.refused.${unitOf(a).need}`, params: { plugin: unitOf(a).name } });
  });
  // A write announced before the app closed gets its whole deadline again: nothing goes out without the person having had the interval.
  for (const a of pendingPluginWrites()) arm(rearmPluginWrite(a.id, pluginConfig().confirmSeconds));
};

export type { PluginsView };
