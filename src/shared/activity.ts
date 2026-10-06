// What an agent run is doing right now, as short redacted lines. Main emits them, the window and the browser show them.
export type ActivityKind = 'tool' | 'text' | 'status';
/** `queued` is a call that was accepted while another one of the same run still runs: it is alive, and it has not started. */
export type ActivityState = 'queued' | 'started' | 'resumed' | 'finished' | 'failed' | 'blocked';

/** The `@` call a run belongs to: which agent answers, in which thread, for which message. */
/** The activity job of a conversation outside a run (a channel, a general conversation, an agent's direct one): what its calls and their steps are kept under. */
export const mentionJob = (thread: string): string => `mention:${thread}`;

export interface ActivityCall {
  /** The id of the agent that answers. */
  agent: string;
  /** The thread the line belongs to (`run-<id>`), how a conversation picks its own lines. */
  thread: string;
  /** The sequence of the message that named the agent: two calls of the same agent are two calls. */
  message: number;
}

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
  /** Present on the lines of a run an `@` call asked for, and only on those. */
  call?: ActivityCall;
}

export const ACTIVITY_EVENT = 'agent:activity';
export const ACTIVITY_GET = 'agent:activity:get';
/** Fired on window when the browser's event stream dropped and came back: what was said in the gap is fetched again. */
export const EVENTS_RECONNECTED = 'cerimonias:events-reconnected';
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

/** Whether a run still has work going on, from its last status line: a queued call counts as alive, it is waiting its turn. */
export function runActive(entries: ActivityEntry[], runId: string): boolean {
  const last = [...entries].reverse().find((e) => e.runId === runId && e.kind === 'status' && e.state !== 'blocked');
  return !!last && last.state !== 'finished' && last.state !== 'failed';
}
