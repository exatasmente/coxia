import { type Author, type ForumMessage, GENERAL_THREAD, SQUADS_CHANNEL, type ThreadSummary } from './forum';

// What the forum screens decide from the threads: how a run's messages group into the chain a question walked, which threads are unread, what the lists show
// and how `@agent` is completed while typing. Pure: nothing here reads the disk or the DOM.

// ---- the chain a question walks -------------------------------------------------------------------------------------------------------

export interface ChainStep {
  /** Who passed it. */
  from: Author;
  /** Where it went: an agent id, `person` or `reporter`. */
  to: string;
  /** What the one who passed it said about why. */
  reason: string | null;
  seq: number;
}

/** A question and everything said about it until it was answered: who asked whom, each time it was passed on, why it reached the person. */
export interface QuestionChain {
  asker: Author;
  /** Who it was asked of first: an agent id, `person` or `reporter`. */
  first: string;
  steps: ChainStep[];
  /** Whom it is with now (or was with when it was answered). */
  holder: string;
  /** It reached the person (or the reporter): no agent holds it any more. */
  reachedPerson: boolean;
  /** Why it reached the person: the last reason an agent gave, or the app's own line (too many hops, an agent gone). */
  why: string | null;
  answer: ForumMessage | null;
  open: boolean;
}

/**
 * A row of a thread: a message, the chain a question walked, or a round of commands: the app's lines about the commands one agent ran (or asked to run) one after
 * the other, with nothing else said in between, which the conversation shows folded.
 */
export type ThreadRow = { type: 'message'; message: ForumMessage } | { type: 'chain'; chain: QuestionChain; messages: ForumMessage[] } | { type: 'commands'; agent: string; messages: ForumMessage[] };

/** The app's lines about one command: one ran (in a sandbox or on this computer), one waits for the person, the person's answer to it. */
const COMMAND_CODES: ReadonlySet<string> = new Set(['runner.exec', 'runner.exec.host', 'runner.command.ask', 'runner.command.once', 'runner.command.stage', 'runner.command.deny']);

export const isCommandLine = (m: ForumMessage): boolean => m.kind === 'system' && !!m.code && COMMAND_CODES.has(m.code);

const commandAgent = (m: ForumMessage): string => String((m.params as Record<string, unknown> | undefined)?.agent ?? '');

/** What the folded round says of itself: how many commands ran, and whether the last one still waits for the person (then it is shown open). */
export function commandRound(messages: readonly ForumMessage[]): { ran: number; waiting: boolean } {
  return { ran: messages.filter((m) => m.code === 'runner.exec' || m.code === 'runner.exec.host').length, waiting: messages.at(-1)?.code === 'runner.command.ask' };
}

const target = (m: ForumMessage): string => m.to ?? 'person';
const isAgent = (a: Author, id: string): boolean => a.type === 'agent' && a.id === id;
const isPerson = (to: string): boolean => to === 'person' || to === 'reporter';

/**
 * Groups the messages of a thread for reading. A question starts a chain; what follows belongs to it while it is the holder's reason (a post by the agent the
 * question is with), the holder passing it on (a question by that agent), or the app saying why it went up (a `runner.chain.*` line); an answer ends it. Any
 * other message is a row of its own, and a chain whose question nobody has answered yet stays open. `text` words a message of the app (its `code`).
 */
export function groupThread(messages: readonly ForumMessage[], text: (m: ForumMessage) => string = (m) => m.text): ThreadRow[] {
  type Pending = { chain: QuestionChain; messages: ForumMessage[] };
  const rows: ThreadRow[] = [];
  // `open`: the chain being read. `waiting`: the last chain left with no answer: the answer comes later, after whatever was said in between, and still belongs to it.
  const at: { open: Pending | null; waiting: Pending | null } = { open: null, waiting: null };
  const close = (): void => {
    const o = at.open;
    if (!o) return;
    rows.push({ type: 'chain', chain: o.chain, messages: o.messages });
    at.waiting = o.chain.answer ? null : o;
    at.open = null;
  };
  for (const m of messages) {
    const open = at.open;
    if (m.kind === 'question') {
      const holder = open?.chain.holder;
      // An agent that holds the question passes it on: a hop of the same chain.
      if (open && !open.chain.answer && holder && !isPerson(holder) && isAgent(m.author, holder)) {
        const last = open.messages.at(-1);
        const reason = last?.kind === 'post' && isAgent(last.author, holder) ? last.text : null;
        open.chain.steps.push({ from: m.author, to: target(m), reason, seq: m.seq });
        open.chain.holder = target(m);
        open.chain.reachedPerson = isPerson(target(m));
        if (open.chain.reachedPerson) open.chain.why = reason ?? open.chain.why;
        open.messages.push(m);
        continue;
      }
      close();
      const to = target(m);
      at.open = { chain: { asker: m.author, first: to, steps: [], holder: to, reachedPerson: isPerson(to) || m.author.type === 'app', why: null, answer: null, open: true }, messages: [m] };
      continue;
    }
    if (open && !open.chain.answer) {
      if (m.kind === 'answer') {
        open.chain.answer = m;
        open.chain.open = false;
        open.messages.push(m);
        close();
        continue;
      }
      const reason = m.kind === 'post' && isAgent(m.author, open.chain.holder);
      const why = m.kind === 'system' && !!m.code?.startsWith('runner.chain.');
      if (reason || why) {
        if (why) {
          open.chain.why = text(m);
          open.chain.reachedPerson = true;
        }
        open.messages.push(m);
        continue;
      }
    }
    // Something else is said: the question stays where it is (still open when nobody answered it) and the message stands alone.
    close();
    const waiting = at.waiting;
    if (m.kind === 'answer' && waiting) {
      waiting.chain.answer = m;
      waiting.chain.open = false;
      waiting.messages.push(m);
      at.waiting = null;
      continue;
    }
    // A command line joins the round the same agent is in, when nothing else was said since; otherwise it starts one.
    if (isCommandLine(m)) {
      const last = rows.at(-1);
      if (last?.type === 'commands' && last.agent === commandAgent(m)) last.messages.push(m);
      else rows.push({ type: 'commands', agent: commandAgent(m), messages: [m] });
      continue;
    }
    rows.push({ type: 'message', message: m });
  }
  close();
  return rows;
}

