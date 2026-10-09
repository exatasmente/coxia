import { mentionJob } from '../../shared/activity';
import { rulesAllow } from '../../shared/ceremonyCommands';
import { cycleText } from '../../shared/cycles/text';
import type { ForumMessage, ThreadSummary } from '../../shared/forum';
import { MAX_MENTIONS } from '../../shared/forum';
import { type RunActivity, beginCallActivity } from '../activity';
import { runAgent, secretPath } from '../agents';
import { ceremonyCommands } from '../ceremonyCommands';
import { ATAS, HOME } from '../env';
import { forumStore } from '../forum';
import { type Module } from '../module';
import { runStore } from '../runs';
import { sandbox } from '../sandbox/workspace';
import { getConfig, rc } from '../workspaceConfig';
import { proceduresPort } from '../procedures';
import { answerMentions, type MentionDeps } from './answer';
import { placeOfThread } from './place';
import { proposeMention } from './propose';
import { createSharedMemory } from '../runner/activities';
import { handoffService, screenAsks, screenSessions } from '../runner/module';

// Mentions answered outside a run's thread: a squad channel, the channel the squads talk in, a conversation a person opened, and the direct conversation of an agent
// (where every message of the person calls its owner without an `@`). A run's thread stays with the runner (it has the worktree, the cycle folder and the publisher).
// An agent named here answers in the thread, read only, over a throwaway copy of the code when it runs commands; what it may write on the code host it proposes here,
// through the same door of Actions (propose.ts), and nothing runs without the person's yes. One answer at a time per thread, so the thread reads in order.

let queue: Map<string, Promise<void>> | null = null;

/** The chains of the running workspace: one promise per thread, so an answer never overtakes another in the same thread. */
const inFlight = (): Map<string, Promise<void>> => (queue ??= new Map());

/** The line of each call, from when the message was accepted until the call ends: what the conversation shows under the message. */
const callLines = new Map<string, { activity: RunActivity; queued: boolean }>();
const lineKey = (thread: string, seq: number, agent: string): string => `${thread}:${seq}:${agent}`;

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

/** The record of the activities of the running workspace, in the workspace's own folder: the mentions module only reads it. */
let shared: ReturnType<typeof createSharedMemory> | null = null;
export const sharedMemory = (): ReturnType<typeof createSharedMemory> => (shared ??= createSharedMemory(ATAS));

/** The takes of an activity reference a message carries: the number `#123`, or a whole reference `group/project#123`. */
export function refsInMessage(message: ForumMessage): string[] {
  return [...(message.text ?? '').matchAll(/(?:([\w.-]+\/[\w.-]+))?#(\d{1,6})\b/g)].map((m) => (m[1] ? `${m[1]}#${m[2]}` : (m[2] as string)));
}

export const mentionsModule: Module = () => {
  const forum = forumStore();
  const deps: MentionDeps = {
    forum,
    config: getConfig,
    engine: (call, commands) => runAgent(call, commands),
    sandbox,
    // The agents' screens come from the runner's module, which registers before this one: asked for at each answer, since they exist only once it has.
    screens: () => {
      const sessions = screenSessions();
      const asks = screenAsks();
      return sessions && asks ? { sessions, asks, handoff: handoffService() } : null;
    },
    env: () => ({ fallbackCwd: rc().projectsRoot ?? ATAS }),
    propose: proposeMention,
    procedures: proceduresPort(),
    // What the answer is told of the activities of the workspace, read from the record of the running workspace and cut by what the message named.
    memory: (place, message) => {
      const run = place.kind === 'run' ? place.run : null;
      const refs = refsInMessage(message);
      return sharedMemory().render(runStore(), { ref: run?.issue.ref ?? place.ref ?? null, refs, agents: callsOf(message, ownerOfThread(forum.summary(place.thread))) }, getConfig().language);
    },
    // A host command asks the person through the notice every screen shows, as the ceremonies do; a command the agent's rules always allow runs without asking.
    askCommand: (def, command, signal) => {
      const rules = getConfig().agents.team.find((a) => a.id === def.id)?.allowedCommands ?? def.allowedCommands;
      return rulesAllow(rules, command) ? Promise.resolve({ ok: true }) : ceremonyCommands.ask(def.id, command, signal, cycleText(def.name || def.id, getConfig().language));
    },
  };
  forum.subscribe((message) => {
    // A run's thread is the runner's: it is not this module's to answer.
    if (message.thread.startsWith('run-')) return;
    const owner = ownerOfThread(forum.summary(message.thread));
    const calls = callsOf(message, owner);
    if (!calls.length) return;
    const place = placeOfThread(forum.summary(message.thread), (id) => runStore().get(id), getConfig(), HOME);
    if (!place || place.kind === 'run') return;
    const prior = inFlight().get(message.thread);
    // Every agent called gets its line as soon as the message is accepted, as in a run's thread: working, or waiting its turn behind an answer still going in
    // this conversation or an agent named before it in the same message.
    const team = getConfig().agents.team;
    const root = rc().projectsRoot ?? ATAS;
    let ahead = !!prior;
    for (const id of calls) {
      if (!team.some((a) => a.id === id) || callLines.has(lineKey(message.thread, message.seq, id))) continue;
      const activity = beginCallActivity(id, { jobId: mentionJob(message.thread), call: { agent: id, thread: message.thread, message: message.seq }, isSecretPath: (p) => secretPath(p, root) });
      activity.status(ahead ? 'queued' : 'started');
      callLines.set(lineKey(message.thread, message.seq, id), { activity, queued: ahead });
      ahead = true;
    }
    // An agent set to run commands gets a throwaway copy here; the person's own folder is only the fallback.
    const next = (prior ?? Promise.resolve())
      // The owner of a direct conversation answers without an `@`: the calls are the ones this module resolved.
      .then(() =>
        answerMentions(place, message, {
          ...deps,
          calls,
          callOf: (id) => callLines.get(lineKey(message.thread, message.seq, id)) ?? null,
          release: (id) => void callLines.delete(lineKey(message.thread, message.seq, id)),
        }).then(() => undefined),
      )
      .catch(() => {
        // Whatever ended the chain early, no line of this message may stay on screen.
        for (const id of calls) {
          callLines.get(lineKey(message.thread, message.seq, id))?.activity.status('failed');
          callLines.delete(lineKey(message.thread, message.seq, id));
        }
      });
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
