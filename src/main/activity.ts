// The live activity of agent runs: a bounded ring per run, a push to every window and browser, and the job that asked for the run.
// A run may hang under another (a sub-agent, a called agent): that is a node of a tree, with a ring of its own, so a chatty child never pushes its parent's lines out.
// Only short labels go in (a tool call as the agents module words it, an excerpt of the model's own narration, a state, one line of the model's reasoning per turn
// and an excerpt of a called agent's reply), after redaction. Tool results, file contents and the environment never reach this module.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { t } from '../shared/i18n';
import {
  ACTIVITY_ANSWER_MAX,
  ACTIVITY_LABEL_MAX,
  ACTIVITY_NODE_MAX,
  ACTIVITY_RING,
  ACTIVITY_TEXT_MAX,
  ACTIVITY_THOUGHT_MAX,
  type ActivityCall,
  type ActivityEntry,
  type ActivityNode,
  type ActivityState,
} from '../shared/activity';
import { redact } from './errorlog-core';

interface Context {
  jobId: string | null;
  callId: string;
  /** The run id of the node whose work is current in this async chain: what a run started here hangs under. */
  parent: string | null;
}

const als = new AsyncLocalStorage<Context>();

export interface RunActivity {
  readonly id: string;
  tool(label: string): void;
  text(text: string): void;
  /** The model's reasoning of one turn: masked, one line, cut at ACTIVITY_THOUGHT_MAX; nothing is made while the workspace has the switch off. */
  thought(text: string): void;
  /** An excerpt of the reply of a called agent, posted by the code that delivers the reply: masked, cut at ACTIVITY_ANSWER_MAX. */
  answer(text: string): void;
  blocked(label: string): void;
  status(state: Exclude<ActivityState, 'blocked'>, detail?: string): void;
  /** A node under this one: same job, same call. The caller says `started` or `queued` on it. */
  child(node: ActivityNode, role?: string): RunActivity;
  /** A view whose `finished` and `failed` are ignored: one engine run that is a round of a longer exchange, closed by whoever owns the exchange. */
  lend(): RunActivity;
}

interface Run {
  id: string;
  jobId: string | null;
  callId: string | null;
  role: string;
  /** The `@` call this run answers, when a message asked for it. */
  call: ActivityCall | null;
  /** The run this one hangs under; null for the root of a tree. */
  parent: string | null;
  node: ActivityNode | null;
  entries: ActivityEntry[];
}

export interface ActivityLogOptions {
  /** Lines kept per node. */
  ring?: number;
  /** Trees (a root and everything under it) kept; finished ones go first. */
  maxRuns?: number;
  /** Nodes kept in all, over every tree; only finished trees are dropped for it. Default four times `maxRuns`. */
  maxNodes?: number;
  now?: () => number;
  /** Whether a thought is made: read each time one arrives, so the switch takes effect from the next one. */
  thoughts?: () => boolean;
}

/** What `redact` scans of a reasoning: the cut text is never shown (the line keeps ACTIVITY_THOUGHT_MAX after masking), so this only bounds the work. */
const THOUGHT_SCAN_MAX = 20_000;

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
        return /[/.~]/.test(bare) && hidden(isSecretPath, bare) ? t('activity.secretFile') : token;
      })
      .join(' ');
  }
  return ellipsize(redact(out), max);
}

/** The line a status reader looks at: the newest status that is not a refusal. */
const newestStatus = (entries: readonly ActivityEntry[]): ActivityEntry | undefined => entries.findLast((e) => e.kind === 'status' && e.state !== 'blocked');

