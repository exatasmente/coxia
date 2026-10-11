import type { AuditBasis, AuditEntry } from '../../shared/auditoria';
import { t } from '../../shared/i18n';
import { parseTarget, type PushTarget } from '../../shared/push';
import { recordWrite } from '../auditoria';
import { configAuditEntry, raisedFields } from '../configAudit';
import { ToolError, clip } from '../engine/open/tools/types';
import { redact } from '../errorlog-core';
import { forumStore } from '../forum';
import { fence } from '../runner/prompt';
import { invokePersona } from '../rpc';
import { getConfig } from '../workspaceConfig';
import { type Act, newActId, runAct } from './act';
import { WHY_MAX, checkArgs } from './args';
import { type Hooks, type OpCtx, type Values, defaultCtx, hooksOf, positional } from './doorOps';
import { type Op, OPS, TOOL_NAMES, findOp, isTool, keyOf, opsOf } from './doorTable';
import { signHostText } from './footer';
import { beginInflight } from './inflight';
import { personaStop } from './runtime';
import { ACT_LINES_MAX, type AnswerSession } from './session';

// The persona's door (#248): the one place the persona acts from. It runs the handler of a channel, the function the window's own call runs, under the persona origin, so the
// validation, the test-workspace guard, the handler's own audit line, the error log and the activity job stay where they are, once. What it adds, no handler has: it refuses
// when the persona is stopped, it keeps the record of what was read, it says the act in the conversation and it stamps the audit (through the act's scope, which `recordWrite` reads).
// The phone's policy is not consulted anywhere in it: that is the limit of a device, and the persona has none. The channels of the stop are not in the table, so the persona
// cannot stop, resume or change its own stop.

/** A result is cut at this size before it is given to the model. */
export const RESULT_MAX = 12_000;
/** The subject of an act in the conversation. */
const LINE_SUBJECT_MAX = 120;
const SUBJECT_MAX = 300;
/** The mark of an audit line and of a line in the conversation for a call the door refused before it reached any handler. */
export const EARLY = 'before-handler';
/** What the stop's line says of an act in flight. */
const INFLIGHT_MAX = 120;

export interface DoorDeps {
  /** The operations the door knows; a test adds one with a slow `build`. */
  table?: readonly Op[];
  hooks?: (op: Op) => Hooks;
  /** Whether the persona is stopped: read in the same turn of the event loop in which a handler starts. */
  stopped?: () => boolean;
  ctx?: () => OpCtx;
}

export interface Door {
  /** One call of a tool: its text for the model, or a ToolError the model reads and recovers from. */
  run(session: AnswerSession, tool: string, input: Record<string, unknown>): Promise<string>;
  /** The answer is over: the acts past the cap are said in one line. */
  finish(session: AnswerSession): void;
}

/** A value of a write's argument with the answer's masked values taken out of every text in it, JSON included; the shape and the other types stay. */
function maskedArg(value: unknown, mask: (text: string) => string): unknown {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map((x) => maskedArg(x, mask));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, maskedArg(x, mask)]));
  return value;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A result as the model reads it: compact JSON with long text and long lists cut, so no operation can fill the context by itself. */
