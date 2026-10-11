import type { Card } from '../../shared/types';
import type { WorkspaceConfig } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import { waitingRuns } from '../../shared/runs/view';
import { actionSubject } from '../actions';
import { recordWrite } from '../auditoria';
import { SECRET_RAISED, secretAuditEntry } from '../decisionAudit';
import { describeStep } from '../browser/asks';
import { ceremonyCommands } from '../ceremonyCommands';
import { getSettings } from '../config';
import { forumStore } from '../forum';
import { priorityDecision } from '../priority';
import { screenAsks } from '../runner/module';
import { runStore } from '../runs';
import { secrets } from '../secrets';
import { proposePriority } from '../store';
import { turnAsks } from '../turnAsks';
import { assertExternalWrite } from '../workspace';
import { getConfig } from '../workspaceConfig';
import { pluginsDeps } from '../plugins/module';
import { loadCards } from '../cards';
import { ToolError } from '../engine/open/tools/types';
import { type Op, keyOf } from './doorTable';
import { PathError, applyPath, readPath } from './configPath';
import { personaSettingsRefusal } from './settingsGuard';
import type { AnswerSession } from './session';

// What each operation of the persona's door builds, says and runs beyond the table (#248): the arguments of the channel from the tool's, the subject the app itself puts before a
// person to decide (read at the moment of the act and never taken from the model), the slice of a result worth giving the model, and the four operations that have no channel.

export type Values = Record<string, unknown>;

export interface OpCtx {
  config(): WorkspaceConfig;
  /** The card of the day with this reference; a reference nobody loaded is a tool error that names the first few. */
  card(ref: string): Promise<Card>;
}

export interface RunCtx extends OpCtx {
  session: AnswerSession;
  via: 'persona';
}

export interface Hooks {
  build?(v: Values, c: OpCtx): unknown[] | Promise<unknown[]>;
  subject?(v: Values, c: OpCtx): string | null | Promise<string | null>;
  shape?(result: unknown, v: Values): unknown;
  /** A reason to refuse, from the arguments just built, in the same synchronous stretch in which the handler would start; the act is then recorded as refused. */
  guard?(args: unknown[], v: Values, c: OpCtx): string | null;
  /** Names a raise the operation makes that the configuration's diff does not show (a secret that runs a command): marked in the audit line and in the act line. */
  raised?(v: Values): string[];
  /** The operations with no channel run here. */
  run?(v: Values, c: RunCtx): unknown | Promise<unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const only = <T extends Values>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** The cards of the day as loaded, with no refresh: a reference is checked against what the app already holds, as the button tool checks a target. */
export async function cardOf(ref: string): Promise<Card> {
  const { cards } = await loadCards(100);
  const found = cards.find((c) => c.ref === ref);
  if (!found) throw new ToolError(t('main.persona.door.noCard', { ref, list: cards.slice(0, 5).map((c) => c.ref).join(', ') || '-' }));
  return found;
}

export const defaultCtx = (): OpCtx => ({ config: getConfig, card: cardOf });

/** A card, or the issue the host lists by its project and number: what the board's writes take as their target. */
function targetOf(v: Values): string | { project: string; iid: number } {
  const id = str(v.id);
  const project = str(v.project);
  const hasHost = project !== '' || v.iid !== undefined;
  if (id && hasHost) throw new ToolError(t('main.persona.door.board.twoTargets'));
  if (id) return id;
  if (project && typeof v.iid === 'number') return { project, iid: v.iid };
  throw new ToolError(t('main.persona.door.board.noTarget'));
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Walks the schema of the configuration to the fragment a path names; `name[id]` goes into `items`. */
export function schemaAt(schema: unknown, path: string): unknown {
  let at: unknown = schema;
  for (const part of path.split('.')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\[[^\]]+\])?$/.exec(part);
    const node = at as { properties?: Record<string, unknown>; items?: unknown } | undefined;
    if (!m || !node || typeof node !== 'object') return undefined;
    at = node.properties?.[m[1]];
    if (part.includes('[') && at && typeof at === 'object') at = (at as { items?: unknown }).items;
    if (at === undefined) return undefined;
  }
  return at;
}

function pathProblem(e: unknown, path: string): ToolError {
  if (e instanceof PathError) return new ToolError(t(`main.persona.door.path.${e.code}`, { path }));
  return e instanceof ToolError ? e : new ToolError(String(e instanceof Error ? e.message : e));
}

