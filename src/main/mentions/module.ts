import type { ForumMessage } from '../../shared/forum';
import { MAX_MENTIONS } from '../../shared/forum';
import { runAgent } from '../agents';
import { ATAS } from '../env';
import { forumStore } from '../forum';
import { type Module } from '../module';
import { runStore } from '../runs';
import { sandbox } from '../sandbox/workspace';
import { getConfig, rc } from '../workspaceConfig';
import { answerMentions, type MentionDeps } from './answer';
import { placeOfThread } from './place';

// Mentions answered outside a run's thread: a squad channel, the channel the squads talk in, a conversation a person opened. A run's thread stays with the runner
// (it has the worktree, the cycle folder and the publisher). An agent named here answers in the thread, read only, over a throwaway copy of the code when it runs
// commands; nothing here writes to the code host. One answer at a time per thread, so the thread reads in order.

let queue: Map<string, Promise<void>> | null = null;

/** The chains of the running workspace: one promise per thread, so an answer never overtakes another in the same thread. */
const inFlight = (): Map<string, Promise<void>> => (queue ??= new Map());

/** The agents a person's message calls on, up to the limit; empty for any other message (an agent's own text never calls another). */
export function callsOf(message: ForumMessage): string[] {
  if (message.author.type !== 'person' || message.kind !== 'post' || !message.mentions.length) return [];
  return message.mentions.slice(0, MAX_MENTIONS);
}

export const mentionsModule: Module = () => {
  const forum = forumStore();
  const deps: MentionDeps = {
    forum,
    config: getConfig,
    engine: (call, commands) => runAgent(call, commands),
    sandbox,
    env: () => ({ fallbackCwd: rc().projectsRoot ?? ATAS }),
  };
  forum.subscribe((message) => {
    // A run's thread is the runner's: it is not this module's to answer.
    if (!callsOf(message).length || message.thread.startsWith('run-')) return;
    const place = placeOfThread(forum.summary(message.thread), (id) => runStore().get(id), getConfig());
    if (!place || place.kind === 'run') return;
    const prior = inFlight().get(message.thread) ?? Promise.resolve();
    // An agent set to run commands gets a throwaway copy here; the person's own folder is only the fallback.
    const next = prior
      .then(() => answerMentions(place, message, deps).then(() => undefined))
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
