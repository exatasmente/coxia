import { resolve } from 'node:path';
import { ACTIVITY_LABEL_MAX, type ActivityEntry, type ActivityKind, type ActivityState } from '../../shared/activity';
import {
  CLAUDE_SESSIONS_LINES_EVENT,
  CLAUDE_SESSIONS_STATE_EVENT,
  type ClaudeAnswerResult,
  type ClaudeSessionLines,
  type ClaudeSessionResult,
  type ClaudeSessionsList,
  type PendingClaudePermission,
  claudeJob,
} from '../../shared/claudeSessions';
import type { Through } from '../../shared/auditoria';
import type { AppEvent } from '../../shared/types';
import type { ClaudeAsks } from './asks-core';
import { type Driven, type InputMessage, type OwnedRegistry, createOwned, inputQueue } from './owned';
import type { MachineSessions, RawMessage } from './source';

// What the screen asks of the machine's Claude Code sessions: list, read and follow them, send to one, answer its permission requests, stop its turn, end a process the app
// started, start a new one. Every text that leaves here is masked (the same `redact` as the activity lines). Sending and starting are refused in a test workspace before the
// SDK is touched. Events go to the window only: the module hands an emitter that never reaches a paired browser.

export type AuditAction = 'message' | 'permission' | 'stop' | 'start';

type PermissionAnswer = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string };

export interface QueryOptions {
  cwd: string;
  resume?: string;
  forkSession?: boolean;
  abortController: AbortController;
  canUseTool(tool: string, input: Record<string, unknown>, o: { signal: AbortSignal }): Promise<PermissionAnswer>;
}

export interface DrivenQuery extends AsyncIterable<RawMessage> {
  interrupt(): Promise<unknown>;
}

export interface ServiceDeps {
  source: MachineSessions;
  query(params: { prompt: AsyncIterable<InputMessage>; options: QueryOptions }): DrivenQuery;
  /** The SDK can be loaded: `reason` says why not. */
  cli(): { ok: boolean; reason: string };
  isTest(): boolean;
  /** The project folders of the workspace, expanded. */
  folders(): string[];
  redact(text: string): string;
  /** To the desktop window only. */
  emit(ev: AppEvent): void;
  audit(action: AuditAction, sessionId: string, fields: Record<string, string>): void;
  asks: ClaudeAsks;
  owned?: OwnedRegistry;
  now?(): number;
  /** How often an open session is read again. */
  every?(ms: number, fn: () => void): () => void;
}

export const FOLLOW_MS = 2000;
const INPUT_MAX = 400;
const DENIED = 'The person denied this tool from Coxia.';

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const blocks = (message: unknown): unknown[] => {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
};

const textOf = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((b) => (typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join(' ');
  return '';
};

/** The activity lines of one message: the person's words, the answer, each tool call and result, the end of a turn. Thinking and system lines are left out. */
export function entriesOf(m: RawMessage, of: string, redact: (t: string) => string, next: () => number, at: number): ActivityEntry[] {
  const line = (kind: ActivityKind, text: string, state?: ActivityState): ActivityEntry => ({
    seq: next(),
    runId: of,
    jobId: claudeJob(of),
    role: 'claude',
    at,
    kind,
    label: clip(redact(text.replace(/\s+/g, ' ').trim()), ACTIVITY_LABEL_MAX),
    ...(state ? { state } : {}),
  });
  const out: ActivityEntry[] = [];
  if (m.type === 'result') {
    out.push(line('status', m.is_error ? textOf(m.result) || m.subtype || '' : '', m.is_error ? 'failed' : 'finished'));
    return out;
  }
  if (m.type !== 'user' && m.type !== 'assistant') return out;
  for (const b of blocks(m.message)) {
    const block = b as { type?: string; text?: unknown; name?: unknown; input?: unknown; content?: unknown };
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) out.push(line(m.type === 'user' ? 'status' : 'answer', m.type === 'user' ? `› ${block.text}` : block.text));
    else if (block.type === 'tool_use') out.push(line('tool', `${String(block.name ?? '')} ${JSON.stringify(block.input ?? {})}`));
    else if (block.type === 'tool_result') out.push(line('text', textOf(block.content)));
  }
  return out;
}