/** The messages of a thread with `incoming` folded in: one copy of each sequence number, in order. Returns `list` itself when nothing is new. */
export function mergeMessages(list: readonly ForumMessage[], incoming: readonly ForumMessage[]): readonly ForumMessage[] {
  const have = new Set(list.map((m) => m.seq));
  const fresh = incoming.filter((m) => !have.has(m.seq) && have.add(m.seq));
  return fresh.length ? [...list, ...fresh].sort((a, b) => a.seq - b.seq) : list;
}

// ---- what is unread -------------------------------------------------------------------------------------------------------------------

/** How many messages of a thread the person has not seen: the sequence numbers have no gap, so the count is the last one. */
export const unreadOf = (s: Pick<ThreadSummary, 'id' | 'count'>, seen: Readonly<Record<string, number>>): number => Math.max(0, s.count - (seen[s.id] ?? 0));

export const totalUnread = (threads: readonly Pick<ThreadSummary, 'id' | 'count'>[], seen: Readonly<Record<string, number>>): number => threads.reduce((n, s) => n + unreadOf(s, seen), 0);

/** The person has read a thread up to `seq`: never goes backwards. */
export const markSeen = (seen: Readonly<Record<string, number>>, thread: string, seq: number): Record<string, number> => ((seen[thread] ?? 0) >= seq ? { ...seen } : { ...seen, [thread]: seq });

/** What a device that never opened the forum has read: everything there is now, so only what is said from here on counts as new. */
export const baselineSeen = (threads: readonly Pick<ThreadSummary, 'id' | 'count'>[]): Record<string, number> => Object.fromEntries(threads.map((s) => [s.id, s.count]));

// ---- the lists --------------------------------------------------------------------------------------------------------------------------

export interface ForumLists {
  /** The general thread and the channels (the one the squads talk in, then one per squad). */
  channels: ThreadSummary[];
  /** The threads of the runs and the general threads the person opened, the latest activity first. */
  threads: ThreadSummary[];
}

const activity = (s: ThreadSummary): string => s.lastAt ?? s.createdAt;

/**
 * What the forum screen lists, optionally for one squad: its channel and the threads of its runs. Without a squad, everything: the general thread first, the
 * channel the squads talk in, the squads' channels by name; then every other thread, the latest activity first.
 */
export function forumLists(all: readonly ThreadSummary[], squad: string | null = null): ForumLists {
  const rank = (s: ThreadSummary): number => (s.id === GENERAL_THREAD ? 0 : s.id === SQUADS_CHANNEL ? 1 : 2);
  const isChannel = (s: ThreadSummary): boolean => s.kind === 'channel' || s.id === GENERAL_THREAD;
  const scoped = squad ? all.filter((s) => s.squad === squad) : [...all];
  return {
    channels: scoped.filter(isChannel).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)),
    threads: scoped.filter((s) => !isChannel(s)).sort((a, b) => activity(b).localeCompare(activity(a))),
  };
}

// ---- @agent while typing ----------------------------------------------------------------------------------------------------------------

/** The `@word` the caret is at the end of, when there is one: where it starts and what has been typed after the `@`. The same boundary the parser of mentions uses. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[^\w@/.-])@([A-Za-z0-9_-]*)$/.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2].toLowerCase() } : null;
}

/** The agents a partial mention may mean: those whose id or name starts with it first, then those that contain it. `name` is the name as shown. */
export function mentionOptions<T extends { id: string; name: string }>(team: readonly T[], query: string, limit = 6): T[] {
  const q = query.toLowerCase();
  const starts = (a: T): boolean => a.id.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q);
  const has = (a: T): boolean => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
  return [...team.filter(starts), ...team.filter((a) => !starts(a) && has(a))].slice(0, limit);
}

/** The text with the partial mention replaced by the whole one and a space after it, and where the caret goes. */
export function applyMention(text: string, start: number, caret: number, id: string): { text: string; caret: number } {
  const after = text.slice(caret);
  // A space is already there when the mention was typed in the middle of a sentence: it is not doubled.
  return { text: `${text.slice(0, start)}@${id}${after.startsWith(' ') ? '' : ' '}${after}`, caret: start + id.length + 2 };
}
