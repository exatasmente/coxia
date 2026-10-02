// What an agent run is doing right now, as short redacted lines. Main emits them, the window and the browser show them.
export type ActivityKind = 'tool' | 'text' | 'status';
export type ActivityState = 'started' | 'resumed' | 'finished' | 'failed' | 'blocked';

export interface ActivityEntry {
  /** Grows with every entry of the process: the order, and what a backfill is merged by. */
  seq: number;
  runId: string;
  /** The renderer job that asked for the run; null when nothing did (scheduler, a call that is not a job). */
  jobId: string | null;
  role: string;
  /** Epoch ms in the main process. */
  at: number;
  kind: ActivityKind;
  label: string;
  /** Status lines only. */
  state?: ActivityState;
}

export const ACTIVITY_EVENT = 'agent:activity';
export const ACTIVITY_GET = 'agent:activity:get';
export const ACTIVITY_RING = 200;
export const ACTIVITY_TEXT_MAX = 200;
export const ACTIVITY_LABEL_MAX = 240;

const CTX_KEY = '$ctx';
const JOB_ID = /^[\w#:.@!/ -]{1,160}$/;

/** The calls of a job carry its id as a trailing marker argument; the rpc layer takes it off before the handler runs. */
export function tagArgs(args: unknown[], jobId: string | null): unknown[] {
  return jobId ? [...args, { [CTX_KEY]: { job: jobId } }] : args;
}

export function takeContext(args: unknown[]): { args: unknown[]; jobId: string | null } {
  const last = args[args.length - 1];
  if (!last || typeof last !== 'object' || Array.isArray(last)) return { args, jobId: null };
  const keys = Object.keys(last);
  if (keys.length !== 1 || keys[0] !== CTX_KEY) return { args, jobId: null };
  const job = ((last as Record<string, unknown>)[CTX_KEY] as { job?: unknown } | null)?.job;
  return { args: args.slice(0, -1), jobId: typeof job === 'string' && JOB_ID.test(job) ? job : null };
}

/** Whether a run still has work going on, from its last status line. */
export function runActive(entries: ActivityEntry[], runId: string): boolean {
  const last = [...entries].reverse().find((e) => e.runId === runId && e.kind === 'status' && e.state !== 'blocked');
  return !!last && last.state !== 'finished' && last.state !== 'failed';
}