export function createActivityLog(options: ActivityLogOptions = {}) {
  const ring = options.ring ?? ACTIVITY_RING;
  const maxRuns = options.maxRuns ?? 60;
  const maxNodes = options.maxNodes ?? maxRuns * 4;
  const now = options.now ?? Date.now;
  let thoughtsOn: () => boolean = options.thoughts ?? (() => true);
  const runs = new Map<string, Run>();
  const handles = new Map<string, RunActivity>();
  const latestCall = new Map<string, string>();
  let seq = 0;
  let sink: ((entry: ActivityEntry) => void) | null = null;

  const isDone = (r: Run): boolean => {
    const last = newestStatus(r.entries);
    return !last || last.state === 'finished' || last.state === 'failed';
  };

  /** The trees of the log, oldest first: a root (no parent, or a parent the log no longer holds) and every node under it. */
  function trees(): Run[][] {
    const out = new Map<string, Run[]>();
    const rootOf = (r: Run): string => {
      let cur = r;
      for (let hops = 0; cur.parent && runs.has(cur.parent) && hops < 64; hops++) cur = runs.get(cur.parent) as Run;
      return cur.id;
    };
    for (const r of runs.values()) {
      const root = rootOf(r);
      const list = out.get(root);
      if (list) list.push(r);
      else out.set(root, [r]);
    }
    return [...out.values()];
  }

  // A tree is finished when every node in it is; a node that has said nothing yet is not.
  const treeDone = (tree: readonly Run[]): boolean => tree.every((r) => r.entries.length > 0 && isDone(r));

  function drop(tree: readonly Run[]): void {
    for (const r of tree) {
      runs.delete(r.id);
      handles.delete(r.id);
    }
  }

  function evict(): void {
    for (;;) {
      const all = trees();
      const over = all.length > maxRuns;
      if (!over && runs.size <= maxNodes) return;
      // Finished trees go first, whole and oldest first; a live tree is only dropped when far too many pile up (one that never reported its end).
      const oldest = all.find(treeDone) ?? (all.length > maxRuns * 2 ? all[0] : undefined);
      if (!oldest) return;
      drop(oldest);
    }
  }

  function begin(
    role: string,
    o: { jobId?: string | null; callId?: string | null; call?: ActivityCall | null; parent?: string | null; node?: ActivityNode | null; isSecretPath?: (token: string) => boolean } = {},
  ): RunActivity {
    // A node belongs to the job and the call of the run it hangs under, so a tree is always one job and one call.
    const above = o.parent ? runs.get(o.parent) : undefined;
    const node = o.node ? { type: o.node.type, label: safeText(o.node.label, ACTIVITY_NODE_MAX, o.isSecretPath) } : null;
    const run: Run = {
      id: randomUUID(),
      jobId: above ? above.jobId : (o.jobId ?? null),
      callId: above ? above.callId : (o.callId ?? null),
      role,
      call: o.call ?? null,
      parent: o.parent ?? null,
      node,
      entries: [],
    };
    runs.set(run.id, run);
    let pending = '';

    const emit = (kind: ActivityEntry['kind'], label: string, state?: ActivityState): void => {
      if (!label) return;
      const entry: ActivityEntry = {
        seq: ++seq,
        runId: run.id,
        jobId: run.jobId,
        role,
        at: now(),
        kind,
        label,
        ...(state ? { state } : {}),
        ...(run.call ? { call: run.call } : {}),
        ...(run.parent ? { parent: run.parent } : {}),
        ...(run.node ? { node: run.node } : {}),
      };
      run.entries.push(entry);
      if (run.entries.length > ring) {
        // The newest status line stays even when it is older than the rest: a long node would lose its "started" line first and read as finished.
        const tail = run.entries.slice(run.entries.length - ring);
        const pinned = newestStatus(run.entries);
        run.entries = pinned && !tail.includes(pinned) ? [pinned, ...tail] : tail;
      }
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

    const handle: RunActivity = {
      id: run.id,
      tool: safely((label) => {
        flush();
        emit('tool', safeText(label, ACTIVITY_LABEL_MAX, o.isSecretPath));
      }),
      // The model's narration only counts as a step when a tool call follows it: a closing text is the answer, not a step.
      text: safely((text) => {
        pending = safeText(text, ACTIVITY_TEXT_MAX, o.isSecretPath);
      }),
      // Masked before the cut, so a credential straddling the cut is never half shown; the first characters only bound what the masking scans.
      thought: safely((text) => {
        if (!thoughtsOn()) return;
        emit('thought', safeText(text.trim().slice(0, THOUGHT_SCAN_MAX), ACTIVITY_THOUGHT_MAX, o.isSecretPath));
      }),
      answer: safely((text) => emit('answer', safeText(text, ACTIVITY_ANSWER_MAX, o.isSecretPath))),
      blocked: safely((label) => emit('status', t('activity.blocked', { what: safeText(label, ACTIVITY_LABEL_MAX, o.isSecretPath) }), 'blocked')),
      status: safely((state, detail) => {
        pending = '';
        const reason = detail ? safeText(detail, 160, o.isSecretPath) : '';
        emit('status', state === 'failed' && reason ? t('activity.failedWith', { reason }) : t(`activity.${state}`), state);
      }),
      child: (childNode, childRole) => begin(childRole ?? role, { parent: run.id, node: childNode, isSecretPath: o.isSecretPath }),
      lend: () => lent,
    };
    const lent: RunActivity = {
      ...handle,
      status: (state, detail) => {
        if (state !== 'finished' && state !== 'failed') handle.status(state, detail);
      },
    };
    handles.set(run.id, handle);
    evict();
    return handle;
  }

  /**
   * Entries of a run and everything under it (by run id), of the latest invocation of a job (by job id, with the nodes of its runs), or of the runs no job asked for (null or '').
   * A job that also has a call still going keeps it in the answer: a call waiting its turn is not the job's latest invocation.
   * There is no overall cut: each node's own ring already bounds the answer, and a cut over all of them would let a child push its parent's lines out.
   */
  function get(id: string | null): ActivityEntry[] {
    if (id && runs.has(id)) {
      const picked = new Set([id]);
      // Children are made after their parent, so one pass in insertion order reaches every descendant.
      for (const r of runs.values()) if (r.parent && picked.has(r.parent)) picked.add(r.id);
      return [...picked].flatMap((rid) => (runs.get(rid) as Run).entries).sort((a, b) => a.seq - b.seq);
    }
    const call = id ? latestCall.get(id) : undefined;
    const picked = [...runs.values()].filter((r) => (id ? r.jobId === id && (!call || r.callId === call || !isDone(r)) : r.jobId === null));
    return picked.flatMap((r) => r.entries).sort((a, b) => a.seq - b.seq);
  }

  return {
    begin,
    get,
    /** The handle of a run the log still holds: how work started under a node reaches the node it belongs to. */
    handleOf: (id: string): RunActivity | undefined => handles.get(id),
    setSink(fn: ((entry: ActivityEntry) => void) | null): void {
      sink = fn;
    },
    /** Points the switch of the reasoning at the workspace; null makes every thought welcome again. */
    setThoughtsGate(fn: (() => boolean) | null): void {
      thoughtsOn = fn ?? (() => true);
    },
    startCall(jobId: string, callId: string): void {
      latestCall.set(jobId, callId);
    },
    clear(): void {
      runs.clear();
      handles.clear();
      latestCall.clear();
    },
  };
}

export const activityLog = createActivityLog();

/** The sink of the process: index.ts points it at the window and the browsers. */
export const setActivitySink = activityLog.setSink;

/** The switch of the reasoning of the process: index.ts points it at the workspace's configuration. */
export const setThoughtsGate = activityLog.setThoughtsGate;

/**
 * Runs `fn` as the work of a renderer job: every agent run started inside it is attributed to that job. Inside a call of the same job it joins that call: a nested
 * context must not make itself the job's latest invocation, or a later backfill would drop the agent that is still working above it.
 */
export function withActivityContext<T>(jobId: string | null, fn: () => T): T {
  if (!jobId) return fn();
  if (als.getStore()?.jobId === jobId) return fn();
  const ctx: Context = { jobId, callId: randomUUID(), parent: null };
  activityLog.startCall(jobId, ctx.callId);
  return als.run(ctx, fn);
}

/** Runs `fn` as the work of the node `runId`: every run started inside it (an agent it calls) hangs under that node. */
export function withActivityParent<T>(runId: string, fn: () => T): T {
  return als.run({ ...(als.getStore() ?? { jobId: null, callId: randomUUID() }), parent: runId }, fn);
}

export function currentJobId(): string | null {
  return als.getStore()?.jobId ?? null;
}

/** The node whose work is current in this async chain, when the log still holds it. */
export function currentActivity(): RunActivity | null {
  const id = als.getStore()?.parent;
  return (id ? activityLog.handleOf(id) : undefined) ?? null;
}

/** A new run, attributed to the job that is current in this async chain and hanging under the node that is current in it, if any. */
export function beginActivity(role: string, isSecretPath?: (token: string) => boolean, o: { node?: ActivityNode } = {}): RunActivity {
  const ctx = als.getStore();
  return activityLog.begin(role, { jobId: ctx?.jobId ?? null, callId: ctx?.callId ?? null, parent: ctx?.parent ?? null, node: o.node ?? null, isSecretPath });
}

/**
 * The run of an `@` call, made as soon as the message is accepted: it belongs to the run's own activity context and carries the call's identity, so
 * the line exists while the call still waits its turn, before the engine starts it.
 */
export function beginCallActivity(role: string, o: { jobId: string; call: ActivityCall; node?: ActivityNode; isSecretPath?: (token: string) => boolean }): RunActivity {
  return activityLog.begin(role, { jobId: o.jobId, call: o.call, node: o.node ?? null, isSecretPath: o.isSecretPath });
}
