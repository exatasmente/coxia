import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { runThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { FlowStage, Run } from '../../shared/runs';
import { callKey } from '../../shared/browser';
import { type CallScreen, type ScreenPorts, modelSeesImages, openCallScreen, promptFor } from '../browser/callScreen';
import { grantsFor } from '../browser/guard';
import type { AgentCall } from '../agents';
import type { ForumStore } from '../forum-core';
import type { SandboxSession } from '../sandbox';
import type { StageEngine } from './executor';
import { type RunnerTools, calledAgentTools } from './tools';
import { screenRules } from './screenPrompt';
import { confinedHooks } from './hooks';
import type { Denial } from './hooks';

// A conversation between two agents of the team, started by a stage that is working: the caller asks about a point, the called agent answers, and the two go
// back and forth inside a limit of rounds. The called agent starts as a reader and, when the point needs it, uses its own permissions in the team (commands per
// its `shell`, writes per its `permission`), never more; its commands run in the run's sandbox over the run's worktree, and each one is a `runner.exec` line
// under its own name — the very line a stage writes. The conversation ends when either side stops, when the round limit is reached (the caller is told and its
// stage goes on), or when the person stops the run. A call chain that comes back to an agent already in it is refused, so the loop of agents never opens.

/** Why a call is refused before it opens, or null when it may open. Pure, so the refusal lives in one place. */
export function callRefusal(o: { called: string; chain: string[]; opened: number; perStage: number }): 'cycle' | 'cap' | null {
  if (o.chain.includes(o.called)) return 'cycle';
  if (o.opened >= o.perStage) return 'cap';
  return null;
}

/** How many conversations an attempt at a stage has opened: the cap is per attempt, and a stage returned and run again gets it back. */
const opened = new Map<string, number>();
const openedKey = (runId: string, stage: string): string => `${runId}:${stage}`;
export const openedIn = (runId: string, stage: string): number => opened.get(openedKey(runId, stage)) ?? 0;
export function countOpen(runId: string, stage: string): void {
  opened.set(openedKey(runId, stage), openedIn(runId, stage) + 1);
}
/** The attempt is over: the cap starts again for a stage that is returned and run again. */
export function resetOpened(runId: string, stage: string): void {
  opened.delete(openedKey(runId, stage));
}

/** The clock the conversation gives the session it opens: the stage's own (`beat`/`pause`), so a command waiting for the person kills neither. */
export interface ConversationClock {
  beat(): void;
  pause(): () => void;
  allowed: Set<string>;
}

/** What the caller's stage must give the conversation. */
export interface ConversationDeps {
  run: Run;
  stage: FlowStage;
  caller: AgentDef;
  called: AgentDef;
  forum: ForumStore;
  config: () => WorkspaceConfig;
  engine: StageEngine;
  /** Opens the session the called agent's commands run in, over the run's worktree. Absent: the agent runs no command. */
  openSession?: (called: AgentDef, writes: boolean, clock: ConversationClock) => Promise<SandboxSession | null>;
  /** The commands the called agent may run; what the workspace allows for the stage. */
  commands: string[];
  /** What the conversation's model calls used: counted on the calling stage. */
  onUsage?: (usage: Parameters<NonNullable<AgentCall['onUsage']>>[0]) => void;
  /**
   * Commits what the called agent changed in the worktree, with the identity of the calling stage, at the conversation's close. Absent or null
   * return: the conversation commits nothing (the called agent changed nothing, or the caller does not commit for it).
   */
  commit?: (message: string) => Promise<string | null>;
  /** The abort of the run: it ends the conversation with everything else. */
  abort: AbortController;
  /** The chain of calls that brought the run here (the caller first): the cycle is refused against it. */
  chain: string[];
  /** Where the conversation happens: the run's own thread, or a new thread of the forum linked to the run. */
  place: 'run' | 'new';
  /** The app's browser and the questions to the person, for a called agent with the screen switch; absent: it gets none (a build or a docs run without screens). */
  screens?: ScreenPorts | null;
  /** The title of a new thread (read only when `place` is `new`). */
  title: string;
}

/** What a conversation leaves: the thread it happened in, how many rounds it took, and why it ended. */
export interface ConversationResult {
  thread: string;
  rounds: number;
  reason: 'ended' | 'rounds';
  /** The head of the branch after the conversation committed the called agent's work; null when nothing was committed. */
  head?: string | null;
  /** Every command the called agent ran in its session, in order (the refused ones left out, as a stage's are). */
  log?: SandboxSession['log'];
}

/** The two directions of one conversation: what the caller says, and where each answer of the called agent goes. */
export interface ConversationExchange {
  /** The next message of the caller: null when the caller has ended its stage or has nothing more to say. */
  fromCaller(): Promise<string | null>;
  /** Every answer of the called agent, as it comes: the caller's stage hands it to its agent as a message. */
  answered(text: string): void;
}

const clipped = (text: string, max = 2000): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The message of the commit a conversation makes of the called agent's work, in the repository's history (English by design). */
function conversationCommitMessage(caller: string, called: string): string {
  return `apply the conversation between ${caller} and ${called}`;
}

/**
 * Runs one conversation. The caller's first message opens it; the called agent answers and, by calling its `AskConversation` tool, asks for the next message of
 * the caller. The conversation is the record of itself: every message is a post of the agent that said it, in the conversation's thread.
 */
export async function runConversation(deps: ConversationDeps, ex: ConversationExchange): Promise<ConversationResult> {
  const cap = deps.config().runner.conversations.roundsPerConversation;
  const stage = deps.stage.id;
  const runThread = runThreadId(deps.run.id);
  const thread = deps.place === 'run' ? runThread : `${runThread}-talk-${deps.called.id}-${Date.now().toString(36)}`;
  const say = (m: Parameters<ForumStore['append']>[1]): void => {
    try {
      deps.forum.append(thread, m);
    } catch (e) {
      console.error('[runner] could not record a conversation message', thread, e instanceof Error ? e.message : e);
    }
  };

  if (deps.place === 'new') {
    try {
      deps.forum.ensureThread({ id: thread, kind: 'general', title: deps.title.slice(0, 200) });
    } catch (e) {
      console.error('[runner] could not open the conversation thread', thread, e instanceof Error ? e.message : e);
    }
    // The run's thread points at the conversation, so the person reaches it from the run and back.
    deps.forum.append(runThread, { kind: 'system', author: { type: 'app' }, code: 'runner.conversation.linked', params: { caller: deps.caller.id, called: deps.called.id, thread }, stage });
  }

  const writes = deps.called.permission === 'worktree';
  const clock: ConversationClock = { beat: () => undefined, pause: () => () => undefined, allowed: new Set() };
  let session: SandboxSession | null = null;
  let reason: ConversationResult['reason'] = 'ended';
  let rounds = 0;
  // The called agent's screen, held for the whole conversation under its own key (the agent and the thread, as a mention's is, so it outlives the conversation), and the
  // abort the call hears: the run's, or the screen's closing.
  let screen: CallScreen | null = null;
  let held: HeldScreen | undefined;
  let screenGone = false;
  let unhook = (): void => undefined;
  const screenStopped = (): void => {
    if (screenGone) return;
    screenGone = true;
    say({ kind: 'system', author: { type: 'app' }, code: 'runner.mention.stoppedScreen', params: { agent: deps.called.id }, stage });
  };
  try {
    if (deps.openSession) {
      session = await deps.openSession(deps.called, writes, clock).catch((e: unknown) => {
        say({ kind: 'system', author: { type: 'app' }, code: 'runner.conversation.noShell', params: { called: deps.called.id, reason: String(e instanceof Error ? e.message : e).slice(0, 300) }, stage });
        return null;
      });
    }
    // The caller's messages, taken one at a time: the first opens the conversation, and each answer of the called agent asks for the next.
    let closed = false;
    const nextFromCaller = async (): Promise<string | null> => {
      if (closed) return null;
      const said = await ex.fromCaller();
      if (said === null) closed = true;
      return said;
    };
    const first = await nextFromCaller();
    if (first !== null) {
      say({ kind: 'post', author: { type: 'agent', id: deps.caller.id }, text: clipped(first), stage, public: false });
      if (deps.screens) {
        screen = await openCallScreen(deps.screens, { key: callKey(thread, deps.called.id), agent: deps.called, thread, place: 'conversation', stage, issue: deps.run.issue.iid, display: null, seesImages: modelSeesImages(deps.called), pause: clock.pause, signal: deps.abort.signal }).catch((e: unknown) => {
          console.error('[runner] could not open the screen of a called agent', deps.run.id, e instanceof Error ? e.message : e);
          return null;
        });
        if (screen) held = { screen, abort: deps.abort };
        const lease = screen?.lease;
        if (screen && lease) {
          // A screen that closes under the conversation ends it: nothing the called agent was doing can go on. The run's own abort still ends it too.
          const stop = new AbortController();
          const onRun = (): void => stop.abort();
          const gone = (): void => {
            screenStopped();
            stop.abort();
          };
          deps.abort.signal.addEventListener('abort', onRun, { once: true });
          if (deps.abort.signal.aborted) stop.abort();
          lease.closed.addEventListener('abort', gone, { once: true });
          if (lease.closed.aborted) gone();
          unhook = () => {
            deps.abort.signal.removeEventListener('abort', onRun);
            lease.closed.removeEventListener('abort', gone);
          };
          held = { screen, abort: stop };
        }
      }
      for (;;) {
        if (deps.abort.signal.aborted || screenGone) break;
        if (rounds >= cap) {
          reason = 'rounds';
          say({ kind: 'system', author: { type: 'app' }, code: 'runner.conversation.rounds', params: { caller: deps.caller.id, called: deps.called.id, cap }, stage });
          break;
        }
        rounds++;
        // A turn the screen's closing cut short ends the conversation, not the run.
        const turn = await turnOf(deps, session, clock, nextFromCaller, say, held).catch((e: unknown) => {
          if (screenGone) return null;
          throw e;
        });
        if (turn === null) break;
        ex.answered(turn);
        if (closed || screenGone) break;
      }
    }
  } finally {
    // The screen is let go, not closed: it stays open and counting down for the next call of the agent in this thread.
    unhook();
    screen?.release();
    await session?.close().catch(() => undefined);
  }
  // A called agent that writes owns the worktree while it works here; what it changed is committed with the calling stage before the stage commits its own
  // work, so the reviewer reads it as the stage's. A conversation that changed nothing commits nothing (`commit` answers null).
  let head: string | null | undefined;
  if (deps.commit && deps.called.permission === 'worktree') {
    head = await deps.commit(conversationCommitMessage(deps.caller.id, deps.called.id)).catch(() => null);
  }
  deps.forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'runner.conversation.ended', params: { caller: deps.caller.id, called: deps.called.id, why: t(`main.runner.conversation.reason.${reason}`) }, stage });
  return { thread, rounds, reason, head, log: session?.log.filter((e) => !e.refused) };
}