const needsValue = (v: Values): void => {
  if ((v.mode ?? 'set') !== 'remove' && v.value === undefined) throw new ToolError(t('main.persona.door.arg.required', { name: 'value' }));
};

/** The pieces of a run, an action or a conversation the person is shown to decide: the app reads them, so the record cannot be wrong because the model misread something. */
const runLine = (id: unknown): string | null => {
  const run = typeof id === 'string' ? runStore().get(id) : null;
  return run ? `${run.issue.ref} ${run.issue.title} (${run.stage}, ${run.status})` : null;
};

export const HOOKS: Record<string, Hooks> = {
  // ---- Overview
  'Overview.cards': { build: (v) => [typeof v.limit === 'number' ? v.limit : 50, v.refresh === true, str(v.squad) || undefined] },
  'Overview.audit': { shape: (r) => (Array.isArray(r) ? r.slice(0, 60) : r) },

  // ---- Runs
  'Runs.accept': { subject: (v) => runLine(v.run) },
  'Runs.return': { subject: (v) => runLine(v.run) },
  'Runs.gate': { subject: (v) => [str(v.action), runLine(v.run)].filter(Boolean).join(' · ') },
  'Runs.answer': { subject: (v) => runLine(v.run) },
  'Runs.sendBack': { subject: (v) => [`→ ${str(v.stage)}`, runLine(v.run)].filter(Boolean).join(' · ') },
  'Runs.cancel': { subject: (v) => runLine(v.run) },
  'Runs.retry': { subject: (v) => runLine(v.run) },
  'Runs.retryPr': { subject: (v) => runLine(v.run) },
  'Runs.startStage': { subject: (v) => runLine(v.run) },
  'Runs.command': {
    // The command the run waits to run on this computer, as the run holds it: what the person would be shown, not what the model says it is.
    subject: (v) => {
      const run = typeof v.run === 'string' ? runStore().get(v.run) : null;
      return [str(v.decision), run?.command?.command ?? str(v.command), runLine(v.run)].filter(Boolean).join(' · ');
    },
  },

  // ---- Actions
  'Actions.approve': { subject: (v) => actionSubject(str(v.id)) },
  'Actions.skip': { subject: (v) => actionSubject(str(v.id)) },
  'Actions.freeBranch': { subject: (v) => actionSubject(str(v.id)) },
  'Actions.conflictApply': { build: (v) => [v.id, { skipTests: v.skipTests === true }] },

  // ---- Board
  'Board.create': { build: (v) => [only({ title: v.title, body: v.body, column: v.column, squad: v.squad, priority: v.priority, repo: v.repo, labels: v.labels })] },
  'Board.update': { build: (v) => [targetOf(v), only({ title: v.title, body: v.body, column: v.column, squad: v.squad, priority: v.priority, labels: v.labels })] },
  'Board.comment': { build: (v) => [targetOf(v), v.body] },
  'Board.close': { build: (v) => [targetOf(v)] },
  'Board.reopen': { build: (v) => [targetOf(v)] },
  'Board.proposePriority': {
    subject: (v) => `${str(v.ref)} → ${str(v.to)}`,
    // A label change on the tracker: a proposal that waits in Actions, exactly as a priority saved from a ceremony makes it. A test workspace refuses it like any write that leaves the machine.
    async run(v, c) {
      assertExternalWrite(t('main.priority.whatWrite'));
      const decision = priorityDecision(await c.card(str(v.ref)), str(v.to));
      if (!decision.priority || decision.priority.noWrite) return decision.dest;
      const written = await proposePriority(decision);
      if (!written.ok) throw new ToolError(written.detail);
      return written.detail;
    },
  },

  // ---- Conversations
  'Conversations.attachmentGet': {
    // The bytes of a file are not carried in a tool result: the reference and the size are.
    shape(r) {
      const got = r as { data?: unknown; ref?: unknown } | null;
      return got && typeof got === 'object' && 'data' in got ? { ref: got.ref, size: String(got.data ?? '').length } : r;
    },
  },
  'Conversations.post': { subject: (v) => forumStore().summary(str(v.thread))?.title ?? str(v.thread) },

  // ---- Memory
  'Memory.save': { build: (v) => [v.conversation, v.agent, v.id, v.revision, only({ title: v.title, text: v.text, kind: v.kind })] },

  // ---- Settings
  // No path: the top-level names, never the whole document (it is long, and holds the persona's own instructions and the team's).
  'Settings.get': { shape: (r, v) => (typeof v.path === 'string' && v.path ? slice((r as { config?: unknown })?.config, v.path) : topLevel((r as { config?: unknown })?.config)) },
  'Settings.getApp': { shape: (r, v) => slice(r, v.path) },
  'Settings.schema': { shape: (r, v) => (typeof v.path === 'string' && v.path ? (schemaAt(r, v.path) ?? null) : r) },
  'Settings.set': {
    // The whole next configuration from one path: a long document never goes through the model, and the save validates it like any other.
    build(v, c) {
      needsValue(v);
      try {
        return [applyPath(c.config(), str(v.path), v.value, (v.mode as 'set' | 'append' | 'remove' | undefined) ?? 'set')];
      } catch (e) {
        throw pathProblem(e, str(v.path));
      }
    },
    subject: (v) => `${str(v.path)} (${str(v.mode) || 'set'})`,
    guard: (args, _v, c) => personaSettingsRefusal(c.config(), args[0] as WorkspaceConfig),
  },
  'Settings.setApp': {
    build(v) {
      needsValue(v);
      try {
        return [applyPath(getSettings(), str(v.path), v.value, (v.mode as 'set' | 'append' | 'remove' | undefined) ?? 'set')];
      } catch (e) {
        throw pathProblem(e, str(v.path));
      }
    },
    subject: (v) => `${str(v.path)} (${str(v.mode) || 'set'})`,
  },
  'Settings.promptSet': { build: (v) => [v.id, v.language, typeof v.text === 'string' ? v.text : null], subject: (v) => `${str(v.id)} (${str(v.language)})` },

  // ---- Secrets
  'Secrets.set': {
    build(v) {
      const ref = str(v.ref);
      if (v.source === 'stored') {
        if (typeof v.value !== 'string' || !v.value) throw new ToolError(t('main.persona.door.arg.required', { name: 'value' }));
        return [{ ref, source: 'stored', value: v.value }];
      }
      if (v.source === 'command') {
        if (!str(v.command)) throw new ToolError(t('main.persona.door.arg.required', { name: 'command' }));
        return [{ ref, source: 'command', command: str(v.command), args: Array.isArray(v.args) ? v.args.map(String) : [] }];
      }
      if (!str(v.name)) throw new ToolError(t('main.persona.door.arg.required', { name: 'name' }));
      return [{ ref, source: 'env', name: str(v.name) }];
    },
    // A secret that runs a command is a command the app will run when it resolves it: the executable and how many arguments are said, so the record is not a bare name.
    subject: (v) => (v.source === 'command' ? `${str(v.ref)} (command: ${str(v.command)}, ${Array.isArray(v.args) ? v.args.length : 0} arguments)` : `${str(v.ref)} (${str(v.source)})`),
    raised: (v) => (v.source === 'command' ? [SECRET_RAISED] : []),
  },
  'Secrets.list': {
    // Names and where each comes from, as the screens list them; not the command line or the variable behind one, and never a value.
    run: () => secrets().list().map((s) => ({ ref: s.ref, source: s.source, available: s.available })),
  },
  'Secrets.read': {
    subject: (v) => str(v.ref),
    // The one place a value reaches the model. It joins the answer's mask first, so everything stored or shown from this answer holds the masked form.
    run(v, c) {
      const ref = str(v.ref);
      const source = secrets().list().find((s) => s.ref === ref)?.source;
      try {
        const value = secrets().resolve(ref);
        c.session.maskValue(value);
        recordWrite(secretAuditEntry({ op: 'read', ref, source, ok: true, via: 'persona' }));
        return value;
      } catch (e) {
        recordWrite(secretAuditEntry({ op: 'read', ref, source, ok: false, via: 'persona' }));
        throw e;
      }
    },
  },

  // ---- Plugins
  'Plugins.answer': {
    subject(v) {
      const asked = pluginsDeps.door.pending().find((a) => a.id === str(v.id));
      const unit = (asked?.unit ?? {}) as { name?: string; need?: string };
      return asked ? `${unit.name ?? ''} · ${unit.need ?? ''} → ${str(v.answer)}` : null;
    },
  },
  'Plugins.setSetting': { build: (v) => [v.id, v.key, typeof v.value === 'string' ? v.value : ''] },
  'Plugins.setSecret': { build: (v) => [v.id, v.key, typeof v.value === 'string' ? v.value : ''], subject: (v) => `${str(v.id)} · ${str(v.key)}` },

  // ---- Asks
  'Asks.screenAnswer': {
    // The step the app held, in the app's words, and the site: what the person is shown.
    subject(v) {
      const ask = screenAsks()?.list().find((a) => a.id === str(v.askId));
      if (!ask) return null;
      const what = ask.step ? describeStep(ask.step, ask.site) : (ask.agentWords ?? '');
      return [`${ask.agent}: ${what}`, ask.site, `→ ${str(v.decision)}`].filter(Boolean).join(' · ');
    },
  },
  'Asks.handoffDecline': { subject: (v) => screenAsks()?.list().find((a) => a.id === str(v.askId))?.agent ?? null },
  'Asks.turnAnswer': {
    subject(v) {
      const ask = turnAsks.list().find((a) => a.id === str(v.id));
      return ask ? `${ask.agent} (${ask.of}, ${ask.used}) → ${str(v.choice)}` : null;
    },
  },
  'Asks.ceremonyCommand': {
    subject(v) {
      const c = ceremonyCommands.list().find((x) => x.id === str(v.id));
      return c ? `${c.agent}: ${c.command} → ${str(v.verdict)}` : null;
    },
  },
  'Asks.list': {
    // Everything that waits for the person, in one read: the app's browser holds and confirmations and hand-off requests, the questions at a turn limit, the ceremonies' commands
    // and the runs that need a person.
    run: () => ({
      screen: (screenAsks()?.list() ?? []).map((a) => ({ id: a.id, kind: a.kind, agent: a.agent, site: a.site, ...(a.step ? { step: describeStep(a.step, a.site) } : {}), ...(a.agentWords ? { words: cut(a.agentWords, 300) } : {}) })),
      turnLimits: turnAsks.list().map((a) => ({ id: a.id, agent: a.agent, of: a.of, ref: a.ref, stage: a.stage, used: a.used })),
      ceremonyCommands: ceremonyCommands.list(),
      runs: waitingRuns(runStore().list()).map((r) => ({ id: r.id, ref: r.issue.ref, title: r.issue.title, status: r.status, stage: r.stage, ...(r.question ? { question: cut(r.question.text ?? '', 300) } : {}), ...(r.command ? { command: cut(r.command.command ?? '', 300) } : {}) })),
    }),
  },

  // ---- Ceremonies
  'Ceremonies.gateAnswer': { build: (v) => [v.id, v.q, only({ choice: v.choice, text: v.text })] },
  'Ceremonies.deepAsk': { build: async (v, c) => [await c.card(str(v.card)), v.question, typeof v.sessionId === 'string' ? v.sessionId : null] },
  'Ceremonies.agenda': { build: async (v, c) => [await cards(v.refs, c), v.ceremonyId] },
  'Ceremonies.teamsText': { build: async (v, c) => [v.minutes, await cards(v.refs, c)] },
  'Ceremonies.discussionsExplain': { build: async (v, c) => [await c.card(str(v.card)), v.mr, v.discussion] },
  'Ceremonies.discussionsReply': { build: async (v, c) => [await c.card(str(v.card)), v.mr, v.discussion, v.body] },
  'Ceremonies.discussionsResolve': { build: async (v, c) => [await c.card(str(v.card)), v.mr, v.discussion] },
  'Ceremonies.effectsMark': { build: (v) => [v.effect, typeof v.ceremonyId === 'string' ? v.ceremonyId : null, v.done] },
};

function topLevel(doc: unknown): string[] {
  return doc && typeof doc === 'object' ? Object.keys(doc) : [];
}

function slice(doc: unknown, path: unknown): unknown {
  if (typeof path !== 'string' || !path) return doc;
  try {
    return readPath(doc, path) ?? null;
  } catch (e) {
    throw pathProblem(e, path);
  }
}

async function cards(refs: unknown, c: OpCtx): Promise<Card[]> {
  if (!Array.isArray(refs)) throw new ToolError(t('main.persona.door.arg.type', { name: 'refs', type: 'list' }));
  return Promise.all(refs.slice(0, 50).map((r) => c.card(String(r))));
}

/** The channel's arguments from the tool's, in the channel's order: the default for an operation that has no `build` of its own. A card argument is resolved to the card. */
export async function positional(op: Op, v: Values, c: OpCtx): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const spec of op.args) {
    const given = v[spec.name];
    out.push(spec.type === 'card' && typeof given === 'string' ? await c.card(given) : given);
  }
  while (out.length && out[out.length - 1] === undefined) out.pop();
  return out;
}

export const hooksOf = (op: Op): Hooks => HOOKS[keyOf(op)] ?? {};
