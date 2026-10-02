// The live activity of agent runs: a bounded ring per run, a push to every window and browser, and the job that asked for the run.
// Only short labels go in (a tool call as the agents module words it, an excerpt of the model's own narration, a state), after redaction.
// Tool results, file contents and the environment never reach this module.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { t } from '../shared/i18n';
import {
  ACTIVITY_LABEL_MAX,
  ACTIVITY_RING,
  ACTIVITY_TEXT_MAX,
  type ActivityEntry,
  type ActivityState,
} from '../shared/activity';
import { redact } from './errorlog-core';

interface Context {
  jobId: string | null;
  callId: string;
}

const als = new AsyncLocalStorage<Context>();

export interface RunActivity {
  readonly id: string;
  tool(label: string): void;
  text(text: string): void;
  blocked(label: string): void;
  status(state: Exclude<ActivityState, 'blocked'>, detail?: string): void;
}

interface Run {
  id: string;
  jobId: string | null;
  callId: string | null;
  role: string;
  entries: ActivityEntry[];
}

export interface ActivityLogOptions {
  ring?: number;
  maxRuns?: number;
  now?: () => number;
}

const ellipsize = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// A path check that fails counts as a secret: better a hidden path than a shown one.
function hidden(check: (token: string) => boolean, token: string): boolean {
  try {
    return check(token);
  } catch {
    return true;
  }
}

/** A label or an excerpt as it may be shown: one line, secrets and secret-file paths replaced, home folder shortened. */
export function safeText(text: string, max: number, isSecretPath?: (token: string) => boolean): string {
  let out = text.replace(/\s+/g, ' ').trim();
  if (isSecretPath) {
    out = out
      .split(' ')
      .map((token) => {
        const bare = token.replace(/^["'`(]+|["'`),;]+$/g, '');
        return /[/.~]/.test(bare) && hidden(isSecretPath, bare) ? '[secret file]' : token;
      })
      .join(' ');
  }
  return ellipsize(redact(out), max);
}

export function createActivityLog(options: ActivityLogOptions = {}) {
  const ring = options.ring ?? ACTIVITY_RING;
  const maxRuns = options.maxRuns ?? 60;
  const now = options.now ?? Date.now;
  const runs = new Map<string, Run>();
  const latestCall = new Map<string, string>();
  let seq = 0;
  let sink: ((entry: ActivityEntry) => void) | null = null;

  function evict(): void {
    while (runs.size > maxRuns) {
      // Finished runs go first; a run still going is only dropped when far too many pile up (one that never reported its end).
      const oldest = [...runs.values()].find((r) => r.entries.length && isDone(r)) ?? (runs.size > maxRuns * 2 ? runs.values().next().value : undefined);
      if (!oldest) return;
      runs.delete(oldest.id);
    }
  }

  const isDone = (r: Run): boolean => {
    const last = [...r.entries].reverse().find((e) => e.kind === 'status' && e.state !== 'blocked');
    return !last || last.state === 'finished' || last.state === 'failed';
  };

  function begin(role: string, o: { jobId?: string | null; callId?: string | null; isSecretPath?: (token: string) => boolean } = {}): RunActivity {
    const run: Run = { id: randomUUID(), jobId: o.jobId ?? null, callId: o.callId ?? null, role, entries: [] };
    runs.set(run.id, run);
    evict();
    let pending = '';

    const emit = (kind: ActivityEntry['kind'], label: string, state?: ActivityState): void => {
      if (!label) return;
      const entry: ActivityEntry = { seq: ++seq, runId: run.id, jobId: run.jobId, role, at: now(), kind, label, ...(state ? { state } : {}) };
      run.entries.push(entry);
      if (run.entries.length > ring) run.entries.splice(0, run.entries.length - ring);
      try {
        sink?.(entry);
      } catch (e) {
        console.error('[activity]', e instanceof Error ? e.message : e);
      }
    };
    const flush = (): void => {
      if (pending) emit('text', pending);
      pending = '';
    };

    // Reporting is never allowed to break the run it reports on.
    const safely =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A): void => {
        try {
          fn(...args);
        } catch (e) {
          console.error('[activity]', e instanceof Error ? e.message : e);
        }
      };

    return {
      id: run.id,
      tool: safely((label) => {
        flush();
        emit('tool', safeText(label, ACTIVITY_LABEL_MAX, o.isSecretPath));
      }),
      // The model's narration only counts as a step when a tool call follows it: a closing text is the answer, not a step.
      text: safely((text) => {
        pending = safeText(text, ACTIVITY_TEXT_MAX, o.isSecretPath);
      }),
      blocked: safely((label) => emit('status', t('activity.blocked', { what: safeText(label, ACTIVITY_LABEL_MAX, o.isSecretPath) }), 'blocked')),
      status: safely((state, detail) => {
        pending = '';
        const reason = detail ? safeText(detail, 160, o.isSecretPath) : '';
        emit('status', state === 'failed' && reason ? t('activity.failedWith', { reason }) : t(`activity.${state}`), state);
      }),
    };
  }

  /** Entries of a run (by run id), of the latest invocation of a job (by job id), or of the runs no job asked for (null or ''). */
  function get(id: string | null): ActivityEntry[] {
    if (id && runs.has(id)) return [...(runs.get(id) as Run).entries];
    const call = id ? latestCall.get(id) : undefined;
    const picked = [...runs.values()].filter((r) => (id ? r.jobId === id && (!call || r.callId === call) : r.jobId === null));
    return picked.flatMap((r) => r.entries).sort((a, b) => a.seq - b.seq).slice(-ring);
  }

  return {
    begin,
    get,
    setSink(fn: ((entry: ActivityEntry) => void) | null): void {
      sink = fn;
    },
    startCall(jobId: string, callId: string): void {
      latestCall.set(jobId, callId);
    },
    clear(): void {
      runs.clear();
      latestCall.clear();
    },
  };
}

export const activityLog = createActivityLog();

/** The sink of the process: index.ts points it at the window and the browsers. */
export const setActivitySink = activityLog.setSink;

/** Runs `fn` as the work of a renderer job: every agent run started inside it is attributed to that job. */
export function withActivityContext<T>(jobId: string | null, fn: () => T): T {
  if (!jobId) return fn();
  const ctx: Context = { jobId, callId: randomUUID() };
  activityLog.startCall(jobId, ctx.callId);
  return als.run(ctx, fn);
}

export function currentJobId(): string | null {
  return als.getStore()?.jobId ?? null;
}

/** A new run, attributed to the job that is current in this async chain. */
export function beginActivity(role: string, isSecretPath?: (token: string) => boolean): RunActivity {
  const ctx = als.getStore();
  return activityLog.begin(role, { jobId: ctx?.jobId ?? null, callId: ctx?.callId ?? null, isSecretPath });
}
