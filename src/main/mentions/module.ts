import type { ForumMessage, ThreadSummary } from '../../shared/forum';
import { MAX_MENTIONS } from '../../shared/forum';
import { runAgent } from '../agents';
import { forumStore } from '../forum';
import { type Module } from '../module';
import { runStore } from '../runs';
import { sandbox } from '../sandbox/workspace';
import { getConfig } from '../workspaceConfig';
import { answerMentions } from './answer';
import { placeOfThread } from './place';
import { proposeMention } from './propose';

// Mentions answered outside a run's thread: a squad channel, the channel the squads talk in, a conversation a person opened, and the direct conversation of an agent
// (where every message of the person calls its owner without an `@`). A run's thread stays with the runner (it has the worktree, the cycle folder and the publisher).
// An agent named here answers in the thread, read only, over a throwaway copy of the code when it runs commands; what it may write on the code host it proposes here,
// through the same door of Actions (propose.ts), and nothing runs without the person's yes. One answer at a time per thread, so the thread reads in order.

let queue: Map<string, Promise<void>> | null = null;

/** The chains of the running workspace: one promise per thread, so an answer never overtakes another in the same thread. */
const inFlight = (): Map<string, Promise<void>> => (queue ??= new Map());

/**
 * The agents a message calls on, up to the limit. A person's post calls the names it wrote; in the direct conversation of an agent (`agent-<id>`) it also calls the
 * agent it belongs to, named first and without an `@` (an `@` for another agent still calls that one too). Any other message calls nobody: an agent's own text
 * never calls another.
 */
export function callsOf(message: ForumMessage, owner: string | null = null): string[] {
  if (message.author.type !== 'person' || message.kind !== 'post') return [];
  const named = owner && !message.mentions.includes(owner) ? [owner, ...message.mentions] : [...message.mentions];
  return named.slice(0, MAX_MENTIONS);
}

/** The agent the thread belongs to, when it is the direct conversation of one: the id after `agent-`, null for any other thread. */
export function ownerOfThread(summary: ThreadSummary | null): string | null {
  return summary?.kind === 'agent' ? (summary.agent ?? summary.squad ?? null) : null;
}

export const mentionsModule: Module = () => {
  const forum = forumStore();
  forum.subscribe((message) => {
    // A run's thread is the runner's: it is not this module's to answer.
    if (message.thread.startsWith('run-')) return;
    const owner = ownerOfThread(forum.summary(message.thread));
    const calls = callsOf(message, owner);
    if (!calls.length) return;
    const place = placeOfThread(forum.summary(message.thread), (id) => runStore().get(id), getConfig());
    if (!place || place.kind === 'run') return;
    const prior = inFlight().get(message.thread) ?? Promise.resolve();
    // Only readers reach here (an agent set to commands got a throwaway copy): the folder the person works in is the fallback.
    const next = prior
      .then(() =>
        answerMentions(place, message, {
          forum,
          config: getConfig,
          engine: (call, commands) => runAgent(call, commands),
          sandbox,
          env: () => ({ fallbackCwd: getConfig().projects.roots[0] ?? '' }),
          propose: proposeMention,
        }).then(() => undefined),
      )
      .catch(() => undefined);
    inFlight().set(message.thread, next);
    void next.finally(() => {
      if (inFlight().get(message.thread) === next) inFlight().delete(message.thread);
    });
  });
};

/** Waits for the answers the module started (a test, or a caller that wants the threads settled). */
export async function mentionsIdle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const all = [...inFlight().values()];
    if (!all.length) return;
    await Promise.allSettled(all);
  }
}