/** The called agent's screen for the conversation, and the abort its calls hear (the run's, or the screen's closing). */
interface HeldScreen {
  screen: CallScreen;
  abort: AbortController;
}

/**
 * One turn of the called agent: it reads the caller's message and answers; calling its tool asks for the next message of the caller, and the text of the call is
 * posted in the thread as its message. A turn with no answer at all ends the conversation.
 */
async function turnOf(
  deps: ConversationDeps,
  session: SandboxSession | null,
  clock: ConversationClock,
  nextFromCaller: () => Promise<string | null>,
  say: (m: Parameters<ForumStore['append']>[1]) => void,
  held?: HeldScreen,
): Promise<string | null> {
  // The messages the called agent says through the tool, and what it answers as its final text.
  const spoken: string[] = [];
  let ended = false;
  const tools: RunnerTools = {
    sendMessage: () => '',
    callAgent: async () => '',
    askConversation: async (_to, text) => {
      spoken.push(text);
      say({ kind: 'post', author: { type: 'agent', id: deps.called.id }, text: clipped(text), stage: deps.stage.id, public: false });
      const said = await nextFromCaller();
      if (said === null) {
        ended = true;
        return t('main.runner.conversation.otherEnded');
      }
      say({ kind: 'post', author: { type: 'agent', id: deps.caller.id }, text: clipped(said), stage: deps.stage.id, public: false });
      return said;
    },
    team: { ids: [deps.caller.id, deps.called.id], caller: deps.called.id },
  };
  const writes = deps.called.permission === 'worktree';
  const denied = (den: Denial): void => {
    try {
      say({ kind: 'system', author: { type: 'app' }, code: 'runner.denied', params: { agent: deps.called.id, tool: den.tool, target: den.target || '—', reason: t(`main.runner.denied.${den.code}`) }, stage: deps.stage.id });
    } catch (e) {
      console.error('[runner] could not record a refusal of a called agent', deps.run.id, e instanceof Error ? e.message : e);
    }
  };
  const call: AgentCall = {
    agent: deps.called,
    prompt: writes ? t('main.runner.conversation.systemWrite', { called: deps.called.name, caller: deps.caller.name }) : t('main.runner.conversation.system', { called: deps.called.name, caller: deps.caller.name }),
    schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'], additionalProperties: false },
    system: [t('main.runner.conversation.role', { called: deps.called.name }), held ? screenRules(promptFor(held.screen, deps.called, deps.config().runner.sandbox, grantsFor(deps.called), false)) : ''].filter(Boolean).join('\n\n'),
    cwd: deps.run.worktree,
    confine: writes ? { root: deps.run.worktree, hooks: confinedHooks({ root: deps.run.worktree, commands: deps.commands, onDenied: denied }) } : undefined,
    exec: session ?? undefined,
    label: deps.called.id,
    maxTurns: 12,
    abort: held?.abort ?? deps.abort,
    runnerTools: calledAgentTools(tools),
    onUsage: deps.onUsage,
    ...(held?.screen.toolset ? { screen: held.screen.toolset } : {}),
  };
  const r = await deps.engine(call, deps.commands);
  if (ended) return null;
  const text = typeof (r.data as { texto?: unknown })?.texto === 'string' ? (r.data as { texto: string }).texto.trim() : '';
  // What the agent said through the tool is already posted; the final text is its closing word, if any.
  if (text && spoken[spoken.length - 1] !== text) say({ kind: 'post', author: { type: 'agent', id: deps.called.id }, text: clipped(text), stage: deps.stage.id, public: false });
  void clock;
  return text || spoken[spoken.length - 1] || null;
}
