import { withStageName } from './cycles/text';
import { t } from './i18n';

// The forum: one thread per run plus general threads. Messages are what agents and people say about an activity; the stores are in
// main/forum-core.ts (JSONL, append only) and main/runs-core.ts (the run each thread belongs to).

export const MESSAGE_KINDS = ['post', 'question', 'answer', 'handoff', 'decision', 'system', 'request'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

// `request` is what a liaison says to the liaison of another squad, in the squads channel: it asks something of that squad's area (a question, or a change), is
// open until an `answer` closes it, and carries the squad it comes from and the one it is for in its params.

/** Who said it: an agent of the team, the person, or the app itself (stage changes, the review limit). */
export type Author = { type: 'agent'; id: string } | { type: 'person' } | { type: 'app' };

/** A file of the run's cycle folder, by its path inside that folder. */
export interface ArtifactRef {
  path: string;
  label?: string;
}

export type ParamValue = string | number;

/** Where a thread message was mirrored on the tracker, so the thread links to it. */
export interface PublishedRef {
  target: 'issue' | 'mr';
  noteId: string | number;
  url: string | null;
}

/** What a transition asks the forum to record. The store adds the sequence number, the time and the thread. */
export interface ForumDraft {
  kind: MessageKind;
  author: Author;
  /** What the author wrote. Empty for the messages the app words itself (`code`). */
  text?: string;
  /** A message the app words: a key under `main.forum.code.*`, rendered at display time with `params`, so a language change also translates old threads. */
  code?: string;
  params?: Record<string, ParamValue>;
  /** Agent ids named in the text. */
  mentions?: string[];
  refs?: ArtifactRef[];
  /** The stage of the run the message belongs to. */
  stage?: string | null;
  /** Handoff: the agent id that takes over, or "person". */
  to?: string | null;
  /** An answer: the `seq` of the question or request it answers, when it is not the latest one open. */
  replyTo?: number | null;
  /** Public record: what an agent did, asked, was answered or was decided, and may appear on the tracker. Handoffs and stage changes stay internal. Default false. */
  public?: boolean;
  published?: PublishedRef | null;
}

export interface ForumMessage {
  v: 1;
  type: 'message';
  /** 1, 2, 3... per thread, with no gap. */
  seq: number;
  thread: string;
  /** ISO time. */
  at: string;
  kind: MessageKind;
  author: Author;
  text: string;
  code: string | null;
  params: Record<string, ParamValue>;
  mentions: string[];
  refs: ArtifactRef[];
  stage: string | null;
  to: string | null;
  /** An answer: the `seq` of the question or request it answers. */
  replyTo: number | null;
  /** Eligible to appear on the tracker. Being public is not being published: nothing is mirrored without the workspace option and an approval. */
  public: boolean;
  /** Set once the message was mirrored to the tracker. */
  published: PublishedRef | null;
}

/**
 * run: the thread of a run. general: a thread a person opened. channel: the channel of a squad, and the channel the squads talk in.
 * agent: the direct conversation of one agent of the team, which is carried in `squad` with the agent's id.
 */
export const THREAD_KINDS = ['run', 'general', 'channel', 'agent'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export interface ThreadHeader {
  v: 1;
  type: 'thread';
  id: string;
  kind: ThreadKind;
  /** The run a `run` thread belongs to. */
  runId: string | null;
  /** The squad a channel belongs to, or the agent an `agent` thread belongs to; null for any other thread and for the channel the squads talk in. */
  squad?: string | null;
  title: string;
  createdAt: string;
}

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  runId: string | null;
  /** The squad the thread is listed under: a squad's channel is its own; a run's thread is its run's squad (filled by the module that knows the runs); null otherwise. */
  squad?: string | null;
  /** The agent an `agent` thread belongs to; null for any other thread. */
  agent?: string | null;
  title: string;
  createdAt: string;
  count: number;
  lastAt: string | null;
  lastKind: MessageKind | null;
  /** A question nobody has answered yet. */
  openQuestion: boolean;
}

export interface ThreadRead {
  thread: ThreadSummary;
  messages: ForumMessage[];
  /** The highest sequence number in the thread: what to pass as `afterSeq` next time. */
  last: number;
}

/** Pushed to every window and browser on each append. */
export interface ForumEventPayload {
  thread: string;
  message: ForumMessage;
}

export const FORUM_EVENT = 'forum:message';
export const MAX_TEXT = 20_000;
export const MAX_TITLE = 120;
export const GENERAL_THREAD = 'general';
export const THREAD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const runThreadId = (runId: string): string => `run-${runId}`;

/** The channel the squads talk in: the requests liaisons make to each other, and their answers. */
export const SQUADS_CHANNEL = 'squads';
/** The channel of a squad: its general talk. Its runs' threads are listed under it. */
export const squadChannelId = (squadId: string): string => `squad-${squadId}`;
/** The direct conversation of an agent of the team: one per agent, and where what a person writes goes to it without an `@`. */
export const agentThreadId = (agentId: string): string => `agent-${agentId}`;

/** The text of a message as a person reads it: what the author wrote, or the app's own wording of its `code`. */
export function messageText(m: { text?: string; code?: string | null; params?: Record<string, ParamValue> }): string {
  const own = m.code ? t(`main.forum.code.${m.code}`, m.params && withStageName(m.params)) : '';
  return [own, m.text ?? ''].filter(Boolean).join(m.code && m.text ? '\n' : '');
}

/**
 * The agents a person addressed: `@developer` names the agent with that id (case does not matter). Only ids the team has count, so an unknown
 * `@word`, an address like `ana@example.com` or a path stays plain text. Each agent once, in the order named.
 */
export function parseMentions(text: string, agentIds: readonly string[]): string[] {
  const known = new Set(agentIds);
  const found: string[] = [];
  for (const m of text.matchAll(/(^|[^\w@/.-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const id = m[2].toLowerCase();
    if (known.has(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

/** The most agents a single message calls on: the rest are named but not answered. */
export const MAX_MENTIONS = 3;

/**
 * The `@name` a person wrote that are no agent of the team, in the order written and each once. The same boundary as `parseMentions` (an address, a path and an
 * email stay plain text), and only for a message a person wrote: what a text of an agent says is not a call.
 */
export function unknownMentions(text: string, agentIds: readonly string[]): string[] {
  const known = new Set(agentIds);
  const found: string[] = [];
  for (const m of text.matchAll(/(^|[^\w@/.-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const id = m[2];
    const key = id.toLowerCase();
    if (!known.has(key) && !found.includes(id)) found.push(id);
  }
  return found;
}
