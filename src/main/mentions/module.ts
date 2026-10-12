import { mentionJob } from '../../shared/activity';
import { rulesAllow } from '../../shared/ceremonyCommands';
import { cycleText } from '../../shared/cycles/text';
import type { ForumMessage, ThreadSummary } from '../../shared/forum';
import { MAX_MENTIONS } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { type RunActivity, beginCallActivity } from '../activity';
import { runAgent, secretPath } from '../agents';
import { ceremonyCommands } from '../ceremonyCommands';
import { turnAsks } from '../turnAsks';
import { ATAS, HOME } from '../env';
import { forumStore } from '../forum';
import { type Module } from '../module';
import { runStore } from '../runs';
import { sandbox } from '../sandbox/workspace';
import { getConfig, rc } from '../workspaceConfig';
import { memoryPort } from '../memory/runtime';
import { procedureOffers, proceduresPort } from '../procedures';
import { answerMentions, type MentionDeps } from './answer';
import { type MentionPlace, placeOfThread } from './place';
import { personaOf } from '../../shared/config/team';
import { agentThreadId } from '../../shared/forum';
import { viaOf } from '../rpc';
import { personaDoor } from '../persona/door';
import { type AnswerSession, createSession } from '../persona/session';
import { proposeMention } from './propose';
import { createSharedMemory } from '../runner/activities';
import { personaLive, personaScreens, personaSessions, personaStop, personaThreadNow, setAnswerPending } from '../persona/runtime';
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
    // A sub-agent of an answer that uses its last turn asks the person, as the runner's do.
    turnAsks,
    procedures: proceduresPort(),
    memoryPort: memoryPort(),
    // What the message names, for the ranking of the memory's list.
    named: (place, message) => ({ refs: refsInMessage(message), agents: callsOf(message, ownerOfThread(forum.summary(place.thread))) }),
    // The persona's chat: the live text of its answers, and what its button tool checks a target against.
    persona: { live: personaLive(), screens: personaScreens(), door: personaDoor, sessions: personaSessions() },
    // An answer the persona's Stop ended does not write the line of a stop of one answer: the stop says it.
    latched: (thread) => held(thread),
    // The last turn of an answer that had trial and error and kept nothing, and the card it may leave (#187).
    offers: procedureOffers(),
    // What the answer is told of the activities of the workspace, read from the record of the running workspace and cut by what the message named.
    memory: (place, message, narrow) => {
      const run = place.kind === 'run' ? place.run : null;
      const refs = refsInMessage(message);
      // A call with the shared memory gets only what the message is about or named; the rest is lines of its index.
      return sharedMemory().render(runStore(), { ref: run?.issue.ref ?? place.ref ?? null, refs, agents: callsOf(message, ownerOfThread(forum.summary(place.thread))), ...(narrow ? { onlyNamed: true } : {}) }, getConfig().language);
    },
    // A host command asks the person through the notice every screen shows, as the ceremonies do; a command the agent's rules always allow runs without asking.
    askCommand: (def, command, signal) => {
      const rules = getConfig().agents.team.find((a) => a.id === def.id)?.allowedCommands ?? def.allowedCommands;
      return rulesAllow(rules, command) ? Promise.resolve({ ok: true }) : ceremonyCommands.ask(def.id, command, signal, cycleText(def.name || def.id, getConfig().language));
    },
  };
  // Whether the thread is the real persona's and the latch is set: its messages wait for Resume. The persona's test copy is never stopped, since it cannot act.
  const held = (thread: string): boolean => thread === personaThreadNow() && personaStop().stopped();
  setAnswerPending((thread, seq) => [...callLines.keys()].some((key) => key.startsWith(`${thread}:${seq}:`)));

  /** Chains the answer to a message behind the one going in its thread. A persona's message reached while stopped waits for Resume instead, in the place it holds. */
  const chain = (message: ForumMessage, place: MentionPlace, calls: string[], door: string, session: AnswerSession | null): void => {
    const prior = inFlight().get(message.thread);
    // An agent set to run commands gets a throwaway copy here; the person's own folder is only the fallback.
    const next = (prior ?? Promise.resolve())
      // The owner of a direct conversation answers without an `@`: the calls are the ones this module resolved.
      .then(() => {
        // The latch is read again at the moment the answer would begin: a message queued behind an answer that was stopped waits as the ones written after it.
        if (held(message.thread)) {
          personaStop().hold({ thread: message.thread, seq: message.seq, start: () => chain(message, place, calls, door, session) });
          return undefined;
        }
        return answerMentions(place, message, {
          ...deps,
          calls,
          door,
          ...(session ? { session } : {}),
          callOf: (id) => callLines.get(lineKey(message.thread, message.seq, id)) ?? null,
          release: (id) => void callLines.delete(lineKey(message.thread, message.seq, id)),
        }).then(() => undefined);
      })
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
  };

  forum.subscribe((message) => {
    // A run's thread is the runner's: it is not this module's to answer.
    if (message.thread.startsWith('run-')) return;
    const owner = ownerOfThread(forum.summary(message.thread));
    const calls = callsOf(message, owner);
    if (!calls.length) return;
    const place = placeOfThread(forum.summary(message.thread), (id) => runStore().get(id), getConfig(), HOME);
    if (!place || place.kind === 'run') return;
    // How the message came in, read here: this is inside the call that carried it (the window's or a paired browser's), which the chain that answers it no longer is.
    accept(message, place, calls, viaOf() === 'paired' ? 'paired' : 'window');
  });

  // A schedule's line (#275) is the app's, so it calls nobody by itself: the schedule names the persona, and the answer goes through the same lines, chain and latch.
  wake = (message, persona, door) => {
    const place = placeOfThread(forum.summary(message.thread), (id) => runStore().get(id), getConfig(), HOME);
    if (!place || place.kind === 'run') return Promise.reject(new Error(t('main.schedules.error.thread')));
    // An agent schedule (#250) wakes an agent of the team the same way; one that left the team is said as such.
    const team = getConfig().agents.team;
    if (!team.some((a) => a.id === persona)) return Promise.reject(new Error(t(personaOf(team) ? 'main.schedules.error.agent' : 'main.schedules.error.persona')));
    accept(message, place, [persona], door);
    return inFlight().get(message.thread) ?? Promise.resolve();
  };

  /** Opens the lines of the calls of a message and starts its answer behind the ones going in its thread. */
  function accept(message: ForumMessage, place: MentionPlace, calls: string[], door: string): void {
    const prior = inFlight().get(message.thread);
    const stopped = held(message.thread);
    // Every agent called gets its line as soon as the message is accepted, as in a run's thread: working, or waiting its turn behind an answer still going in
    // this conversation or an agent named before it in the same message. A message of a stopped persona waits for Resume, which is waiting its turn.
    const team = getConfig().agents.team;
    const root = rc().projectsRoot ?? ATAS;
    let ahead = !!prior || stopped;
    // The persona's answer keeps a session (what it read, the values it must never write back): made now, so the line of its call shares the mask.
    const persona = personaOf(team);
    const session = persona && message.thread === agentThreadId(persona.id) && calls.includes(persona.id) ? createSession({ persona: persona.id, thread: message.thread, seq: message.seq, door }) : null;
    // A schedule's line (#250) names its schedule: the call's node says which firing it is.
    const fromSchedule = message.author.type === 'app' && typeof message.params?.schedule === 'string' ? { schedule: message.params.schedule } : {};
    for (const id of calls) {
      if (!team.some((a) => a.id === id) || callLines.has(lineKey(message.thread, message.seq, id))) continue;
      const activity = beginCallActivity(id, { jobId: mentionJob(message.thread), call: { agent: id, thread: message.thread, message: message.seq }, node: { type: 'call', label: message.text, ...fromSchedule }, isSecretPath: (p) => secretPath(p, root), ...(session && id === persona?.id ? { mask: (text: string) => session.maskText(text) } : {}) });
      activity.status(ahead ? 'queued' : 'started');
      callLines.set(lineKey(message.thread, message.seq, id), { activity, queued: ahead });
      ahead = true;
    }
    // Written while stopped: nothing begins, and the message is held in its place. Resume starts it through the chain every answer goes through.
    if (stopped) {
      personaStop().hold({ thread: message.thread, seq: message.seq, start: () => chain(message, place, calls, door, session) });
      return;
    }
    chain(message, place, calls, door, session);
  }
};

let wake: ((message: ForumMessage, persona: string, door: string) => Promise<void>) | null = null;

/**
 * Starts the persona's answer to a line the app posted (a schedule's, #275), by the door given, and settles when the answers going in that conversation are over. Before the
 * module registered there is nothing to answer with, and it fails.
 */
export function wakePersona(message: ForumMessage, persona: string, door: string): Promise<void> {
  // i18n-ignore: developer error: the schedules fire only once the modules are registered
  return wake ? wake(message, persona, door) : Promise.reject(new Error('the mentions module is not registered'));
}

/** Whether an answer is going, or waiting its turn, in this thread: what stops a conversation from being emptied or its agent deleted under it. */
export const answerPending = (thread: string): boolean => inFlight().has(thread) || personaStop().holds(thread);

/** Waits for the answers the module started (a test, or a caller that wants the threads settled). */
export async function mentionsIdle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const all = [...inFlight().values()];
    if (!all.length) return;
    await Promise.allSettled(all);
  }
}
