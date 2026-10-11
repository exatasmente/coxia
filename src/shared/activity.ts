// What an agent run is doing right now, as short redacted lines. Main emits them, the window and the browser show them.
export type ActivityKind = 'tool' | 'text' | 'thought' | 'answer' | 'status';
/**
 * `queued` is a call that was accepted while another one of the same run still runs: it is alive, and it has not started. `waiting` is work that reached its turn limit and
 * waits for the person to let it go on or finish it: alive too, and not the same as waiting its turn.
 */
export type ActivityState = 'queued' | 'waiting' | 'started' | 'resumed' | 'finished' | 'failed' | 'blocked';

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

/** What heads a node that is not an agent's own run: a sub-agent an agent started, or an agent it called. */
export type ActivityNodeType = 'sub' | 'call';
/** Type and the words that head the node (the kind and task of a sub-agent, the topic of a call); masked and cut in the main process. */
export interface ActivityNode {
  type: ActivityNodeType;
  label: string;
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
  /** The run id of the node this one hangs under. Absent: a root of its job (a stage's agent, a ceremony's, an `@` call). Present on every line of the node. */
  parent?: string;
  /** Present on every line of a sub-agent or a called agent: its type and the words that head it. Absent on an agent's own run. */
  node?: ActivityNode;
}

export const ACTIVITY_EVENT = 'agent:activity';
export const ACTIVITY_GET = 'agent:activity:get';
/** Fired on window when the browser's event stream dropped and came back: what was said in the gap is fetched again. */
export const EVENTS_RECONNECTED = 'cerimonias:events-reconnected';
export const ACTIVITY_RING = 200;
export const ACTIVITY_TEXT_MAX = 200;
export const ACTIVITY_LABEL_MAX = 240;
/** A thought is the model's reasoning of one turn, masked and then cut at the end. */
export const ACTIVITY_THOUGHT_MAX = 2000;
/** The excerpt of a called agent's answer, masked and then cut at the end. */
export const ACTIVITY_ANSWER_MAX = 400;
/** The words that head a node (the task of a sub-agent, the topic of a call), and the same clip inside a tool line that names them. */
export const ACTIVITY_NODE_MAX = 120;

/** The switch of the reasoning in the activity: absent (a config stored before it) reads as on. */
export const reasoningOn = (config: { runner?: { showReasoning?: boolean } | null } | null | undefined): boolean => config?.runner?.showReasoning !== false;

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