export function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  // Only the ancestors of the value being written count: a value shared by two branches is shown twice, and only a real cycle is cut.
  const ancestors: object[] = [];
  const text = JSON.stringify(
    value,
    function (this: unknown, _key: string, v: unknown) {
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}… (${v.length} characters)` : v;
      if (typeof v === 'bigint') return String(v);
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `[${v.byteLength} bytes]`;
      if (Array.isArray(v) && v.length > 60) v = [...v.slice(0, 60), `… ${v.length - 60} more`];
      if (v && typeof v === 'object') {
        if (ancestors.includes(v)) return '[circular]';
        ancestors.push(v);
      }
      return v;
    },
  );
  return text ?? '';
}

/** A refusal, a failure: what a handler said, masked and cut, for the model and for the line in the conversation. */
const reasonOf = (e: unknown, mask: (text: string) => string): string => mask(redact(oneLine(e instanceof Error ? e.message : String(e)))).slice(0, 400);

/** What a handler answered when it refused without throwing (`{ ok: false, reason }`): the reason, or null for a result that is not a refusal. */
function refusalOf(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const o = result as { ok?: unknown; reason?: unknown; code?: unknown; text?: unknown };
  if (o.ok !== false) return null;
  const why = [o.reason, o.code, o.text].find((v) => typeof v === 'string' && v);
  return typeof why === 'string' ? why : 'refused';
}

/** The target an act line offers as a button, from what the operation was about; null for one that has no screen of its own. */
function lineTarget(op: Op, v: Values): PushTarget | null {
  const run = typeof v.run === 'string' ? v.run : null;
  const screens: Record<string, string> = { Runs: 'runs', Actions: 'actions', Board: 'board', Memory: 'memory', Settings: 'settings' };
  if (op.tool === 'Runs' && run) return parseTarget({ to: 'run', id: run });
  if (op.tool === 'Conversations' && typeof v.thread === 'string') return parseTarget({ to: 'forum', id: v.thread });
  if (op.tool === 'Memory' && op.op.startsWith('procedure')) return parseTarget({ to: 'procedures' });
  return screens[op.tool] ? parseTarget({ to: screens[op.tool] }) : null;
}

/** What an operation was about, for the record of what was read: the arguments that name the thing, joined. */
function targetText(op: Op, v: Values): string {
  const parts = op.args.filter((a) => a.target).map((a) => v[a.name]).filter((x) => x !== undefined && x !== '');
  return cut(parts.map(String).join(' '), 120);
}

export function createDoor(deps: DoorDeps = {}): Door {
  const table = deps.table ?? OPS;
  const hooks = deps.hooks ?? hooksOf;
  const stopped = deps.stopped ?? (() => personaStop().stopped());
  const context = deps.ctx ?? defaultCtx;
  const find = (tool: string, name: string): Op | undefined => (deps.table ? table.find((o) => o.tool === tool && o.op === name) : findOp(tool, name));

  /** The basis of a write: the subject the app read itself, and the reads of this answer that name the same thing first, then the newest. */
  function basisOf(session: AnswerSession, subject: string, v: Values): AuditBasis {
    const named = new Set(Object.values(v).filter((x): x is string => typeof x === 'string' && x.length > 2));
    const relevant = (target: string): boolean => !!target && (subject.includes(target) || named.has(target));
    const newest = [...session.reads].reverse();
    const ordered = [...newest.filter((r) => relevant(r.target)), ...newest.filter((r) => !relevant(r.target))];
    return { subject, reads: ordered.slice(0, 8), message: session.seq };
  }

  /** The line in the persona's conversation, before the answer is posted: stored, and worded by whoever reads it. */
  function say(session: AnswerSession, o: { tool: string; op: string; id: string; subject: string; reason: string | null; raised: string[]; target: PushTarget | null; early?: { problem: string; arg?: string } }): void {
    if (session.acts.lines >= ACT_LINES_MAX) {
      session.acts.more += 1;
      return;
    }
    session.acts.lines += 1;
    try {
      forumStore().append(session.thread, {
        kind: 'system',
        author: { type: 'app' },
        code: 'persona.act',
        params: {
          tool: o.tool,
          op: o.op,
          subject: cut(session.maskText(o.subject), LINE_SUBJECT_MAX),
          result: o.reason === null ? 'ok' : 'refused',
          id: o.id,
          ...(o.early ? { stage: EARLY, problem: o.early.problem, ...(o.early.arg ? { arg: cut(session.maskText(o.early.arg), 60) } : {}) } : {}),
          ...(o.reason ? { reason: cut(o.reason, LINE_SUBJECT_MAX) } : {}),
          ...(o.raised.length ? { raised: o.raised.join(', ') } : {}),
          ...(o.target ? { target: JSON.stringify(o.target) } : {}),
        },
      });
    } catch (e) {
      console.error('[persona] could not record an act in the conversation', e instanceof Error ? e.message : e);
    }
  }

  /**
   * A call refused before any handler (the operation does not exist, or an argument is wrong): nothing was attempted, but the person is told it was tried. One `act` line marked
   * `before-handler` in the audit and one line in the conversation, for a write and for an operation that does not exist (it may have been meant as one); a read that is badly
   * formed leaves neither, as no read does. The words of the line are made by the viewer's catalog from `problem` and `arg`.
   */
  function refuseEarly(session: AnswerSession, o: { tool: string; op: string; def: Op | null; input: Record<string, unknown>; problem: string; arg?: string; reason: string }): void {
    if (o.def && !o.def.write) return;
    const mask = (text: string): string => session.maskText(text);
    const id = newActId();
    const op = cut(oneLine(o.op), 60) || '-';
    const arg = o.arg ? cut(oneLine(o.arg), 60) : undefined;
    const act: Act = {
      open: true,
      id,
      door: session.door,
      said: typeof o.input.why === 'string' ? cut(oneLine(o.input.why), WHY_MAX) : '',
      mask,
      wrote: { count: 0, kinds: new Set() },
      basis: basisOf(session, '', o.input as Values),
    };
    try {
      runAct(act, () =>
        recordWrite({
          kind: 'act',
          issue: 0,
          target: `${o.tool}.${op}`,
          via: 'persona',
          fields: { tool: o.tool, op, refused: EARLY, problem: o.problem, ...(arg ? { arg } : {}) },
          ok: false,
          code: null,
          result: o.reason,
          origin: { actionId: '', kind: 'persona', key: `${o.tool}.${op}`, summary: null },
          by: null,
        }),
      );
    } catch (e) {
      console.error('[persona] could not record a refused call', e instanceof Error ? e.message : e);
    } finally {
      act.open = false;
    }
    say(session, { tool: o.tool, op, id, subject: '', reason: cut(mask(redact(o.reason)), LINE_SUBJECT_MAX), raised: [], target: null, early: { problem: o.problem, ...(arg ? { arg } : {}) } });
  }

  async function run(session: AnswerSession, toolName: string, input: Record<string, unknown>): Promise<string> {
    const mask = (text: string): string => session.maskText(text);
    const opName = typeof input.op === 'string' ? input.op : '';
    if (!(deps.table ? table.some((o) => o.tool === toolName) : isTool(toolName))) throw new ToolError(t('main.persona.door.unknownTool', { tool: toolName }));
    const op = find(toolName, opName);
    if (!op) {
      const ops = (deps.table ? table.filter((o) => o.tool === toolName) : opsOf(toolName as (typeof TOOL_NAMES)[number])).map((o) => o.op).join(', ');
      const reason = t('main.persona.door.unknownOp', { tool: toolName, op: opName.slice(0, 60) || '-', ops });
      refuseEarly(session, { tool: toolName, op: opName, def: null, input, problem: 'op', reason });
      throw new ToolError(reason);
    }

    // Refused before anything is attempted: the persona is stopped, or the call is not well formed. The model reads why; the person is told of a malformed write (`refuseEarly`),
    // and the Stop has its own line.
    if (stopped()) throw new ToolError(t('main.persona.door.stopped'));
    const checked = checkArgs(op.args, input, op.write);
    if (!checked.ok) {
      const reason = `${op.tool}.${op.op}: ${t(checked.problem.key, checked.problem.params)}`;
      const name = checked.problem.params.name;
      refuseEarly(session, { tool: op.tool, op: op.op, def: op, input, problem: checked.problem.key.slice(checked.problem.key.lastIndexOf('.') + 1), ...(typeof name === 'string' ? { arg: name } : {}), reason });
      throw new ToolError(reason);
    }
    const values: Values = { ...checked.values };
    const why = op.write ? oneLine(String(input.why)) : '';
    for (const spec of op.args) if (spec.secret && typeof values[spec.name] === 'string') session.maskValue(values[spec.name] as string);
    // What the persona writes is masked as well as what it reads: a value it read or was given to set must not be pasted into a comment, a post, a note or an answer, whatever it
    // does with it. The arguments marked secret are the values themselves, and go as given.
    if (op.write) for (const spec of op.args) if (!spec.secret && values[spec.name] !== undefined) values[spec.name] = maskedArg(values[spec.name], mask);
    // Text composed for the code host is signed by the app, never by the model, and only when the persona is the one who composed it.
    for (const name of op.hostText ?? []) if (typeof values[name] === 'string') values[name] = signHostText(values[name] as string);

    const h = hooks(op);
    const ctx = context();
    // Everything that needs an await happens before the next line that matters: after it, the latch is read and the handler starts with nothing in between.
    let args: unknown[] = [];
    let subject = '';
    try {
      args = op.channel ? await (h.build ? h.build(values, ctx) : positional(op, values, ctx)) : [];
      if (op.write) subject = oneLine((await h.subject?.(values, ctx)) ?? targetText(op, values));
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`${op.tool}.${op.op}: ${reasonOf(e, mask)}`);
    }
    subject = cut(mask(redact(subject)), SUBJECT_MAX);

    const act: Act = {
      open: true,
      id: newActId(),
      door: session.door,
      said: why,
      mask,
      wrote: { count: 0, kinds: new Set() },
      ...(op.write ? { basis: basisOf(session, subject, values) } : {}),
    };
    const before = op.write ? getConfig() : null;

    // ---- one synchronous stretch: the latch, the act in flight, the handler's first line. A tool call that was on its way when the Stop was pressed is refused here.
    if (stopped()) throw new ToolError(t('main.persona.door.stopped'));
    const finished = beginInflight(cut(`${op.tool}.${op.op} ${subject}`.trim(), INFLIGHT_MAX));
    // A change the persona may not make through the settings is refused here, in the same stretch, and recorded as a refused act.
    const blocked = h.guard ? h.guard(args, values, ctx) : null;
    // An operation with no channel (`h.run`) runs inside the act's scope, so every line it writes is stamped like a handler's; but it is not a call of the wrapper, so the call
    // origin does not say `persona` in it and it names the persona itself (`via: 'persona'`, as `Secrets.read` does).
    let pending: Promise<unknown>;
    try {
      pending = blocked ? Promise.resolve({ ok: false, reason: blocked }) : Promise.resolve(runAct(act, () => (op.channel ? invokePersona(op.channel, args) : h.run ? h.run(values, { ...ctx, session, via: 'persona' }) : Promise.reject(new Error(`no way to run ${keyOf(op)}`)))));
    } catch (e) {
      pending = Promise.reject(e);
    }
    // ----------------------------------------------------------------------------------------------------------------------------------------------------------------

    let result: unknown;
    let failure: unknown = null;
    try {
      result = await pending;
    } catch (e) {
      failure = e;
    }
    const refused = failure !== null ? reasonOf(failure, mask) : refusalOf(result) !== null ? mask(redact(String(refusalOf(result)))).slice(0, 400) : null;

    // The lines of the act are written inside it, so they carry who acted, the reason and what was read; then the act closes, and nothing it left running is the persona's.
    let raised: string[] = refused === null ? [...(h.raised?.(values) ?? [])] : [];
    try {
      runAct(act, () => {
        if (op.write) {
          const after = getConfig();
          if (before && after !== before) {
            raised = [...new Set([...raised, ...raisedFields(before, after)])];
            if (!act.wrote.kinds.has('config')) {
              const line = configAuditEntry(before, after, { op: 'act', via: 'persona' });
              if (line) recordWrite(line);
            }
          }
          if (act.wrote.count === 0) recordWrite(actLine(op, subject, refused));
        }
      });
      if (op.write) say(session, { tool: op.tool, op: op.op, id: act.id, subject, reason: refused, raised, target: lineTarget(op, values) });
    } finally {
      act.open = false;
      finished();
    }

    if (refused !== null) throw new ToolError(t(failure !== null ? 'main.persona.door.failed' : 'main.persona.door.refused', { tool: op.tool, op: op.op, reason: refused }));

    // What the model reads: the result, masked by the answer's values and the app's redaction, cut, and fenced when it comes from outside the app. A secret read is the one
    // value that is given as it is; it is in the answer's mask from that moment, and the record of what was read holds its name only.
    const shaped = h.shape ? h.shape(result, values) : result;
    const rawText = render(shaped);
    const readSecret = op.tool === 'Secrets' && op.op === 'read';
    const body = readSecret ? rawText : mask(redact(rawText));
    const text = clip(body, RESULT_MAX);
    if (!op.write) {
      const stored = op.tool === 'Settings' && op.op === 'get' && /(?:^|\.)instructions$/.test(String(values.path ?? '')) ? `[${rawText.length} characters]` : cut(oneLine(text), 240);
      session.remember({ tool: op.tool, op: op.op, target: targetText(op, values), excerpt: stored });
    }
    if (op.write) return text ? `${t('main.persona.door.done')}\n${text}` : t('main.persona.door.done');
    return op.outside && text ? `<data>\n${fence(text)}\n</data>` : text;
  }

  function finish(session: AnswerSession): void {
    if (session.acts.more <= 0) return;
    const count = session.acts.more;
    session.acts.more = 0;
    try {
      forumStore().append(session.thread, { kind: 'system', author: { type: 'app' }, code: 'persona.act.more', params: { count } });
    } catch (e) {
      console.error('[persona] could not record the acts past the cap', e instanceof Error ? e.message : e);
    }
  }

  return { run, finish };
}

/** The line of a write act whose handler wrote none: the tool and the operation, what it was about, and whether it worked. */
function actLine(op: Op, subject: string, refused: string | null): Omit<AuditEntry, 'at'> {
  return {
    kind: 'act',
    issue: 0,
    target: `${op.tool}.${op.op}`,
    via: 'persona',
    fields: { tool: op.tool, op: op.op },
    ok: refused === null,
    code: null,
    result: refused === null ? 'done' : refused,
    origin: { actionId: '', kind: 'persona', key: `${op.tool}.${op.op}`, summary: subject || null },
    by: null,
  };
}

/** The door of the running app. */
export const personaDoor: Door = createDoor();