export interface ClaudeSessionsService {
  list(): Promise<ClaudeSessionsList>;
  read(sessionId: string): Promise<ClaudeSessionLines>;
  follow(sessionId: string | null): void;
  send(sessionId: string, text: string): Promise<ClaudeSessionResult>;
  answer(id: string, decision: unknown, through: Through): ClaudeAnswerResult;
  pending(): PendingClaudePermission[];
  stop(sessionId: string): Promise<ClaudeSessionResult>;
  end(sessionId: string): ClaudeSessionResult;
  start(folder: string, text: string): Promise<ClaudeSessionResult>;
  folders(): string[];
  /** The feature was turned off: every process the app started ends and nothing is followed. */
  shutdown(): void;
}

const refuse = (reason: Exclude<ClaudeSessionResult, { ok: true }>['reason'], message?: string): ClaudeSessionResult => ({ ok: false, reason, ...(message ? { message } : {}) });

export function createClaudeSessions(d: ServiceDeps): ClaudeSessionsService {
  const owned = d.owned ?? createOwned();
  const now = d.now ?? Date.now;
  const every = d.every ?? ((ms, fn) => {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  });
  let seq = 0;
  const next = (): number => ++seq;
  const lines = (of: string, mode: ClaudeSessionLines['mode'], entries: ActivityEntry[]): void => {
    if (mode === 'append' && !entries.length) return;
    d.emit({ type: 'module', name: CLAUDE_SESSIONS_LINES_EVENT, payload: { of, mode, entries } satisfies ClaudeSessionLines });
  };
  const state = (): void => d.emit({ type: 'module', name: CLAUDE_SESSIONS_STATE_EVENT, payload: owned.list() });
  const driving = (id: string): Driven | undefined => owned.get(id) ?? owned.all().find((x) => x.of === id);
  // Every process the app started, including one whose id is not known yet: turning the feature off ends them all.
  const started = new Set<Driven>();
  const fail = (e: unknown): string => d.redact(e instanceof Error ? e.message : String(e));
  // An SDK error can name a path or echo input: it leaves the main process masked.
  const masked = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      throw new Error(fail(e));
    }
  };

  async function read(sessionId: string): Promise<ClaudeSessionLines> {
    const at = now();
    const entries = (await masked(() => d.source.messages(sessionId))).flatMap((m) => entriesOf(m, sessionId, d.redact, next, at));
    return { of: sessionId, mode: 'replace', entries };
  }

  /** Starts a process on a session (a new one, a resume or a copy) and resolves once its id is known; null with the reason when it ended first. */
  function drive(o: { cwd: string; resume?: string; fork: boolean; of: string | null }, text: string): Promise<{ driven: Driven } | { error: string }> {
    const input = inputQueue();
    const abort = new AbortController();
    let failure = '';
    let known: (v: Driven | null) => void = () => undefined;
    const idKnown = new Promise<Driven | null>((r) => (known = r));
    const driven: Driven = {
      sessionId: '',
      cwd: o.cwd,
      busy: true,
      forked: o.fork,
      of: o.of,
      push(t) {
        driven.busy = true;
        input.push(t);
        state();
      },
      interrupt: async () => {
        await q.interrupt();
      },
      end() {
        input.close();
        abort.abort();
      },
    };
    const canUseTool: QueryOptions['canUseTool'] = async (tool, toolInput, { signal }) => {
      const outcome = await d.asks.ask({ sessionId: driven.sessionId, tool, input: clip(d.redact(JSON.stringify(toolInput)), INPUT_MAX) }, signal);
      return outcome.decision === 'allow' ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: DENIED };
    };
    started.add(driven);
    const q = d.query({ prompt: input.iterable, options: { cwd: o.cwd, ...(o.resume ? { resume: o.resume } : {}), ...(o.fork ? { forkSession: true } : {}), abortController: abort, canUseTool } });
    input.push(text);
    void (async () => {
      try {
        for await (const m of q) {
          if (!driven.sessionId && typeof m.session_id === 'string' && m.session_id) {
            driven.sessionId = m.session_id;
            owned.set(driven);
            known(driven);
            state();
          }
          lines(o.of ?? driven.sessionId, 'append', entriesOf(m, o.of ?? driven.sessionId, d.redact, next, now()));
          if (m.type === 'result') {
            driven.busy = false;
            state();
          }
        }
      } catch (e) {
        failure = fail(e);
        const of = o.of ?? driven.sessionId;
        if (of) lines(of, 'append', [{ seq: next(), runId: of, jobId: claudeJob(of), role: 'claude', at: now(), kind: 'status', label: clip(failure, ACTIVITY_LABEL_MAX), state: 'failed' }]);
      } finally {
        input.close();
        started.delete(driven);
        if (driven.sessionId) {
          owned.remove(driven.sessionId);
          d.asks.dropSession(driven.sessionId);
        }
        known(null);
        state();
      }
    })();
    return idKnown.then((x) => (x ? { driven: x } : { error: failure }));
  }

  type Following = { id: string; stop: () => void; size: number };
  let following: Following | null = null;

  return {
    async list() {
      const cli = d.cli();
      const live = d.source.live().map((s) => ({ ...s, cwd: d.redact(s.cwd) }));
      const base = { running: live.filter((s) => s.kind === 'interactive'), background: live.filter((s) => s.kind === 'background'), owned: owned.list().map((o) => ({ ...o, cwd: d.redact(o.cwd) })) };
      if (!cli.ok) return { cli: 'missing', reason: d.redact(cli.reason), transcripts: [], ...base };
      try {
        const transcripts = (await d.source.transcripts()).map((s) => ({ ...s, title: d.redact(s.title), firstPrompt: clip(d.redact(s.firstPrompt), ACTIVITY_LABEL_MAX), cwd: d.redact(s.cwd), branch: d.redact(s.branch) }));
        return { cli: 'ok', reason: '', transcripts, ...base };
      } catch (e) {
        return { cli: 'missing', reason: fail(e), transcripts: [], ...base };
      }
    },
    read,
    follow(sessionId) {
      following?.stop();
      following = null;
      if (!sessionId) return;
      const f: Following = { id: sessionId, stop: () => undefined, size: -1 };
      following = f;
      f.stop = every(FOLLOW_MS, () => {
        void d.source.messages(sessionId).then(
          (all) => {
            if (following !== f || all.length === f.size) return;
            f.size = all.length;
            const at = now();
            lines(sessionId, 'replace', all.flatMap((m) => entriesOf(m, sessionId, d.redact, next, at)));
          },
          () => undefined,
        );
      });
    },
    async send(sessionId, text) {
      if (d.isTest()) return refuse('test-workspace');
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) return refuse('empty');
      const mine = driving(sessionId);
      if (mine) {
        if (mine.busy) return refuse('busy');
        mine.push(body);
        d.audit('message', mine.sessionId, { action: 'message', length: String(body.length), forked: String(mine.forked), of: sessionId });
        return { ok: true, sessionId: mine.sessionId, forked: mine.forked };
      }
      const live = d.source.live().filter((s) => s.sessionId === sessionId);
      const transcript = (await masked(() => d.source.transcripts())).find((s) => s.sessionId === sessionId);
      if (!transcript && !live.length) return refuse('unknown');
      // Another process holds the session open: the message goes to a copy, so the two never write the same transcript.
      const held = live.length > 0;
      const r = await drive({ cwd: transcript?.cwd || live[0].cwd, resume: sessionId, fork: held, of: sessionId }, body);
      if ('error' in r) return refuse('failed', r.error);
      d.audit('message', r.driven.sessionId, { action: 'message', length: String(body.length), forked: String(held), of: sessionId });
      return { ok: true, sessionId: r.driven.sessionId, forked: held };
    },
    answer: (id, decision, through) => d.asks.answer(id, decision, through),
    pending: () => d.asks.list(),
    async stop(sessionId) {
      const mine = driving(sessionId);
      if (!mine || !mine.busy) return refuse('not-running');
      await mine.interrupt();
      d.audit('stop', mine.sessionId, { action: 'stop', ended: 'false' });
      return { ok: true, sessionId: mine.sessionId, forked: mine.forked };
    },
    end(sessionId) {
      const mine = driving(sessionId);
      if (!mine) return refuse('not-owned');
      mine.end();
      d.audit('stop', mine.sessionId, { action: 'stop', ended: 'true' });
      return { ok: true, sessionId: mine.sessionId, forked: mine.forked };
    },
    async start(folder, text) {
      if (d.isTest()) return refuse('test-workspace');
      const cwd = typeof folder === 'string' && folder ? resolve(folder) : '';
      if (!cwd || !d.folders().some((f) => resolve(f) === cwd)) return refuse('folder');
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) return refuse('empty');
      const r = await drive({ cwd, fork: false, of: null }, body);
      if ('error' in r) return refuse('failed', r.error);
      d.audit('start', r.driven.sessionId, { action: 'start', length: String(body.length) });
      return { ok: true, sessionId: r.driven.sessionId, forked: false };
    },
    folders: () => d.folders(),
    shutdown() {
      following?.stop();
      following = null;
      for (const x of started) x.end();
    },
  };
}
